import { EOL } from "os"
import { Effect } from "effect"
import { Objective } from "@/nfcore/objective"
import { effectCmd } from "../../effect-cmd"

export const ObjectiveCommand = effectCmd({
  command: "objective [statement]",
  describe: "show or set this project's standing campaign objective (read-only without a statement)",
  builder: (yargs) =>
    yargs
      .positional("statement", { describe: "set the objective to this statement", type: "string" })
      .option("stage", { describe: "stage name (repeatable)", type: "array", string: true })
      .option("decision", { describe: "a decision already fixed (repeatable)", type: "array", string: true }),
  handler: Effect.fn("Cli.debug.objective")(function* (args: {
    statement?: string
    stage?: string[]
    decision?: string[]
  }) {
    const objective = yield* Objective.Service
    if (args.statement) {
      const file = yield* objective.set({
        statement: args.statement,
        stages: args.stage,
        decisions: args.decision,
      })
      process.stdout.write(`Recorded at ${file}` + EOL)
    }
    const current = yield* objective.read()
    if (!current) {
      process.stdout.write("No objective recorded for this project." + EOL)
      return
    }
    process.stdout.write("--- as restated to the model every turn ---" + EOL)
    process.stdout.write(Objective.render(current) + EOL)
  }),
})
