import { describe, expect, test } from "bun:test"
import { NfcoreCommand } from "../../src/nfcore/command"

describe("nfcore.command build", () => {
  test("test mode uses the test profile with the backend and pins the release", () => {
    const { command } = NfcoreCommand.build({
      pipeline: "rnaseq",
      release: "3.26.0",
      backend: "docker",
      mode: "test",
      outdir: "results",
    })
    expect(command).toBe("nextflow run nf-core/rnaseq -r 3.26.0 -profile test,docker --outdir results")
  })

  test("test mode never adds --input even if one is passed (the test profile bundles its data)", () => {
    const { command } = NfcoreCommand.build({
      pipeline: "rnaseq",
      release: "3.26.0",
      backend: "docker",
      mode: "test",
      outdir: "results",
      input: "samplesheet.csv",
    })
    expect(command).not.toContain("--input")
  })

  test("run mode adds the samplesheet as --input", () => {
    const { command } = NfcoreCommand.build({
      pipeline: "rnaseq",
      release: "3.26.0",
      backend: "docker",
      mode: "run",
      outdir: "results",
      input: "samplesheet.csv",
    })
    expect(command).toBe("nextflow run nf-core/rnaseq -r 3.26.0 -profile docker --outdir results --input samplesheet.csv")
  })

  test("strips an nf-core/ prefix from the pipeline name", () => {
    const { command } = NfcoreCommand.build({
      pipeline: "nf-core/sarek",
      release: "3.4.0",
      backend: "conda",
      mode: "test",
      outdir: "out",
    })
    expect(command).toContain("nextflow run nf-core/sarek")
    expect(command).toContain("-profile test,conda")
  })

  test("extra params become --key value and resume adds -resume", () => {
    const { command } = NfcoreCommand.build({
      pipeline: "rnaseq",
      release: "3.26.0",
      backend: "docker",
      mode: "run",
      outdir: "results",
      input: "samplesheet.csv",
      params: { genome: "GRCh38", aligner: "star_salmon" },
      resume: true,
    })
    expect(command).toContain("--genome GRCh38")
    expect(command).toContain("--aligner star_salmon")
    expect(command.endsWith("-resume")).toBe(true)
  })

  test("quotes values that contain spaces", () => {
    const { command } = NfcoreCommand.build({
      pipeline: "rnaseq",
      release: "3.26.0",
      backend: "docker",
      mode: "run",
      outdir: "/data/my results",
      input: "samplesheet.csv",
    })
    expect(command).toContain("--outdir '/data/my results'")
  })

  test("notes flag compute/approval and the missing samplesheet on a real run", () => {
    const { notes } = NfcoreCommand.build({
      pipeline: "rnaseq",
      release: "3.26.0",
      backend: "docker",
      mode: "run",
      outdir: "results",
    })
    expect(notes.some((n) => n.includes("approval"))).toBe(true)
    expect(notes.some((n) => n.includes("needs one"))).toBe(true)
  })

  test("extra profiles are inserted before the backend", () => {
    const { command } = NfcoreCommand.build({
      pipeline: "rnaseq",
      release: "3.26.0",
      backend: "docker",
      mode: "test",
      outdir: "results",
      extraProfiles: ["arm"],
    })
    expect(command).toContain("-profile test,arm,docker")
  })
})
