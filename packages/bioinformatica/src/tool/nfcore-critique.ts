import { Effect, Schema } from "effect"
import { Critique } from "@/nfcore/critique"
import DESCRIPTION from "./nfcore-critique.txt"
import * as Tool from "./tool"

export const NfcoreCritiqueTool = Tool.define(
  "nfcore_critique",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Schema.Struct({
        analysis: Schema.String.annotate({
          description: "What the analysis is — a short description or the pipeline/method name (e.g. 'RNA-seq differential expression with DESeq2').",
        }),
        replicatesPerGroup: Schema.optional(
          Schema.Number.annotate({ description: "Biological replicates per group, if known (e.g. counted from the samplesheet)." }),
        ),
        groups: Schema.optional(Schema.Number.annotate({ description: "Number of groups being compared, if known." })),
        multipleTestingApplied: Schema.optional(
          Schema.Boolean.annotate({ description: "Whether multiple-testing correction (FDR/adjusted p-values) is being used, if known." }),
        ),
      }),
      // Pure, read-only reasoning aid — auto-approved. Returns the shaped concerns
      // and any soft-block gate; the agent decides how to surface them per the skill.
      execute: (
        params: { analysis: string; replicatesPerGroup?: number; groups?: number; multipleTestingApplied?: boolean },
        _ctx: Tool.Context,
      ) =>
        Effect.sync(() => {
          const result = Critique.critique(params.analysis, {
            replicatesPerGroup: params.replicatesPerGroup,
            groups: params.groups,
            multipleTestingApplied: params.multipleTestingApplied,
          })
          return {
            title: result.type,
            metadata: {
              type: result.type,
              concerns: result.concerns.map((c) => c.id),
              gates: result.gates.map((g) => g.id),
            },
            output: Critique.summarize(result),
          }
        }),
    }
  }),
)
