import { describe, expect, test } from "bun:test"
import { Report } from "../../src/nfcore/report"

describe("nfcore.report.analyzeClaims", () => {
  test("counts each canonical claim type", () => {
    const body = [
      "- [computed] DESeq2 called 214 DE genes at padj < 0.05.",
      "- [cited] TP53 loss worsens prognosis (Smith 2023, PMID 12345678).",
      "- [model-inferred] The cell-cycle enrichment is consistent with TP53 status.",
      "- [computed] Median library size was 28M reads.",
    ].join("\n")
    const a = Report.analyzeClaims(body)
    expect(a.counts).toEqual({ computed: 2, cited: 1, "model-inferred": 1 })
    expect(a.total).toBe(4)
    expect(a.issues).toHaveLength(0)
  })

  test("flags a report with no typed claims", () => {
    const a = Report.analyzeClaims("The results look interesting and worth a closer look.")
    expect(a.total).toBe(0)
    expect(a.issues[0]).toContain("No typed claims")
  })

  test("flags a mis-spelled tag and suggests the canonical one", () => {
    const a = Report.analyzeClaims("- [inferred] This is probably a batch effect.\n- [cited] Backed (PMID 1).")
    expect(a.counts["model-inferred"]).toBe(0)
    expect(a.issues.some((i) => i.includes("[inferred]") && i.includes("[model-inferred]"))).toBe(true)
  })

  test("does not flag markdown links or numeric reference markers", () => {
    const body = "- [cited] See the [paper](https://example.org) and ref [1] for details."
    const a = Report.analyzeClaims(body)
    expect(a.counts.cited).toBe(1)
    expect(a.issues).toHaveLength(0)
  })

  test("is case-insensitive on the canonical tags", () => {
    const a = Report.analyzeClaims("- [Computed] x\n- [CITED] y (PMID 1)")
    expect(a.counts.computed).toBe(1)
    expect(a.counts.cited).toBe(1)
  })
})

describe("nfcore.report.render", () => {
  const body = "- [computed] 214 DE genes.\n- [cited] Backed by Smith 2023 (PMID 12345678)."

  test("includes the title, a provenance stamp, the legend, and the body verbatim", () => {
    const { content } = Report.render({ title: "RNA-seq findings", body, generatedAt: "2026-07-12T00:00:00Z" })
    expect(content).toContain("# RNA-seq findings")
    expect(content).toContain("generated 2026-07-12T00:00:00Z")
    expect(content).toContain("**Claim types.**")
    expect(content).toContain("[computed] 214 DE genes.")
    expect(content).toContain("(PMID 12345678)")
  })

  test("analyzes the body only — the legend's own tag names never count", () => {
    const { analysis } = Report.render({ title: "t", body, generatedAt: "2026-07-12T00:00:00Z" })
    expect(analysis.total).toBe(2)
    expect(analysis.counts).toEqual({ computed: 1, cited: 1, "model-inferred": 0 })
  })
})

describe("nfcore.report.summarizeAnalysis", () => {
  test("summarizes counts and appends issues", () => {
    const a = Report.analyzeClaims("nothing typed here")
    const s = Report.summarizeAnalysis(a)
    expect(s).toContain("0 computed, 0 cited, 0 model-inferred (0 total)")
    expect(s).toContain("No typed claims")
  })
})
