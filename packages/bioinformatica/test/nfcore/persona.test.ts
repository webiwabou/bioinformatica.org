import { describe, expect, test } from "bun:test"
import { NfcorePersona } from "../../src/nfcore/persona"

describe("nfcore.persona", () => {
  test("persona text is a non-empty nf-core identity block", () => {
    expect(NfcorePersona.Persona.length).toBeGreaterThan(0)
    expect(NfcorePersona.Persona).toContain("You are Bioinformática.org")
    expect(NfcorePersona.Persona).toContain("nf-core")
  })

  test("ships the foundational built-in nf-core skills", () => {
    const names = NfcorePersona.BuiltinSkills.map((skill) => skill.name)
    expect(names).toContain("nfcore-workflow")
    expect(names).toContain("nfcore-environment")
  })

  test("ships the discovery-campaign skill for questions no pipeline answers", () => {
    const names = NfcorePersona.BuiltinSkills.map((skill) => skill.name)
    expect(names).toContain("discovery-campaign")
  })

  test("the campaign skill is discoverable from a NO_SUITABLE_PIPELINE verdict", () => {
    // The registry's negative verdict names this skill; the description is the only
    // thing in the always-on context that decides whether the model loads it.
    const campaign = NfcorePersona.BuiltinSkills.find((s) => s.name === "discovery-campaign")!
    expect(campaign.description).toContain("NO_SUITABLE_PIPELINE")
  })

  test("only the hypothesis skill is fenced as speculative", () => {
    // "brainstorm" marks the opt-in speculative mode; any other skill carrying
    // that word would inherit the fence and stop being loadable by default.
    const speculative = NfcorePersona.BuiltinSkills.filter((s) => /brainstorm/i.test(s.description))
    expect(speculative.map((s) => s.name)).toEqual(["hypothesis-generation"])
  })

  test("the persona admits a non-pipeline shape of work", () => {
    expect(NfcorePersona.Persona).toContain("NO_SUITABLE_PIPELINE")
    expect(NfcorePersona.Persona).toContain("discovery-campaign")
    // The catalogue restriction is gone; the standard is not.
    expect(NfcorePersona.Persona).not.toContain("Only nf-core pipelines")
  })

  test("the persona forbids ending a reply without a handoff", () => {
    expect(NfcorePersona.Persona).toContain("what you did, what remains")
  })

  test("ships the recipe skills for running work outside the nf-core catalogue", () => {
    const names = NfcorePersona.BuiltinSkills.map((skill) => skill.name)
    expect(names).toContain("external-tool-acquisition")
    expect(names).toContain("bulk-data-acquisition")
    expect(names).toContain("structural-evidence")
  })

  const body = (name: string) => NfcorePersona.BuiltinSkills.find((s) => s.name === name)!.content

  test("the tooling skill carries the shell facts that silently waste a stage", () => {
    const text = body("external-tool-acquisition")
    // Each of these is a real property of this harness, and each one costs a whole
    // stage if the model assumes otherwise.
    expect(text).toContain("`conda activate` cannot work")
    expect(text).toContain("stdin is closed")
    expect(text).toContain("stdout and stderr are merged")
    // Detachment works, but only under both conditions.
    expect(text).toContain("nohup")
    expect(text).toContain("exit 0")
    // Pinning must be reproducible: a tag can be re-pushed.
    expect(text).toContain("digest")
  })

  test("the tooling skill tells the agent to check obtainability before building", () => {
    // A research agent once spent five and a half hours compiling a tool from source
    // to answer the question "is this obtainable".
    expect(body("external-tool-acquisition")).toContain("Never spend time building a tool")
  })

  test("the data skill treats an empty result as a failure mode, not a finding", () => {
    const text = body("bulk-data-acquisition")
    expect(text).toContain("An empty result is not the same as no data")
    expect(text).toContain("row count is asserted")
    // The subtraction is the result: a truncated known set fabricates novelty.
    expect(text).toContain("manufactures one")
  })

  test("the structural skill carries both silent data corruptions", () => {
    const text = body("structural-evidence")
    // Identity thresholds normalised by the shorter sequence absorb substrings.
    expect(text).toContain("shorter")
    expect(text).toContain("-aL 1.0")
    expect(text).toContain("-d 0")
    // Convenience extractors drop HETATM, and MSE is a HETATM.
    expect(text).toContain("MSE")
    expect(text).toContain("Insertion codes")
  })

  test("the structural skill refuses to call a conditioned test independent", () => {
    expect(body("structural-evidence")).toContain("conditioned on")
  })

  test("every built-in skill has a valid name, a description, and content", () => {
    for (const skill of NfcorePersona.BuiltinSkills) {
      // Skill loader requires lowercase hyphen-separated names up to 64 chars.
      expect(skill.name).toMatch(/^[a-z][a-z0-9-]{0,63}$/)
      expect(skill.description.length).toBeGreaterThan(0)
      expect(skill.content.length).toBeGreaterThan(0)
    }
  })
})
