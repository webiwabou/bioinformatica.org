export * as Entrez from "./entrez"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { httpClient } from "@bioinformatica/core/effect/app-node-platform"
import { Global } from "@bioinformatica/core/global"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { isRecord } from "@/util/record"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import fsNode from "fs/promises"
import path from "path"

// NCBI Entrez E-utilities client for PubMed literature. This is a dedicated
// structured, citable, credential-free scientific API — the primary path for
// literature. Per NCBI usage policy every call identifies the
// tool ("bioinformatica") and a contact email; an optional api_key raises the rate limit
// and is read from the environment or ~/.config/bioinformatica/ncbi.json.

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
const TOOL = "bioinformatica"
const DEFAULT_EMAIL = "bioinformatica-agent@users.noreply.github.com"

export const PubmedRecord = Schema.Struct({
  pmid: Schema.String,
  title: Schema.String,
  authors: Schema.Array(Schema.String),
  journal: Schema.optional(Schema.String),
  year: Schema.optional(Schema.String),
  doi: Schema.optional(Schema.String),
  url: Schema.String,
})
export type PubmedRecord = Schema.Schema.Type<typeof PubmedRecord>

export interface SearchResult {
  readonly count: number
  readonly records: PubmedRecord[]
}

export interface Interface {
  readonly searchPubmed: (query: string, retmax?: number) => Effect.Effect<SearchResult>
  readonly fetchAbstract: (pmid: string) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/Entrez") {}

export const use = serviceUse(Service)

interface Credentials {
  email: string
  apiKey?: string
}

async function loadCredentials(): Promise<Credentials> {
  let email = process.env.BIOINFORMATICA_NCBI_EMAIL
  let apiKey = process.env.BIOINFORMATICA_NCBI_API_KEY
  if (!email || !apiKey) {
    try {
      const raw = await fsNode.readFile(path.join(Global.Path.config, "ncbi.json"), "utf8")
      const parsed = JSON.parse(raw) as unknown
      if (isRecord(parsed)) {
        if (!email && typeof parsed.email === "string") email = parsed.email
        if (!apiKey && typeof parsed.apiKey === "string") apiKey = parsed.apiKey
      }
    } catch {
      // no config file; fall back to the default contact email
    }
  }
  return { email: email || DEFAULT_EMAIL, apiKey }
}

// A PubMed citation string with everything needed to find the paper again.
export function citation(record: PubmedRecord): string {
  const trimDot = (s: string) => s.replace(/\.\s*$/, "").trim()
  const lead = record.authors.length > 0 ? `${record.authors[0]}${record.authors.length > 1 ? " et al" : ""}` : "[No author]"
  const parts = [`${lead}. ${trimDot(record.title)}`]
  if (record.journal) parts.push(trimDot(record.journal))
  if (record.year) parts.push(record.year)
  const tail = [`PMID: ${record.pmid}`]
  if (record.doi) tail.push(`doi:${record.doi}`)
  return `${parts.join(". ")}. ${tail.join(". ")}. ${record.url}`
}

export function summarize(result: SearchResult): string {
  if (result.records.length === 0) return "No PubMed results found."
  const header = `${result.count} PubMed results (showing ${result.records.length}):`
  return [header, ...result.records.map((r, i) => `${i + 1}. ${citation(r)}`)].join("\n")
}

function parseYear(record: Record<string, unknown>): string | undefined {
  const source = typeof record.sortpubdate === "string" ? record.sortpubdate : typeof record.pubdate === "string" ? record.pubdate : ""
  const m = source.match(/(\d{4})/)
  return m?.[1]
}

function parseRecord(pmid: string, record: unknown): PubmedRecord | undefined {
  if (!isRecord(record)) return undefined
  const authors = Array.isArray(record.authors)
    ? record.authors
        .filter((a): a is Record<string, unknown> => isRecord(a) && a.authtype === "Author")
        .map((a) => (typeof a.name === "string" ? a.name : ""))
        .filter((n) => n.length > 0)
    : []
  const doi = Array.isArray(record.articleids)
    ? record.articleids
        .filter((a): a is Record<string, unknown> => isRecord(a) && a.idtype === "doi")
        .map((a) => (typeof a.value === "string" ? a.value : undefined))
        .find((v) => v)
    : undefined
  return {
    pmid,
    title: typeof record.title === "string" ? record.title : "[No title]",
    authors,
    journal: typeof record.fulljournalname === "string" ? record.fulljournalname : typeof record.source === "string" ? record.source : undefined,
    year: parseYear(record),
    doi: doi ?? undefined,
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const credentials = yield* Effect.promise(() => loadCredentials())

    const params = (extra: Record<string, string>) => ({
      tool: TOOL,
      email: credentials.email,
      ...(credentials.apiKey ? { api_key: credentials.apiKey } : {}),
      ...extra,
    })

    const getJson = (endpoint: string, query: Record<string, string>) =>
      HttpClientRequest.get(`${BASE}/${endpoint}`).pipe(
        HttpClientRequest.setUrlParams(params(query)),
        http.execute,
        Effect.flatMap((res) => res.json),
        Effect.timeout("20 seconds"),
        Effect.catch(() => Effect.succeed(undefined)),
      )

    const searchPubmed = Effect.fn("Entrez.searchPubmed")(function* (query: string, retmax = 10) {
      const search = yield* getJson("esearch.fcgi", { db: "pubmed", term: query, retmax: String(retmax), retmode: "json" })
      const esr = isRecord(search) && isRecord(search.esearchresult) ? search.esearchresult : undefined
      const ids = esr && Array.isArray(esr.idlist) ? esr.idlist.filter((x): x is string => typeof x === "string") : []
      const count = esr && typeof esr.count === "string" ? Number(esr.count) : ids.length
      if (ids.length === 0) return { count, records: [] }

      const summary = yield* getJson("esummary.fcgi", { db: "pubmed", id: ids.join(","), retmode: "json" })
      const result = isRecord(summary) && isRecord(summary.result) ? summary.result : {}
      const records = ids
        .map((id) => parseRecord(id, (result as Record<string, unknown>)[id]))
        .filter((r): r is PubmedRecord => r !== undefined)
      return { count, records }
    })

    const fetchAbstract = Effect.fn("Entrez.fetchAbstract")(function* (pmid: string) {
      const text = yield* HttpClientRequest.get(`${BASE}/efetch.fcgi`).pipe(
        HttpClientRequest.setUrlParams(params({ db: "pubmed", id: pmid, rettype: "abstract", retmode: "text" })),
        http.execute,
        Effect.flatMap((res) => res.text),
        Effect.timeout("20 seconds"),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      return text && text.trim().length > 0 ? text.trim() : undefined
    })

    return Service.of({ searchPubmed, fetchAbstract })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [httpClient] })
