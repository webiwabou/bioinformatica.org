import { EOL } from "os"
import { Effect } from "effect"
import { Record } from "@/nfcore/record"
import { effectCmd } from "../../effect-cmd"

export const RunsCommand = effectCmd({
  command: "runs",
  describe: "list recorded nf-core runs from this project's .bioinformatica/runs/ (read-only)",
  builder: (yargs) => yargs,
  handler: Effect.fn("Cli.debug.runs")(function* () {
    const record = yield* Record.Service
    const runs = yield* record.list()
    process.stdout.write(Record.summarize(runs) + EOL)
  }),
})
