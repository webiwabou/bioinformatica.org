import { EOL } from "os"
import { Effect } from "effect"
import { Registry } from "@/nfcore/registry"
import { effectCmd } from "../../effect-cmd"

export const PipelinesCommand = effectCmd({
  command: "pipelines [query]",
  describe: "search the cached nf-core pipeline registry (read-only)",
  // Uses the global registry cache; no project InstanceContext needed.
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("query", { describe: "search terms (omit to list all pipelines)", type: "string" })
      .option("refresh", { describe: "force a fresh fetch of the registry", type: "boolean" })
      .option("limit", { describe: "maximum results", type: "number" }),
  handler: Effect.fn("Cli.debug.pipelines")(function* (args: { query?: string; refresh?: boolean; limit?: number }) {
    const registry = yield* Registry.Service
    if (args.refresh) yield* registry.refresh(true)
    if (args.query) {
      const result = yield* registry.search(args.query, args.limit ?? 10)
      process.stdout.write(Registry.report(result) + EOL)
      return
    }
    const all = yield* registry.list()
    process.stdout.write(`${all.length} nf-core pipelines cached.` + EOL)
    process.stdout.write(Registry.summarize(all.slice(0, args.limit ?? 20)) + EOL)
  }),
})
