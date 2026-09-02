export * as Verify from "./verify"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { CorpusSnapshot } from "@/bio/snapshot"
import { InstanceState } from "@/effect/instance-state"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { Context, Effect, Layer, Schema } from "effect"
import path from "path"

// Cold verification: does what this project recorded still agree with what is on disk?
//
// The point is trust inversion. A campaign's own agent wrote the manifests, so the agent
// re-asserting that they are fine proves nothing. This check runs with NO MODEL and NO
// NETWORK — it reads files, re-hashes bytes, and compares numbers — so a collaborator, a
// reviewer, or a CI job can run it without running Bioinformatica's brain. Anything that needed a
// model or an upstream fetch would be re-deriving the claim rather than checking it, so
// this module deliberately depends on nothing but the filesystem.
//
// Two failure modes are kept strictly apart, because conflating them is how a broken
// corpus passes review:
//   - a project with no corpus manifests has nothing to verify (ok, exit 0)
//   - a manifest whose data file is missing, unreadable, or altered is a FAILURE
// There is no "could not tell" that reads as success.

export type Verdict = "pass" | "fail" | "skip"

export interface Check {
  /** The manifest this check is about, as a project-relative path. */
  readonly name: string
  readonly verdict: Verdict
  /** One line a human can act on: what was compared and what was found. */
  readonly detail: string
}

export interface Report {
  readonly directory: string
  readonly checks: readonly Check[]
  readonly counts: { readonly pass: number; readonly fail: number; readonly skip: number }
  /** False if any check failed. A report with no checks at all is ok. */
  readonly ok: boolean
}

/**
 * An attempted read. The `ok` discriminant exists so an I/O failure can never be mistaken
 * for an empty file — a zero-row snapshot legitimately has empty contents (see
 * `CorpusSnapshot.toNdjson([]) === ""`), and collapsing both into `undefined` would let a
 * deleted corpus verify as an empty one.
 */
export type Read<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: string }

export interface Evidence {
  /** Project-relative path of the manifest, used as the check name. */
  readonly name: string
  /** The manifest, decoded, or why that failed. */
  readonly manifest: Read<CorpusSnapshot.Manifest>
  /**
   * The data file's bytes, or why they could not be read. Absent only when the manifest
   * itself did not decode, so there was no data path to try.
   */
  readonly data?: Read<string>
}

/** Directories whose contents are not this project's records. */
const SKIP_DIRS = new Set(["node_modules", "work", ".git", ".nextflow", ".venv"])

/**
 * Whether a project-relative path is one of ours to check. Nextflow's `work/` is full of
 * staged copies and symlinks of the same corpus files; checking them would report the same
 * bytes several times and fail loudly the moment a work directory is cleaned.
 */
export function isScanned(relative: string): boolean {
  return !relative.split(/[\\/]/).some((segment) => SKIP_DIRS.has(segment))
}

/** Manifests are written next to their data as `<name>.manifest.json` (see `bio/snapshot.ts`). */
export function isManifestPath(relative: string): boolean {
  return relative.endsWith(".manifest.json") && isScanned(relative)
}

/**
 * Line count of an NDJSON body. Mirrors how the snapshot was written: one JSON record per
 * line, and `JSON.stringify` escapes newlines inside strings, so no record can span lines.
 * Blank lines are not records; the writer emits exactly one trailing newline.
 */
export function countRows(text: string): number {
  let rows = 0
  for (const line of text.split("\n")) if (line.trim().length > 0) rows++
  return rows
}

function short(digest: string): string {
  return digest.length > 12 ? `${digest.slice(0, 12)}…` : digest
}

/**
 * The whole check, as a pure function of already-read bytes. Compares the recorded sha256,
 * row count and byte count against the data file as it is now.
 *
 * Note the data file is compared as decoded UTF-8 text, the same encoding the writer used.
 * A byte that is no longer valid UTF-8 decodes to a replacement character and therefore
 * still changes the digest — corruption fails, which is the direction that matters.
 */
export function checkSnapshot(evidence: Evidence): Check {
  const name = evidence.name
  if (!evidence.manifest.ok) {
    // A file that claims the manifest name but cannot be read as one is a broken record,
    // not an absent one. Skipping it here would hide exactly the corruption we are looking for.
    return { name, verdict: "fail", detail: `manifest could not be read: ${evidence.manifest.error}` }
  }
  const manifest = evidence.manifest.value
  if (!evidence.data) {
    return { name, verdict: "fail", detail: `no read was attempted for the data file ${manifest.data}` }
  }
  if (!evidence.data.ok) {
    return { name, verdict: "fail", detail: `data file ${manifest.data} is missing or unreadable: ${evidence.data.error}` }
  }

  const text = evidence.data.value
  const problems: string[] = []
  const digest = CorpusSnapshot.sha256(text)
  if (digest !== manifest.sha256) {
    problems.push(`sha256 is ${short(digest)}, manifest records ${short(manifest.sha256)}`)
  }
  const rows = countRows(text)
  if (rows !== manifest.rows) problems.push(`${rows} rows on disk, manifest records ${manifest.rows}`)
  const bytes = Buffer.byteLength(text, "utf8")
  if (bytes !== manifest.bytes) problems.push(`${bytes} bytes on disk, manifest records ${manifest.bytes}`)

  if (problems.length > 0) {
    return { name, verdict: "fail", detail: `${manifest.data}: ${problems.join("; ")}` }
  }
  return {
    name,
    verdict: "pass",
    detail: `${manifest.data}: ${manifest.rows} rows, ${manifest.bytes} bytes, sha256 ${short(manifest.sha256)}`,
  }
}

/** Tally the checks. Pure, so the exit code is a property of the data, not of the run. */
export function report(directory: string, checks: readonly Check[]): Report {
  const ordered = [...checks].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const counts = {
    pass: ordered.filter((c) => c.verdict === "pass").length,
    fail: ordered.filter((c) => c.verdict === "fail").length,
    skip: ordered.filter((c) => c.verdict === "skip").length,
  }
  return { directory, checks: ordered, counts, ok: counts.fail === 0 }
}

const ANSI = {
  reset: "\x1b[0m",
  green: "\x1b[92m",
  red: "\x1b[91m",
  dim: "\x1b[90m",
}

const MARK: Record<Verdict, string> = { pass: "✓", fail: "✗", skip: "–" }
const COLOR: Record<Verdict, string> = { pass: ANSI.green, fail: ANSI.red, skip: ANSI.dim }

/**
 * The receipt. Colour is opt-in so the rendered text is deterministic by default — a
 * receipt that a reviewer pastes into an email should not carry escape codes, and tests
 * compare plain strings.
 */
export function format(value: Report, options: { readonly color?: boolean } = {}): string {
  const paint = (verdict: Verdict, text: string) =>
    options.color ? `${COLOR[verdict]}${text}${ANSI.reset}` : text

  const lines = [`Cold verify — ${value.directory}`, ""]
  if (value.checks.length === 0) {
    lines.push("No corpus manifests found. Nothing to verify.", "")
    lines.push(paint("pass", "OK — but this project has recorded no snapshots, so nothing was checked."))
    return lines.join("\n")
  }

  const width = Math.max(...value.checks.map((c) => c.name.length))
  for (const check of value.checks) {
    lines.push(`  ${paint(check.verdict, MARK[check.verdict])} ${check.name.padEnd(width)}  ${check.detail}`)
  }
  lines.push("")
  const tally = `${value.counts.pass} passed, ${value.counts.fail} failed${value.counts.skip > 0 ? `, ${value.counts.skip} skipped` : ""}`
  lines.push(
    value.ok
      ? paint("pass", `OK — ${tally}. Every manifest matches its data.`)
      : paint("fail", `FAILED — ${tally}. Recorded outputs do not match their manifests.`),
  )
  return lines.join("\n")
}

export interface Interface {
  /** Verify a project directory. Relative paths resolve against the current instance. */
  readonly verify: (directory?: string) => Effect.Effect<Report>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/NfcoreVerify") {}

export const use = serviceUse(Service)

function reason(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const verify = Effect.fn("NfcoreVerify.verify")(function* (directory?: string) {
      const ctx = yield* InstanceState.context
      const root = path.isAbsolute(directory ?? "") ? directory! : path.resolve(ctx.directory, directory ?? ".")

      // A discovery failure becomes a FAILING check rather than an empty result. Swallowing
      // it would turn an unreadable project into "nothing to verify, exit 0" — the one
      // answer a verifier must never give when it could not look.
      const found = yield* fs
        .glob("**/*.manifest.json", { cwd: root, absolute: true, include: "file" })
        .pipe(Effect.map((paths) => ({ ok: true as const, value: paths })), Effect.catch((cause) => Effect.succeed({ ok: false as const, error: reason(cause) })))
      if (!found.ok) {
        return report(root, [
          { name: ".", verdict: "fail", detail: `could not scan ${root} for manifests: ${found.error}` },
        ])
      }

      const checks: Check[] = []
      for (const manifestPath of found.value) {
        const relative = path.relative(root, manifestPath).split(path.sep).join("/")
        if (!isManifestPath(relative)) continue

        const manifest: Read<CorpusSnapshot.Manifest> = yield* fs
          .readJson(manifestPath)
          .pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(CorpusSnapshot.Manifest)),
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catch((cause) => Effect.succeed({ ok: false as const, error: reason(cause) })),
          )

        if (!manifest.ok) {
          checks.push(checkSnapshot({ name: relative, manifest }))
          continue
        }

        // `data` is recorded relative to the manifest, so a moved corpus folder still verifies.
        const dataPath = path.resolve(path.dirname(manifestPath), manifest.value.data)
        const data: Read<string> = yield* fs
          .readFileString(dataPath)
          .pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catch((cause) => Effect.succeed({ ok: false as const, error: reason(cause) })),
          )
        checks.push(checkSnapshot({ name: relative, manifest, data }))
      }

      return report(root, checks)
    })

    return Service.of({ verify })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node] })
