import { Effect, Schema } from "effect"
import { Environment } from "@/environment/detect"
import { Resource } from "@/environment/resource"
import DESCRIPTION from "./nfcore-resources.txt"
import * as Tool from "./tool"

export const NfcoreResourcesTool = Tool.define(
  "nfcore_resources",
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    return {
      description: DESCRIPTION,
      parameters: Schema.Struct({
        requestedMemoryGb: Schema.optional(
          Schema.Number.annotate({ description: "Memory a step requests, in GB, to reconcile against what's available." }),
        ),
        requestedCpus: Schema.optional(Schema.Number.annotate({ description: "CPUs a step requests, to compare with available cores." })),
      }),
      // Read-only: recommends a ceiling and decides adaptation. Changes nothing. Auto-approved.
      execute: (params: { requestedMemoryGb?: number; requestedCpus?: number }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const report = yield* environment.detect()
          const parts = [Resource.summarizeCeiling(report)]

          if (params.requestedMemoryGb !== undefined) {
            const availableMb = report.resources.memoryAvailableMb ?? report.resources.memoryTotalMb ?? 0
            const decision = Resource.adapt(params.requestedMemoryGb * 1024, availableMb)
            parts.push("", `Memory request (${params.requestedMemoryGb} GB): ${decision.action.toUpperCase()} — ${decision.rationale}`)
          }
          if (params.requestedCpus !== undefined && params.requestedCpus > report.resources.cpuCores) {
            parts.push(
              "",
              `CPU request (${params.requestedCpus}) exceeds the ${report.resources.cpuCores} cores available; it will be capped to ${report.resources.cpuCores}.`,
            )
          }

          return { title: "resources", metadata: { report }, output: parts.join("\n") }
        }).pipe(Effect.orDie),
    }
  }),
)
