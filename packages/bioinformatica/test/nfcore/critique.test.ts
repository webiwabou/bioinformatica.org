import { describe, expect, test } from "bun:test"
import { Critique } from "../../src/nfcore/critique"

describe("nfcore.critique.classifyAnalysis", () => {
  test("maps descriptions and pipeline names to analysis types", () => {
    expect(Critique.classifyAnalysis("RNA-seq differential expression with DESeq2")).toBe("differential-expression")
    expect(Critique.classifyAnalysis("nf-core/differentialabundance")).toBe("differential-expression")
    expect(Critique.classifyAnalysis("ampliseq 16S microbiome community")).toBe("differential-abundance")
    expect(Critique.classifyAnalysis("sarek somatic variant calling")).toBe("variant-calling")
    expect(Critique.classifyAnalysis("GSEA gene set enrichment")).toBe("enrichment")
    expect(Critique.classifyAnalysis("just aligning some reads")).toBe("general")
  })
})

describe("nfcore.critique.critiqueFor", () => {
  test("puts the base concerns first and adds type-specific ones, deduped", () => {
    const de = Critique.critiqueFor("differential-expression")
    const ids = de.map((c) => c.id)
    expect(ids.slice(0, 4)).toEqual(["multiple-testing", "confounders-batch", "replication-power", "reproducibility"])
    expect(ids).toContain("normalization-assumptions")
    expect(ids).toContain("effect-size-vs-significance")
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("general has only the base concerns", () => {
    expect(Critique.critiqueFor("general").map((c) => c.id)).toEqual([
      "multiple-testing",
      "confounders-batch",
      "replication-power",
      "reproducibility",
    ])
  })

  test("each analysis type carries its own distinctive concern", () => {
    expect(Critique.critiqueFor("differential-abundance").map((c) => c.id)).toContain("compositionality")
    expect(Critique.critiqueFor("variant-calling").map((c) => c.id)).toContain("coverage-depth")
    expect(Critique.critiqueFor("enrichment").map((c) => c.id)).toContain("background-universe")
  })
})

describe("nfcore.critique.gates", () => {
  test("soft-blocks a differential analysis with too few replicates", () => {
    const two = Critique.gates("differential-expression", { replicatesPerGroup: 2 })
    expect(two).toHaveLength(1)
    expect(two[0].id).toBe("insufficient-replication")
    expect(two[0].severity).toBe("soft-block")

    const one = Critique.gates("differential-abundance", { replicatesPerGroup: 1 })
    expect(one[0].id).toBe("no-replication")
  })

  test("does not fire with adequate replication, unknown replication, or non-comparative types", () => {
    expect(Critique.gates("differential-expression", { replicatesPerGroup: 3 })).toHaveLength(0)
    expect(Critique.gates("differential-expression", {})).toHaveLength(0)
    expect(Critique.gates("variant-calling", { replicatesPerGroup: 1 })).toHaveLength(0)
    expect(Critique.gates("general", { replicatesPerGroup: 1 })).toHaveLength(0)
  })
})

describe("nfcore.critique.summarize", () => {
  test("shows the soft block when a gate trips", () => {
    const r = Critique.critique("DESeq2 differential expression", { replicatesPerGroup: 2 })
    const s = Critique.summarize(r)
    expect(s).toContain("analysis type: differential-expression")
    expect(s).toContain("SOFT BLOCK")
    expect(s).toContain("explicit human confirmation")
  })

  test("says no gate tripped when the design is adequate", () => {
    const r = Critique.critique("DESeq2 differential expression", { replicatesPerGroup: 4 })
    expect(Critique.summarize(r)).toContain("No invalid-as-configured gate triggered")
  })
})
