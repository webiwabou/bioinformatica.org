import { EOL } from "os"
import { Effect } from "effect"
import { PDB } from "@/bio/pdb"
import { RepeatsDB } from "@/bio/repeatsdb"
import { UniProt } from "@/bio/uniprot"
import { CorpusSnapshot } from "@/bio/snapshot"
import { effectCmd, fail } from "../../effect-cmd"

export const CorpusCommand = effectCmd({
  command: "corpus <name>",
  describe: "write or inspect a versioned corpus snapshot in the project's corpus/ folder",
  builder: (yargs) =>
    yargs
      .positional("name", { describe: "snapshot name", type: "string" })
      .option("repeatsdb", { describe: "fetch the RepeatsDB annotated set into this snapshot", type: "string" })
      .option("pdb-holdings", { describe: "fetch every released PDB entry id", type: "boolean" })
      .option("pdb-chains", { describe: "fetch per-chain records for these entry ids (comma-separated)", type: "string" })
      .option("uniprot", { describe: "fetch a UniProt query into this snapshot, e.g. 'reviewed:true AND organism_id:9606'", type: "string" })
      .option("dir", { describe: "output directory (default: corpus/)", type: "string" }),
  handler: Effect.fn("Cli.debug.corpus")(function* (args: {
    name?: string
    repeatsdb?: string
    pdbHoldings?: boolean
    pdbChains?: string
    uniprot?: string
    dir?: string
  }) {
    if (!args.name) return yield* fail("name is required")
    const name = args.name
    const snapshots = yield* CorpusSnapshot.Service
    if (args.repeatsdb !== undefined) {
      const db = yield* RepeatsDB.Service
      const source = args.repeatsdb.length > 0 ? args.repeatsdb : RepeatsDB.SOURCE_PDB
      const rows = yield* db.all(source).pipe(Effect.catch((e) => fail(e.message)))
      const written = yield* snapshots.write({
        name,
        source: "RepeatsDB",
        endpoint: "https://repeatsdb.org/api/production/annotations",
        query: `chain.source=${source}`,
        // RepeatsDB publishes no dump, no version and no checksum — recording that
        // absence is more honest than implying the snapshot is pinned to a release.
        rows,
        ...(args.dir ? { directory: args.dir } : {}),
      })
      process.stdout.write(`${written.rows} rows -> ${written.path}` + EOL)
    }
    if (args.pdbHoldings) {
      const ids = yield* (yield* PDB.Service).holdings().pipe(Effect.catch((e) => fail(e.message)))
      const written = yield* snapshots.write({
        name,
        source: "RCSB PDB",
        endpoint: "https://data.rcsb.org/rest/v1/holdings/current/entry_ids",
        rows: ids,
        ...(args.dir ? { directory: args.dir } : {}),
      })
      process.stdout.write(`${written.rows} entry ids -> ${written.path}` + EOL)
    }

    if (args.pdbChains) {
      const ids = args.pdbChains.split(",").map((x) => x.trim()).filter(Boolean)
      const chains = yield* (yield* PDB.Service).chains(ids).pipe(Effect.catch((e) => fail(e.message)))
      for (const c of chains.slice(0, 20)) {
        process.stdout.write(
          `  ${PDB.chainKey(c)}  entity ${c.entityId}  ${c.sequence ? `${c.sequence.length} aa` : "no seq"}  ${c.description ?? ""}` + EOL,
        )
      }
      process.stdout.write(`${chains.length} chains from ${ids.length} entries` + EOL)
    }

    if (args.uniprot) {
      const up = yield* UniProt.Service
      const c = yield* up.count(args.uniprot).pipe(Effect.catch((e) => fail(e.message)))
      process.stdout.write(`UniProt ${c.total} results, release ${c.release ?? "(none)"}` + EOL)
      const all = yield* up.all(args.uniprot).pipe(Effect.catch((e) => fail(e.message)))
      const written = yield* snapshots.write({
        name,
        source: "UniProtKB",
        endpoint: "https://rest.uniprot.org/uniprotkb/search",
        query: args.uniprot,
        ...(all.release ? { release: all.release } : {}),
        rows: all.rows,
        ...(args.dir ? { directory: args.dir } : {}),
      })
      process.stdout.write(`${written.rows} rows -> ${written.path}` + EOL)
    }

    const manifest = yield* snapshots.read(name, args.dir)
    if (!manifest) {
      process.stdout.write(`No snapshot named '${name}'.` + EOL)
      return
    }
    process.stdout.write(CorpusSnapshot.describe(manifest) + EOL)
  }),
})
