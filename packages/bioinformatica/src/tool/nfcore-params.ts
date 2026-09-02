import { Effect, Schema } from "effect"
import { Registry } from "@/nfcore/registry"
import { Params } from "@/nfcore/params"
import DESCRIPTION from "./nfcore-params.txt"
import * as Tool from "./tool"

export const NfcoreParamsTool = Tool.define(
  "nfcore_params",
  Effect.gen(function* () {
    const params = yield* Params.Service
    const registry = yield* Registry.Service
    return {
      description: DESCRIPTION,
      parameters: Schema.Struct({
        pipeline: Schema.String.annotate({ description: "nf-core pipeline name, e.g. 'rnaseq'." }),
        query: Schema.optional(
          Schema.String.annotate({ description: "Parameter name or keywords (e.g. 'aligner'). Omit for required params." }),
        ),
        release: Schema.optional(Schema.String.annotate({ description: "Release tag; defaults to latest stable." })),
      }),
      // Read-only parameter lookup. Auto-approved.
      execute: (input: { pipeline: string; query?: string; release?: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          let release = input.release
          if (!release) release = (yield* registry.get(input.pipeline))?.latestRelease
          if (!release) {
            return {
              title: input.pipeline,
              metadata: {},
              output: `nf-core/${input.pipeline} has no stable release; specify a release to read its parameters.`,
            }
          }
          const all = yield* params.all(input.pipeline, release)
          const matches = Params.find(all, input.query ?? "")
          return {
            title: `${input.pipeline}@${release}`,
            metadata: { count: matches.length },
            output: Params.summarize(matches),
          }
        }).pipe(Effect.catch((error) => Effect.succeed({ title: input.pipeline, metadata: {}, output: error.message }))),
    }
  }),
)
