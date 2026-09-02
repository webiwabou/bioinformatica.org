import { Effect, Schema } from "effect"
import { Environment } from "@/environment/detect"
import { Remediate } from "@/environment/remediate"
import DESCRIPTION from "./environment.txt"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({})

export const EnvironmentTool = Tool.define(
  "environment",
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      // Read-only inspection: it detects state and recommends fix commands, but
      // never runs anything, so it is auto-approved per the approval model
      // and does not gate on ctx.ask.
      execute: (_params: {}, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const report = yield* environment.detect()
          const plan = Remediate.plan(report)
          const output = [Environment.summarize(report), "", Remediate.summarize(plan)].join("\n")
          return {
            title: "environment",
            metadata: { report, plan },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
