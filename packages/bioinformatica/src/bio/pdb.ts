export * as PDB from "./pdb"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { httpClient } from "@bioinformatica/core/effect/app-node-platform"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { isRecord } from "@/util/record"
import { BioHttp } from "./http"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

// RCSB PDB — macromolecular structures. Dedicated, structured,
// credential-free. Accepts a 4-character PDB ID (direct lookup) or a
// keyword (full-text search then lookup).
const DATA = "https://data.rcsb.org/rest/v1/core/entry"
const SEARCH = "https://search.rcsb.org/rcsbsearch/v2/query"
const HOLDINGS = "https://data.rcsb.org/rest/v1/holdings/current/entry_ids"
const GRAPHQL = "https://data.rcsb.org/graphql"
const PDB_ID = /^[0-9][A-Za-z0-9]{3}$/

/** GraphQL `entries()` rejects more than this; 1000 ids is also slow (~12 s). */
export const GRAPHQL_MAX_IDS = 1000
/** Practical batch: 200 heavy ids returned in ~1.4 s. */
export const GRAPHQL_BATCH = 200

/**
 * Entry-level fields that actually carry human-written text, for mining. Sampled over 60
 * random entries: struct.title, struct_keywords.pdbx_keywords, struct_keywords.text and
 * rcsb_primary_citation.title were populated 60/60. `struct.pdbx_descriptor` was null in
 * all 60 and must not be used.
 */
export const TEXT_FIELDS = ["struct.title", "struct_keywords.pdbx_keywords", "struct_keywords.text"] as const

/** One polymer chain, keyed the way RepeatsDB and SIFTS key it: lowercase id + AUTHOR chain. */
export interface Chain {
  readonly entry: string
  /** auth_asym_id — NOT the label asym id that appears in a polymer_instance identifier. */
  readonly authChain: string
  readonly entityId: string
  /** SEQRES, canonical one-letter form. */
  readonly sequence?: string
  readonly description?: string
}

export const Structure = Schema.Struct({
  id: Schema.String,
  title: Schema.optional(Schema.String),
  method: Schema.optional(Schema.String),
  resolution: Schema.optional(Schema.Number),
  released: Schema.optional(Schema.String),
  url: Schema.String,
})
export type Structure = Schema.Schema.Type<typeof Structure>

export interface Interface {
  readonly lookup: (idOrTerm: string, size?: number) => Effect.Effect<Structure[]>
  /** Every currently-released entry id. ~258k today. Unsorted. */
  readonly holdings: () => Effect.Effect<string[], BioHttp.BioError>
  /** All ids matching a structured or full-text query, with no silent page cap. */
  readonly searchAll: (query: unknown, returnType?: string) => Effect.Effect<string[], BioHttp.BioError>
  /** Per-CHAIN records with author chain ids and SEQRES, batched through GraphQL. */
  readonly chains: (entryIds: readonly string[]) => Effect.Effect<Chain[], BioHttp.BioError>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/PDB") {}
export const use = serviceUse(Service)

export function parseEntry(id: string, data: unknown): Structure | undefined {
  if (!isRecord(data)) return undefined
  const struct = isRecord(data.struct) ? data.struct : undefined
  const exptl = Array.isArray(data.exptl) && isRecord(data.exptl[0]) ? data.exptl[0] : undefined
  const info = isRecord(data.rcsb_entry_info) ? data.rcsb_entry_info : undefined
  const acc = isRecord(data.rcsb_accession_info) ? data.rcsb_accession_info : undefined
  const resolution = info && Array.isArray(info.resolution_combined) && typeof info.resolution_combined[0] === "number" ? info.resolution_combined[0] : undefined
  const released = acc && typeof acc.initial_release_date === "string" ? acc.initial_release_date.slice(0, 10) : undefined
  return {
    id: id.toUpperCase(),
    title: struct && typeof struct.title === "string" ? struct.title : undefined,
    method: exptl && typeof exptl.method === "string" ? exptl.method : undefined,
    resolution,
    released,
    url: `https://www.rcsb.org/structure/${id.toUpperCase()}`,
  }
}

export function citation(s: Structure): string {
  const bits = [s.method, s.resolution ? `${s.resolution} Å` : undefined, s.released].filter(Boolean)
  return `PDB ${s.id}${s.title ? `: ${s.title}` : ""}${bits.length ? ` (${bits.join(", ")})` : ""}. ${s.url}`
}

export function summarize(structures: readonly Structure[]): string {
  if (structures.length === 0) return "No PDB structures found."
  return structures.map((s) => `- ${citation(s)}`).join("\n")
}

/**
 * Read ids out of a search response.
 *
 * Three shapes have to be tolerated, and getting any of them wrong yields a silently
 * short corpus: `results_verbosity: "compact"` makes `result_set` a list of BARE STRINGS
 * while the default ("minimal") makes it objects with `.identifier`; and paging past the
 * end returns HTTP 200 with the `result_set` key ABSENT altogether.
 */
export function parseSearchIds(body: unknown): string[] {
  if (!isRecord(body)) return []
  const set = body.result_set
  if (!Array.isArray(set)) return []
  return set
    .map((r) => (typeof r === "string" ? r : isRecord(r) && typeof r.identifier === "string" ? r.identifier : undefined))
    .filter((x): x is string => !!x)
}

/**
 * Fan a GraphQL entries() response out into one record per CHAIN.
 *
 * SEQRES is stored per ENTITY, not per chain, so an entity's sequence is spread across
 * every author chain it appears as: 4HHB_1 -> ["A","C"]. Counting entities as chains
 * undercounts by roughly half on the PDB as a whole.
 *
 * The canonical one-letter sequence is used deliberately:
 * `pdbx_seq_one_letter_code` writes modified residues in parentheses, e.g. `(MSE)`, so
 * parsing it as plain A-Z corrupts every sequence containing one.
 */
export function parseChains(body: unknown): Chain[] {
  const data = isRecord(body) && isRecord(body.data) ? body.data : undefined
  const entries = data && Array.isArray(data.entries) ? data.entries : []
  const out: Chain[] = []
  for (const e of entries) {
    if (!isRecord(e) || typeof e.rcsb_id !== "string") continue
    const entities = Array.isArray(e.polymer_entities) ? e.polymer_entities : []
    for (const ent of entities) {
      if (!isRecord(ent)) continue
      const poly = isRecord(ent.entity_poly) ? ent.entity_poly : undefined
      const ids = isRecord(ent.rcsb_polymer_entity_container_identifiers)
        ? ent.rcsb_polymer_entity_container_identifiers
        : undefined
      const desc =
        isRecord(ent.rcsb_polymer_entity) && typeof ent.rcsb_polymer_entity.pdbx_description === "string"
          ? ent.rcsb_polymer_entity.pdbx_description
          : undefined
      const sequence =
        poly && typeof poly.pdbx_seq_one_letter_code_can === "string" ? poly.pdbx_seq_one_letter_code_can : undefined
      const entityId = ids && typeof ids.entity_id === "string" ? ids.entity_id : ""
      const authChains = ids && Array.isArray(ids.auth_asym_ids) ? ids.auth_asym_ids : []
      for (const c of authChains) {
        if (typeof c !== "string") continue
        out.push({
          entry: e.rcsb_id,
          authChain: c,
          entityId,
          ...(sequence ? { sequence } : {}),
          ...(desc ? { description: desc } : {}),
        })
      }
    }
  }
  return out
}

/** The join key shared with RepeatsDB and SIFTS. */
export function chainKey(c: { entry: string; authChain: string }): string {
  return `${c.entry.toLowerCase()}_${c.authChain}`
}

const CHAINS_QUERY = `query($ids:[String!]!){
  entries(entry_ids:$ids){
    rcsb_id
    polymer_entities{
      entity_poly{ pdbx_seq_one_letter_code_can }
      rcsb_polymer_entity{ pdbx_description }
      rcsb_polymer_entity_container_identifiers{ entity_id auth_asym_ids }
    }
  }
}`

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    // Unfiltered client: the corpus paths must inspect status codes themselves (204, 200-with-errors).
    const raw = yield* HttpClient.HttpClient

    const entry = Effect.fn("PDB.entry")(function* (id: string) {
      const data = yield* HttpClientRequest.get(`${DATA}/${encodeURIComponent(id)}`).pipe(
        http.execute,
        Effect.flatMap((res) => res.json),
        Effect.timeout("20 seconds"),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      return parseEntry(id, data)
    })

    const searchIds = Effect.fn("PDB.searchIds")(function* (term: string, size: number) {
      const query = {
        query: { type: "terminal", service: "full_text", parameters: { value: term } },
        return_type: "entry",
        request_options: { paginate: { start: 0, rows: size } },
      }
      const data = yield* HttpClientRequest.get(SEARCH).pipe(
        HttpClientRequest.setUrlParams({ json: JSON.stringify(query) }),
        http.execute,
        Effect.flatMap((res) => res.json),
        Effect.timeout("20 seconds"),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      const set = isRecord(data) && Array.isArray(data.result_set) ? data.result_set : []
      return set
        .map((r) => (isRecord(r) && typeof r.identifier === "string" ? r.identifier : undefined))
        .filter((x): x is string => !!x)
    })

    const lookup = Effect.fn("PDB.lookup")(function* (idOrTerm: string, size = 5) {
      const ids = PDB_ID.test(idOrTerm.trim()) ? [idOrTerm.trim()] : yield* searchIds(idOrTerm, size)
      const entries = yield* Effect.forEach(ids, (id) => entry(id), { concurrency: 4 })
      return entries.filter((s): s is Structure => s !== undefined)
    })

    /** POST JSON and hand back the parsed body, with typed failures. */
    const post = Effect.fnUntraced(function* (url: string, payload: unknown, source: string) {
      const res = yield* HttpClientRequest.post(url).pipe(
        HttpClientRequest.bodyJsonUnsafe(payload),
        raw.execute,
        Effect.timeout("120 seconds"),
        Effect.catch((cause) => Effect.fail(new BioHttp.RequestFailed({ source, url, reason: String(cause) }))),
      )
      // A search with zero hits answers 204 with an EMPTY BODY — parsing it as JSON
      // throws on what is a perfectly legitimate empty result.
      if (res.status === 204) return { empty: true as const, body: undefined }
      if (res.status !== 200) {
        return yield* Effect.fail(
          new BioHttp.RequestFailed({ source, url, reason: `HTTP ${res.status}`, status: res.status }),
        )
      }
      const body = yield* res.json.pipe(
        Effect.catch((cause) => Effect.fail(new BioHttp.RequestFailed({ source, url, reason: `bad body: ${cause}` }))),
      )
      // GraphQL reports its errors with a 200 status, so the status alone proves nothing.
      const gql = BioHttp.graphqlErrors(body)
      if (gql) return yield* Effect.fail(new BioHttp.RequestFailed({ source, url, reason: `GraphQL: ${gql}` }))
      return { empty: false as const, body }
    })

    const holdings = Effect.fn("PDB.holdings")(function* () {
      const res = yield* HttpClientRequest.get(HOLDINGS).pipe(
        raw.execute,
        Effect.timeout("120 seconds"),
        Effect.catch((cause) =>
          Effect.fail(new BioHttp.RequestFailed({ source: "RCSB", url: HOLDINGS, reason: String(cause) })),
        ),
      )
      if (res.status !== 200) {
        return yield* Effect.fail(
          new BioHttp.RequestFailed({ source: "RCSB", url: HOLDINGS, reason: `HTTP ${res.status}`, status: res.status }),
        )
      }
      const body = yield* res.json.pipe(
        Effect.catch((cause) =>
          Effect.fail(new BioHttp.RequestFailed({ source: "RCSB", url: HOLDINGS, reason: String(cause) })),
        ),
      )
      return Array.isArray(body) ? body.filter((x): x is string => typeof x === "string") : []
    })

    const searchAll = Effect.fn("PDB.searchAll")(function* (query: unknown, returnType = "entry") {
      const payload = {
        query,
        return_type: returnType,
        request_options: {
          // Omitting BOTH paginate and return_all_hits silently returns 10 rows with a
          // 200 and the true total_count beside them.
          return_all_hits: true,
          // Bare id strings rather than {identifier, score} objects.
          results_verbosity: "compact",
          // The default sort is by score, which is not a total order — most hits tie —
          // so pages under it can duplicate and drop ids.
          sort: [{ sort_by: "rcsb_id", direction: "asc" }],
        },
      }
      const out = yield* BioHttp.retryTransient(post(SEARCH, payload, "RCSB Search"))
      if (out.empty) return []
      return parseSearchIds(out.body)
    })

    const chains = Effect.fn("PDB.chains")(function* (entryIds: readonly string[]) {
      const all: Chain[] = []
      for (let i = 0; i < entryIds.length; i += GRAPHQL_BATCH) {
        const batch = entryIds.slice(i, i + GRAPHQL_BATCH)
        const out = yield* BioHttp.retryTransient(
          post(GRAPHQL, { query: CHAINS_QUERY, variables: { ids: batch } }, "RCSB GraphQL"),
        )
        if (out.empty) continue
        const parsed = parseChains(out.body)
        // GraphQL silently DROPS unknown or obsoleted ids: a batch of 200 containing a
        // withdrawn entry comes back short, HTTP 200, with no errors array. Diff by id
        // rather than trusting the length, and never zip by index.
        const seen = new Set(parsed.map((c) => c.entry.toUpperCase()))
        const missing = batch.filter((id) => !seen.has(id.toUpperCase()))
        if (missing.length > 0) {
          yield* Effect.logWarning("RCSB GraphQL dropped ids", {
            requested: batch.length,
            returned: seen.size,
            missing: missing.slice(0, 20),
          })
        }
        all.push(...parsed)
      }
      return all
    })

    return Service.of({ lookup, holdings, searchAll, chains })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [httpClient] })
