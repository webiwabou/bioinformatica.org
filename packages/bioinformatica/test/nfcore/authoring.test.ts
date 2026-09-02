import { describe, expect, test } from "bun:test"
import { Authoring } from "../../src/nfcore/authoring"

describe("nfcore.authoring.parseLintJson", () => {
  // The tuple form nf-core lint --json emits: [check, message] per entry.
  const raw = {
    nf_core_version: "2.14.1",
    tests_pass: [
      ["files_exist", "File found: main.nf"],
      ["nextflow_config", "Config OK"],
    ],
    tests_warned: [["readme", "README could add a citation"]],
    tests_ignored: [["actions_ci", "ignored by config"]],
    tests_failed: [
      ["nextflow_config", "Config variable not found: manifest.name"],
      ["files_exist", "File not found: CHANGELOG.md"],
    ],
  }

  test("counts passed/warned/failed/ignored and keeps the version", () => {
    const report = Authoring.parseLintJson(raw)
    expect(report.nfCoreVersion).toBe("2.14.1")
    expect(report.counts).toEqual({ passed: 2, warned: 1, failed: 2, ignored: 1 })
    const failed = report.findings.filter((f) => f.status === "failed")
    expect(failed).toHaveLength(2)
    expect(failed[0]).toEqual({ status: "failed", check: "nextflow_config", message: "Config variable not found: manifest.name", file: undefined })
  })

  test("is defensive about entry shape (object and bare-string forms)", () => {
    const report = Authoring.parseLintJson({
      passed: ["files_exist"],
      failed: [{ test_name: "schema_lint", message: "bad schema", file: "nextflow_schema.json" }],
    })
    expect(report.counts.passed).toBe(1)
    expect(report.counts.failed).toBe(1)
    const fail = report.findings.find((f) => f.status === "failed")!
    expect(fail.check).toBe("schema_lint")
    expect(fail.file).toBe("nextflow_schema.json")
  })

  test("empty or non-object input yields an empty report", () => {
    expect(Authoring.parseLintJson(null).counts).toEqual({ passed: 0, warned: 0, failed: 0, ignored: 0 })
  })
})

describe("nfcore.authoring.readiness", () => {
  test("not ready when any check fails", () => {
    const report = Authoring.parseLintJson({ tests_failed: [["a", "x"]], tests_warned: [["b", "y"]] })
    const r = Authoring.readiness(report)
    expect(r.ready).toBe(false)
    expect(r.blockers).toHaveLength(1)
    expect(r.summary).toContain("Not ready")
  })

  test("ready with caveats when only warnings remain", () => {
    const r = Authoring.readiness(Authoring.parseLintJson({ tests_warned: [["b", "y"]] }))
    expect(r.ready).toBe(true)
    expect(r.summary).toContain("caveats")
  })

  test("cleanly ready when nothing failed or warned", () => {
    const r = Authoring.readiness(Authoring.parseLintJson({ tests_pass: [["a", "ok"]] }))
    expect(r.ready).toBe(true)
    expect(r.summary).toContain("clean")
  })
})

describe("nfcore.authoring.summarizeLint", () => {
  test("shows the tally and lists failures and warnings", () => {
    const s = Authoring.summarizeLint(
      Authoring.parseLintJson({ tests_failed: [["nextflow_config", "missing manifest.name"]], tests_pass: [["x", "ok"]] }),
    )
    expect(s).toContain("1 passed, 0 warned, 1 failed")
    expect(s).toContain("✘ nextflow_config: missing manifest.name")
  })
})

describe("nfcore.authoring.inspectModule", () => {
  test("recognises a conformant module layout", () => {
    const shape = Authoring.inspectModule(["main.nf", "meta.yml", "environment.yml", "tests/main.nf.test"])
    expect(shape.conformant).toBe(true)
    expect(shape.missing).toHaveLength(0)
    expect(shape.hasEnvironment).toBe(true)
  })

  test("reports what a bare module is missing (per the nf-core spec)", () => {
    const shape = Authoring.inspectModule(["main.nf"])
    expect(shape.conformant).toBe(false)
    expect(shape.missing).toEqual(["meta.yml", "environment.yml", "tests/main.nf.test"])
  })

  test("environment.yml is mandatory per the spec (a module without it is not conformant)", () => {
    const shape = Authoring.inspectModule(["main.nf", "meta.yml", "tests/main.nf.test"])
    expect(shape.conformant).toBe(false)
    expect(shape.missing).toEqual(["environment.yml"])
  })
})
