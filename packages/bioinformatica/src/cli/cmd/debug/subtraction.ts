import { EOL } from "os"
import { Effect } from "effect"
import { RepeatsDB } from "@/bio/repeatsdb"
import { Sifts } from "@/bio/sifts"
import { effectCmd, fail } from "../../effect-cmd"

export const RepeatsdbCommand = effectCmd({
  command: "repeatsdb",
  describe: "inspect RepeatsDB — the already-annotated set a discovery campaign subtracts (read-only)",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("source", { describe: "chain.source filter, e.g. 'RCSB/PDB' or 'AlphaFoldDB'", type: "string" })
      .option("limit", { describe: "records to show (max 100 per page)", type: "number" })
      .option("all", { describe: "paginate to exhaustion and verify completeness", type: "boolean" }),
  handler: Effect.fn("Cli.debug.repeatsdb")(function* (args: {
    source?: string
    limit?: number
    all?: boolean
  }) {
    const db = yield* RepeatsDB.Service
    if (args.all) {
      const all = yield* db.all(args.source).pipe(Effect.catch((e) => fail(e.message)))
      process.stdout.write(`${all.length} annotations, completeness verified against the reported count.` + EOL)
      process.stdout.write(RepeatsDB.summarize(all.slice(0, 5)) + EOL)
      return
    }
    const page = yield* db
      .page({ limit: args.limit ?? 5, skip: 0, source: args.source })
      .pipe(Effect.catch((e) => fail(e.message)))
    process.stdout.write(`count=${page.count} for source=${args.source ?? "(all)"}` + EOL)
    process.stdout.write(RepeatsDB.summarize(page.annotations) + EOL)
  }),
})

export const SiftsCommand = effectCmd({
  command: "sifts",
  describe: "load the SIFTS PDB<->UniProt mapping and show its version stamp (read-only, cached)",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("file", { describe: "flat file name", type: "string" })
      .option("chain", { describe: "look up a pdbid_chain, e.g. 1a0c_A", type: "string" }),
  handler: Effect.fn("Cli.debug.sifts")(function* (args: { file?: string; chain?: string }) {
    const sifts = yield* Sifts.Service
    const table = yield* sifts.load(args.file).pipe(Effect.catch((e) => fail(e.message)))
    process.stdout.write(Sifts.describe(table) + EOL)
    if (args.chain) {
      const want = args.chain.toLowerCase()
      const hits = table.rows.filter((r) => Sifts.chainKey(r).toLowerCase() === want)
      process.stdout.write(
        (hits.length === 0
          ? `No SIFTS mapping for ${args.chain}.`
          : hits.map((h) => `  ${Sifts.chainKey(h)} -> ${h.accession}  PDB ${h.pdbBeg}-${h.pdbEnd}  SP ${h.spBeg}-${h.spEnd}`).join("\n")) + EOL,
      )
    }
  }),
})
