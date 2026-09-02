export * as KEGG from "./kegg"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { httpClient } from "@bioinformatica/core/effect/app-node-platform"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

// KEGG — pathways and related biological knowledge. Dedicated,
// credential-free. KEGG returns flat tab-separated text, not JSON.
const BASE = "https://rest.kegg.jp"

export const Pathway = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
})
export type Pathway = Schema.Schema.Type<typeof Pathway>

export interface Interface {
  readonly findPathways: (query: string, size?: number) => Effect.Effect<Pathway[]>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/KEGG") {}
export const use = serviceUse(Service)

// Parse KEGG's flat `id\tname` list format. Pure.
export function parsePathways(text: string): Pathway[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .flatMap((line) => {
      const tab = line.indexOf("\t")
      if (tab < 0) return []
      const id = line.slice(0, tab).replace(/^path:/, "").trim()
      const name = line.slice(tab + 1).trim()
      if (!id) return []
      return [{ id, name, url: `https://www.kegg.jp/entry/${id}` }]
    })
}

export function citation(p: Pathway): string {
  return `KEGG pathway ${p.id}: ${p.name}. ${p.url}`
}

export function summarize(pathways: readonly Pathway[]): string {
  if (pathways.length === 0) return "No KEGG pathways found."
  return pathways.map((p) => `- ${citation(p)}`).join("\n")
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const findPathways = Effect.fn("KEGG.findPathways")(function* (query: string, size = 10) {
      const text = yield* HttpClientRequest.get(`${BASE}/find/pathway/${encodeURIComponent(query)}`).pipe(
        http.execute,
        Effect.flatMap((res) => res.text),
        Effect.timeout("20 seconds"),
        Effect.catch(() => Effect.succeed("")),
      )
      return parsePathways(text).slice(0, size)
    })
    return Service.of({ findPathways })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [httpClient] })
