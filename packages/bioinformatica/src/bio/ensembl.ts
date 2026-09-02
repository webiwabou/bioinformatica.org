export * as Ensembl from "./ensembl"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { httpClient } from "@bioinformatica/core/effect/app-node-platform"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { isRecord } from "@/util/record"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

// Ensembl REST — gene/transcript reference data. Dedicated, structured,
// credential-free.
const BASE = "https://rest.ensembl.org"

export const Gene = Schema.Struct({
  id: Schema.String,
  symbol: Schema.String,
  species: Schema.String,
  description: Schema.optional(Schema.String),
  biotype: Schema.optional(Schema.String),
  location: Schema.optional(Schema.String),
  url: Schema.String,
})
export type Gene = Schema.Schema.Type<typeof Gene>

export interface Interface {
  readonly gene: (symbol: string, species?: string) => Effect.Effect<Gene | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/Ensembl") {}
export const use = serviceUse(Service)

export function parseGene(symbol: string, species: string, data: unknown): Gene | undefined {
  if (!isRecord(data) || typeof data.id !== "string") return undefined
  const chrom = typeof data.seq_region_name === "string" ? data.seq_region_name : undefined
  const location =
    chrom && typeof data.start === "number" && typeof data.end === "number"
      ? `${chrom}:${data.start}-${data.end}${data.strand === -1 ? " (-)" : data.strand === 1 ? " (+)" : ""}`
      : undefined
  return {
    id: data.id,
    symbol: typeof data.display_name === "string" ? data.display_name : symbol,
    species,
    description: typeof data.description === "string" ? data.description : undefined,
    biotype: typeof data.biotype === "string" ? data.biotype : undefined,
    location,
    url: `https://www.ensembl.org/${species}/Gene/Summary?g=${data.id}`,
  }
}

export function citation(gene: Gene): string {
  return `Ensembl ${gene.symbol} (${gene.id}, ${gene.species})${gene.description ? `: ${gene.description}` : ""}${gene.location ? ` — ${gene.location}` : ""}. ${gene.url}`
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const gene = Effect.fn("Ensembl.gene")(function* (symbol: string, species = "homo_sapiens") {
      const data = yield* HttpClientRequest.get(`${BASE}/lookup/symbol/${species}/${encodeURIComponent(symbol)}`).pipe(
        HttpClientRequest.setUrlParams({ "content-type": "application/json" }),
        http.execute,
        Effect.flatMap((res) => res.json),
        Effect.timeout("20 seconds"),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      return parseGene(symbol, species, data)
    })
    return Service.of({ gene })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [httpClient] })
