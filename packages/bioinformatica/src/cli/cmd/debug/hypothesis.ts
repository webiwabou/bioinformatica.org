import { EOL } from "os"
import fs from "fs/promises"
import { Effect } from "effect"
import { Hypothesis } from "@/nfcore/hypothesis"
import { effectCmd, fail } from "../../effect-cmd"

export const HypothesisCommand = effectCmd({
  command: "hypothesis <file>",
  describe: "rank candidate hypotheses from a JSON file (read-only)",
  instance: false,
  builder: (yargs) =>
    yargs.positional("file", { describe: "JSON file: an array of hypotheses, or { hypotheses: [...] }", type: "string" }),
  handler: Effect.fn("Cli.debug.hypothesis")(function* (args: { file?: string }) {
    if (!args.file) return yield* fail("a JSON file of hypotheses is required")
    const text = yield* Effect.tryPromise(() => fs.readFile(args.file!, "utf8")).pipe(
      Effect.catch(() => fail(`could not read ${args.file}`)),
    )
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return yield* fail(`${args.file} is not valid JSON`)
    }
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as any).hypotheses)
        ? (parsed as any).hypotheses
        : undefined
    if (!list) return yield* fail("expected an array of hypotheses or { hypotheses: [...] }")
    process.stdout.write(Hypothesis.summarize(Hypothesis.rank(list as Hypothesis.Hypothesis[])) + EOL)
  }),
})
