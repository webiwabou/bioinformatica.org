import { describe, expect, test } from "bun:test"
import { Entrez } from "../../src/bio/entrez"

const record: Entrez.PubmedRecord = {
  pmid: "37541528",
  title: "Efficacy of Probiotics in Irritable Bowel Syndrome.",
  authors: ["Goodoory VC", "Ford AC"],
  journal: "Gastroenterology.",
  year: "2023",
  doi: "10.1053/j.gastro.2023.07.018",
  url: "https://pubmed.ncbi.nlm.nih.gov/37541528/",
}

describe("bio.entrez citation", () => {
  test("formats a complete, deduplicated-period citation", () => {
    const c = Entrez.citation(record)
    expect(c).toContain("Goodoory VC et al.")
    expect(c).toContain("Efficacy of Probiotics in Irritable Bowel Syndrome")
    expect(c).toContain("Gastroenterology")
    expect(c).toContain("2023")
    expect(c).toContain("PMID: 37541528")
    expect(c).toContain("doi:10.1053/j.gastro.2023.07.018")
    expect(c).toContain("https://pubmed.ncbi.nlm.nih.gov/37541528/")
    // no doubled periods from "et al." + title trailing period
    expect(c).not.toContain("..")
  })

  test("a single-author paper drops 'et al'", () => {
    const c = Entrez.citation({ ...record, authors: ["Solo A"] })
    expect(c).toContain("Solo A.")
    expect(c).not.toContain("et al")
  })

  test("handles a missing author", () => {
    expect(Entrez.citation({ ...record, authors: [] })).toContain("[No author]")
  })
})

describe("bio.entrez summarize", () => {
  test("lists numbered citations with the total count", () => {
    const out = Entrez.summarize({ count: 42, records: [record] })
    expect(out).toContain("42 PubMed results (showing 1)")
    expect(out).toContain("1. Goodoory VC et al.")
  })

  test("reports no results cleanly", () => {
    expect(Entrez.summarize({ count: 0, records: [] })).toContain("No PubMed results")
  })
})
