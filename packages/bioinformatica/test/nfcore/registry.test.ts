import { describe, expect, test } from "bun:test"
import { Registry } from "../../src/nfcore/registry"

// A trimmed fixture in the shape of nf-core's pipelines.json (only the fields
// Bioinformatica reads, plus a few it ignores, to prove tolerance).
const fixture = {
  remote_workflows: [
    {
      name: "rnaseq",
      full_name: "nf-core/rnaseq",
      description: "RNA sequencing analysis pipeline using STAR, RSEM, HISAT2 or Salmon.",
      topics: ["rna-seq", "rnaseq", "differential-expression"],
      archived: false,
      stargazers_count: 1000,
      releases: [
        { tag_name: "3.26.0", published_at: "2025-06-01T00:00:00Z", nextflow_version: "!>=25.04.3", has_schema: true },
        { tag_name: "3.25.0", published_at: "2025-03-01T00:00:00Z", nextflow_version: "!>=24.10.0" },
        { tag_name: "dev", published_at: null, nextflow_version: "!>=25.04.3" },
      ],
    },
    {
      name: "lncpipe",
      full_name: "nf-core/lncpipe",
      description: "UNDER DEVELOPMENT — Analysis of long non-coding RNAs from RNA-seq datasets.",
      topics: ["rna-seq", "lncrna"],
      archived: false,
      releases: [{ tag_name: "dev", nextflow_version: ">=21.10.0" }],
    },
    {
      name: "hlatyping",
      full_name: "nf-core/hlatyping",
      description: "Precision HLA typing from NGS data.",
      topics: ["hla", "immunology"],
      archived: true,
      releases: [{ tag_name: "2.0.0", published_at: "2023-01-01T00:00:00Z", nextflow_version: ">=22.10.0" }],
    },
  ],
}

const byName = (pipelines: Registry.Pipeline[], name: string) => pipelines.find((p) => p.name === name)!

describe("nfcore.registry parse", () => {
  const pipelines = Registry.parse(fixture)

  test("parses the fields Bioinformatica reasons about and ignores the rest", () => {
    const rnaseq = byName(pipelines, "rnaseq")
    expect(rnaseq.fullName).toBe("nf-core/rnaseq")
    expect(rnaseq.description).toContain("RNA sequencing")
    expect(rnaseq.topics).toContain("rnaseq")
    expect(rnaseq.archived).toBe(false)
  })

  test("latest stable release skips the dev tag and carries its Nextflow requirement", () => {
    const rnaseq = byName(pipelines, "rnaseq")
    expect(rnaseq.latestRelease).toBe("3.26.0")
    expect(rnaseq.latestNextflowVersion).toBe("!>=25.04.3")
    expect(rnaseq.releases.map((r) => r.version)).toEqual(["3.26.0", "3.25.0", "dev"])
  })

  test("a dev-only pipeline has no stable release", () => {
    const lncpipe = byName(pipelines, "lncpipe")
    expect(lncpipe.latestRelease).toBeUndefined()
  })

  test("tolerates a non-object input", () => {
    expect(Registry.parse(null)).toEqual([])
    expect(Registry.parse({})).toEqual([])
  })
})

describe("nfcore.registry ranking", () => {
  const pipelines = Registry.parse(fixture)
  const ranked = (query: string) =>
    pipelines
      .map((p) => ({ p, s: Registry.score(p, query) }))
      .filter((e) => e.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((e) => e.p.name)

  test("an exact name query ranks that pipeline first", () => {
    expect(ranked("rnaseq")[0]).toBe("rnaseq")
  })

  test("topic and description terms find relevant pipelines", () => {
    expect(ranked("RNA-seq")).toContain("rnaseq")
  })

  test("dev-only and archived pipelines are deprioritized", () => {
    // Both lncpipe (dev-only) and rnaseq match "rna-seq", but rnaseq (stable) ranks higher.
    const r = ranked("rna-seq")
    expect(r.indexOf("rnaseq")).toBeLessThan(r.indexOf("lncpipe"))
    // hlatyping is archived and unrelated; it should not match an rna query at all.
    expect(r).not.toContain("hlatyping")
  })

  test("an unrelated query returns nothing", () => {
    expect(ranked("assembly")).toEqual([])
  })
})

describe("nfcore.registry confidence floor", () => {
  const pipelines = Registry.parse(fixture)

  test("a real match clears the floor and is reported as a fit", () => {
    const result = Registry.classify(pipelines, "rnaseq")
    expect(result.suitable).toBe(true)
    expect(result.matches[0]!.name).toBe("rnaseq")
    expect(Registry.report(result)).toContain("nf-core/rnaseq")
    expect(Registry.report(result)).not.toContain("NO_SUITABLE_PIPELINE")
  })

  test("an objective no pipeline serves returns a negative verdict, not the closest entry", () => {
    // Every term here appears somewhere in some description, so the old behaviour
    // returned a confident-looking ranked list for a question no pipeline answers.
    const result = Registry.classify(pipelines, "repeated regions in experimental protein structures")
    expect(result.suitable).toBe(false)
    expect(result.matches).toEqual([])
  })

  test("the negative verdict tells the model what to do instead", () => {
    const out = Registry.report(Registry.classify(pipelines, "repeated regions in experimental protein structures"))
    expect(out).toContain("NO_SUITABLE_PIPELINE")
    expect(out).toContain("say plainly that no pipeline fits")
    expect(out).toContain("discovery-campaign")
  })

  test("near misses are rendered as context, explicitly not as candidates", () => {
    const rnaseq = byName(pipelines, "rnaseq")
    const out = Registry.report({ matches: [], nearMisses: [rnaseq], suitable: false })
    expect(out).toContain("NOT proposed as a fit")
    expect(out).toContain("nf-core/rnaseq")
    expect(out).toContain("Do not adopt one of these")
  })

  test("coverage, not absolute score, is what separates a fit from a coincidence", () => {
    const rnaseq = byName(pipelines, "rnaseq")
    // Matching the whole question.
    expect(Registry.coverage(rnaseq, "rnaseq")).toBe(1)
    // Matching one word out of many is a coincidence, however high the raw score.
    expect(Registry.coverage(rnaseq, "repeated regions in experimental protein structures")).toBeLessThan(
      Registry.MIN_COVERAGE,
    )
  })

  test("stopwords cannot score: 'not' must not match 'annotator'", () => {
    // Regression: `score` used raw whitespace splitting, so "not yet catalogued" scored 40
    // against nf-core/proteinannotator purely because "an-not-ator" contains "not".
    expect(Registry.queryTerms("find proteins with not yet catalogued")).toEqual(["proteins", "catalogued"])
    const annotator: Registry.Pipeline = {
      name: "proteinannotator",
      fullName: "nf-core/proteinannotator",
      description: "Annotation of proteins",
      topics: ["annotation", "proteomics"],
      archived: false,
      releases: [{ version: "1.0.0" }],
      latestRelease: "1.0.0",
    }
    // No meaningful term survives, so nothing scores — and classify drops it entirely.
    expect(Registry.score(annotator, "not yet")).toBe(0)
    expect(Registry.classify([annotator], "find proteins not yet catalogued").suitable).toBe(false)
  })

  test("hyphenated queries still match the unhyphenated pipeline name", () => {
    expect(Registry.queryTerms("ATAC-seq")).toEqual(["atac", "seq"])
  })

  test("limit applies to matches", () => {
    expect(Registry.classify(pipelines, "rna", 1).matches.length).toBeLessThanOrEqual(1)
  })
})

describe("nfcore.registry summarize", () => {
  const pipelines = Registry.parse(fixture)

  test("shows the latest stable release and Nextflow requirement", () => {
    const out = Registry.summarize([byName(pipelines, "rnaseq")])
    expect(out).toContain("nf-core/rnaseq")
    expect(out).toContain("latest stable 3.26.0")
    expect(out).toContain("requires Nextflow !>=25.04.3")
  })

  test("flags dev-only and archived pipelines", () => {
    expect(Registry.summarize([byName(pipelines, "lncpipe")])).toContain("dev only")
    expect(Registry.summarize([byName(pipelines, "hlatyping")])).toContain("[archived]")
  })

  test("reports when there are no matches", () => {
    expect(Registry.summarize([])).toContain("No matching")
  })
})

// The frozen catalogue and the registry that reads it are two programs that
// have to agree on one format: `script/freeze-pipelines.ts` writes one workflow per
// NDJSON line, and `populate()` rebuilds `{ remote_workflows: [...] }` from those
// lines before parsing. If either side changes shape the pin degrades to an empty
// catalogue, which `parse` returns without complaint — so the contract is pinned here.
describe("nfcore.registry frozen catalogue contract", () => {
  const workflow = {
    name: "rnaseq",
    full_name: "nf-core/rnaseq",
    description: "RNA sequencing analysis pipeline",
    topics: ["rna-seq"],
    archived: false,
    releases: [
      { tag_name: "dev", published_at: "2026-01-02T00:00:00Z" },
      { tag_name: "3.14.0", published_at: "2026-01-01T00:00:00Z", nextflow_version: ">=24.04.2" },
    ],
  }

  test("a workflow survives the ndjson round trip the freezer and the reader share", () => {
    // Exactly what freeze-pipelines.ts writes...
    const text = [workflow].map((w) => JSON.stringify(w)).join("\n") + "\n"
    // ...and exactly what populate() does with a pinned file.
    const rows = text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown)
    const parsed = Registry.parse({ remote_workflows: rows })

    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.name).toBe("rnaseq")
    expect(parsed[0]!.latestRelease).toBe("3.14.0")
    expect(parsed[0]!.latestNextflowVersion).toBe(">=24.04.2")
    expect(parsed[0]!.topics).toEqual(["rna-seq"])
  })

  test("the pinned form parses identically to the live document form", () => {
    // The live path hands `parse` the whole upstream object; the pinned path
    // reconstructs it from lines. Neither may see a different catalogue.
    const live = Registry.parse({ remote_workflows: [workflow] })
    const pinned = Registry.parse({ remote_workflows: [JSON.parse(JSON.stringify(workflow))] })
    expect(pinned).toEqual(live)
  })
})
