import { Effect, Schema } from "effect"
import { Manifest } from "@/nfcore/manifest"
import DESCRIPTION from "./nfcore-manifest.txt"
import * as Tool from "./tool"

export const NfcoreManifestTool = Tool.define(
  "nfcore_manifest",
  Effect.gen(function* () {
    const manifest = yield* Manifest.Service
    return {
      description: DESCRIPTION,
      parameters: Schema.Struct({
        outdir: Schema.String.annotate({ description: "The run's results directory (the --outdir it used)." }),
        sessionSummary: Schema.optional(
          Schema.String.annotate({ description: "Short summary of the session's goal and decisions, for the manifest." }),
        ),
      }),
      // Reads provenance and writes Bioinformatica's own manifest into .bioinformatica/; auto-approved.
      execute: (params: { outdir: string; sessionSummary?: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { manifest: built, file } = yield* manifest.build(params)
          return {
            title: params.outdir,
            metadata: { file },
            output: `${Manifest.summarize(built)}\n\nWritten to ${file}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
