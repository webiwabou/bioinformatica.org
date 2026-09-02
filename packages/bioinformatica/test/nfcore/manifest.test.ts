import { describe, expect, test } from "bun:test"
import { Manifest } from "../../src/nfcore/manifest"

describe("nfcore.manifest classifyArtifact", () => {
  test("classifies nf-core pipeline_info files", () => {
    expect(Manifest.classifyArtifact("software_versions.yml")).toBe("software-versions")
    expect(Manifest.classifyArtifact("nf_core_pipeline_software_mqc_versions.yml")).toBe("software-versions")
    expect(Manifest.classifyArtifact("params_2024-01-01_12-00-00.json")).toBe("params")
    expect(Manifest.classifyArtifact("execution_report_2024-01-01.html")).toBe("execution-report")
    expect(Manifest.classifyArtifact("execution_timeline_2024-01-01.html")).toBe("execution-timeline")
    expect(Manifest.classifyArtifact("execution_trace_2024-01-01.txt")).toBe("execution-trace")
    expect(Manifest.classifyArtifact("pipeline_dag_2024-01-01.html")).toBe("dag")
  })

  test("classifies nf-prov provenance files", () => {
    expect(Manifest.classifyArtifact("ro-crate-metadata.json")).toBe("ro-crate")
    expect(Manifest.classifyArtifact("manifest.json")).toBe("bco")
    expect(Manifest.classifyArtifact("something_else.txt")).toBe("other")
  })
})

describe("nfcore.manifest parseSoftwareVersions", () => {
  const yaml = [
    "CUSTOM_DUMPSOFTWAREVERSIONS:",
    "  python: 3.9.5",
    "  yaml: 5.4.1",
    "FASTQC:",
    "  fastqc: 0.11.9",
    "Workflow:",
    '  nf-core/demo: "1.2.0"',
    "  Nextflow: 24.10.0",
  ].join("\n")

  test("flattens process -> tool:version leaves into a version list", () => {
    const versions = Manifest.parseSoftwareVersions(yaml)
    const map = Object.fromEntries(versions.map((v) => [v.tool, v.version]))
    expect(map["fastqc"]).toBe("0.11.9")
    expect(map["python"]).toBe("3.9.5")
    expect(map["Nextflow"]).toBe("24.10.0")
    // quotes are stripped
    expect(map["nf-core/demo"]).toBe("1.2.0")
    // top-level process names are not captured as tools
    expect(map["FASTQC"]).toBeUndefined()
  })

  test("tolerates empty or junk input", () => {
    expect(Manifest.parseSoftwareVersions("")).toEqual([])
    expect(Manifest.parseSoftwareVersions("not: yaml: at all: here")).toBeDefined()
  })
})

describe("nfcore.manifest summarize", () => {
  const manifest: Manifest.Manifest = {
    generatedAt: "2026-07-12T00:00:00.000Z",
    outdir: "/study/results",
    environment: { nextflow: "24.10.0", backend: "docker", nfcoreTools: "2.14.1" },
    software: [{ tool: "fastqc", version: "0.11.9" }],
    artifacts: [
      { name: "software_versions.yml", path: "/study/results/pipeline_info/software_versions.yml", kind: "software-versions" },
      { name: "ro-crate-metadata.json", path: "/study/results/pipeline_info/ro-crate-metadata.json", kind: "ro-crate" },
    ],
    approvals: [{ decision: "once" }],
    session: { summary: "RNA-seq DE test" },
  }

  test("reports referenced artifacts, native provenance, and the Bioinformatica layer", () => {
    const out = Manifest.summarize(manifest)
    expect(out).toContain("Nextflow 24.10.0")
    expect(out).toContain("Tool versions recorded: 1")
    expect(out).toContain("nf-prov BCO/RO-Crate present: yes")
    expect(out).toContain("Human approvals logged (Bioinformática.org layer): 1")
    expect(out).toContain("Session summary: included")
  })
})
