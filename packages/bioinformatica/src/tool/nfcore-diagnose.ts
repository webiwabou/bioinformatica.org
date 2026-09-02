import { Effect, Schema } from "effect"
import { Failure } from "@/nfcore/failure"
import DESCRIPTION from "./nfcore-diagnose.txt"
import * as Tool from "./tool"

export const NfcoreDiagnoseTool = Tool.define(
  "nfcore_diagnose",
  Effect.gen(function* () {
    const failure = yield* Failure.Service
    return {
      description: DESCRIPTION,
      parameters: Schema.Struct({
        runDir: Schema.optional(
          Schema.String.annotate({ description: "The run directory containing .nextflow.log (usually where you launched the run)." }),
        ),
        error: Schema.optional(
          Schema.String.annotate({ description: "Error text captured from the failed nextflow run, if you have it." }),
        ),
      }),
      // Read-only: inspects logs and classifies. Auto-approved.
      execute: (params: { runDir?: string; error?: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const diagnosis = yield* failure.diagnose(params)
          return {
            title: diagnosis.category,
            metadata: { diagnosis },
            output: Failure.summarize(diagnosis),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
