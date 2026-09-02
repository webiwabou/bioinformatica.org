import { describe, expect, test } from "bun:test"
import { Fork } from "../../src/nfcore/fork"

describe("nfcore.fork.plan", () => {
  test("pins the clone to a release and targets a visible fork folder", () => {
    const p = Fork.plan({ pipeline: "rnaseq", release: "3.14.0" })
    expect(p.path).toBe("pipelines/rnaseq-fork")
    expect(p.command).toBe(
      "git clone --branch 3.14.0 --single-branch https://github.com/nf-core/rnaseq.git pipelines/rnaseq-fork",
    )
  })
})

describe("nfcore.fork.parseStatus", () => {
  test("parses git status --porcelain into typed changes", () => {
    const changes = Fork.parseStatus(" M workflows/rnaseq.nf\n?? custom_step.nf\nA  conf/custom.config\n")
    expect(changes).toEqual([
      { file: "workflows/rnaseq.nf", status: "M" },
      { file: "custom_step.nf", status: "??" },
      { file: "conf/custom.config", status: "A" },
    ])
  })

  test("an empty status is no changes", () => {
    expect(Fork.parseStatus("")).toHaveLength(0)
  })
})

describe("nfcore.fork.parseDiffStat", () => {
  test("reads files/insertions/deletions from --shortstat", () => {
    expect(Fork.parseDiffStat(" 3 files changed, 12 insertions(+), 4 deletions(-)")).toEqual({
      files: 3,
      insertions: 12,
      deletions: 4,
    })
  })

  test("handles a single-file, insertions-only stat", () => {
    expect(Fork.parseDiffStat(" 1 file changed, 2 insertions(+)")).toEqual({ files: 1, insertions: 2, deletions: 0 })
  })
})

describe("nfcore.fork.summarizeStatus", () => {
  test("reports a modified fork with its divergence", () => {
    const s = Fork.summarizeStatus({
      path: "pipelines/rnaseq-fork",
      currentSha: "abcdef1234567890",
      baselineSha: "0123456789abcdef",
      changes: [{ file: "main.nf", status: "M" }],
      diverged: { files: 1, insertions: 5, deletions: 2 },
      clean: false,
    })
    expect(s).toContain("Diverged from upstream: 1 file(s), +5/-2")
    expect(s).toContain("modified from the pinned upstream")
  })

  test("reports a clean fork as identical to upstream", () => {
    const s = Fork.summarizeStatus({
      path: "pipelines/rnaseq-fork",
      baselineSha: "0123456789abcdef",
      changes: [],
      diverged: { files: 0, insertions: 0, deletions: 0 },
      clean: true,
    })
    expect(s).toContain("identical to the pinned upstream")
  })
})
