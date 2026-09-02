import { describe, expect, test } from "bun:test"
import type { Environment } from "../../src/environment/detect"
import { Remediate } from "../../src/environment/remediate"

type ReportInput = {
  nextflow?: boolean
  java?: boolean
  nfcore?: boolean
  docker?: { installed: boolean; running: boolean }
  conda?: "conda" | "mamba" | "micromamba" | false
}

// Build a Report, deriving containerBackend the same way detection does
// (docker.running -> docker, else conda -> conda, else none).
function report(input: ReportInput): Environment.Report {
  const docker = input.docker ?? { installed: false, running: false }
  const condaInstalled = input.conda !== undefined && input.conda !== false
  const containerBackend = docker.running ? "docker" : condaInstalled ? "conda" : "none"
  return {
    nextflow: { installed: input.nextflow ?? false },
    java: { installed: input.java ?? false },
    nfcoreTools: { installed: input.nfcore ?? false },
    nfTest: { installed: false },
    docker: { installed: docker.installed, running: docker.running },
    conda: condaInstalled ? { installed: true, flavor: input.conda as any } : { installed: false },
    containerBackend,
    resources: { cpuCores: 8 },
    gpu: { present: false },
  }
}

const step = (plan: Remediate.Plan, dependency: string) => plan.steps.find((s) => s.dependency === dependency)!

describe("environment.remediate", () => {
  test("a fully provisioned machine is ready with no install or manual steps", () => {
    const plan = Remediate.plan(
      report({ nextflow: true, java: true, nfcore: true, docker: { installed: true, running: true } }),
    )
    expect(plan.ready).toBe(true)
    expect(plan.steps.every((s) => s.action === "ok")).toBe(true)
    expect(Remediate.summarize(plan)).toContain("ready")
  })

  test("only nf-core tools missing, conda present: single no-root conda install", () => {
    const plan = Remediate.plan(
      report({ nextflow: true, java: true, nfcore: false, conda: "conda", docker: { installed: true, running: true } }),
    )
    expect(plan.ready).toBe(false)
    const nfcore = step(plan, "nf-core tools")
    expect(nfcore.action).toBe("install")
    expect(nfcore.requiresSudo).toBe(false)
    expect(nfcore.command).toContain("conda install")
    expect(nfcore.command).toContain("nf-core")
  })

  test("Nextflow missing with conda present installs via conda (pulls Java)", () => {
    const plan = Remediate.plan(report({ nextflow: false, java: false, conda: "mamba" }))
    const nf = step(plan, "Nextflow")
    expect(nf.action).toBe("install")
    expect(nf.requiresSudo).toBe(false)
    expect(nf.command).toContain("mamba install")
    expect(nf.command).toContain("nextflow")
  })

  test("Nextflow missing, no conda but Java present uses the official installer (no root)", () => {
    const plan = Remediate.plan(report({ nextflow: false, java: true }))
    const nf = step(plan, "Nextflow")
    expect(nf.action).toBe("install")
    expect(nf.requiresSudo).toBe(false)
    expect(nf.command).toContain("get.nextflow.io")
  })

  test("bare machine bootstraps a no-root package manager and never asks for root to install tools", () => {
    const plan = Remediate.plan(report({}))
    const nf = step(plan, "Nextflow")
    expect(nf.command).toContain("micromamba")
    expect(nf.requiresSudo).toBe(false)
    const nfcore = step(plan, "nf-core tools")
    expect(nfcore.command).toContain("pip install --user")
    expect(nfcore.requiresSudo).toBe(false)
  })

  test("Docker absent but conda present: backend is satisfied by conda without root", () => {
    const plan = Remediate.plan(report({ nextflow: true, nfcore: true, conda: "conda" }))
    const backend = step(plan, "Container backend")
    expect(backend.action).toBe("ok")
    expect(backend.requiresSudo).toBe(false)
    expect(plan.ready).toBe(true)
  })

  test("Docker installed but stopped, no conda: manual root step to start the daemon", () => {
    const plan = Remediate.plan(
      report({ nextflow: true, nfcore: true, docker: { installed: true, running: false } }),
    )
    const backend = step(plan, "Container backend")
    expect(backend.action).toBe("manual")
    expect(backend.requiresSudo).toBe(true)
    expect(backend.command).toContain("systemctl start docker")
    expect(plan.ready).toBe(false)
  })

  test("no backend at all: manual step, and summary tells the scientist to run it themselves", () => {
    const plan = Remediate.plan(report({ nextflow: true, nfcore: true }))
    const backend = step(plan, "Container backend")
    expect(backend.action).toBe("manual")
    expect(backend.requiresSudo).toBe(true)
    expect(Remediate.summarize(plan)).toContain("run this yourself")
  })
})
