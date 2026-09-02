import { Effect, Schema } from "effect"
import path from "path"
import { Report } from "@/nfcore/report"
import { InstanceState } from "@/effect/instance-state"
import DESCRIPTION from "./report.txt"
import * as Tool from "./tool"

export const ReportSaveTool = Tool.define(
  "report_save",
  Effect.gen(function* () {
    const report = yield* Report.Service
    return {
      description: DESCRIPTION,
      parameters: Schema.Struct({
        path: Schema.String.annotate({
          description: "Where to save the report — the location the scientist chose (ask first; no default).",
        }),
        title: Schema.String.annotate({ description: "A short title for the report." }),
        body: Schema.String.annotate({
          description:
            "The report in markdown, with claim-typing tags: [computed], [cited], or [model-inferred] on each substantive statement.",
        }),
      }),
      // A human-readable report is a data write to the user's workspace, so unlike the
      // read-only and .bioinformatica-bookkeeping tools it asks for approval — this also
      // gives the scientist a final say on the exact path.
      execute: (params: { path: string; title: string; body: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = path.isAbsolute(params.path) ? params.path : path.join(instance.directory, params.path)
          const { content, analysis } = Report.render(params)

          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(instance.worktree, filepath)],
            always: ["*"],
            metadata: { filepath, preview: content },
          })

          const saved = yield* report.save({ path: filepath, title: params.title, body: params.body })
          return {
            title: path.relative(instance.worktree, saved.file),
            metadata: { file: saved.file, claims: analysis.counts, issues: analysis.issues },
            output: `${Report.summarizeAnalysis(analysis)}\n\nWritten to ${saved.file}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
