import { EOL } from "os"
import { Effect } from "effect"
import { Ensembl } from "@/bio/ensembl"
import { UniProt } from "@/bio/uniprot"
import { PDB } from "@/bio/pdb"
import { KEGG } from "@/bio/kegg"
import { effectCmd, fail } from "../../effect-cmd"

export const GeneCommand = effectCmd({
  command: "gene <symbol>",
  describe: "look up a gene in Ensembl (read-only)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("symbol", { describe: "gene symbol, e.g. BRCA1", type: "string" })
      .option("species", { describe: "Ensembl species (default homo_sapiens)", type: "string" }),
  handler: Effect.fn("Cli.debug.gene")(function* (args: { symbol?: string; species?: string }) {
    if (!args.symbol) return yield* fail("gene symbol is required")
    const gene = yield* (yield* Ensembl.Service).gene(args.symbol, args.species)
    process.stdout.write((gene ? Ensembl.citation(gene) : `No Ensembl gene found for '${args.symbol}'.`) + EOL)
  }),
})

export const ProteinCommand = effectCmd({
  command: "protein <query>",
  describe: "search UniProt for a protein (read-only)",
  instance: false,
  builder: (yargs) => yargs.positional("query", { describe: "protein/gene name or UniProt query", type: "string" }),
  handler: Effect.fn("Cli.debug.protein")(function* (args: { query?: string }) {
    if (!args.query) return yield* fail("query is required")
    const result = yield* (yield* UniProt.Service).search(args.query, 3)
    process.stdout.write(UniProt.summarize(result.proteins, result.failed) + EOL)
  }),
})

export const StructureCommand = effectCmd({
  command: "structure <query>",
  describe: "look up a PDB structure by ID or keyword (read-only)",
  instance: false,
  builder: (yargs) => yargs.positional("query", { describe: "PDB ID or keyword", type: "string" }),
  handler: Effect.fn("Cli.debug.structure")(function* (args: { query?: string }) {
    if (!args.query) return yield* fail("query is required")
    const structures = yield* (yield* PDB.Service).lookup(args.query, 3)
    process.stdout.write(PDB.summarize(structures) + EOL)
  }),
})

export const PathwayCommand = effectCmd({
  command: "pathway <query>",
  describe: "find KEGG pathways by keyword (read-only)",
  instance: false,
  builder: (yargs) => yargs.positional("query", { describe: "pathway keyword, e.g. glycolysis", type: "string" }),
  handler: Effect.fn("Cli.debug.pathway")(function* (args: { query?: string }) {
    if (!args.query) return yield* fail("query is required")
    const pathways = yield* (yield* KEGG.Service).findPathways(args.query, 8)
    process.stdout.write(KEGG.summarize(pathways) + EOL)
  }),
})
