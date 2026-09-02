export * as Validation from "./validation"

import { Critique } from "./critique"

// A deliberately diverse, curated sample of nf-core pipelines spanning different
// biological domains. The validation harness exercises Bioinformatica's generic
// capabilities against each — registry lookup, samplesheet schema, parameter
// schema, command construction, and the adaptive critique's analysis
// classification — to prove they work for pipelines Bioinformatica was never
// specifically tuned for, because everything reasons from nf-core's own standardized
// structure rather than per-pipeline logic.
//
// `analysis` is the rigor profile the adaptive critique should recognise for each
// pipeline's typical use, assigned by domain judgment: most nf-core pipelines are
// data-processing (alignment, assembly, quantification, peak/variant calling) whose
// pipeline-level rigor concerns are the general ones, and the critique correctly
// stays "general" for them; it specialises only where the analysis type calls for it
// (variant calling; compositional differential abundance; differential expression).
export const PIPELINES: readonly {
  readonly name: string
  readonly domain: string
  readonly analysis: Critique.AnalysisType
}[] = [
  { name: "rnaseq", domain: "RNA-seq", analysis: "general" },
  { name: "sarek", domain: "Variant calling", analysis: "variant-calling" },
  { name: "mag", domain: "Metagenome assembly", analysis: "general" },
  { name: "atacseq", domain: "ATAC-seq", analysis: "general" },
  { name: "methylseq", domain: "Methylation", analysis: "general" },
  { name: "scrnaseq", domain: "Single-cell RNA-seq", analysis: "general" },
  { name: "chipseq", domain: "ChIP-seq", analysis: "general" },
  { name: "ampliseq", domain: "Amplicon / 16S", analysis: "differential-abundance" },
  { name: "viralrecon", domain: "Viral genomics", analysis: "general" },
  { name: "taxprofiler", domain: "Taxonomic profiling", analysis: "differential-abundance" },
  { name: "bacass", domain: "Bacterial assembly", analysis: "general" },
  { name: "smrnaseq", domain: "Small RNA-seq", analysis: "general" },
  { name: "rnafusion", domain: "RNA fusion", analysis: "general" },
  { name: "differentialabundance", domain: "Differential abundance", analysis: "differential-expression" },
  { name: "demo", domain: "Demo / sanity", analysis: "general" },
]

export type CheckName = "registry" | "samplesheet" | "params" | "command" | "critique"

export interface CheckResult {
  readonly ok: boolean
  readonly detail: string
}

export interface PipelineResult {
  readonly name: string
  readonly domain: string
  readonly release?: string
  readonly checks: Record<CheckName, CheckResult>
  readonly ok: boolean
}

export const CHECK_ORDER: readonly CheckName[] = ["registry", "samplesheet", "params", "command", "critique"]

// Does the adaptive critique recognise this pipeline's analysis type and produce a
// non-empty, shaped rigor checklist? Pure — no network. `expected` is the
// curated domain judgment; when it is omitted (custom pipelines) the check just reports
// the classification.
export function critiqueCheck(name: string, domain: string, expected?: Critique.AnalysisType): CheckResult {
  const type = Critique.classifyAnalysis(`${name} ${domain}`)
  const concerns = Critique.critiqueFor(type).length
  const matches = expected === undefined || type === expected
  return {
    ok: matches && concerns > 0,
    detail: `${type}, ${concerns} concerns${matches ? "" : ` (expected ${expected})`}`,
  }
}

export function result(
  name: string,
  domain: string,
  release: string | undefined,
  checks: Record<CheckName, CheckResult>,
): PipelineResult {
  return { name, domain, release, checks, ok: CHECK_ORDER.every((c) => checks[c].ok) }
}

const mark = (ok: boolean) => (ok ? "✔" : "✘")

export function formatMatrix(results: readonly PipelineResult[]): string {
  const lines: string[] = []
  for (const r of results) {
    lines.push(
      `${r.ok ? "✔" : "✘"} nf-core/${r.name}  [${r.domain}]${r.release ? `  @${r.release}` : ""}`,
    )
    for (const check of CHECK_ORDER) {
      lines.push(`    ${mark(r.checks[check].ok)} ${check.padEnd(11)} ${r.checks[check].detail}`)
    }
  }
  const passed = results.filter((r) => r.ok).length
  lines.push("")
  lines.push(`${passed}/${results.length} pipelines passed all checks.`)
  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    lines.push(
      `Failed: ${failed.map((r) => `${r.name} (${CHECK_ORDER.filter((c) => !r.checks[c].ok).join(", ")})`).join("; ")}`,
    )
  }
  return lines.join("\n")
}
