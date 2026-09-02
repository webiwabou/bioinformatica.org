import { describe, expect, test } from "bun:test"
import type { Environment } from "../../src/environment/detect"
import { Resource } from "../../src/environment/resource"

function report(cpuCores: number, memoryTotalMb: number, memoryAvailableMb?: number): Environment.Report {
  return {
    nextflow: { installed: true },
    java: { installed: true },
    nfcoreTools: { installed: true },
    nfTest: { installed: true },
    docker: { installed: true, running: true },
    conda: { installed: false },
    containerBackend: "docker",
    resources: { cpuCores, memoryTotalMb, memoryAvailableMb: memoryAvailableMb ?? memoryTotalMb },
    gpu: { present: false },
  }
}

describe("environment.resource adapt", () => {
  const requested = 8192 // 8 GB

  test("no change when the machine has enough", () => {
    expect(Resource.adapt(requested, 8192).action).toBe("ok")
    expect(Resource.adapt(requested, 10000).action).toBe("ok")
  })

  test("auto-trims within the ~25% safe margin", () => {
    // 6144 MB is exactly 75% of 8192; anything at or above that is a minor trim.
    expect(Resource.adapt(requested, 6144).action).toBe("auto")
    expect(Resource.adapt(requested, 7000).action).toBe("auto")
  })

  test("asks first for a cut larger than the margin", () => {
    const decision = Resource.adapt(requested, 5000)
    expect(decision.action).toBe("ask")
    expect(decision.rationale.toLowerCase()).toContain("out-of-memory")
  })
})

describe("environment.resource ceiling and readiness", () => {
  test("ceiling leaves OS headroom", () => {
    const c = Resource.ceiling(report(16, 32000, 20000))
    expect(c.cpus).toBe(16)
    // 20000 * 0.8 = 16000 MB -> 15 GB (floored)
    expect(c.memoryMb).toBe(16000)
    expect(c.memoryGb).toBe(15)
  })

  test("readiness is comfortable / tight / risky by usable memory", () => {
    expect(Resource.readiness(report(16, 64000, 32000)).level).toBe("comfortable")
    expect(Resource.readiness(report(8, 10000, 8000)).level).toBe("tight")
    expect(Resource.readiness(report(2, 5000, 4000)).level).toBe("risky")
  })

  test("config snippet caps every process at the ceiling", () => {
    const snippet = Resource.configSnippet(Resource.ceiling(report(8, 16000, 12000)))
    expect(snippet).toContain("resourceLimits")
    expect(snippet).toContain("cpus: 8")
    expect(snippet).toMatch(/memory: '\d+\.GB'/)
  })
})
