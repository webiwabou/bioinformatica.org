import { EOL } from "os"
import fs from "fs/promises"
import { Effect } from "effect"
import { Report } from "@/nfcore/report"
import { effectCmd, fail } from "../../effect-cmd"

export const ReportCommand = effectCmd({
  command: "report [body]",
  describe: "render and claim-type-check a report body, optionally saving it (read-only unless --out)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("body", { describe: "report body in markdown (or use --file)", type: "string" })
      .option("file", { describe: "read the report body from this file", type: "string" })
      .option("title", { describe: "report title", type: "string", default: "Report" })
      .option("out", { describe: "also write the rendered report to this path", type: "string" }),
  handler: Effect.fn("Cli.debug.report")(function* (args: {
    body?: string
    file?: string
    title: string
    out?: string
  }) {
    const body = args.file
      ? yield* Effect.tryPromise(() => fs.readFile(args.file!, "utf8")).pipe(
          Effect.catch(() => fail(`could not read ${args.file}`)),
        )
      : args.body
    if (!body) return yield* fail("a report body is required (positional argument or --file)")

    const { content, analysis } = Report.render({ title: args.title, body })
    process.stdout.write(Report.summarizeAnalysis(analysis) + EOL + EOL)
    if (args.out) {
      yield* Effect.tryPromise(() => fs.writeFile(args.out!, content, "utf8")).pipe(
        Effect.catch(() => fail(`could not write ${args.out}`)),
      )
      process.stdout.write(`Written to ${args.out}` + EOL)
      return
    }
    process.stdout.write(content + EOL)
  }),
})
