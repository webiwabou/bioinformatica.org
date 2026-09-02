import { describe, expect, test } from "bun:test"
import { Samplesheet } from "../../src/nfcore/samplesheet"

// An rnaseq-like schema_input.json (only the fields Bioinformatica reads).
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "array",
  items: {
    type: "object",
    required: ["sample", "fastq_1", "strandedness"],
    properties: {
      sample: { type: "string", pattern: "^\\S+$", description: "Sample name" },
      fastq_1: { type: "string", format: "file-path", pattern: ".+\\.f(ast)?q(\\.gz)?$" },
      fastq_2: { type: "string", format: "file-path", pattern: ".+\\.f(ast)?q(\\.gz)?$" },
      strandedness: { type: "string", enum: ["forward", "reverse", "unstranded", "auto"] },
    },
  },
}

const columns = Samplesheet.parseColumns(schema)
const col = (name: string) => columns.find((c) => c.name === name)!

describe("nfcore.samplesheet parseColumns", () => {
  test("reads columns, required flags, enums and formats from the schema", () => {
    expect(columns.map((c) => c.name)).toEqual(["sample", "fastq_1", "fastq_2", "strandedness"])
    expect(col("sample").required).toBe(true)
    expect(col("fastq_1").required).toBe(true)
    expect(col("fastq_2").required).toBe(false)
    expect(col("fastq_1").format).toBe("file-path")
    expect(col("strandedness").enum).toEqual(["forward", "reverse", "unstranded", "auto"])
  })

  test("tolerates a schema without items/properties", () => {
    expect(Samplesheet.parseColumns(null)).toEqual([])
    expect(Samplesheet.parseColumns({ items: {} })).toEqual([])
  })
})

describe("nfcore.samplesheet validate", () => {
  test("a correct paired-end samplesheet passes", () => {
    const result = Samplesheet.validate(columns, [
      { sample: "CTRL_1", fastq_1: "/data/CTRL_1_R1.fastq.gz", fastq_2: "/data/CTRL_1_R2.fastq.gz", strandedness: "auto" },
      { sample: "CTRL_2", fastq_1: "/data/CTRL_2_R1.fastq.gz", fastq_2: "/data/CTRL_2_R2.fastq.gz", strandedness: "auto" },
    ])
    expect(result.ok).toBe(true)
    expect(result.rowCount).toBe(2)
    expect(result.issues).toEqual([])
  })

  test("single-end (no fastq_2) is fine because fastq_2 is optional", () => {
    const result = Samplesheet.validate(columns, [
      { sample: "S1", fastq_1: "/data/S1.fastq.gz", strandedness: "unstranded" },
    ])
    expect(result.ok).toBe(true)
  })

  test("flags a missing required column", () => {
    const result = Samplesheet.validate(columns, [{ sample: "S1", fastq_1: "/data/S1.fastq.gz" }])
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ row: 1, column: "strandedness", message: expect.stringContaining("missing") }),
    )
  })

  test("flags a value outside an enum", () => {
    const result = Samplesheet.validate(columns, [
      { sample: "S1", fastq_1: "/data/S1.fastq.gz", strandedness: "sense" },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.column === "strandedness" && i.message.includes("not one of"))).toBe(true)
  })

  test("flags a file that does not match the required extension pattern", () => {
    const result = Samplesheet.validate(columns, [
      { sample: "S1", fastq_1: "/data/S1.txt", strandedness: "auto" },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.column === "fastq_1" && i.message.includes("format"))).toBe(true)
  })

  test("flags an unknown column that is not in the schema", () => {
    const result = Samplesheet.validate(columns, [
      { sample: "S1", fastq_1: "/data/S1.fastq.gz", strandedness: "auto", condition: "treated" },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.column === "condition" && i.message.includes("unknown"))).toBe(true)
  })

  test("summaries read clearly for pass and fail", () => {
    const ok = Samplesheet.validate(columns, [{ sample: "S1", fastq_1: "/data/S1.fastq.gz", strandedness: "auto" }])
    expect(Samplesheet.summarizeValidation("rnaseq", "3.26.0", ok)).toContain("valid")
    const bad = Samplesheet.validate(columns, [{ sample: "S1", fastq_1: "/data/S1.fastq.gz" }])
    expect(Samplesheet.summarizeValidation("rnaseq", "3.26.0", bad)).toContain("row 1")
  })
})
