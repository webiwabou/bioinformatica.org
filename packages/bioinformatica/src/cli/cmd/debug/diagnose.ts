import { EOL } from "os"
import { Effect } from "effect"
import { Failure } from "@/nfcore/failure"
import { effectCmd, fail } from "../../effect-cmd"

export const DiagnoseCommand = effectCmd({
  command: "diagnose [runDir]",
  describe: "diagnose a failed nf-core/Nextflow run from its logs (read-only)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("runDir", { describe: "run directory containing .nextflow.log", type: "string" })
      .option("error", { describe: "error text to classify instead of / in addition to a run dir", type: "string" }),
  handler: Effect.fn("Cli.debug.diagnose")(function* (args: { runDir?: string; error?: string }) {
    if (!args.runDir && !args.error) return yield* fail("provide a run directory or --error text")
    const failure = yield* Failure.Service
    const diagnosis = yield* failure.diagnose({ runDir: args.runDir, error: args.error })
    process.stdout.write(Failure.summarize(diagnosis) + EOL)
  }),
})
