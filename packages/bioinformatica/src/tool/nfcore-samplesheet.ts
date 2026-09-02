import { Effect, Schema } from "effect"
import { Registry } from "@/nfcore/registry"
import { Samplesheet } from "@/nfcore/samplesheet"
import SCHEMA_DESCRIPTION from "./nfcore-samplesheet-schema.txt"
import VALIDATE_DESCRIPTION from "./nfcore-samplesheet-validate.txt"
import * as Tool from "./tool"

const noStableRelease = (pipeline: string) =>
  `nf-core/${pipeline} has no stable release to read a samplesheet schema from. Specify a release explicitly if you mean a development version.`

export const NfcoreSamplesheetSchemaTool = Tool.define(
  "nfcore_samplesheet_schema",
  Effect.gen(function* () {
    const samplesheet = yield* Samplesheet.Service
    const registry = yield* Registry.Service
    return {
      description: SCHEMA_DESCRIPTION,
      parameters: Schema.Struct({
        pipeline: Schema.String.annotate({ description: "nf-core pipeline name, e.g. 'rnaseq'." }),
        release: Schema.optional(
          Schema.String.annotate({ description: "Release tag, e.g. '3.26.0'. Defaults to the latest stable release." }),
        ),
      }),
      // Read-only: fetches the published schema and reports it. Auto-approved.
      execute: (params: { pipeline: string; release?: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          let release = params.release
          if (!release) release = (yield* registry.get(params.pipeline))?.latestRelease
          if (!release) return { title: params.pipeline, metadata: {}, output: noStableRelease(params.pipeline) }
          const spec = yield* samplesheet.schema(params.pipeline, release)
          return {
            title: `${params.pipeline}@${release}`,
            metadata: { spec },
            output: Samplesheet.summarizeColumns(spec),
          }
        }).pipe(
          Effect.catch((error) => Effect.succeed({ title: params.pipeline, metadata: {}, output: error.message })),
        ),
    }
  }),
)

export const NfcoreSamplesheetValidateTool = Tool.define(
  "nfcore_samplesheet_validate",
  Effect.gen(function* () {
    const samplesheet = yield* Samplesheet.Service
    const registry = yield* Registry.Service
    return {
      description: VALIDATE_DESCRIPTION,
      parameters: Schema.Struct({
        pipeline: Schema.String.annotate({ description: "nf-core pipeline name, e.g. 'rnaseq'." }),
        rows: Schema.Array(Schema.Record(Schema.String, Schema.String)).annotate({
          description: "The proposed samplesheet as an array of row objects keyed by column name.",
        }),
        release: Schema.optional(
          Schema.String.annotate({ description: "Release tag. Defaults to the latest stable release." }),
        ),
      }),
      // Read-only: validates proposed rows, writes nothing. Auto-approved.
      execute: (params: { pipeline: string; rows: readonly Samplesheet.Row[]; release?: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          let release = params.release
          if (!release) release = (yield* registry.get(params.pipeline))?.latestRelease
          if (!release) return { title: params.pipeline, metadata: {}, output: noStableRelease(params.pipeline) }
          const spec = yield* samplesheet.schema(params.pipeline, release)
          const result = Samplesheet.validate(spec.columns, params.rows)
          return {
            title: `${params.pipeline}@${release}`,
            metadata: { validation: result },
            output: Samplesheet.summarizeValidation(params.pipeline, release, result),
          }
        }).pipe(
          Effect.catch((error) => Effect.succeed({ title: params.pipeline, metadata: {}, output: error.message })),
        ),
    }
  }),
)
