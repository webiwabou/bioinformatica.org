import { describe, expect, test } from "bun:test"
import path from "path"
import { Objective } from "../../src/nfcore/objective"

const base: Objective.ObjectiveRecord = {
  statement: "Find repeat proteins that current databases have not catalogued.",
  updatedAt: "2026-08-25T00:00:00.000Z",
}

describe("nfcore.objective", () => {
  test("lives project-locally under .bioinformatica/, keyed on the directory", () => {
    expect(Objective.file("/work/proj")).toBe(path.join("/work/proj", ".bioinformatica", "objective.json"))
    // Two projects have independent objectives; nothing is keyed on a session id.
    expect(Objective.file("/work/a")).not.toBe(Objective.file("/work/b"))
  })

  test("renders the statement inside a delimited block", () => {
    const out = Objective.render(base)
    expect(out).toContain("<campaign_objective>")
    expect(out).toContain("</campaign_objective>")
    expect(out).toContain("current databases have not catalogued")
  })

  test("always restates the handoff obligation", () => {
    // This is a standing rule; it must survive compaction, which is exactly
    // when the model would otherwise stop without saying anything.
    expect(Objective.render(base)).toContain("what you did, what remains")
  })

  test("fixed decisions are marked as settled, so a long stage never re-opens them", () => {
    const out = Objective.render({
      ...base,
      decisions: ["100% identity for dedup", "predicted models do not count as prior annotation"],
    })
    expect(out).toContain("do not re-litigate")
    expect(out).toContain("100% identity for dedup")
  })

  test("optional sections are omitted rather than rendered empty", () => {
    const out = Objective.render(base)
    expect(out).not.toContain("Done when:")
    expect(out).not.toContain("Decisions already fixed")
    expect(out).not.toContain("Stages:")
  })

  test("success criteria and stages render when present", () => {
    const out = Objective.render({ ...base, successCriteria: ["each hit has two evidence levels"], stages: ["pull", "subtract", "detect"] })
    expect(out).toContain("Done when:")
    expect(out).toContain("each hit has two evidence levels")
    expect(out).toContain("pull → subtract → detect")
  })
})
