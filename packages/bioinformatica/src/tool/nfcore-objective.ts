import { Effect, Schema } from "effect"
import { Objective } from "@/nfcore/objective"
import DESCRIPTION from "./nfcore-objective.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  statement: Schema.String.annotate({
    description: "The objective in the scientist's own terms — the outcome, not the method.",
  }),
  successCriteria: Schema.optional(
    Schema.Array(Schema.String).annotate({ description: "What would count as done." }),
  ),
  decisions: Schema.optional(
    Schema.Array(Schema.String).annotate({
      description:
        "Scientific choices already fixed with the scientist (thresholds, cutoffs, what counts as already-known), so a long stage never has to stop and ask.",
    }),
  ),
  stages: Schema.optional(
    Schema.Array(Schema.String).annotate({ description: "Ordered stage names for the campaign." }),
  ),
})

export const NfcoreObjectiveTool = Tool.define(
  "nfcore_objective_set",
  Effect.gen(function* () {
    const objective = yield* Objective.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      // Writes agent bookkeeping under .bioinformatica/, not scientist data:
      // read-only from the scientist's point of view, so no approval gate.
      execute: (
        params: {
          statement: string
          successCriteria?: readonly string[]
          decisions?: readonly string[]
          stages?: readonly string[]
        },
        _ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const path = yield* objective.set(params)
          return {
            title: params.statement.slice(0, 60),
            metadata: { path, stages: params.stages?.length ?? 0, decisions: params.decisions?.length ?? 0 },
            output: [
              `Objective recorded at ${path}.`,
              "It will be restated at the start of every turn in this project, including after compaction and in a new session.",
            ].join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
