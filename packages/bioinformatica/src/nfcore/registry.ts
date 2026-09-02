export * as Registry from "./registry"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { httpClient } from "@bioinformatica/core/effect/app-node-platform"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { Global } from "@bioinformatica/core/global"
import { InstallationVersion } from "@bioinformatica/core/installation/version"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { isRecord } from "@/util/record"
import { CorpusSnapshot } from "@/bio/snapshot"
import { Context, Duration, Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import path from "path"

// nf-core publishes its full pipeline registry as a single JSON document. Bioinformatica
// consumes that artifact directly — it does not maintain its own list —
// and caches it locally so pipeline discovery keeps working offline after the
// first sync. The cache refreshes when stale (older than the TTL)
// on first use of a session and can be refreshed on demand.
const SOURCE = "https://nf-co.re/pipelines.json"
const USER_AGENT = `bioinformatica/${InstallationVersion}`
const TTL = Duration.hours(1)

export const Release = Schema.Struct({
  version: Schema.String,
  publishedAt: Schema.optional(Schema.String),
  nextflowVersion: Schema.optional(Schema.String),
})
export type Release = Schema.Schema.Type<typeof Release>

export const Pipeline = Schema.Struct({
  name: Schema.String,
  fullName: Schema.String,
  description: Schema.String,
  topics: Schema.Array(Schema.String),
  archived: Schema.Boolean,
  releases: Schema.Array(Release),
  latestRelease: Schema.optional(Schema.String),
  latestNextflowVersion: Schema.optional(Schema.String),
})
export type Pipeline = Schema.Schema.Type<typeof Pipeline>

export interface Interface {
  readonly list: () => Effect.Effect<Pipeline[]>
  readonly get: (name: string) => Effect.Effect<Pipeline | undefined>
  /** Returns a verdict, not a bare list: below the confidence floor there is no fit. */
  readonly search: (query: string, limit?: number) => Effect.Effect<SearchResult>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/NfcoreRegistry") {}

export const use = serviceUse(Service)

// Parse nf-core's registry document into just the fields Bioinformatica reasons about.
// Tolerant by design: the source has dozens of GitHub-metadata fields we ignore,
// and one malformed entry must not drop the rest.
export function parse(raw: unknown): Pipeline[] {
  if (!isRecord(raw)) return []
  const workflows = Array.isArray(raw.remote_workflows) ? raw.remote_workflows : []
  const out: Pipeline[] = []
  for (const w of workflows) {
    if (!isRecord(w) || typeof w.name !== "string") continue
    const releasesRaw = Array.isArray(w.releases) ? w.releases : []
    const releases: Release[] = releasesRaw
      .filter(isRecord)
      .map((r) => ({
        version: typeof r.tag_name === "string" ? r.tag_name : "",
        publishedAt: typeof r.published_at === "string" ? r.published_at : undefined,
        nextflowVersion: typeof r.nextflow_version === "string" ? r.nextflow_version : undefined,
      }))
      .filter((r) => r.version.length > 0)
    // Releases arrive newest-first with "dev" last; the latest stable release is
    // the first non-dev tag.
    const latest = releases.find((r) => r.version !== "dev")
    out.push({
      name: w.name,
      fullName: typeof w.full_name === "string" ? w.full_name : `nf-core/${w.name}`,
      description: typeof w.description === "string" ? w.description : "",
      topics: Array.isArray(w.topics) ? w.topics.filter((t): t is string => typeof t === "string") : [],
      archived: w.archived === true,
      releases,
      latestRelease: latest?.version,
      latestNextflowVersion: latest?.nextflowVersion,
    })
  }
  return out
}

/**
 * Function words that carry no biological meaning but are matched as substrings inside
 * real pipeline names and topics. Without this list `not` scores 40 against
 * `proteinannotator` — because "an-NOT-ator" contains it — and the registry confidently
 * recommends an annotation pipeline to someone who wrote "not yet catalogued".
 */
const STOPWORDS = new Set([
  "and", "any", "are", "but", "can", "for", "from", "has", "how", "its", "not", "the", "that",
  "them", "they", "this", "was", "were", "what", "when", "which", "with", "you", "your", "yet",
  "find", "get", "want", "need", "all", "some", "have", "into", "over", "than", "then",
])

/**
 * The meaningful terms of a query: lowercased, split on whitespace and hyphens, with
 * one- and two-character fragments and stopwords dropped. Hyphen splitting is what lets
 * "ATAC-seq" match a pipeline named `atacseq`.
 */
export function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,_/-]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
}

export function score(pipeline: Pipeline, query: string): number {
  const q = query.toLowerCase().trim()
  if (q.length === 0) return 0
  const terms = queryTerms(q)
  const name = pipeline.name.toLowerCase()
  const description = pipeline.description.toLowerCase()
  const topics = pipeline.topics.map((t) => t.toLowerCase())

  let s = 0
  if (name === q) s += 100
  else if (name.includes(q)) s += 40
  for (const term of terms) {
    if (name.includes(term)) s += 20
    if (topics.some((t) => t.includes(term))) s += 15
    if (description.includes(term)) s += 5
  }
  // Deprioritize archived pipelines and dev-only pipelines (no stable release).
  if (pipeline.archived) s -= 30
  if (!pipeline.latestRelease) s -= 10
  return s
}

/**
 * Minimum score for a confident match: at least a topic or name hit. Prose-only
 * evidence (5 per term) is never enough on its own.
 */
export const CONFIDENT_SCORE = 15

/**
 * Minimum fraction of a query's meaningful terms a pipeline must match to count as a fit.
 *
 * Absolute score cannot do this job: measured against the live registry, the correct
 * answer for "ATAC-seq" (`atacseq`) scores 20, and so does a wrong answer for "proteins
 * with repeated regions structure sequence" (`phyloplace`, matching only "sequence").
 * What separates them is how much of the question the pipeline actually answers —
 * atacseq matches 2 of 2 terms, phyloplace 1 of 5.
 *
 * Below this the honest answer is that no pipeline fits, not the best of a bad list.
 * Returning a ranked list unconditionally is what makes an agent confidently propose a
 * structure-prediction pipeline to a scientist who already has experimental structures
 *.
 */
export const MIN_COVERAGE = 0.6

/** Fraction of the query's meaningful terms that appear anywhere in the pipeline's text. */
export function coverage(pipeline: Pipeline, query: string): number {
  const terms = queryTerms(query)
  if (terms.length === 0) return 0
  const haystack = [pipeline.name, pipeline.description, ...pipeline.topics].join(" ").toLowerCase()
  return terms.filter((t) => haystack.includes(t)).length / terms.length
}

export interface SearchResult {
  /** Pipelines that clear CONFIDENT_SCORE, best first. */
  readonly matches: Pipeline[]
  /** Scored above zero but below the floor: shown as context, never as a fit. */
  readonly nearMisses: Pipeline[]
  /** False means: say no nf-core pipeline fits, and design a process instead. */
  readonly suitable: boolean
}

/** Pure: rank `pipelines` against `query` and split them at the confidence floor. */
export function classify(pipelines: Pipeline[], query: string, limit = 10): SearchResult {
  const ranked = pipelines
    .map((pipeline) => ({ pipeline, score: score(pipeline, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.pipeline.name.localeCompare(b.pipeline.name))
  const confident = (p: Pipeline, sc: number) => sc >= CONFIDENT_SCORE && coverage(p, query) >= MIN_COVERAGE
  const matches = ranked
    .filter((entry) => confident(entry.pipeline, entry.score))
    .slice(0, limit)
    .map((entry) => entry.pipeline)
  const nearMisses = ranked
    .filter((entry) => !confident(entry.pipeline, entry.score))
    .slice(0, 5)
    .map((entry) => entry.pipeline)
  return { matches, nearMisses, suitable: matches.length > 0 }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const cacheFile = path.join(Global.Path.cache, "nfcore", "pipelines.json")

    const isFresh = Effect.fnUntraced(function* () {
      const stat = yield* fs.stat(cacheFile).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!stat) return false
      const mtime = Option.getOrElse(stat.mtime, () => new Date(0)).getTime()
      return Date.now() - mtime < Duration.toMillis(TTL)
    })

    const loadFromDisk = Effect.fnUntraced(function* () {
      return yield* fs.readJson(cacheFile).pipe(Effect.catch(() => Effect.succeed(undefined)))
    })

    const fetchAndWrite = Effect.fn("NfcoreRegistry.fetchAndWrite")(function* () {
      const text = yield* HttpClientRequest.get(SOURCE).pipe(
        HttpClientRequest.setHeader("User-Agent", USER_AGENT),
        http.execute,
        Effect.flatMap((res) => res.text),
        Effect.timeout("20 seconds"),
      )
      const tempfile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`
      yield* fs.writeWithDirs(tempfile, text).pipe(
        Effect.andThen(fs.rename(tempfile, cacheFile)),
        Effect.catch((error) =>
          fs.remove(tempfile, { force: true }).pipe(Effect.ignore, Effect.andThen(Effect.fail(error))),
        ),
      )
      return JSON.parse(text)
    })

    /**
     * A catalogue pinned by the operator, via `BIOINFORMATICA_NFCORE_PIPELINES`
     * pointing at a frozen snapshot manifest written by `script/freeze-pipelines.ts`.
     *
     * When set, this is the whole source: no fetch, no TTL, no mutable cache. A
     * measurement has to be able to name the catalogue it resolved pipelines
     * against, and an hour-old cache under `Global.Path.cache` cannot be named —
     * two runs a week apart silently see different catalogues.
     *
     * A pin that cannot be loaded is a hard failure rather than a fallback to
     * live. Quietly reverting to the network would produce exactly the result the
     * operator was trying to prevent, and it would look identical to a successful
     * pinned run.
     */
    const loadPinned = Effect.fn("NfcoreRegistry.loadPinned")(function* (manifestPath: string) {
      const raw = yield* fs
        .readJson(manifestPath)
        .pipe(Effect.catch(() => Effect.succeed(undefined as unknown)))
      const manifest = yield* Schema.decodeUnknownEffect(CorpusSnapshot.Manifest)(raw).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (!manifest) {
        return yield* Effect.die(
          new Error(
            `BIOINFORMATICA_NFCORE_PIPELINES points at ${manifestPath}, which is not a readable snapshot manifest. ` +
              `Write one with: bun run script/freeze-pipelines.ts`,
          ),
        )
      }
      const dataPath = path.resolve(path.dirname(manifestPath), manifest.data)
      const text = yield* fs.readFileString(dataPath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (text === undefined) {
        return yield* Effect.die(
          new Error(`pinned catalogue manifest ${manifestPath} references ${manifest.data}, which cannot be read`),
        )
      }
      // Deliberately not re-hashed here: `bioinformatica verify` is the thing that checks a
      // snapshot against its manifest, with no model and no network, and doing it
      // in two places invites the two to disagree.
      const workflows = text
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as unknown)
      yield* Effect.logInfo("nf-core catalogue pinned", {
        manifest: manifestPath,
        rows: workflows.length,
        sha256: manifest.sha256,
        fetchedAt: manifest.fetchedAt,
      })
      return parse({ remote_workflows: workflows })
    })

    const populate = Effect.fn("NfcoreRegistry.populate")(function* () {
      const pinned = process.env["BIOINFORMATICA_NFCORE_PIPELINES"]
      if (pinned) return yield* loadPinned(path.resolve(pinned))
      if (yield* isFresh()) {
        const disk = yield* loadFromDisk()
        if (disk !== undefined) return parse(disk)
      }
      const fetched = yield* fetchAndWrite().pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (fetched !== undefined) return parse(fetched)
      // Offline: fall back to whatever is cached, even if stale.
      const disk = yield* loadFromDisk()
      if (disk !== undefined) return parse(disk)
      yield* Effect.logWarning("nf-core registry unavailable and no cache present")
      return [] as Pipeline[]
    })

    const [cachedGet, invalidate] = yield* Effect.cachedInvalidateWithTTL(populate(), Duration.infinity)

    const list = Effect.fn("NfcoreRegistry.list")(function* () {
      return yield* cachedGet
    })

    const get = Effect.fn("NfcoreRegistry.get")(function* (name: string) {
      const wanted = name.replace(/^nf-core\//, "").toLowerCase()
      return (yield* cachedGet).find((p) => p.name.toLowerCase() === wanted)
    })

    const search = Effect.fn("NfcoreRegistry.search")(function* (query: string, limit = 10) {
      return classify(yield* cachedGet, query, limit)
    })

    const refresh = Effect.fn("NfcoreRegistry.refresh")(function* (force = false) {
      if (force) yield* fetchAndWrite().pipe(Effect.ignore)
      yield* invalidate
      yield* cachedGet
    })

    return Service.of({ list, get, search, refresh })
  }),
)

export function summarize(pipelines: Pipeline[]): string {
  if (pipelines.length === 0) return "No matching nf-core pipelines found."
  return pipelines
    .map((p) => {
      const release = p.latestRelease
        ? `latest stable ${p.latestRelease}${p.latestNextflowVersion ? `, requires Nextflow ${p.latestNextflowVersion}` : ""}`
        : "no stable release yet (dev only)"
      const flags = p.archived ? " [archived]" : ""
      return `- ${p.fullName}${flags}: ${p.description}\n    ${release}`
    })
    .join("\n")
}

/**
 * Render a search verdict for the model. When nothing clears the confidence floor this
 * says so first and explicitly withholds the near misses as candidates, because the
 * failure mode being prevented is adopting the closest entry as though it fit.
 */
export function report(result: SearchResult): string {
  if (result.suitable) return summarize(result.matches)
  const lines = [
    "NO_SUITABLE_PIPELINE — no nf-core pipeline confidently matches this objective.",
    "",
  ]
  if (result.nearMisses.length > 0) {
    lines.push(
      "The closest entries matched only incidental words in their descriptions. They are NOT proposed as a fit:",
      summarize(result.nearMisses),
      "",
    )
  }
  lines.push(
    "Do not adopt one of these because it is the closest — say plainly that no pipeline fits.",
    "When none fits, the work is to design a process from established, version-pinned tooling and hold it to the conformance rules; load the discovery-campaign skill.",
  )
  return lines.join("\n")
}

export const node = LayerNode.make({ service: Service, layer, deps: [httpClient, FSUtil.node] })
