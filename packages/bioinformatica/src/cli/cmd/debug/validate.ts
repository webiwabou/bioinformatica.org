import { EOL } from "os"
import { Effect } from "effect"
import { Registry } from "@/nfcore/registry"
import { Samplesheet } from "@/nfcore/samplesheet"
import { Params } from "@/nfcore/params"
import { NfcoreCommand } from "@/nfcore/command"
import { Validation } from "@/nfcore/validation"
import { effectCmd, fail } from "../../effect-cmd"

// Exercise the generic nf-core capabilities against each curated pipeline and
// report a pass/fail matrix. Hits the network; run on demand.
export const ValidateCommand = effectCmd({
  command: "validate [pipelines..]",
  describe: "validate Bioinformática.org's generic capabilities across a curated set of nf-core pipelines",
  instance: false,
  builder: (yargs) => yargs.positional("pipelines", { describe: "pipelines to check (default: curated set)", type: "string" }),
  handler: Effect.fn("Cli.debug.validate")(function* (args: { pipelines?: string | readonly string[] }) {
    const registry = yield* Registry.Service
    const samplesheet = yield* Samplesheet.Service
    const params = yield* Params.Service

    const requested = Array.isArray(args.pipelines)
      ? args.pipelines
      : typeof args.pipelines === "string"
        ? [args.pipelines]
        : []
    const selected =
      requested.length > 0
        ? requested.map((p) => ({ name: String(p), domain: "custom", analysis: undefined }))
        : Validation.PIPELINES

    const results: Validation.PipelineResult[] = []
    for (const { name, domain, analysis } of selected) {
      const info = yield* registry.get(name)
      const release = info?.latestRelease

      const registryCheck: Validation.CheckResult = release
        ? { ok: true, detail: `${release}${info?.latestNextflowVersion ? `, Nextflow ${info.latestNextflowVersion}` : ""}` }
        : { ok: false, detail: info ? "no stable release" : "not found in registry" }

      let samplesheetCheck: Validation.CheckResult = { ok: false, detail: "skipped (no release)" }
      let paramsCheck: Validation.CheckResult = { ok: false, detail: "skipped (no release)" }
      let commandCheck: Validation.CheckResult = { ok: false, detail: "skipped (no release)" }

      if (release) {
        const spec = yield* samplesheet.schema(name, release).pipe(Effect.catch((e) => Effect.succeed(e)))
        // The capability is: fetch and parse the pipeline's own schema_input.json
        // into a usable column spec. Whether the schema marks columns
        // required via a flat `required` array is the pipeline's authoring choice
        // (some, like ampliseq, express it with anyOf conditionals), so the check
        // is "parsed at least one column", with the required count as info.
        samplesheetCheck =
          "columns" in spec
            ? {
                ok: spec.columns.length > 0,
                detail: `${spec.columns.length} columns (${spec.columns.filter((c) => c.required).length} required)`,
              }
            : { ok: false, detail: spec.message }

        const all = yield* params.all(name, release).pipe(Effect.catch((e) => Effect.succeed(e)))
        paramsCheck = Array.isArray(all)
          ? { ok: all.length > 0, detail: `${all.length} parameters` }
          : { ok: false, detail: all.message }

        const built = NfcoreCommand.build({ pipeline: name, release, backend: "docker", mode: "test", outdir: "results" })
        const expected = `nextflow run nf-core/${name}`
        commandCheck = { ok: built.command.startsWith(expected), detail: built.command }
      }

      // Phase 2: the adaptive critique classification is pure, so it is checked
      // regardless of whether the network-backed release lookup succeeded.
      const critiqueCheck = Validation.critiqueCheck(name, domain, analysis)

      results.push(
        Validation.result(name, domain, release, {
          registry: registryCheck,
          samplesheet: samplesheetCheck,
          params: paramsCheck,
          command: commandCheck,
          critique: critiqueCheck,
        }),
      )
      process.stdout.write(`${results[results.length - 1].ok ? "✔" : "✘"} ${name}${EOL}`)
    }

    process.stdout.write(EOL + Validation.formatMatrix(results) + EOL)
    if (results.some((r) => !r.ok)) return yield* fail("some pipelines failed validation", 1)
  }),
})
