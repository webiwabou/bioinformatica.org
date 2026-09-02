import { EOL } from "os"
import { Effect } from "effect"
import { Manifest } from "@/nfcore/manifest"
import { effectCmd, fail } from "../../effect-cmd"

export const ManifestCommand = effectCmd({
  command: "manifest <outdir>",
  describe: "build a reproducibility manifest for a completed run's outdir (read-only)",
  builder: (yargs) =>
    yargs
      .positional("outdir", { describe: "the run's results directory (its --outdir)", type: "string" })
      .option("json", { describe: "print the full manifest as JSON", type: "boolean" }),
  handler: Effect.fn("Cli.debug.manifest")(function* (args: { outdir?: string; json?: boolean }) {
    if (!args.outdir) return yield* fail("outdir is required")
    const manifest = yield* Manifest.Service
    const { manifest: built, file } = yield* manifest.build({ outdir: args.outdir })
    if (args.json) {
      process.stdout.write(JSON.stringify(built, null, 2) + EOL)
      return
    }
    process.stdout.write(Manifest.summarize(built) + EOL + EOL + `Written to ${file}` + EOL)
  }),
})
