import { describe, expect, test } from "bun:test"
import { Hypothesis } from "../../src/nfcore/hypothesis"

const h = (over: Partial<Hypothesis.Hypothesis>): Hypothesis.Hypothesis => ({
  statement: "s",
  grounding: "model-inferred",
  proposedTest: "nf-core/demo",
  testability: 3,
  novelty: 3,
  plausibility: 3,
  ...over,
})

describe("nfcore.hypothesis.score", () => {
  test("a fully grounded, testable, plausible, novel hypothesis scores the maximum", () => {
    expect(Hypothesis.score(h({ grounding: "cited", testability: 5, plausibility: 5, novelty: 5 }))).toBe(1)
  })

  test("grounding dominates: cited/computed start far above model-inferred", () => {
    const cited = Hypothesis.score(h({ grounding: "cited", testability: 1, novelty: 1, plausibility: 1 }))
    const inferred = Hypothesis.score(h({ grounding: "model-inferred", testability: 1, novelty: 1, plausibility: 1 }))
    expect(cited).toBeGreaterThan(inferred)
    expect(cited - inferred).toBeCloseTo(0.4 * (1 - 0.4), 5)
  })

  test("out-of-range self-assessments are clamped to 1-5", () => {
    expect(Hypothesis.score(h({ grounding: "cited", testability: 99, novelty: 99, plausibility: 99 }))).toBe(1)
  })
})

describe("nfcore.hypothesis.rank", () => {
  test("a grounded, testable hypothesis outranks a novel but ungrounded one", () => {
    const grounded = h({ statement: "grounded", grounding: "cited", testability: 5, plausibility: 5, novelty: 2 })
    const shiny = h({ statement: "shiny", grounding: "model-inferred", testability: 2, plausibility: 2, novelty: 5 })
    const ranked = Hypothesis.rank([shiny, grounded])
    expect(ranked[0].statement).toBe("grounded")
    expect(ranked[0].rank).toBe(1)
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  test("ties keep input order and ranks are 1..n", () => {
    const a = h({ statement: "a" })
    const b = h({ statement: "b" })
    const ranked = Hypothesis.rank([a, b])
    expect(ranked.map((r) => r.statement)).toEqual(["a", "b"])
    expect(ranked.map((r) => r.rank)).toEqual([1, 2])
  })
})

describe("nfcore.hypothesis.summarize", () => {
  test("labels the output as speculative and explains the weighting", () => {
    const s = Hypothesis.summarize(Hypothesis.rank([h({ statement: "x", grounding: "cited" })]))
    expect(s).toContain("SPECULATIVE")
    expect(s).toContain("NOT findings")
    expect(s).toContain("grounding (0.4)")
    expect(s).toContain("1. [score")
  })
})
