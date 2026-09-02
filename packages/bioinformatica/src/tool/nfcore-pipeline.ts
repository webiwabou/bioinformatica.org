import { Effect, Schema } from "effect"
import { Registry } from "@/nfcore/registry"
import DESCRIPTION from "./nfcore-pipeline.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description:
      "What the scientist wants to do, in plain terms (e.g. 'RNA-seq differential expression', 'bacterial assembly', 'ATAC-seq'). Matched against pipeline names, topics, and descriptions.",
  }),
  limit: Schema.optional(
    Schema.Number.annotate({ description: "Maximum number of pipelines to return (default 10)." }),
  ),
})

export const NfcorePipelineTool = Tool.define(
  "nfcore_pipeline_search",
  Effect.gen(function* () {
    const registry = yield* Registry.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      // Read-only registry lookup: auto-approved per the approval model.
      execute: (params: { query: string; limit?: number }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const result = yield* registry.search(params.query, params.limit ?? 10)
          return {
            title: params.query,
            metadata: {
              suitable: result.suitable,
              count: result.matches.length,
              pipelines: result.matches,
              nearMisses: result.nearMisses,
            },
            output: Registry.report(result),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
