export * as UniProt from "./uniprot"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { httpClient } from "@bioinformatica/core/effect/app-node-platform"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { isRecord } from "@/util/record"
import { BioHttp } from "./http"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"

// UniProt — protein reference data. Dedicated, structured, credential-free.
const BASE = "https://rest.uniprot.org/uniprotkb/search"
const FIELDS = "accession,protein_name,gene_names,organism_name,cc_function"

/**
 * Maximum page size the API accepts (501 is a 400). The DEFAULT is 25 and it applies
 * silently: a single request with no `size` returns 25 rows with HTTP 200 while
 * `X-Total-Results` says 575503, and nothing anywhere reports the truncation. Every
 * corpus fetch must set this explicitly and follow the cursor to exhaustion.
 */
export const MAX_PAGE = 500

/** Fields carrying free text or cross-references. NONE are in the default projection. */
export const MINING_FIELDS =
  "accession,id,reviewed,protein_name,gene_names,organism_name,length,keyword,cc_function,cc_domain,cc_similarity,ft_repeat,xref_pdb"

export const Protein = Schema.Struct({
  accession: Schema.String,
  name: Schema.String,
  genes: Schema.Array(Schema.String),
  organism: Schema.optional(Schema.String),
  function: Schema.optional(Schema.String),
  url: Schema.String,
})
export type Protein = Schema.Schema.Type<typeof Protein>

export interface Interface {
  /**
   * `failed` is set when the REQUEST did not succeed. An empty `proteins` with
   * `failed` unset means the query genuinely matched nothing; with `failed` set it
   * means we do not know. Conflating the two is how a rate-limited request becomes a
   * negative scientific result.
   */
  readonly search: (query: string, size?: number) => Effect.Effect<{ proteins: Protein[]; failed?: string }>
  /** Exact result count without transferring a body, plus the release stamp. */
  readonly count: (query: string) => Effect.Effect<{ total: number; release?: string }, BioHttp.BioError>
  /**
   * Every record for a query, paged to exhaustion and checked against the count the
   * service itself reported. Returns raw records so the caller decides what to keep.
   */
  readonly all: (
    query: string,
    options?: { fields?: string },
  ) => Effect.Effect<{ rows: unknown[]; total: number; release?: string }, BioHttp.BioError>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/UniProt") {}
export const use = serviceUse(Service)

function functionText(comments: unknown): string | undefined {
  if (!Array.isArray(comments)) return undefined
  const fn = comments.find((c): c is Record<string, unknown> => isRecord(c) && c.commentType === "FUNCTION")
  if (!fn || !Array.isArray(fn.texts)) return undefined
  const first = fn.texts.find((t): t is Record<string, unknown> => isRecord(t) && typeof t.value === "string")
  const value = first && typeof first.value === "string" ? first.value : undefined
  return value && value.length > 400 ? value.slice(0, 400) + "…" : value
}

export function parseEntry(entry: unknown): Protein | undefined {
  if (!isRecord(entry) || typeof entry.primaryAccession !== "string") return undefined
  const desc = isRecord(entry.proteinDescription) ? entry.proteinDescription : undefined
  const rec = desc && isRecord(desc.recommendedName) ? desc.recommendedName : undefined
  const name = rec && isRecord(rec.fullName) && typeof rec.fullName.value === "string" ? rec.fullName.value : "[unnamed protein]"
  const genes = Array.isArray(entry.genes)
    ? entry.genes
        .map((g) => (isRecord(g) && isRecord(g.geneName) && typeof g.geneName.value === "string" ? g.geneName.value : undefined))
        .filter((g): g is string => !!g)
    : []
  return {
    accession: entry.primaryAccession,
    name,
    genes,
    organism: isRecord(entry.organism) && typeof entry.organism.scientificName === "string" ? entry.organism.scientificName : undefined,
    function: functionText(entry.comments),
    url: `https://www.uniprot.org/uniprotkb/${entry.primaryAccession}`,
  }
}

export function citation(p: Protein): string {
  return `UniProt ${p.accession} — ${p.name}${p.genes.length ? ` (gene ${p.genes.join("/")})` : ""}${p.organism ? `, ${p.organism}` : ""}. ${p.url}`
}

export function summarize(proteins: readonly Protein[], failed?: string): string {
  if (failed) return `UniProt request FAILED (${failed}). This is not an empty result — do not report it as one.`
  if (proteins.length === 0) return "No UniProt entries found."
  return proteins
    .map((p) => `- ${citation(p)}${p.function ? `\n    Function: ${p.function}` : ""}`)
    .join("\n")
}

/**
 * Cursor pagination terminates when the Link header is ABSENT — not when a page comes
 * back short or empty. The cursor is opaque and encodes the query and page size, so it
 * is followed verbatim and never constructed.
 */
export function nextLink(header: string | undefined): string | undefined {
  if (!header) return undefined
  const m = /<([^>]+)>\s*;\s*rel="next"/.exec(header)
  return m?.[1]
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const search = Effect.fn("UniProt.search")(function* (query: string, size = 5) {
      const outcome = yield* HttpClientRequest.get(BASE).pipe(
        HttpClientRequest.setUrlParams({ query, format: "json", size: String(size), fields: FIELDS }),
        http.execute,
        Effect.flatMap((res) => res.json),
        Effect.timeout("20 seconds"),
        Effect.map((data) => ({ data, failed: undefined as string | undefined })),
        Effect.catch((cause) => Effect.succeed({ data: undefined, failed: String(cause) })),
      )
      if (outcome.failed) return { proteins: [], failed: outcome.failed }
      const results = isRecord(outcome.data) && Array.isArray(outcome.data.results) ? outcome.data.results : []
      return { proteins: results.map(parseEntry).filter((p): p is Protein => p !== undefined) }
    })
    interface RawPage {
      readonly body: unknown
      readonly total: number | undefined
      readonly release: string | undefined
      readonly next: string | undefined
    }

    /** One request, returning the body plus the headers the corpus logic depends on. */
    const fetchPage = Effect.fnUntraced(function* (url: string) {
      const res = yield* HttpClientRequest.get(url).pipe(
        http.execute,
        Effect.timeout("120 seconds"),
        Effect.catch((cause) =>
          Effect.fail(new BioHttp.RequestFailed({ source: "UniProtKB", url, reason: String(cause) })),
        ),
      )
      const body = yield* res.json.pipe(
        Effect.catch((cause) =>
          Effect.fail(new BioHttp.RequestFailed({ source: "UniProtKB", url, reason: `bad body: ${cause}` })),
        ),
      )
      const h = res.headers as Record<string, string | undefined>
      const page: RawPage = {
        body,
        total: h["x-total-results"] ? Number(h["x-total-results"]) : undefined,
        release: h["x-uniprot-release"],
        next: nextLink(h["link"]),
      }
      return page
    })

    const count = Effect.fn("UniProt.count")(function* (query: string) {
      // size=0 returns a zero-length body and the exact total in the header.
      const url = `${BASE}?${new URLSearchParams({ query, size: "0", format: "list" }).toString()}`
      const res = yield* HttpClientRequest.get(url).pipe(
        http.execute,
        Effect.timeout("60 seconds"),
        Effect.catch((cause) =>
          Effect.fail(new BioHttp.RequestFailed({ source: "UniProtKB", url, reason: String(cause) })),
        ),
      )
      const h = res.headers as Record<string, string | undefined>
      const total = h["x-total-results"]
      if (total === undefined) {
        return yield* Effect.fail(
          new BioHttp.RequestFailed({ source: "UniProtKB", url, reason: "no X-Total-Results header" }),
        )
      }
      return { total: Number(total), ...(h["x-uniprot-release"] ? { release: h["x-uniprot-release"] } : {}) }
    })

    const all = Effect.fn("UniProt.all")(function* (query: string, options?: { fields?: string }) {
      const params = new URLSearchParams({
        query,
        format: "json",
        // Never rely on the default: it is 25, and it truncates silently.
        size: String(MAX_PAGE),
        fields: options?.fields ?? MINING_FIELDS,
      })
      let url: string | undefined = `${BASE}?${params.toString()}`
      const rows: unknown[] = []
      let total: number | undefined
      let release: string | undefined

      while (url) {
        const page: RawPage = yield* BioHttp.retryTransient(fetchPage(url))
        if (total === undefined) total = page.total
        if (release === undefined) release = page.release
        else if (page.release && page.release !== release) {
          // Responses are cached for 12 hours, so a long fetch can straddle a release
          // boundary and silently mix two versions of the database into one corpus.
          return yield* Effect.fail(
            new BioHttp.RequestFailed({
              source: "UniProtKB",
              url,
              reason: `release changed mid-fetch (${release} -> ${page.release}); refusing to mix versions`,
            }),
          )
        }
        const results = isRecord(page.body) && Array.isArray(page.body.results) ? page.body.results : []
        rows.push(...results)
        url = page.next
      }

      if (total !== undefined) yield* BioHttp.assertComplete("UniProtKB", total, rows.length)
      return { rows, total: total ?? rows.length, ...(release ? { release } : {}) }
    })

    return Service.of({ search, count, all })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [httpClient] })
