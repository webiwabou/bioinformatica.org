export * as Remediate from "./remediate"

import { Schema } from "effect"
import type { Environment } from "./detect"

// Turns a read-only environment report into a concrete, ordered plan for
// getting the machine ready to run nf-core pipelines.
//
// Each step has one of three actions:
//   - "ok":      already satisfied; nothing to do.
//   - "install": installable without root. Bioinformatica runs `command` for the scientist
//                through the shell tool, after showing it and getting approval.
//   - "manual":  needs root (or a human decision). Bioinformatica shows `command` and the
//                scientist runs it — Bioinformatica never runs a privileged command itself.
//
// This module only *plans*. Execution goes through the existing shell tool so the
// exact command is always shown before running and approval still applies
//. Nothing here runs a command.

export const Action = Schema.Literals(["ok", "install", "manual"])
export type Action = Schema.Schema.Type<typeof Action>

export const Step = Schema.Struct({
  dependency: Schema.String,
  status: Schema.String,
  action: Action,
  requiresSudo: Schema.Boolean,
  command: Schema.optional(Schema.String),
  rationale: Schema.String,
})
export type Step = Schema.Schema.Type<typeof Step>

export const Plan = Schema.Struct({
  ready: Schema.Boolean,
  steps: Schema.Array(Step),
})
export type Plan = Schema.Schema.Type<typeof Plan>

export function plan(report: Environment.Report): Plan {
  const steps: Step[] = []
  const condaCmd = report.conda.installed ? (report.conda.flavor ?? "conda") : undefined

  // Nextflow ---------------------------------------------------------------
  if (report.nextflow.installed) {
    steps.push({
      dependency: "Nextflow",
      status: `installed${report.nextflow.version ? ` (${report.nextflow.version})` : ""}`,
      action: "ok",
      requiresSudo: false,
      rationale: "Nextflow is the workflow engine every nf-core pipeline runs on.",
    })
  } else if (condaCmd) {
    steps.push({
      dependency: "Nextflow",
      status: "missing",
      action: "install",
      requiresSudo: false,
      command: `${condaCmd} install -y -c bioconda -c conda-forge nextflow`,
      rationale: "Installs Nextflow together with a compatible Java into your conda environment, without root.",
    })
  } else if (report.java.installed) {
    steps.push({
      dependency: "Nextflow",
      status: "missing",
      action: "install",
      requiresSudo: false,
      command: "curl -s https://get.nextflow.io | bash && mkdir -p ~/.local/bin && mv nextflow ~/.local/bin/",
      rationale:
        "Java is present, so install the Nextflow launcher into ~/.local/bin (no root). Make sure ~/.local/bin is on your PATH.",
    })
  } else {
    steps.push({
      dependency: "Nextflow",
      status: "missing (Java also missing)",
      action: "install",
      requiresSudo: false,
      command: 'curl -Ls https://micro.mamba.pm/install.sh | bash -s -- -b -p "$HOME/micromamba"',
      rationale:
        "Neither Java nor conda was found. Install micromamba (no root) first, then re-run detection so Bioinformatica can install Nextflow, Java, and nf-core tools through it.",
    })
  }

  // nf-core tools (managed dependency) -------------------------------------
  if (report.nfcoreTools.installed) {
    steps.push({
      dependency: "nf-core tools",
      status: `installed${report.nfcoreTools.version ? ` (${report.nfcoreTools.version})` : ""}`,
      action: "ok",
      requiresSudo: false,
      rationale: "The nf-core CLI powers pipeline discovery, schema access, and samplesheet validation.",
    })
  } else if (condaCmd) {
    steps.push({
      dependency: "nf-core tools",
      status: "missing",
      action: "install",
      requiresSudo: false,
      command: `${condaCmd} install -y -c bioconda -c conda-forge nf-core`,
      rationale: "The nf-core CLI is installed via conda without root; Bioinformatica relies on it for pipeline metadata and schemas.",
    })
  } else {
    steps.push({
      dependency: "nf-core tools",
      status: "missing",
      action: "install",
      requiresSudo: false,
      command: "pip install --user nf-core",
      rationale: "The nf-core CLI is installed with a per-user pip install (no root); Bioinformatica relies on it for pipeline metadata and schemas.",
    })
  }

  // Container backend ---------------------------------------------
  if (report.docker.running) {
    steps.push({
      dependency: "Container backend",
      status: "Docker daemon running",
      action: "ok",
      requiresSudo: false,
      rationale: "Docker is the preferred backend and is ready.",
    })
  } else if (condaCmd) {
    steps.push({
      dependency: "Container backend",
      status: report.docker.installed ? "Docker installed but daemon not running; conda available" : "conda available",
      action: "ok",
      requiresSudo: false,
      command: report.docker.installed ? "sudo systemctl start docker" : undefined,
      rationale: report.docker.installed
        ? "Pipelines can run with the conda backend (-profile conda) right now. To use Docker instead, start its daemon (needs root): sudo systemctl start docker."
        : "Docker is not installed, but pipelines can run with the conda backend (-profile conda). Installing Docker needs root and is optional.",
    })
  } else if (report.docker.installed) {
    steps.push({
      dependency: "Container backend",
      status: "Docker installed but daemon not running",
      action: "manual",
      requiresSudo: true,
      command: "sudo systemctl start docker",
      rationale: "Starting the Docker daemon needs root. Run this yourself; there is no conda fallback available on this machine.",
    })
  } else {
    steps.push({
      dependency: "Container backend",
      status: "no backend available",
      action: "manual",
      requiresSudo: true,
      command: "# Install Docker (needs root): https://docs.docker.com/engine/install/  — or install conda/mamba (no root) for the conda backend",
      rationale:
        "A container engine or conda is required. Installing Docker needs root; installing conda/mamba is the no-root alternative and lets pipelines run with -profile conda.",
    })
  }

  const ready =
    report.nextflow.installed && report.nfcoreTools.installed && report.containerBackend !== "none"

  return { ready, steps }
}

export function summarize(plan: Plan): string {
  if (plan.ready) {
    return "Environment is ready to run nf-core pipelines. No changes needed."
  }
  const lines: string[] = ["To get ready to run nf-core pipelines:"]
  for (const step of plan.steps) {
    if (step.action === "ok") continue
    if (step.action === "install") {
      lines.push(`- ${step.dependency}: ${step.status}. Bioinformatica can install this for you (no root):`)
      lines.push(`    ${step.command}`)
      lines.push(`    ${step.rationale}`)
    } else {
      lines.push(`- ${step.dependency}: ${step.status}. You need to run this yourself${step.requiresSudo ? " (needs root)" : ""}:`)
      if (step.command) lines.push(`    ${step.command}`)
      lines.push(`    ${step.rationale}`)
    }
  }
  return lines.join("\n")
}
