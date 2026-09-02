import { EOL } from "os"
import { Effect } from "effect"
import { Registry } from "@/nfcore/registry"
import { Samplesheet } from "@/nfcore/samplesheet"
import { effectCmd, fail } from "../../effect-cmd"

export const SamplesheetCommand = effectCmd({
  command: "samplesheet <pipeline>",
  describe: "show an nf-core pipeline's samplesheet columns from its schema (read-only)",
  // Uses global registry/schema caches; no project InstanceContext needed.
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("pipeline", { describe: "nf-core pipeline name, e.g. 'rnaseq'", type: "string" })
      .option("release", { describe: "release tag (defaults to latest stable)", type: "string" }),
  handler: Effect.fn("Cli.debug.samplesheet")(function* (args: { pipeline?: string; release?: string }) {
    if (!args.pipeline) return yield* fail("pipeline name is required")
    const registry = yield* Registry.Service
    const samplesheet = yield* Samplesheet.Service
    let release = args.release
    if (!release) {
      const info = yield* registry.get(args.pipeline)
      if (!info?.latestRelease) return yield* fail(`nf-core/${args.pipeline} has no stable release; pass --release`)
      release = info.latestRelease
    }
    const spec = yield* samplesheet.schema(args.pipeline, release).pipe(Effect.catch((e) => fail(e.message)))
    process.stdout.write(Samplesheet.summarizeColumns(spec) + EOL)
  }),
})
