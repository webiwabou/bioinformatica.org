import { Effect, Schema } from "effect"
import { Registry } from "@/nfcore/registry"
import { Environment } from "@/environment/detect"
import { NfcoreCommand } from "@/nfcore/command"
import DESCRIPTION from "./nfcore-run.txt"
import * as Tool from "./tool"

export const NfcoreRunTool = Tool.define(
  "nfcore_run_command",
  Effect.gen(function* () {
    const registry = yield* Registry.Service
    const environment = yield* Environment.Service
    return {
      description: DESCRIPTION,
      parameters: Schema.Struct({
        pipeline: Schema.String.annotate({ description: "nf-core pipeline name, e.g. 'rnaseq'." }),
        mode: Schema.Literals(["test", "run"]).annotate({
          description: "'test' for the bundled test profile (run first), 'run' for real data.",
        }),
        release: Schema.optional(Schema.String.annotate({ description: "Release tag; defaults to latest stable." })),
        backend: Schema.optional(
          Schema.Literals(["docker", "conda", "singularity"]).annotate({
            description: "Container backend; defaults to what the environment provides.",
          }),
        ),
        outdir: Schema.optional(Schema.String.annotate({ description: "Results directory; defaults to 'results'." })),
        input: Schema.optional(Schema.String.annotate({ description: "Samplesheet path (required for a real run)." })),
        params: Schema.optional(
          Schema.Record(Schema.String, Schema.String).annotate({ description: "Extra pipeline --params." }),
        ),
        resume: Schema.optional(Schema.Boolean.annotate({ description: "Add -resume to continue a previous run." })),
        configs: Schema.optional(
          Schema.Array(Schema.String).annotate({
            description: "Extra Nextflow config files to pass with -c, e.g. a resource-limits config from nfcore_resources.",
          }),
        ),
      }),
      // Read-only: builds and returns the command string. It does not execute —
      // the shell tool does, with the command shown and approval required.
      execute: (
        params: {
          pipeline: string
          mode: "test" | "run"
          release?: string
          backend?: "docker" | "conda" | "singularity"
          outdir?: string
          input?: string
          params?: Record<string, string>
          resume?: boolean
          configs?: readonly string[]
        },
        _ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const empty: Record<string, unknown> = {}
          let release = params.release
          if (!release) release = (yield* registry.get(params.pipeline))?.latestRelease
          if (!release) {
            return {
              title: params.pipeline,
              metadata: empty,
              output: `nf-core/${params.pipeline} has no stable release. Specify a release explicitly to run a development version.`,
            }
          }

          let backend = params.backend
          if (!backend) {
            const report = yield* environment.detect()
            backend = report.containerBackend === "conda" ? "conda" : report.containerBackend === "docker" ? "docker" : undefined
          }
          if (!backend) {
            return {
              title: params.pipeline,
              metadata: empty,
              output:
                "No container backend is available (no running Docker and no conda). Use the environment tool to set one up before running a pipeline.",
            }
          }

          const built = NfcoreCommand.build({
            pipeline: params.pipeline,
            release,
            backend,
            mode: params.mode,
            outdir: params.outdir ?? "results",
            input: params.input,
            params: params.params,
            resume: params.resume,
            configs: params.configs,
          })

          const metadata: Record<string, unknown> = {
            command: built.command,
            argv: built.argv,
            backend,
            release,
          }
          return {
            title: `${params.pipeline}@${release} (${params.mode})`,
            metadata,
            output: NfcoreCommand.summarize(built),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
