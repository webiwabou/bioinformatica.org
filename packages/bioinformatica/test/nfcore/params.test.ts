import { describe, expect, test } from "bun:test"
import { Params } from "../../src/nfcore/params"

// A trimmed nextflow_schema.json ($defs groups with properties).
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: {
    input_output_options: {
      title: "Input/output options",
      required: ["input", "outdir"],
      properties: {
        input: { type: "string", description: "Path to the sample sheet.", help_text: "A CSV with the samples." },
        outdir: { type: "string", description: "Output directory." },
      },
    },
    alignment_options: {
      title: "Alignment options",
      properties: {
        aligner: {
          type: "string",
          default: "star_salmon",
          enum: ["star_salmon", "star_rsem", "hisat2"],
          description: "Specifies the alignment algorithm to use.",
        },
      },
    },
  },
}

const params = Params.parseParams(schema)
const param = (name: string) => params.find((p) => p.name === name)!

describe("nfcore.params parseParams", () => {
  test("flattens groups into parameters with type, default, enum and required", () => {
    expect(params.map((p) => p.name).sort()).toEqual(["aligner", "input", "outdir"])
    expect(param("input").required).toBe(true)
    expect(param("input").group).toBe("Input/output options")
    expect(param("input").help).toContain("CSV")
    expect(param("aligner").required).toBe(false)
    expect(param("aligner").default).toBe("star_salmon")
    expect(param("aligner").enum).toEqual(["star_salmon", "star_rsem", "hisat2"])
  })

  test("tolerates a schema without $defs", () => {
    expect(Params.parseParams(null)).toEqual([])
    expect(Params.parseParams({})).toEqual([])
  })
})

describe("nfcore.params find and summarize", () => {
  test("a name query surfaces the matching parameter", () => {
    expect(Params.find(params, "aligner").map((p) => p.name)).toContain("aligner")
  })

  test("an empty query returns the required parameters", () => {
    const required = Params.find(params, "").map((p) => p.name)
    expect(required).toContain("input")
    expect(required).toContain("outdir")
    expect(required).not.toContain("aligner")
  })

  test("summarize shows the flag, constraints and description", () => {
    const out = Params.summarize([param("aligner")])
    expect(out).toContain("--aligner")
    expect(out).toContain("one of: star_salmon, star_rsem, hisat2")
    expect(out).toContain("default: star_salmon")
    expect(out).toContain("alignment algorithm")
  })
})
