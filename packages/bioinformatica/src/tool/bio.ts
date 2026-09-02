import { Effect, Schema } from "effect"
import { Ensembl } from "@/bio/ensembl"
import { UniProt } from "@/bio/uniprot"
import { PDB } from "@/bio/pdb"
import { KEGG } from "@/bio/kegg"
import * as Tool from "./tool"

// Structured, credential-free lookups against four public biological databases:
// Ensembl, UniProt, the RCSB PDB and KEGG. Each tool is read-only and returns data
// with a citation, so any claim drawn from it carries its source.

const GENE_DESC =
  "Look up a gene in Ensembl by symbol. Returns the Ensembl gene ID, description, biotype, and genomic location, with a citation. Species defaults to human (homo_sapiens); pass another Ensembl species name for other organisms. Use this to ground a claim about a gene's identity, location, or type. Read-only."

const PROTEIN_DESC =
  "Search UniProt for a protein. Pass a query (a protein/gene name, or UniProt syntax like 'gene:BRCA1 AND organism_id:9606 AND reviewed:true'). Returns accession, protein name, gene, organism, and a function summary, each with a citation. Use this to ground a claim about a protein's identity or function. Read-only."

const STRUCTURE_DESC =
  "Look up macromolecular structures in the RCSB PDB. Pass a 4-character PDB ID for a direct lookup, or a keyword to full-text search. Returns title, experimental method, resolution, and release date with a citation. Use this to ground a claim about a solved structure. Read-only."

const PATHWAY_DESC =
  "Find biological pathways in KEGG by keyword (e.g. 'glycolysis', 'apoptosis', 'p53'). Returns matching KEGG pathway IDs and names with citations/links. Use this to ground a claim about a pathway or to point the scientist at the canonical pathway map. Read-only."

export const GeneLookupTool = Tool.define(
  "gene_lookup",
  Effect.gen(function* () {
    const ensembl = yield* Ensembl.Service
    return {
      description: GENE_DESC,
      parameters: Schema.Struct({
        symbol: Schema.String.annotate({ description: "Gene symbol, e.g. 'BRCA1'." }),
        species: Schema.optional(Schema.String.annotate({ description: "Ensembl species name; defaults to homo_sapiens." })),
      }),
      execute: (params: { symbol: string; species?: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const gene = yield* ensembl.gene(params.symbol, params.species)
          return {
            title: params.symbol,
            metadata: { gene },
            output: gene ? Ensembl.citation(gene) : `No Ensembl gene found for '${params.symbol}'.`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const ProteinLookupTool = Tool.define(
  "protein_lookup",
  Effect.gen(function* () {
    const uniprot = yield* UniProt.Service
    return {
      description: PROTEIN_DESC,
      parameters: Schema.Struct({
        query: Schema.String.annotate({ description: "Protein/gene name or UniProt query syntax." }),
        limit: Schema.optional(Schema.Number.annotate({ description: "Max entries (default 5)." })),
      }),
      execute: (params: { query: string; limit?: number }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const result = yield* uniprot.search(params.query, params.limit ?? 5)
          return {
            title: params.query,
            metadata: { proteins: result.proteins, failed: result.failed },
            output: UniProt.summarize(result.proteins, result.failed),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const StructureLookupTool = Tool.define(
  "structure_lookup",
  Effect.gen(function* () {
    const pdb = yield* PDB.Service
    return {
      description: STRUCTURE_DESC,
      parameters: Schema.Struct({
        query: Schema.String.annotate({ description: "A 4-character PDB ID, or a keyword to search." }),
        limit: Schema.optional(Schema.Number.annotate({ description: "Max structures for a keyword search (default 5)." })),
      }),
      execute: (params: { query: string; limit?: number }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const structures = yield* pdb.lookup(params.query, params.limit ?? 5)
          return { title: params.query, metadata: { structures }, output: PDB.summarize(structures) }
        }).pipe(Effect.orDie),
    }
  }),
)

export const PathwayLookupTool = Tool.define(
  "pathway_lookup",
  Effect.gen(function* () {
    const kegg = yield* KEGG.Service
    return {
      description: PATHWAY_DESC,
      parameters: Schema.Struct({
        query: Schema.String.annotate({ description: "Pathway keyword, e.g. 'glycolysis'." }),
        limit: Schema.optional(Schema.Number.annotate({ description: "Max pathways (default 10)." })),
      }),
      execute: (params: { query: string; limit?: number }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const pathways = yield* kegg.findPathways(params.query, params.limit ?? 10)
          return { title: params.query, metadata: { pathways }, output: KEGG.summarize(pathways) }
        }).pipe(Effect.orDie),
    }
  }),
)
