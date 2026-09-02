import { Effect, Schema } from "effect"
import { Entrez } from "@/bio/entrez"
import SEARCH_DESCRIPTION from "./pubmed-search.txt"
import FETCH_DESCRIPTION from "./pubmed-fetch.txt"
import * as Tool from "./tool"

export const PubmedSearchTool = Tool.define(
  "pubmed_search",
  Effect.gen(function* () {
    const entrez = yield* Entrez.Service
    return {
      description: SEARCH_DESCRIPTION,
      parameters: Schema.Struct({
        query: Schema.String.annotate({ description: "PubMed search query (keywords or field-tagged terms)." }),
        limit: Schema.optional(Schema.Number.annotate({ description: "Max results to return (default 10)." })),
      }),
      // Read-only literature lookup. Auto-approved.
      execute: (params: { query: string; limit?: number }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const result = yield* entrez.searchPubmed(params.query, params.limit ?? 10)
          return {
            title: params.query,
            metadata: { count: result.count, records: result.records },
            output: Entrez.summarize(result),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const PubmedFetchTool = Tool.define(
  "pubmed_fetch",
  Effect.gen(function* () {
    const entrez = yield* Entrez.Service
    return {
      description: FETCH_DESCRIPTION,
      parameters: Schema.Struct({
        pmid: Schema.String.annotate({ description: "PubMed ID (PMID) of the paper." }),
      }),
      // Read-only abstract fetch. Auto-approved.
      execute: (params: { pmid: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const abstract = yield* entrez.fetchAbstract(params.pmid)
          return {
            title: params.pmid,
            metadata: { pmid: params.pmid },
            output: abstract ?? `No abstract found for PMID ${params.pmid}.`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
