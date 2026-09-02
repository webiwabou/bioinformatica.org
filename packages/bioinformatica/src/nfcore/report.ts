export * as Report from "./report"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { Context, Effect, Layer } from "effect"
import path from "path"

// Claim typing in written outputs. Every substantive statement in
// a SAVED report is tagged by provenance so a reader knows what backs it:
//   [computed]       — this analysis's own run or artifacts
//   [cited]          — an external source, given inline
//   [model-inferred] — the model's own reasoning/hypothesis, not directly backed
// These explicit tags live ONLY in saved reports/artifacts; ordinary
// conversation stays in honest natural language without visible tags. Reports have
// no fixed location — the caller supplies the path the scientist chose.

export type ClaimType = "computed" | "cited" | "model-inferred"

export const CLAIM_TYPES: readonly ClaimType[] = ["computed", "cited", "model-inferred"]

export interface ClaimAnalysis {
  readonly counts: Record<ClaimType, number>
  readonly total: number
  readonly issues: string[]
}

// Common mis-spellings the model might reach for, mapped to the canonical tag. Kept
// deliberately small and explicit so plain markdown links `[text](url)` and reference
// markers `[1]` are never flagged.
const NEAR_MISS: Record<string, ClaimType> = {
  inferred: "model-inferred",
  "model inferred": "model-inferred",
  model_inferred: "model-inferred",
  modelinferred: "model-inferred",
  hypothesis: "model-inferred",
  hypothesized: "model-inferred",
  assumed: "model-inferred",
  assumption: "model-inferred",
  computation: "computed",
  compute: "computed",
  measured: "computed",
  citation: "cited",
  cite: "cited",
  source: "cited",
  reference: "cited",
}

// Count the typed claims in a report body and flag authoring problems. Pure. Only the
// canonical `[computed]`/`[cited]`/`[model-inferred]` tags count; near-miss bracket
// tokens are reported as fixable issues rather than silently accepted.
export function analyzeClaims(body: string): ClaimAnalysis {
  const counts: Record<ClaimType, number> = { computed: 0, cited: 0, "model-inferred": 0 }
  for (const m of body.matchAll(/\[(computed|cited|model-inferred)\]/gi)) {
    counts[m[1].toLowerCase() as ClaimType]++
  }
  const total = counts.computed + counts.cited + counts["model-inferred"]

  const issues: string[] = []
  if (total === 0) {
    issues.push(
      "No typed claims found. Tag substantive statements as [computed], [cited], or [model-inferred].",
    )
  }
  const flagged = new Set<string>()
  for (const m of body.matchAll(/\[([^\]]{1,30})\]/g)) {
    const token = m[1].trim().toLowerCase()
    const canonical = NEAR_MISS[token]
    if (canonical && !flagged.has(token)) {
      flagged.add(token)
      issues.push(`Found \`[${m[1].trim()}]\`; the canonical tag is \`[${canonical}]\`.`)
    }
  }
  return { counts, total, issues }
}

const LEGEND = [
  "> **Claim types.** Statements below are tagged by provenance:",
  "> `[computed]` — backed by this analysis's own run or artifacts ·",
  "> `[cited]` — backed by an external source, given inline ·",
  "> `[model-inferred]` — the model's own reasoning or hypothesis, not directly backed",
  "> by a run or a source.",
].join("\n")

// Assemble the final report markdown: a title, a provenance stamp, the claim-type
// legend so any reader can decode the tags, then the body verbatim. Pure. The claim
// analysis is computed from the BODY only (the legend's own tag names never count).
export function render(input: { title: string; body: string; generatedAt?: string }): {
  content: string
  analysis: ClaimAnalysis
} {
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const content = [
    `# ${input.title.trim() || "Report"}`,
    "",
    `*Bioinformatica report — generated ${generatedAt}*`,
    "",
    LEGEND,
    "",
    input.body.trim(),
    "",
  ].join("\n")
  return { content, analysis: analyzeClaims(input.body) }
}

export function summarizeAnalysis(analysis: ClaimAnalysis): string {
  const head = `Claim typing: ${analysis.counts.computed} computed, ${analysis.counts.cited} cited, ${analysis.counts["model-inferred"]} model-inferred (${analysis.total} total).`
  if (analysis.issues.length === 0) return head
  return [head, ...analysis.issues.map((i) => `- ${i}`)].join("\n")
}

export interface Interface {
  readonly save: (input: {
    path: string
    title: string
    body: string
    generatedAt?: string
  }) => Effect.Effect<{ file: string; content: string; analysis: ClaimAnalysis }>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/NfcoreReport") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const save = Effect.fn("NfcoreReport.save")(function* (input: {
      path: string
      title: string
      body: string
      generatedAt?: string
    }) {
      const ctx = yield* InstanceState.context
      const file = path.isAbsolute(input.path) ? input.path : path.join(ctx.directory, input.path)
      const { content, analysis } = render(input)
      yield* fs.writeWithDirs(file, content).pipe(Effect.orDie)
      return { file, content, analysis }
    })

    return Service.of({ save })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node] })
