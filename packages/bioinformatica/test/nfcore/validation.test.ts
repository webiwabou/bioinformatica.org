import { describe, expect, test } from "bun:test"
import { Validation } from "../../src/nfcore/validation"

const ok = (detail = ""): Validation.CheckResult => ({ ok: true, detail })
const bad = (detail = "nope"): Validation.CheckResult => ({ ok: false, detail })

describe("nfcore.validation curated set", () => {
  test("is a sizeable, domain-diverse sample", () => {
    expect(Validation.PIPELINES.length).toBeGreaterThanOrEqual(12)
    const domains = new Set(Validation.PIPELINES.map((p) => p.domain))
    expect(domains.size).toBeGreaterThanOrEqual(10)
    const names = Validation.PIPELINES.map((p) => p.name)
    // A few load-bearing domains must be represented, whatever else the sample covers.
    expect(names).toContain("rnaseq")
    expect(names).toContain("sarek")
    expect(names).toContain("mag")
  })
})

describe("nfcore.validation critique check", () => {
  test("the adaptive critique classifies every curated pipeline as its expected type", () => {
    for (const { name, domain, analysis } of Validation.PIPELINES) {
      const check = Validation.critiqueCheck(name, domain, analysis)
      expect(check.ok).toBe(true)
      expect(check.detail).toContain(analysis)
    }
  })

  test("the specialised analysis types are represented in the sample", () => {
    const types = new Set(Validation.PIPELINES.map((p) => p.analysis))
    expect(types).toContain("variant-calling")
    expect(types).toContain("differential-abundance")
    expect(types).toContain("differential-expression")
    expect(types).toContain("general")
  })

  test("a mismatch is reported with the expected type", () => {
    const check = Validation.critiqueCheck("sarek", "Variant calling", "general")
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("expected general")
  })
})

describe("nfcore.validation result and matrix", () => {
  const allChecks = (checks: Partial<Record<Validation.CheckName, Validation.CheckResult>>) => ({
    registry: ok(),
    samplesheet: ok(),
    params: ok(),
    command: ok(),
    critique: ok(),
    ...checks,
  })

  test("a pipeline passes only when every check passes", () => {
    expect(Validation.result("demo", "Demo", "1.0.0", allChecks({})).ok).toBe(true)
    expect(Validation.result("demo", "Demo", "1.0.0", allChecks({ params: bad() })).ok).toBe(false)
  })

  test("the matrix marks each pipeline and summarizes pass/fail", () => {
    const results = [
      Validation.result("rnaseq", "RNA-seq", "3.26.0", allChecks({})),
      Validation.result("ampliseq", "Amplicon", "2.18.0", allChecks({ samplesheet: bad("0 columns") })),
    ]
    const out = Validation.formatMatrix(results)
    expect(out).toContain("✔ nf-core/rnaseq")
    expect(out).toContain("✘ nf-core/ampliseq")
    expect(out).toContain("1/2 pipelines passed all checks.")
    expect(out).toContain("Failed: ampliseq (samplesheet)")
  })
})
