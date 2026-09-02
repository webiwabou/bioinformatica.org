import { EOL } from "os"
import { Effect } from "effect"
import { Glue } from "@/bio/glue"
import { effectCmd } from "../../effect-cmd"

export const GlueCommand = effectCmd({
  command: "glue [directory]",
  describe: "list or materialise the coordinate-bookkeeping scripts (SEQRES/ATOM mapping, fragment cutting, propagation)",
  builder: (yargs) =>
    yargs.positional("directory", { describe: "write the scripts here (omit to just list them)", type: "string" }),
  handler: Effect.fn("Cli.debug.glue")(function* (args: { directory?: string }) {
    if (!args.directory) {
      process.stdout.write(Glue.describe() + EOL)
      return
    }
    const written = yield* (yield* Glue.Service).write(args.directory)
    for (const p of written) process.stdout.write(p + EOL)
  }),
})
