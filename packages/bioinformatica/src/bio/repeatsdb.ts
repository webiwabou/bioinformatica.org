export * as RepeatsDB from "./repeatsdb"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { httpClient } from "@bioinformatica/core/effect/app-node-platform"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { isRecord } from "@/util/record"
import { BioHttp } from "./http"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

// RepeatsDB — the curated set of proteins already annotated as structural repeats.
//
// In a discovery campaign this is the set that gets SUBTRACTED, which makes it the most
// dangerous input in the whole method: whatever survives the subtraction is reported as
// novel, so a quietly truncated download does not weaken the claim, it fabricates one.
// Everything unusual below is therefore checked rather than assumed.
//
// Three properties of this API that break naive clients, all verified live 2026-08-25:
//   - `items` is an OBJECT keyed by stringified index ({"0":…,"1":…}), not an array.
//   - `skip` is MANDATORY; omitting it returns 400, not page one.
//   - `limit` is capped at 100; asking for more returns 400, not a truncated page.
// And an asymmetry worth its own note: the source is `RCSB/PDB` as a query parameter but
// the literal `PDB` as a path segment.

const BASE = "https://repeatsdb.org/api/production/annotations"
export const MAX_LIMIT = 100
export const SOURCE_PDB = "RCSB/PDB"
export const SOURCE_AFDB = "AlphaFoldDB"

export const Locus = Schema.Struct({
  type: Schema.String,
  /** RepeatsDB serves coordinates as STRINGS. Parse before arithmetic. */
  start: Schema.String,
  end: Schema.String,
  class: Schema.optional(Schema.String),
  parent: Schema.optional(Schema.Number),
})

export const Annotation = Schema.Struct({
  /** Lowercase 4-character PDB id, or a UniProt accession for AlphaFoldDB records. */
  structure: Schema.String,
  /** auth_asym_id — the same key SIFTS and RCSB join on. */
  chain: Schema.String,
  source: Schema.String,
  loci: Schema.Array(Locus),
  /** UniProt accessions lifted from content.features["UniProt-<acc>"]. */
  uniprot: Schema.Array(Schema.String),
})
export type Annotation = Schema.Schema.Type<typeof Annotation>

export interface Page {
  readonly count: number
  readonly annotations: Annotation[]
}

export interface Interface {
  /** One page. `skip` is required by the API and therefore required here. */
  readonly page: (input: { limit: number; skip: number; source?: string }) => Effect.Effect<Page, BioHttp.BioError>
  /**
   * Every annotation for a source, paginated to exhaustion and then checked against the
   * count the service itself reported. Fails rather than returning a partial set.
   */
  readonly all: (source?: string) => Effect.Effect<Annotation[], BioHttp.BioError>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/RepeatsDB") {}
export const use = serviceUse(Service)

/** The join key shared with SIFTS and RCSB: lowercase PDB id + author chain. */
export function chainKey(a: { structure: string; chain: string }): string {
  return `${a.structure.toLowerCase()}_${a.chain}`
}

function uniprotAccessions(features: unknown): string[] {
  if (!isRecord(features)) return []
  const out: string[] = []
  for (const key of Object.keys(features)) {
    // Keys are source-prefixed, e.g. "UniProt-P19148" or "GO-0000287".
    if (key.startsWith("UniProt-")) out.push(key.slice("UniProt-".length))
  }
  return out
}

export function parseAnnotation(raw: unknown): Annotation | undefined {
  if (!isRecord(raw)) return undefined
  const content = isRecord(raw.content) ? raw.content : undefined
  if (!content) return undefined
  const chain = isRecord(content.chain) ? content.chain : undefined
  if (!chain || typeof chain.structure !== "string" || typeof chain.id !== "string") return undefined
  const loci = Array.isArray(content.loci)
    ? content.loci
        .filter(isRecord)
        .map((l) => ({
          type: typeof l.type === "string" ? l.type : "",
          start: typeof l.start === "string" ? l.start : String(l.start ?? ""),
          end: typeof l.end === "string" ? l.end : String(l.end ?? ""),
          ...(typeof l.class === "string" && l.class.length > 0 ? { class: l.class } : {}),
          ...(typeof l.parent === "number" ? { parent: l.parent } : {}),
        }))
    : []
  return {
    structure: chain.structure,
    chain: chain.id,
    source: typeof chain.source === "string" ? chain.source : "",
    loci,
    uniprot: uniprotAccessions(content.features),
  }
}

/**
 * Parse a page body. `items` arrives as an object keyed by stringified index, so this
 * takes its values in numeric key order rather than treating it as an array.
 */
export function parsePage(body: unknown): Page | undefined {
  if (!isRecord(body) || typeof body.count !== "number") return undefined
  const items = body.items
  const raws: unknown[] = Array.isArray(items)
    ? items
    : isRecord(items)
      ? Object.keys(items)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => (items as Record<string, unknown>)[k])
      : []
  return {
    count: body.count,
    annotations: raws.map(parseAnnotation).filter((a): a is Annotation => a !== undefined),
  }
}

export function summarize(annotations: readonly Annotation[]): string {
  if (annotations.length === 0) return "No RepeatsDB annotations."
  return annotations
    .map((a) => {
      const region = a.loci.find((l) => l.type === "region")
      const units = a.loci.filter((l) => l.type === "unit").length
      const span = region ? `${region.start}-${region.end}` : "?"
      const cls = region?.class ? ` class ${region.class}` : ""
      const up = a.uniprot.length ? ` [UniProt ${a.uniprot.join(",")}]` : ""
      return `- ${chainKey(a)}  region ${span}${cls}, ${units} units${up}`
    })
    .join("\n")
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const spacing = BioHttp.pace()

    const fetchPage = Effect.fn("RepeatsDB.page")(function* (input: {
      limit: number
      skip: number
      source?: string
    }) {
      const params: Record<string, string> = {
        limit: String(Math.min(input.limit, MAX_LIMIT)),
        // Required by the API: omitting it is a 400, not page one.
        skip: String(input.skip),
      }
      if (input.source) params["chain.source"] = input.source
      const url = `${BASE}?${new URLSearchParams(params).toString()}`

      const attempt = Effect.gen(function* () {
        yield* spacing()
        const res = yield* HttpClientRequest.get(BASE).pipe(
          HttpClientRequest.setUrlParams(params),
          http.execute,
          Effect.timeout("60 seconds"),
        )
        if (res.status !== 200) {
          return yield* Effect.fail(
            new BioHttp.RequestFailed({ source: "RepeatsDB", url, reason: `HTTP ${res.status}`, status: res.status }),
          )
        }
        return yield* res.json
      }).pipe(
        // Anything that is not already a typed failure (timeout, socket error, bad JSON)
        // becomes one. Nothing here is allowed to degrade into an empty result.
        Effect.catch((cause) =>
          Effect.fail(
            cause instanceof BioHttp.RequestFailed
              ? cause
              : new BioHttp.RequestFailed({ source: "RepeatsDB", url, reason: String(cause) }),
          ),
        ),
      )

      // Retry only what can succeed on a second attempt. A 400 is a wrong request and
      // will stay wrong; retrying it four times just multiplies the same error.
      const body = yield* BioHttp.retryTransient(attempt)
      const page = parsePage(body)
      if (!page) {
        return yield* Effect.fail(
          new BioHttp.RequestFailed({ source: "RepeatsDB", url, reason: "unrecognised response shape" }),
        )
      }
      return page
    })

    const all = Effect.fn("RepeatsDB.all")(function* (source?: string) {
      const first = yield* fetchPage({ limit: MAX_LIMIT, skip: 0, source })
      const out: Annotation[] = [...first.annotations]
      let skip = MAX_LIMIT
      while (skip < first.count) {
        const next = yield* fetchPage({ limit: MAX_LIMIT, skip, source })
        if (next.annotations.length === 0) break
        out.push(...next.annotations)
        skip += MAX_LIMIT
      }
      // The whole point: a short download must fail, not quietly become the answer.
      yield* BioHttp.assertComplete("RepeatsDB", first.count, out.length)
      return out
    })

    return Service.of({ page: fetchPage, all })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [httpClient] })
