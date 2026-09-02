import { EOL } from "os"
import { Effect } from "effect"
import { Registry } from "@/nfcore/registry"
import { Environment } from "@/environment/detect"
import { NfcoreCommand } from "@/nfcore/command"
import { effectCmd, fail } from "../../effect-cmd"

export const RunCommandCommand = effectCmd({
  command: "run-command <pipeline>",
  describe: "build the nextflow run command for an nf-core pipeline (does not run it)",
  // Uses global registry/environment; no project InstanceContext needed.
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("pipeline", { describe: "nf-core pipeline name, e.g. 'rnaseq'", type: "string" })
      .option("mode", { describe: "test | run", type: "string", choices: ["test", "run"], default: "test" })
      .option("release", { describe: "release tag (defaults to latest stable)", type: "string" })
      .option("input", { describe: "samplesheet path (for a real run)", type: "string" })
      .option("outdir", { describe: "results directory", type: "string" }),
  handler: Effect.fn("Cli.debug.runCommand")(function* (args: {
    pipeline?: string
    mode?: string
    release?: string
    input?: string
    outdir?: string
  }) {
    if (!args.pipeline) return yield* fail("pipeline name is required")
    const registry = yield* Registry.Service
    const environment = yield* Environment.Service

    let release = args.release
    if (!release) release = (yield* registry.get(args.pipeline))?.latestRelease
    if (!release) return yield* fail(`nf-core/${args.pipeline} has no stable release; pass --release`)

    const report = yield* environment.detect()
    const backend = report.containerBackend === "conda" ? "conda" : "docker"

    const built = NfcoreCommand.build({
      pipeline: args.pipeline,
      release,
      backend,
      mode: args.mode === "run" ? "run" : "test",
      outdir: args.outdir ?? "results",
      input: args.input,
    })
    process.stdout.write(NfcoreCommand.summarize(built) + EOL)
  }),
})
