import { describe, expect, test } from "bun:test"
import type { Environment } from "../../src/environment/detect"
import { Remediate } from "../../src/environment/remediate"

type ReportInput = {
  nextflow?: boolean
  java?: boolean
  nfcore?: boolean
  docker?: { installed: boolean; running: boolean }
  conda?: "conda" | "mamba" | "micromamba" | false
  platform?: Environment.Platform
}

// Build a Report, deriving containerBackend the same way detection does
// (docker.running -> docker, else conda -> conda, else none).
function report(input: ReportInput): Environment.Report {
  const docker = input.docker ?? { installed: false, running: false }
  const condaInstalled = input.conda !== undefined && input.conda !== false
  const containerBackend = docker.running ? "docker" : condaInstalled ? "conda" : "none"
  return {
    platform: input.platform ?? { os: "linux" },
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

describe("environment.remediate on Windows", () => {
  // Every probe comes back empty on native Windows, and every command the rest
  // of the plan would suggest is bash. The plan has to say the one true thing.
  const windows = (wslAvailable: boolean) =>
    Remediate.plan(report({ platform: { os: "windows", wslAvailable } }))

  test("with no WSL, asks for it and nothing else", () => {
    const plan = windows(false)
    expect(plan.ready).toBe(false)
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0].command).toBe("wsl --install")
    expect(plan.steps[0].requiresSudo).toBe(true)
  })

  test("with WSL present, points at running inside it instead", () => {
    const plan = windows(true)
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0].command).toBeUndefined()
    expect(plan.steps[0].rationale).toContain("install.ps1")
  })

  test("never suggests a bash command to a PowerShell prompt", () => {
    for (const plan of [windows(true), windows(false)]) {
      for (const step of plan.steps) {
        expect(step.command ?? "").not.toContain("curl")
        expect(step.command ?? "").not.toContain("sudo")
      }
    }
  })
})

describe("environment.remediate inside WSL", () => {
  const inWsl = (cwd: string, extra: Partial<ReportInput> = {}): ReportInput => ({
    platform: {
      os: "linux",
      wsl: { version: 2, distro: "Ubuntu", cwd, cwdOnWindowsDrive: cwd.startsWith("/mnt/") },
    },
    ...extra,
  })

  const provisioned = { nextflow: true, java: true, nfcore: true, docker: { installed: true, running: true } }

  test("warns about a working directory on a Windows drive without blocking readiness", () => {
    const plan = Remediate.plan(report(inWsl("/mnt/c/Users/x/datos", provisioned)))
    expect(plan.ready).toBe(true)
    const advice = plan.steps.find((s) => s.action === "advice")!
    expect(advice.dependency).toBe("Working directory")
    expect(advice.status).toContain("/mnt/c/Users/x/datos")
    expect(advice.requiresSudo).toBe(false)
  })

  test("the warning survives into the summary of a ready environment", () => {
    const text = Remediate.summarize(Remediate.plan(report(inWsl("/mnt/d/datos", provisioned))))
    expect(text).toContain("Worth knowing")
    expect(text).toContain("/mnt/d/datos")
  })

  test("says nothing when the work is on the distribution's own filesystem", () => {
    const plan = Remediate.plan(report(inWsl("/home/x/datos", provisioned)))
    expect(plan.steps.some((s) => s.action === "advice")).toBe(false)
  })

  // `sudo systemctl start docker` is wrong here twice over: the docker command
  // usually comes from Docker Desktop, and most distributions have no systemd.
  test("does not send a WSL user to systemctl when the daemon is down", () => {
    const plan = Remediate.plan(
      report(inWsl("/home/x", { nextflow: true, java: true, nfcore: true, docker: { installed: true, running: false } })),
    )
    const backend = plan.steps.find((s) => s.dependency === "Container backend")!
    expect(backend.command).toBeUndefined()
    expect(backend.requiresSudo).toBe(false)
    expect(backend.rationale).toContain("Docker Desktop")
  })

  test("keeps the systemctl advice on plain Linux", () => {
    const plan = Remediate.plan(
      report({ nextflow: true, java: true, nfcore: true, docker: { installed: true, running: false } }),
    )
    expect(plan.steps.find((s) => s.dependency === "Container backend")!.command).toBe("sudo systemctl start docker")
  })
})
