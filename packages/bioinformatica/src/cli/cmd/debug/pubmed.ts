import { EOL } from "os"
import { Effect } from "effect"
import { Entrez } from "@/bio/entrez"
import { effectCmd, fail } from "../../effect-cmd"

export const PubmedCommand = effectCmd({
  command: "pubmed <query>",
  describe: "search PubMed for literature with citations (read-only)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("query", { describe: "PubMed search query", type: "string" })
      .option("limit", { describe: "max results", type: "number" }),
  handler: Effect.fn("Cli.debug.pubmed")(function* (args: { query?: string; limit?: number }) {
    if (!args.query) return yield* fail("query is required")
    const entrez = yield* Entrez.Service
    const result = yield* entrez.searchPubmed(args.query, args.limit ?? 5)
    process.stdout.write(Entrez.summarize(result) + EOL)
  }),
})
