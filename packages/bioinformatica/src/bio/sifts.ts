export * as Sifts from "./sifts"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { Global } from "@bioinformatica/core/global"
import { httpClient } from "@bioinformatica/core/effect/app-node-platform"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { BioHttp } from "./http"
import { Context, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import path from "path"
import { gunzipSync } from "zlib"

// SIFTS — the authoritative PDB <-> UniProt residue-level mapping, published by EBI as
// weekly flat files. This is the join that makes a structure corpus and a sequence corpus
// the same corpus.
//
// Two things matter for reproducibility (conformance rule 9):
//   - The first line is a provenance comment carrying the exact PDB and UniProt releases
//     the file was built from, e.g. "# 2026/08/17 - 18:31 | PDB: 33.26 | UniProt: 2026.03".
//     Naive header parsing treats it as the header row and silently shifts every column.
//     It is also the ONLY version stamp these files carry, so it goes in the manifest.
//   - The download is large and EBI can be slow (a live probe delivered 5.1 MB of 6.1 MB
//     in 120 s before timing out), so the timeout here is generous and a partial file is
//     never written into the cache path.

const FTP = "https://ftp.ebi.ac.uk/pub/databases/msd/sifts/flatfiles/tsv"

/** PDB chain -> UniProt segments. The primary join. */
export const CHAIN_UNIPROT = "pdb_chain_uniprot.tsv.gz"
/** Same shape, restricted to residues that actually have coordinates. */
export const SEGMENTS_OBSERVED = "uniprot_segments_observed.tsv.gz"

export interface Version {
  /** The raw provenance line, kept verbatim for the manifest. */
  readonly line: string
  readonly built?: string
  readonly pdb?: string
  readonly uniprot?: string
}

export interface Mapping {
  /** Lowercase PDB id. */
  readonly pdb: string
  /** auth_asym_id. */
  readonly chain: string
  readonly accession: string
  readonly resBeg: string
  readonly resEnd: string
  readonly pdbBeg: string
  readonly pdbEnd: string
  readonly spBeg: string
  readonly spEnd: string
}

export interface Table {
  readonly version: Version
  readonly rows: Mapping[]
}

export interface Interface {
  /** Download (cached) and parse a SIFTS flat file. */
  readonly load: (file?: string) => Effect.Effect<Table, BioHttp.BioError>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/Sifts") {}
export const use = serviceUse(Service)

/**
 * Parse the leading provenance comment. Returns undefined for anything that is not a
 * comment line, so a caller can tell a stamped file from an unstamped one rather than
 * inventing a version.
 */
export function parseVersion(line: string): Version | undefined {
  if (!line.startsWith("#")) return undefined
  const body = line.slice(1).trim()
  const pdb = /PDB:\s*([^\s|]+)/.exec(body)?.[1]
  const uniprot = /UniProt:\s*([^\s|]+)/.exec(body)?.[1]
  const built = /^([0-9/]{8,10}\s*-\s*[0-9:]{4,5})/.exec(body)?.[1]?.trim()
  return { line, ...(built ? { built } : {}), ...(pdb ? { pdb } : {}), ...(uniprot ? { uniprot } : {}) }
}

export function parseRow(line: string): Mapping | undefined {
  // The EBI flat files are CRLF. Splitting on "\n" alone leaves a trailing carriage
  // return on the LAST field, so SP_END silently becomes "439\r" and every downstream
  // comparison against it fails for reasons nothing reports.
  const f = line.replace(/\r$/, "").split("\t")
  if (f.length < 9) return undefined
  const [pdb, chain, accession, resBeg, resEnd, pdbBeg, pdbEnd, spBeg, spEnd] = f
  if (!pdb || !chain || !accession) return undefined
  return {
    pdb: pdb.toLowerCase(),
    chain,
    accession,
    resBeg: resBeg ?? "",
    resEnd: resEnd ?? "",
    pdbBeg: pdbBeg ?? "",
    pdbEnd: pdbEnd ?? "",
    spBeg: spBeg ?? "",
    spEnd: spEnd ?? "",
  }
}

/**
 * Parse a decompressed flat file: one provenance comment, one header row, then data.
 * Fails when the version stamp is absent — an unstamped mapping cannot be cited, and
 * silently continuing would put an unversioned join at the base of the campaign.
 */
export function parseTable(text: string): { table?: Table; error?: string } {
  const lines = text.split("\n")
  const first = lines[0] ?? ""
  const version = parseVersion(first)
  if (!version) return { error: "no leading '#' provenance line — cannot record which PDB/UniProt release this is" }
  const rows: Mapping[] = []
  // lines[1] is the column header; data starts at 2.
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line.length === 0) continue
    const row = parseRow(line)
    if (row) rows.push(row)
  }
  return { table: { version, rows } }
}

/** The join key shared with RepeatsDB and RCSB. */
export function chainKey(m: { pdb: string; chain: string }): string {
  return `${m.pdb.toLowerCase()}_${m.chain}`
}

export function describe(table: Table): string {
  const pdbs = new Set(table.rows.map((r) => r.pdb))
  const chains = new Set(table.rows.map((r) => chainKey(r)))
  const accs = new Set(table.rows.map((r) => r.accession))
  return [
    `SIFTS ${table.version.line}`,
    `  ${table.rows.length} segment rows`,
    `  ${pdbs.size} PDB entries, ${chains.size} PDB+chain pairs, ${accs.size} UniProt accessions`,
  ].join("\n")
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const fs = yield* FSUtil.Service
    const cacheDir = path.join(Global.Path.cache, "sifts")

    const load = Effect.fn("Sifts.load")(function* (file = CHAIN_UNIPROT) {
      const url = `${FTP}/${file}`
      const cached = path.join(cacheDir, file)

      let buf: Uint8Array | undefined = yield* fs
        .readFile(cached)
        .pipe(Effect.catch(() => Effect.succeed(undefined)))

      if (!buf) {
        const res = yield* HttpClientRequest.get(url).pipe(
          http.execute,
          // EBI is slow for these; the 20s used elsewhere in this layer is not enough.
          Effect.timeout("10 minutes"),
          Effect.catch((cause) =>
            Effect.fail(new BioHttp.RequestFailed({ source: "SIFTS", url, reason: String(cause) })),
          ),
        )
        if (res.status !== 200) {
          return yield* Effect.fail(
            new BioHttp.RequestFailed({ source: "SIFTS", url, reason: `HTTP ${res.status}`, status: res.status }),
          )
        }
        const bytes = yield* res.arrayBuffer.pipe(
          Effect.catch((cause) =>
            Effect.fail(new BioHttp.RequestFailed({ source: "SIFTS", url, reason: String(cause) })),
          ),
        )
        buf = new Uint8Array(bytes)
        // Write via a temp path so an interrupted download can never be picked up as a
        // complete cached file on the next run.
        const tmp = `${cached}.${process.pid}.tmp`
        yield* fs.writeWithDirs(tmp, buf).pipe(Effect.andThen(fs.rename(tmp, cached)), Effect.orDie)
      }

      const bytes = buf
      const text = yield* Effect.try({
        try: () => gunzipSync(bytes).toString("utf8"),
        catch: (cause) => new BioHttp.RequestFailed({ source: "SIFTS", url, reason: `decompress failed: ${cause}` }),
      })
      const parsed = parseTable(text)
      if (!parsed.table) {
        return yield* Effect.fail(new BioHttp.RequestFailed({ source: "SIFTS", url, reason: parsed.error ?? "unparsable" }))
      }
      return parsed.table
    })

    return Service.of({ load })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [httpClient, FSUtil.node] })
