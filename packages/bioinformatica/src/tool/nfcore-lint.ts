import { Effect, Schema } from "effect"
import { Authoring } from "@/nfcore/authoring"
import DESCRIPTION from "./nfcore-lint.txt"
import * as Tool from "./tool"

export const NfcoreLintTool = Tool.define(
  "nfcore_lint",
  Effect.gen(function* () {
    const authoring = yield* Authoring.Service
    return {
      description: DESCRIPTION,
      parameters: Schema.Struct({
        directory: Schema.String.annotate({
          description: "Path to the pipeline repository (or local module repo) to lint.",
        }),
        module: Schema.optional(
          Schema.String.annotate({ description: "Lint just this module (e.g. 'fastqc') instead of the whole pipeline." }),
        ),
      }),
      // Read-only inspection: nf-core lint analyses, it does not modify the repo, so it is
      // auto-approved like the environment probe.
      execute: (params: { directory: string; module?: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const run = yield* authoring.lint(params)
          if (!run.installed)
            return {
              title: "nf-core lint",
              metadata: { installed: false } as Record<string, unknown>,
              output:
                "nf-core tools is not installed, so linting cannot run. Install it (see the environment tool and the authoring skill), then retry.",
            }
          if (!run.report)
            return {
              title: "nf-core lint",
              metadata: { installed: true, error: run.error } as Record<string, unknown>,
              output: `Could not get structured lint results${run.error ? ` (${run.error})` : ""}.${run.raw ? `\n\n${run.raw}` : ""}`,
            }
          const readiness = Authoring.readiness(run.report)
          return {
            title: params.module ?? params.directory,
            metadata: { counts: run.report.counts, ready: readiness.ready } as Record<string, unknown>,
            output: `${Authoring.summarizeLint(run.report)}\n\n${readiness.summary}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
