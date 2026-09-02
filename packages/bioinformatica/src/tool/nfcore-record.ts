import { Effect, Schema } from "effect"
import { Record } from "@/nfcore/record"
import DESCRIPTION from "./nfcore-record.txt"
import * as Tool from "./tool"

export const NfcoreRecordTool = Tool.define(
  "nfcore_record",
  Effect.gen(function* () {
    const record = yield* Record.Service
    return {
      description: DESCRIPTION,
      parameters: Schema.Struct({
        pipeline: Schema.String.annotate({ description: "nf-core pipeline name, e.g. 'rnaseq'." }),
        release: Schema.String.annotate({ description: "Release tag that was run, e.g. '3.26.0'." }),
        backend: Schema.String.annotate({ description: "Container backend used, e.g. 'docker' or 'conda'." }),
        mode: Schema.String.annotate({ description: "'test' for a test-profile run, 'run' for real data." }),
        command: Schema.String.annotate({ description: "The exact nextflow run command that was executed." }),
        status: Schema.String.annotate({ description: "'started', 'succeeded', or 'failed'." }),
        outdir: Schema.optional(Schema.String.annotate({ description: "Results directory." })),
        notes: Schema.optional(Schema.String.annotate({ description: "Optional notes, e.g. a diagnosis if it failed." })),
      }),
      // Writes provenance into Bioinformatica's own .bioinformatica/ directory (not user data), so it
      // is auto-approved like other bookkeeping.
      execute: (
        input: {
          pipeline: string
          release: string
          backend: string
          mode: string
          command: string
          status: string
          outdir?: string
          notes?: string
        },
        _ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const file = yield* record.run(input)
          return { title: `${input.pipeline}@${input.release}`, metadata: { file }, output: `Recorded run to ${file}` }
        }).pipe(Effect.orDie),
    }
  }),
)
