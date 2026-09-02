import { Effect, Schema } from "effect"
import { Hypothesis } from "@/nfcore/hypothesis"
import DESCRIPTION from "./nfcore-hypothesis.txt"
import * as Tool from "./tool"

export const NfcoreHypothesisTool = Tool.define(
  "nfcore_hypothesis_rank",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Schema.Struct({
        hypotheses: Schema.Array(
          Schema.Struct({
            statement: Schema.String.annotate({ description: "The hypothesis as a precise, falsifiable claim." }),
            grounding: Schema.Literals(["cited", "computed", "model-inferred"]).annotate({
              description: "What backs it: cited (a source), computed (this session's results), or model-inferred (your reasoning).",
            }),
            proposedTest: Schema.String.annotate({
              description: "How to test it, ideally naming a concrete nf-core pipeline or analysis.",
            }),
            testability: Schema.Number.annotate({ description: "1-5: how directly it can be tested." }),
            novelty: Schema.Number.annotate({ description: "1-5: how far beyond what is already established." }),
            plausibility: Schema.Number.annotate({ description: "1-5: how consistent with what is known." }),
          }),
        ).annotate({ description: "The candidate hypotheses you generated, each grounded and self-assessed." }),
      }),
      // Pure, read-only ranking aid — auto-approved. Enforces the honest structure
      // (grounding + a concrete test) and ranks reproducibly; the model still owns the
      // reasoning and must present the results as speculative candidates.
      execute: (params: { hypotheses: readonly Hypothesis[] }, _ctx: Tool.Context) =>
        Effect.sync(() => {
          const ranked = Hypothesis.rank(params.hypotheses)
          return {
            title: `${ranked.length} hypotheses`,
            metadata: {
              top: ranked[0]?.statement,
              grounding: ranked.map((h) => h.grounding),
            },
            output: Hypothesis.summarize(ranked),
          }
        }),
    }
  }),
)
