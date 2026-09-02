import { EOL } from "os"
import { Effect } from "effect"
import { Critique } from "@/nfcore/critique"
import { effectCmd, fail } from "../../effect-cmd"

export const CritiqueCommand = effectCmd({
  command: "critique <analysis>",
  describe: "run the adaptive critique for an analysis type (read-only)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("analysis", { describe: "analysis description or pipeline/method name", type: "string" })
      .option("replicates", { describe: "biological replicates per group", type: "number" })
      .option("groups", { describe: "number of groups compared", type: "number" }),
  handler: Effect.fn("Cli.debug.critique")(function* (args: {
    analysis?: string
    replicates?: number
    groups?: number
  }) {
    if (!args.analysis) return yield* fail("an analysis description is required")
    const result = Critique.critique(args.analysis, {
      replicatesPerGroup: args.replicates,
      groups: args.groups,
    })
    process.stdout.write(Critique.summarize(result) + EOL)
  }),
})
