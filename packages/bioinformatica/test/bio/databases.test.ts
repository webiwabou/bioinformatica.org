import { describe, expect, test } from "bun:test"
import { Ensembl } from "../../src/bio/ensembl"
import { UniProt } from "../../src/bio/uniprot"
import { PDB } from "../../src/bio/pdb"
import { KEGG } from "../../src/bio/kegg"

describe("bio.ensembl", () => {
  const raw = {
    id: "ENSG00000012048",
    display_name: "BRCA1",
    description: "BRCA1 DNA repair associated [Source:HGNC Symbol;Acc:HGNC:1100]",
    biotype: "protein_coding",
    seq_region_name: "17",
    start: 43044292,
    end: 43170245,
    strand: -1,
  }
  test("parses a gene with location and strand", () => {
    const gene = Ensembl.parseGene("BRCA1", "homo_sapiens", raw)!
    expect(gene.id).toBe("ENSG00000012048")
    expect(gene.biotype).toBe("protein_coding")
    expect(gene.location).toBe("17:43044292-43170245 (-)")
    expect(gene.url).toContain("ENSG00000012048")
    expect(Ensembl.citation(gene)).toContain("Ensembl BRCA1")
  })
  test("returns undefined for a non-gene payload", () => {
    expect(Ensembl.parseGene("X", "homo_sapiens", { error: "Not found" })).toBeUndefined()
  })
})

describe("bio.uniprot", () => {
  const entry = {
    primaryAccession: "P04637",
    proteinDescription: { recommendedName: { fullName: { value: "Cellular tumor antigen p53" } } },
    genes: [{ geneName: { value: "TP53" } }],
    organism: { scientificName: "Homo sapiens" },
    comments: [{ commentType: "FUNCTION", texts: [{ value: "Multifunctional transcription factor." }] }],
  }
  test("parses accession, name, gene, organism, and function", () => {
    const p = UniProt.parseEntry(entry)!
    expect(p.accession).toBe("P04637")
    expect(p.name).toBe("Cellular tumor antigen p53")
    expect(p.genes).toEqual(["TP53"])
    expect(p.organism).toBe("Homo sapiens")
    expect(p.function).toContain("transcription factor")
    expect(UniProt.citation(p)).toContain("UniProt P04637")
  })
})

describe("bio.pdb", () => {
  const raw = {
    struct: { title: "THE CRYSTAL STRUCTURE OF HUMAN DEOXYHAEMOGLOBIN" },
    exptl: [{ method: "X-RAY DIFFRACTION" }],
    rcsb_entry_info: { resolution_combined: [1.74] },
    rcsb_accession_info: { initial_release_date: "1984-07-17T00:00:00.000+00:00" },
  }
  test("parses title, method, resolution, and release date", () => {
    const s = PDB.parseEntry("4hhb", raw)!
    expect(s.id).toBe("4HHB")
    expect(s.method).toBe("X-RAY DIFFRACTION")
    expect(s.resolution).toBe(1.74)
    expect(s.released).toBe("1984-07-17")
    const c = PDB.citation(s)
    expect(c).toContain("PDB 4HHB")
    expect(c).toContain("1.74 Å")
  })
})

describe("bio.kegg", () => {
  test("parses the flat id\\tname pathway list", () => {
    const text = "path:map04115\tp53 signaling pathway\nmap00010\tGlycolysis / Gluconeogenesis\n"
    const pathways = KEGG.parsePathways(text)
    expect(pathways).toHaveLength(2)
    expect(pathways[0]).toEqual({
      id: "map04115",
      name: "p53 signaling pathway",
      url: "https://www.kegg.jp/entry/map04115",
    })
    expect(KEGG.citation(pathways[0])).toContain("KEGG pathway map04115")
    expect(KEGG.summarize([])).toContain("No KEGG pathways")
  })
})
