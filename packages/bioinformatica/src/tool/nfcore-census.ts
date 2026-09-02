import { Effect, Schema } from "effect"
import { Census } from "@/nfcore/census"
import DESCRIPTION from "./nfcore-census.txt"
import * as Tool from "./tool"

const Parameters = Schema.Struct({
  samplesheet: Schema.String.annotate({ description: "Path to the samplesheet CSV the run was launched with." }),
  outdir: Schema.optional(
    Schema.String.annotate({
      description: "The run's outdir. The newest pipeline_info/execution_trace_*.txt under it is used.",
    }),
  ),
  trace: Schema.optional(
    Schema.String.annotate({ description: "Path to an execution_trace_*.txt, if you already know it." }),
  ),
})

type Metadata = {
  /** Absent when no census could be taken; `failed` is what distinguishes that case. */
  report?: Census.CensusReport
  failed: boolean
  problem?: string
}

export const NfcoreCensusTool = Tool.define<typeof Parameters, Metadata, Census.Service>(
  "nfcore_census",
  Effect.gen(function* () {
    const census = yield* Census.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      // Read-only: parses the samplesheet and the execution trace. Auto-approved.
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const report = yield* census.of(params)
          return {
            // The title is the line the model skims, so it must not contradict the body.
            // An unmeasurable trace has deepestCount 0 and attrition [], which the old
            // two-arm form rendered as "0/4 samples — 0 unaccounted for": two invented
            // numbers presented as a measurement.
            title: !report.measurable
              ? `${report.declared} declared — attrition not measurable from this trace`
              : report.complete
                ? `${report.declared}/${report.declared} samples`
                : `${report.deepestCount}/${report.declared} samples — ${report.attrition.length} unaccounted for`,
            metadata: { report, failed: false },
            output: Census.format(report),
          }
        }).pipe(
          // Surface the reason to the model rather than dying, but never fall back to a
          // partial or empty report: "no census could be taken" and "no samples are
          // missing" must not read the same, and `failed` carries that distinction for
          // anything reading the metadata rather than the text.
          Effect.catch((error) =>
            Effect.succeed({
              title: "census unavailable",
              metadata: { failed: true, problem: error.problem },
              output: error.message,
            }),
          ),
        ),
    }
  }),
)
