import { Effect, Schema } from "effect"
import { Fork } from "@/nfcore/fork"
import FORK_DESCRIPTION from "./nfcore-fork.txt"
import STATUS_DESCRIPTION from "./nfcore-fork-status.txt"
import * as Tool from "./tool"

export const NfcoreForkTool = Tool.define(
  "nfcore_fork",
  Effect.gen(function* () {
    const fork = yield* Fork.Service
    return {
      description: FORK_DESCRIPTION,
      parameters: Schema.Struct({
        pipeline: Schema.String.annotate({ description: "nf-core pipeline to fork, e.g. 'rnaseq'." }),
        release: Schema.String.annotate({ description: "Release tag to pin the fork to, e.g. '3.14.0'." }),
      }),
      // Planning the clone command and recording provenance into .bioinformatica/ is bookkeeping,
      // not the data write — the clone itself runs through the shell tool with approval —
      // so this is auto-approved.
      execute: (params: { pipeline: string; release: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const result = yield* fork.fork(params)
          if (result.kind === "plan") {
            return {
              title: `${params.pipeline}@${params.release}`,
              metadata: { planned: true, path: result.plan.path } as Record<string, unknown>,
              output: `To fork nf-core/${params.pipeline} at ${params.release}, run this through the shell tool (it writes files, so it asks for approval):\n\n${result.plan.command}\n\nThe fork lands in ${result.plan.path} (a visible project folder — the scientist's code, not hidden in .bioinformatica). After it clones, call nfcore_fork again to record its provenance.`,
            }
          }
          return {
            title: `${params.pipeline}@${params.release}`,
            metadata: { recorded: true, file: result.file, baselineSha: result.record.baselineSha } as Record<string, unknown>,
            output: `Recorded fork provenance to ${result.file}.\n\n${Fork.summarizeStatus(result.status)}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const NfcoreForkStatusTool = Tool.define(
  "nfcore_fork_status",
  Effect.gen(function* () {
    const fork = yield* Fork.Service
    return {
      description: STATUS_DESCRIPTION,
      parameters: Schema.Struct({
        pipeline: Schema.String.annotate({ description: "The forked pipeline's name, e.g. 'rnaseq'." }),
      }),
      // Read-only git inspection → auto-approved.
      execute: (params: { pipeline: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const records = yield* fork.list()
          const record = records.filter((r) => r.pipeline === params.pipeline).at(-1)
          if (!record)
            return {
              title: params.pipeline,
              metadata: { found: false } as Record<string, unknown>,
              output: `No recorded fork for '${params.pipeline}'. Fork it first with nfcore_fork.`,
            }
          const status = yield* fork.status({ path: record.path, baselineSha: record.baselineSha })
          return {
            title: params.pipeline,
            metadata: { found: true, clean: status.clean, changed: status.changes.length } as Record<string, unknown>,
            output: `Fork of nf-core/${record.pipeline} pinned to ${record.release}.\n${Fork.summarizeStatus(status)}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
