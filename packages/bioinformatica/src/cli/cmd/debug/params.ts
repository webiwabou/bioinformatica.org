import { EOL } from "os"
import { Effect } from "effect"
import { Registry } from "@/nfcore/registry"
import { Params } from "@/nfcore/params"
import { effectCmd, fail } from "../../effect-cmd"

export const ParamsCommand = effectCmd({
  command: "params <pipeline> [query]",
  describe: "explain an nf-core pipeline's parameters from its schema (read-only)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("pipeline", { describe: "nf-core pipeline name, e.g. 'rnaseq'", type: "string" })
      .positional("query", { describe: "parameter name or keywords (omit for required params)", type: "string" })
      .option("release", { describe: "release tag (defaults to latest stable)", type: "string" }),
  handler: Effect.fn("Cli.debug.params")(function* (args: { pipeline?: string; query?: string; release?: string }) {
    if (!args.pipeline) return yield* fail("pipeline name is required")
    const registry = yield* Registry.Service
    const params = yield* Params.Service
    let release = args.release
    if (!release) release = (yield* registry.get(args.pipeline))?.latestRelease
    if (!release) return yield* fail(`nf-core/${args.pipeline} has no stable release; pass --release`)
    const all = yield* params.all(args.pipeline, release).pipe(Effect.catch((e) => fail(e.message)))
    process.stdout.write(Params.summarize(Params.find(all, args.query ?? "")) + EOL)
  }),
})
