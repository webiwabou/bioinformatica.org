export * as CorpusSnapshot from "./snapshot"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { Context, Effect, Layer, Schema } from "effect"
import { createHash } from "crypto"
import path from "path"

// A corpus snapshot: the data, written once, plus the manifest that makes it citable.
//
// Two rules, and both are about the same failure. First, fetch once and work
// from what you wrote — re-querying live mid-campaign lets two stages disagree about what
// the corpus was, and nothing will tell you which result is right. Second, the snapshot
// carries the upstream release stamp, because "we downloaded it in August" is not a
// version and cannot be re-fetched.
//
// Data lands in a VISIBLE project folder, not in `.bioinformatica/`: a corpus is the
// scientist's working content. Only agent bookkeeping belongs in `.bioinformatica/`.

const DEFAULT_DIR = "corpus"

export const Manifest = Schema.Struct({
  /** Which database this came from, e.g. "RepeatsDB" or "UniProtKB". */
  source: Schema.String,
  /** The exact request, so a third party can re-issue it. */
  endpoint: Schema.String,
  /** The query as sent, where the endpoint alone does not determine the result. */
  query: Schema.optional(Schema.String),
  /**
   * The upstream release this data came from, verbatim from the source where it
   * publishes one (e.g. "PDB: 33.26 | UniProt: 2026.03"). Absent means the source
   * publishes no version — which is itself worth recording rather than hiding.
   */
  release: Schema.optional(Schema.String),
  fetchedAt: Schema.String,
  rows: Schema.Number,
  bytes: Schema.Number,
  sha256: Schema.String,
  /** Path of the data file, relative to the manifest. */
  data: Schema.String,
})
export type Manifest = Schema.Schema.Type<typeof Manifest>

export interface WriteInput {
  readonly name: string
  readonly source: string
  readonly endpoint: string
  readonly query?: string
  readonly release?: string
  readonly rows: readonly unknown[]
  /** Defaults to `corpus/` in the project directory. */
  readonly directory?: string
}

export interface Written {
  readonly path: string
  readonly manifestPath: string
  readonly rows: number
  readonly sha256: string
}

export interface Interface {
  readonly write: (input: WriteInput) => Effect.Effect<Written>
  readonly read: (name: string, directory?: string) => Effect.Effect<Manifest | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/BioSnapshot") {}
export const use = serviceUse(Service)

/** One JSON record per line. Streamable, greppable, and appendable without a parser. */
export function toNdjson(rows: readonly unknown[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : "")
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

export function describe(m: Manifest): string {
  return [
    `${m.source} snapshot — ${m.rows} rows, ${m.bytes} bytes`,
    `  release  ${m.release ?? "(source publishes no version — pin by fetch date only)"}`,
    `  fetched  ${m.fetchedAt}`,
    `  endpoint ${m.endpoint}${m.query ? `  query: ${m.query}` : ""}`,
    `  sha256   ${m.sha256}`,
    `  data     ${m.data}`,
  ].join("\n")
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const resolve = Effect.fnUntraced(function* (directory?: string) {
      const ctx = yield* InstanceState.context
      return path.isAbsolute(directory ?? "")
        ? directory!
        : path.join(ctx.directory, directory ?? DEFAULT_DIR)
    })

    const write = Effect.fn("BioSnapshot.write")(function* (input: WriteInput) {
      const dir = yield* resolve(input.directory)
      const dataName = `${input.name}.ndjson`
      const dataPath = path.join(dir, dataName)
      const manifestPath = path.join(dir, `${input.name}.manifest.json`)
      const text = toNdjson(input.rows)
      const digest = sha256(text)

      // Write via a temporary path and rename, so an interrupted write cannot be picked
      // up as a complete corpus on the next run.
      const tmp = `${dataPath}.${process.pid}.tmp`
      yield* fs.writeWithDirs(tmp, text).pipe(Effect.andThen(fs.rename(tmp, dataPath)), Effect.orDie)

      const manifest = Manifest.make({
        source: input.source,
        endpoint: input.endpoint,
        ...(input.query ? { query: input.query } : {}),
        ...(input.release ? { release: input.release } : {}),
        fetchedAt: new Date().toISOString(),
        rows: input.rows.length,
        bytes: Buffer.byteLength(text, "utf8"),
        sha256: digest,
        data: dataName,
      })
      yield* fs.writeWithDirs(manifestPath, JSON.stringify(manifest, null, 2)).pipe(Effect.orDie)

      return { path: dataPath, manifestPath, rows: input.rows.length, sha256: digest }
    })

    const read = Effect.fn("BioSnapshot.read")(function* (name: string, directory?: string) {
      const dir = yield* resolve(directory)
      const raw = yield* fs
        .readJson(path.join(dir, `${name}.manifest.json`))
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (raw === undefined) return undefined
      return yield* Schema.decodeUnknownEffect(Manifest)(raw).pipe(Effect.catch(() => Effect.succeed(undefined)))
    })

    return Service.of({ write, read })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node] })
