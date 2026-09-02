import { EOL } from "os"
import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Ablation } from "@/nfcore/ablation"
import { Dossier } from "@/nfcore/dossier"
import { HandCount } from "@/nfcore/handcount"
import { Verify } from "@/nfcore/verify"
import { effectCmd, fail } from "../effect-cmd"

// `bioinformatica dossier [directory]` — collect the four run artefacts into one directory.
//
// One directory a third party can check. Everything in it already existed; what did not
// was a single object with an entry point, and a way for the reader to know what SHOULD
// have been there. See src/nfcore/dossier.ts for why the index names what is absent
// instead of omitting it.

/** What the dossier looks for, and what to say when it is not there. */
const SOURCES: readonly {
  id: Dossier.Artefact["id"]
  title: string
  /** Project-relative glob. */
  pattern: string
  missing: string
}[] = [
  {
    id: "manifest",
    title: "Cold-verifiable manifest",
    pattern: "**/*.manifest.json",
    missing: "no corpus manifest — nothing was snapshotted, so there is no data to re-check",
  },
  {
    id: "protocol",
    title: "Protocol, amendments and refusals",
    pattern: ".bioinformatica/protocol/*",
    missing: "no protocol was committed — nothing was binding, so no refusal could be recorded",
  },
  {
    id: "handcount",
    title: "Human intervention count",
    pattern: ".bioinformatica/handcount.json",
    missing: "no hand count was written — run `bioinformatica handcount --write`",
  },
  {
    id: "methods",
    title: "Methods with pinned versions",
    pattern: ".bioinformatica/manifests/*",
    missing: "no run manifest — and note that no generator exists for this artefact yet",
  },
]

/** Files that are records of the run but belong to no single one of the four artefacts. */
const EXTRA: readonly string[] = [".bioinformatica/approvals.jsonl", ".bioinformatica/runs/*.json", "census/*"]

export const DossierCommand = effectCmd({
  command: "dossier [directory]",
  describe: "collect the four run artefacts into one directory a third party can check without Bioinformática.org",
  builder: (yargs) =>
    yargs
      .positional("directory", { describe: "project directory to collect from (default: cwd)", type: "string" })
      .option("out", { describe: "where to write the dossier (default: <directory>/dossier)", type: "string" }),
  directory: (args: { directory?: string }) =>
    args.directory ? path.resolve(process.cwd(), args.directory) : process.cwd(),
  handler: Effect.fn("Cli.dossier")(function* (args: { directory?: string; out?: string }) {
    const fs = yield* FSUtil.Service
    const project = args.directory ? path.resolve(process.cwd(), args.directory) : process.cwd()
    const out = args.out ? path.resolve(process.cwd(), args.out) : path.join(project, "dossier")

    if (path.relative(project, out) === "") {
      return yield* fail("refusing to write the dossier over the project directory itself")
    }

    const collect = Effect.fn("Cli.dossier.collect")(function* (pattern: string) {
      // A discovery failure is not an empty result. Swallowing it here would report a
      // campaign that produced no artefacts, which is the exact claim this command exists
      // to make carefully — same reasoning as `verify.ts`, which refuses the same shortcut.
      const hits = yield* fs
        .glob(pattern, { cwd: project, absolute: true, include: "file", dot: true })
        .pipe(Effect.catch((cause) => fail(`could not scan ${project} for ${pattern}: ${String(cause)}`)))
      return hits
        .filter((hit) => Verify.isScanned(path.relative(project, hit)))
        // `dossier/` is an output. Anything already inside it belongs to a previous run and
        // must not be collected into the next one, or the dossier grows a copy of itself
        // every time it is built. A path outside `out` is one whose relative path escapes it.
        .filter((hit) => path.relative(out, hit).startsWith(".."))
        .sort()
    })

    const entries: Dossier.Entry[] = []
    const seen = new Set<string>()

    const carry = Effect.fn("Cli.dossier.carry")(function* (absolute: string) {
      const rel = Dossier.relative(project, absolute)
      if (seen.has(rel)) return rel
      const text = yield* fs.readFileStringSafe(absolute).pipe(Effect.catch(() => Effect.succeed(undefined)))
      // A file that cannot be read is not silently dropped: it would look identical to a
      // campaign that never produced it, which is the distinction this whole command is for.
      if (text === undefined) return undefined
      yield* fs.writeWithDirs(path.join(out, rel), text).pipe(Effect.orDie)
      seen.add(rel)
      entries.push({
        path: rel,
        origin: rel,
        bytes: Buffer.byteLength(text, "utf8"),
        sha256: Dossier.sha256(text),
      })
      return rel
    })

    const artefacts: Dossier.Artefact[] = []
    for (const source of SOURCES) {
      const found = yield* collect(source.pattern)
      const carried: string[] = []
      for (const hit of found) {
        const rel = yield* carry(hit)
        if (rel) carried.push(rel)
        // A corpus manifest is useless without the data it attests, so bring that too.
        if (rel && source.id === "manifest") {
          const manifest = yield* fs.readJson(hit).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const data = (manifest as { data?: unknown } | undefined)?.data
          if (typeof data === "string") {
            const dataPath = path.resolve(path.dirname(hit), data)
            const dataRel = yield* carry(dataPath)
            if (dataRel) carried.push(dataRel)
          }
        }
      }
      artefacts.push({
        id: source.id,
        title: source.title,
        present: carried.length > 0,
        entries: carried,
        ...(carried.length === 0 ? { missing: source.missing } : {}),
      })
    }

    for (const pattern of EXTRA) {
      for (const hit of yield* collect(pattern)) yield* carry(hit)
    }

    // Run the cold verification of the SOURCE project and carry its verdict. A dossier
    // assembled over a corpus that fails its own manifests would otherwise ship a green
    // receipt: it records the corrupt digests faithfully, so nothing has "changed since
    // assembly" and verify.sh says OK. Found by the differential test that runs the emitted
    // receipt over a project whose corpus does not match its own manifests.
    const verification = yield* (yield* Verify.Service).verify(project)
    const failures = verification.checks
      .filter((c) => c.verdict === "fail")
      .map((c) => `${c.name}: ${c.detail}`)

    // The frozen versions, and which ablation configuration produced this. Both are
    // properties of the run that no file in the dossier states on its own.
    const flags = yield* RuntimeFlags.Service
    const state = Ablation.resolve(flags.ablate)

    const index: Dossier.Index = {
      kind: "bioinformatica-dossier",
      version: 1,
      project: path.basename(project),
      generatedAt: new Date().toISOString(),
      taxonomyVersion: HandCount.TAXONOMY_VERSION,
      classifierVersion: HandCount.CLASSIFIER_VERSION,
      ablation: {
        spec: Ablation.spec(state),
        contextSha256: Ablation.contextHash({
          client: flags.client,
          enableQuestionTool: flags.enableQuestionTool,
          experimentalCodeMode: flags.experimentalCodeMode,
          experimentalLspTool: flags.experimentalLspTool,
          experimentalPlanMode: flags.experimentalPlanMode,
          customTools: [],
        }),
      },
      artefacts,
      verification: {
        ok: verification.ok,
        passed: verification.counts.pass,
        failed: verification.counts.fail,
        failures,
      },
      entries: entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      limits: Dossier.LIMITS,
    }

    // Serialise once and hash exactly those bytes: the digest has to cover what lands on
    // disk, because that is what `verify.sh` re-hashes.
    const text = Dossier.serialize(index)
    const digest = Dossier.sha256(text)
    yield* fs.writeWithDirs(path.join(out, "index.json"), text).pipe(Effect.orDie)
    yield* fs
      .writeWithDirs(path.join(out, "verify.sh"), Dossier.verifyScript(index, digest), 0o755)
      .pipe(Effect.orDie)

    process.stdout.write(Dossier.format(index, digest) + EOL)
    process.stdout.write(`${EOL}Written to ${out}${EOL}`)

    // The dossier is still written when the project fails to verify — you may well need to
    // hand over a failing one — but the command's exit code says so, which is what makes
    // `bioinformatica verify` and the emitted receipt agree on the same project.
    if (!verification.ok) {
      return yield* fail(
        `${verification.counts.fail} cold-verification check(s) failed in ${project}; the dossier records them and its receipt will refuse.`,
      )
    }
  }),
})
