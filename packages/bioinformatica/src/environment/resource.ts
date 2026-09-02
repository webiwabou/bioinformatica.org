export * as Resource from "./resource"

import type { Environment } from "./detect"

// Resource adaptation policy. When a pipeline step needs more than
// the machine has, Bioinformatica trims the request automatically only within a safe
// margin (~20-25% below what was asked for) and reports it; a larger cut is risky
// (out-of-memory, degraded/truncated output) and must be confirmed first.
//
// This module only decides and recommends. It never runs anything. Applying a
// ceiling to a run is done with a Nextflow config the scientist approves.

// The default safe margin. Tunable as real usage data comes in (A-003).
export const DEFAULT_MARGIN = 0.25
// Below these, a real run is likely to struggle regardless of the pipeline.
const FLOOR_MEMORY_MB = 4096
const FLOOR_CPUS = 2

export type AdaptAction = "ok" | "auto" | "ask"

export interface Adaptation {
  readonly action: AdaptAction
  readonly requestedMb: number
  readonly availableMb: number
  readonly appliedMb: number
  readonly rationale: string
}

const gb = (mb: number) => Math.round((mb / 1024) * 10) / 10

// Decide how to reconcile a specific memory request with what's available.
export function adapt(requestedMb: number, availableMb: number, margin = DEFAULT_MARGIN): Adaptation {
  if (availableMb >= requestedMb) {
    return {
      action: "ok",
      requestedMb,
      availableMb,
      appliedMb: requestedMb,
      rationale: `${gb(availableMb)} GB available covers the ${gb(requestedMb)} GB requested.`,
    }
  }
  if (availableMb >= requestedMb * (1 - margin)) {
    return {
      action: "auto",
      requestedMb,
      availableMb,
      appliedMb: availableMb,
      rationale: `Trimming ${gb(requestedMb)} GB down to ${gb(availableMb)} GB — within the ~${Math.round(
        margin * 100,
      )}% safe margin, so applied automatically.`,
    }
  }
  return {
    action: "ask",
    requestedMb,
    availableMb,
    appliedMb: availableMb,
    rationale: `Only ${gb(availableMb)} GB available against ${gb(requestedMb)} GB requested — more than ${Math.round(
      margin * 100,
    )}% below. This risks out-of-memory failure, degraded performance, or truncated output; confirm before proceeding.`,
  }
}

export interface Ceiling {
  readonly cpus: number
  readonly memoryMb: number
  readonly memoryGb: number
}

// A recommended resource ceiling for a run on this machine, leaving headroom for
// the OS. Used as the cap a real run should not exceed.
export function ceiling(report: Environment.Report, headroom = 0.2): Ceiling {
  const availableMb = report.resources.memoryAvailableMb ?? report.resources.memoryTotalMb ?? 0
  const memoryMb = Math.max(0, Math.floor(availableMb * (1 - headroom)))
  return { cpus: report.resources.cpuCores, memoryMb, memoryGb: Math.max(1, Math.floor(memoryMb / 1024)) }
}

export type ReadinessLevel = "comfortable" | "tight" | "risky"

export interface Readiness {
  readonly level: ReadinessLevel
  readonly rationale: string
}

// Under WSL 2 the memory this machine reports is not the memory the scientist
// bought. It is the ceiling of the virtual machine, which defaults to about half
// the host's RAM and is raised from the Windows side in .wslconfig. Without this
// sentence, someone with 32 GB is told they have 16 and has no reason to suspect
// the figure is a setting rather than a fact.
function wslMemoryNote(report: Environment.Report): string {
  if (report.platform.wsl?.version !== 2) return ""
  return " This is a WSL 2 virtual machine, so that memory is its ceiling (about half the computer's RAM by default), not the RAM installed. It can be raised from Windows by setting memory= in %UserProfile%\\.wslconfig and running wsl --shutdown."
}

// A proactive judgement of whether this machine can comfortably run a real
// pipeline, before any specific step request is known.
export function readiness(report: Environment.Report): Readiness {
  const c = ceiling(report)
  const note = wslMemoryNote(report)
  if (c.memoryMb < FLOOR_MEMORY_MB || c.cpus < FLOOR_CPUS) {
    return {
      level: "risky",
      rationale: `Only ~${c.memoryGb} GB usable memory and ${c.cpus} core(s) after OS headroom. Many pipeline steps need more; a real run may fail. Confirm before running real data, and expect to cap resources.${note}`,
    }
  }
  if (c.memoryMb < 8192) {
    return {
      level: "tight",
      rationale: `~${c.memoryGb} GB usable memory and ${c.cpus} cores. Workable for lighter pipelines; heavier steps may need resource limits or may not fit.${note}`,
    }
  }
  return {
    level: "comfortable",
    rationale: `~${c.memoryGb} GB usable memory and ${c.cpus} cores available for the run.${note}`,
  }
}

// A Nextflow config that caps every process at the ceiling — the version-agnostic
// way to constrain resources on a small machine. Write it (with approval) and pass
// it to the run with `-c`.
export function configSnippet(c: Ceiling): string {
  return ["process {", `  resourceLimits = [ cpus: ${c.cpus}, memory: '${c.memoryGb}.GB' ]`, "}", ""].join("\n")
}

export function summarizeCeiling(report: Environment.Report): string {
  const c = ceiling(report)
  const r = readiness(report)
  return [
    `Recommended resource ceiling for a run on this machine: ${c.cpus} cpus, ${c.memoryGb} GB memory (OS headroom left).`,
    `Readiness: ${r.level}. ${r.rationale}`,
    "",
    "To apply it, write this Nextflow config and pass it with -c:",
    configSnippet(c).trimEnd(),
  ].join("\n")
}
