export * as Hypothesis from "./hypothesis"

// Hypothesis generation & ranking. This is the co-scientist
// ideation loop — and the highest-hallucination-risk capability — so it is fenced in:
//   - it runs only in an explicit, opt-in speculative/brainstorm mode, never by default;
//   - every hypothesis is grounded and claim-typed (cited / computed / model-inferred)
//     and proposes a concrete test within the nf-core frame;
//   - candidates are critiqued by REUSING the existing adaptive critique, not a new
//     mechanism;
//   - ranking is transparent and deterministic, weighting grounding and testability far
//     above novelty so a shiny-but-ungrounded idea cannot float to the top.
// This module is pure. The model reasons and self-assesses each hypothesis; Bioinformatica does the
// reproducible ranking and never lets a candidate be presented as an established finding.

export type Grounding = "cited" | "computed" | "model-inferred"

export interface Hypothesis {
  readonly statement: string
  readonly grounding: Grounding
  readonly proposedTest: string
  readonly testability: number // 1-5: how directly it can be tested (ideally with an nf-core pipeline)
  readonly novelty: number // 1-5: how far beyond what is already established
  readonly plausibility: number // 1-5: how consistent with what is known
}

export interface RankedHypothesis extends Hypothesis {
  readonly score: number
  readonly rank: number
}

// Documented, deliberately grounding-heavy weights, chosen against hallucination: grounded
// evidence and testability dominate; novelty counts least. A cited/computed hypothesis
// starts far ahead of a purely model-inferred one.
export const WEIGHTS = { grounding: 0.4, testability: 0.3, plausibility: 0.2, novelty: 0.1 } as const
const GROUNDING_SCORE: Record<Grounding, number> = { cited: 1, computed: 1, "model-inferred": 0.4 }

const clamp15 = (n: number) => (Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 1)

export function score(h: Hypothesis): number {
  const g = GROUNDING_SCORE[h.grounding] ?? 0.4
  const raw =
    WEIGHTS.grounding * g +
    WEIGHTS.testability * (clamp15(h.testability) / 5) +
    WEIGHTS.plausibility * (clamp15(h.plausibility) / 5) +
    WEIGHTS.novelty * (clamp15(h.novelty) / 5)
  return Math.round(raw * 100) / 100
}

// Rank hypotheses by the documented composite. Stable on ties (keeps input order). Pure.
export function rank(hypotheses: readonly Hypothesis[]): RankedHypothesis[] {
  return hypotheses
    .map((h, i) => ({ ...h, score: score(h), _i: i }))
    .sort((a, b) => b.score - a.score || a._i - b._i)
    .map(({ _i, ...h }, i) => ({ ...h, rank: i + 1 }))
}

export function summarize(ranked: readonly RankedHypothesis[]): string {
  const lines = [
    "Ranked hypotheses — SPECULATIVE, model-generated candidates, NOT findings:",
    "",
  ]
  for (const h of ranked) {
    lines.push(
      `${h.rank}. [score ${h.score.toFixed(2)}, ${h.grounding}] ${h.statement}`,
      `   test: ${h.proposedTest}  (testability ${clamp15(h.testability)}/5, plausibility ${clamp15(h.plausibility)}/5, novelty ${clamp15(h.novelty)}/5)`,
    )
  }
  lines.push(
    "",
    `Ranked by grounding (${WEIGHTS.grounding}) + testability (${WEIGHTS.testability}) + plausibility (${WEIGHTS.plausibility}) + novelty (${WEIGHTS.novelty}); cited/computed grounding is weighted far above model-inferred.`,
    "Critique the top candidates (reuse the adaptive critique) and test them before treating any as a finding.",
  )
  return lines.join("\n")
}
