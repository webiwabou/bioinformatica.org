import { describe, expect, test } from "bun:test"
import { Failure } from "../../src/nfcore/failure"

describe("nfcore.failure classify", () => {
  test("out-of-memory (exit 137) is a reparable, resumable resource failure", () => {
    const d = Failure.classify("Command exit status: 137\nCommand error: .command.sh: line 3: Killed")
    expect(d.category).toBe("resources")
    expect(d.reparable).toBe(true)
    expect(d.resumable).toBe(true)
    expect(d.suggestedFix).toContain("resourceLimits")
  })

  test("exit code passed explicitly is honored for OOM", () => {
    expect(Failure.classify("some process failed", 137).category).toBe("resources")
  })

  test("docker daemon unreachable is a container failure", () => {
    const d = Failure.classify("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?")
    expect(d.category).toBe("container")
    expect(d.reparable).toBe(true)
  })

  test("nextflow version mismatch is detected", () => {
    const d = Failure.classify("ERROR ~ Nextflow version 22.10.0 does not match workflow required version: >=24.04.0")
    expect(d.category).toBe("nextflow_version")
    expect(d.reparable).toBe(true)
  })

  test("parameter validation failure is an input problem", () => {
    const d = Failure.classify(
      "ERROR ~ Validation of pipeline parameters failed!\n* --input: the file 'sheet.csv' does not exist",
    )
    expect(d.category).toBe("input")
    expect(d.reparable).toBe(true)
    expect(d.resumable).toBe(true)
  })

  test("unknown parameter is a params problem", () => {
    const d = Failure.classify("ERROR ~ Unknown parameter: --alignerx. Did you mean --aligner?")
    expect(d.category).toBe("params")
  })

  test("a missing revision is a non-resumable pipeline reference problem", () => {
    const d = Failure.classify("Cannot find revision `0.0.0` -- Make sure that it exists in the remote repository")
    expect(d.category).toBe("pipeline_ref")
    expect(d.resumable).toBe(false)
  })

  test("network/download issues are external and not Bioinformatica-reparable", () => {
    const d = Failure.classify("ERROR ~ Failed to download ... Connection timed out")
    expect(d.category).toBe("network")
    expect(d.reparable).toBe(false)
    expect(d.resumable).toBe(true)
  })

  test("a generic process error is honest about limits but resumable", () => {
    const d = Failure.classify("ERROR ~ Error executing process > 'NFCORE_DEMO:DEMO:FASTQC (SAMPLE1)'\nCaused by: exit 1")
    expect(d.category).toBe("process_error")
    expect(d.reparable).toBe(false)
    expect(d.resumable).toBe(true)
  })

  test("an unrecognized failure is classified unknown, not guessed", () => {
    expect(Failure.classify("something weird happened that we have no pattern for").category).toBe("unknown")
  })
})

describe("nfcore.failure helpers", () => {
  test("extractWorkDir pulls the failed task's work directory", () => {
    const text = [
      "Caused by:",
      "  Process `FASTQC` terminated with an error exit status (1)",
      "",
      "Work dir:",
      "  /home/user/study/work/ab/cdef1234567890",
      "",
    ].join("\n")
    expect(Failure.extractWorkDir(text)).toBe("/home/user/study/work/ab/cdef1234567890")
  })

  test("summarize states reparability and resume guidance", () => {
    const out = Failure.summarize(Failure.classify("Command exit status: 137"))
    expect(out).toContain("Diagnosis:")
    expect(out).toContain("-resume")
    expect(out.toLowerCase()).toContain("approval")
  })
})
