export * as Critique from "./critique"

// Adaptive critique pass. After each result or interpretation
// Bioinformatica runs a critique shaped to the KIND of analysis — not a fixed checklist — and
// surfaces the rigor concerns that actually apply (multiple testing, batch/confounders,
// replication/power, distributional assumptions). It flags and explains; it does NOT
// block. The one exception is a soft block: when an analysis is scientifically
// invalid as configured (e.g. too few replicates to test), Bioinformatica pauses and requires
// explicit human confirmation to proceed anyway. Thresholds here are conservative,
// documented defaults, adjustable per analysis type. This module is pure.

export type AnalysisType =
  | "differential-expression"
  | "differential-abundance"
  | "variant-calling"
  | "enrichment"
  | "general"

export interface Concern {
  readonly id: string
  readonly question: string
  readonly why: string
}

// What Bioinformatica knows about how the analysis was configured. All optional — the agent
// supplies what it could determine (e.g. replicate counts read from the samplesheet).
// A gate only fires when the relevant fact is actually known; missing facts never
// fabricate an "invalid" verdict, they stay as concerns to verify.
export interface CritiqueContext {
  readonly replicatesPerGroup?: number
  readonly groups?: number
  readonly multipleTestingApplied?: boolean
}

export interface Gate {
  readonly id: string
  readonly severity: "soft-block"
  readonly message: string
  readonly threshold: string
}

// Concerns that apply to essentially any comparative analysis. Kept first in every list.
const BASE: Concern[] = [
  {
    id: "multiple-testing",
    question: "Is multiple-testing correction applied (FDR/adjusted p-values), and are you reading the corrected values rather than raw p-values?",
    why: "Testing many features at once inflates false positives; raw p-values overstate significance.",
  },
  {
    id: "confounders-batch",
    question: "Are batch effects and known confounders modeled in the design, and not confounded with the condition of interest?",
    why: "A batch confounded with the condition is uncorrectable and mimics real biological signal.",
  },
  {
    id: "replication-power",
    question: "Is biological replication adequate for the effect size you expect?",
    why: "Too few replicates give unstable estimates, low power, and irreproducible hits.",
  },
  {
    id: "reproducibility",
    question: "Are the pipeline versions, parameters, and any seed recorded so this result can be re-run exactly?",
    why: "An interpretation that cannot be reproduced is not yet a finding (ties to the reproducibility manifest).",
  },
]

const SPECIFIC: Record<Exclude<AnalysisType, "general">, Concern[]> = {
  "differential-expression": [
    {
      id: "normalization-assumptions",
      question: "Does the normalization/model assumption hold — e.g. that most genes are NOT differentially expressed, and dispersion is estimated across enough samples?",
      why: "DESeq2/edgeR-style methods assume a stable majority; a global shift or too few samples breaks the size-factor and dispersion estimates.",
    },
    {
      id: "effect-size-vs-significance",
      question: "Are you ranking by effect size (log fold-change) together with significance, not by p-value alone?",
      why: "A statistically significant gene with a tiny fold-change is often not biologically meaningful.",
    },
  ],
  "differential-abundance": [
    {
      id: "compositionality",
      question: "Is the compositional nature of the data handled (e.g. CLR or an appropriate normalization), rather than testing raw proportions?",
      why: "Relative abundances are not independent; naive tests on proportions give spurious associations.",
    },
    {
      id: "sparsity-prevalence",
      question: "Are low-prevalence / rare features filtered before testing?",
      why: "Sparse features are unreliable and inflate the multiple-testing burden.",
    },
    {
      id: "sequencing-depth",
      question: "Is sequencing depth (library size) controlled for as a confounder (rarefaction or normalization)?",
      why: "Uneven depth drives apparent abundance differences that are technical, not biological.",
    },
  ],
  "variant-calling": [
    {
      id: "coverage-depth",
      question: "Is coverage/depth adequate across the target regions for confident calls?",
      why: "Low-coverage sites produce false and missed calls regardless of the caller.",
    },
    {
      id: "filtering-quality",
      question: "Are quality/depth filters applied, and are you working from filtered rather than raw calls?",
      why: "Raw call sets are dominated by artifacts; unfiltered variants mislead downstream interpretation.",
    },
    {
      id: "pairing-stratification",
      question: "For tumor–normal or population studies, are the pairing and any population stratification correct?",
      why: "Mispaired samples or unmodeled ancestry create large, systematic false-positive signals.",
    },
  ],
  "enrichment": [
    {
      id: "background-universe",
      question: "Is the correct background gene universe used (the genes actually testable in this experiment, not all genes)?",
      why: "An inflated background makes almost any set look enriched.",
    },
    {
      id: "set-multiple-testing",
      question: "Is multiple testing across gene sets corrected, and are redundant/overlapping sets accounted for?",
      why: "Thousands of overlapping sets are tested at once; without correction and de-duplication the top hits are noise.",
    },
    {
      id: "directionality",
      question: "Is directionality (up- vs down-regulated) preserved, not just set membership?",
      why: "Mixing directions can cancel or manufacture enrichment that has no coherent biological meaning.",
    },
  ],
}

// Best-effort mapping from a free-text description or pipeline/analysis name to an
// analysis type. Specific patterns are checked before the general fallback. Pure.
export function classifyAnalysis(text: string): AnalysisType {
  const t = text.toLowerCase()
  const has = (...needles: string[]) => needles.some((n) => t.includes(n))

  // Note: "metagenom" is intentionally NOT a trigger — metagenome *assembly* (e.g. mag)
  // is not a compositional abundance test; the abundance-specific concerns only apply
  // when the data is actually analysed for differential abundance (microbiome/amplicon/
  // taxonomic profiling), which the more specific keywords below capture.
  if (has("ampliseq", "microbiome", "amplicon", "16s", "compositional", "taxa", "taxonomic"))
    return "differential-abundance"
  if (has("enrichment", "gsea", "over-representation", "over representation", "ora", "gene set", "gene-set", "go term", "pathway analysis"))
    return "enrichment"
  if (has("sarek", "variant", "vcf", "snv", "indel", "mutation", "germline", "somatic", "genotyp"))
    return "variant-calling"
  if (has("deseq", "edger", "limma", "differential expression", "differentially expressed", "differentialabundance"))
    return "differential-expression"
  if ((has("rnaseq", "rna-seq", "rna seq")) && has("differential", "de ", "expression"))
    return "differential-expression"
  return "general"
}

// The shaped checklist for an analysis type: the always-relevant base concerns first,
// then the type-specific ones. Deduplicated by id. Pure.
export function critiqueFor(type: AnalysisType): Concern[] {
  const specific = type === "general" ? [] : SPECIFIC[type]
  const seen = new Set<string>()
  const out: Concern[] = []
  for (const c of [...BASE, ...specific]) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return out
}

// Conservative, documented soft-block gate: a comparative analysis run with too few
// biological replicates to be testable. Fires only for comparative analysis types and
// only when the replicate count is actually known. Pure.
const MIN_REPLICATES = 3

export function gates(type: AnalysisType, ctx: CritiqueContext): Gate[] {
  const out: Gate[] = []
  const comparative = type === "differential-expression" || type === "differential-abundance"
  const n = ctx.replicatesPerGroup
  if (comparative && typeof n === "number") {
    if (n < 2) {
      out.push({
        id: "no-replication",
        severity: "soft-block",
        message: `Only ${n} biological replicate per group: the comparison cannot be tested statistically (variance is unestimable). Any "result" would be a difference between single samples, not a finding.`,
        threshold: "at least 2 replicates per group to test at all; ≥3 recommended (conservative default)",
      })
    } else if (n < MIN_REPLICATES) {
      out.push({
        id: "insufficient-replication",
        severity: "soft-block",
        message: `Only ${n} biological replicates per group: dispersion cannot be estimated reliably, so differential testing is statistically unreliable. Treat any results as exploratory.`,
        threshold: `≥${MIN_REPLICATES} biological replicates per group (conservative default, adjustable)`,
      })
    }
  }
  return out
}

export interface CritiqueResult {
  readonly type: AnalysisType
  readonly concerns: Concern[]
  readonly gates: Gate[]
}

export function critique(text: string, ctx: CritiqueContext = {}): CritiqueResult {
  const type = classifyAnalysis(text)
  return { type, concerns: critiqueFor(type), gates: gates(type, ctx) }
}

export function summarize(result: CritiqueResult): string {
  const lines = [
    `Adaptive critique — analysis type: ${result.type}`,
    "",
    "Rigor concerns to address in the interpretation (flag honestly; these do not block):",
    ...result.concerns.map((c) => `- ${c.question}\n  why: ${c.why}`),
  ]
  if (result.gates.length > 0) {
    lines.push(
      "",
      "SOFT BLOCK — invalid as configured. Pause and require explicit human confirmation before proceeding:",
      ...result.gates.map((g) => `- ${g.message}\n  threshold: ${g.threshold}`),
    )
  } else {
    lines.push("", "No invalid-as-configured gate triggered from the provided context.")
  }
  return lines.join("\n")
}
