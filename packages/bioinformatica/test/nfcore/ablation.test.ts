import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { Ablation } from "../../src/nfcore/ablation"

describe("nfcore.ablation spec parsing", () => {
  test("the default is the full stack — an unset flag never silently ablates", () => {
    for (const spec of [undefined, "", "none", "   "]) {
      expect(Ablation.parse(spec).state).toEqual(Ablation.FULL)
      expect(Ablation.isFull(Ablation.parse(spec).state)).toBe(true)
    }
  })

  test("'all' disables every layer", () => {
    expect(Ablation.parse("all").state).toEqual(Ablation.BARE)
    for (const layer of Ablation.LAYERS) expect(Ablation.BARE[layer]).toBe(false)
  })

  test("layers are disabled independently", () => {
    const s = Ablation.parse("persona,tools").state
    expect(s.persona).toBe(false)
    expect(s.tools).toBe(false)
    expect(s.skills).toBe(true)
    expect(s.provenance).toBe(true)
  })

  test("a typo is reported, never silently ignored", () => {
    // A misspelled layer that parsed as "no ablation" would run the FULL configuration
    // while the operator believed they were running the bare one — the one mistake this
    // switch cannot survive, because both would look valid.
    const parsed = Ablation.parse("persona,skils")
    expect(parsed.unknown).toEqual(["skils"])
    expect(parsed.state.persona).toBe(false)
  })

  test("spec() round-trips, so the configuration can be recorded and replayed", () => {
    for (const spec of ["none", "all", "persona", "skills,tools"]) {
      expect(Ablation.spec(Ablation.parse(spec).state)).toBe(Ablation.spec(Ablation.parse(Ablation.spec(Ablation.parse(spec).state)).state))
    }
    expect(Ablation.spec(Ablation.FULL)).toBe("none")
    expect(Ablation.spec(Ablation.BARE)).toBe("all")
  })
})

describe("nfcore.ablation tool classification", () => {
  test("the specialization set is listed explicitly, not matched by prefix", () => {
    // reportSave and the four *Lookup clients carry no nfcore prefix. A prefix rule
    // would leave them enabled in the bare configuration, making the two differ by LESS
    // than the switch claims — and it would never surface as a failure.
    expect(Ablation.isSpecializationTool("report_save")).toBe(true)
    for (const t of ["gene_lookup", "protein_lookup", "structure_lookup", "pathway_lookup"]) {
      expect(Ablation.isSpecializationTool(t)).toBe(true)
    }
    expect(Ablation.isSpecializationTool("pubmed_search")).toBe(true)
    // These are the REGISTRY KEYS, not tool ids. The filter runs on ids; if these ever
    // start matching, someone has confused the two namespaces again and the bare
    // configuration will silently keep every specialization tool.
    expect(Ablation.isSpecializationTool("reportSave")).toBe(false)
    expect(Ablation.isSpecializationTool("nfcorePipeline")).toBe(false)
  })

  test("base coding-agent tools are never ablated", () => {
    // These are opencode's, not Bioinformatica's. Removing them would make the bare
    // configuration a crippled agent rather than the base one, and any difference
    // between the two would say nothing about the layer.
    for (const t of ["bash", "read", "write", "edit", "glob", "grep", "task", "todowrite", "skill", "webfetch"]) {
      expect(Ablation.isSpecializationTool(t)).toBe(false)
    }
  })
})

describe("nfcore.ablation fingerprint", () => {
  test("hashing is order-independent, so tool-registration order cannot fake a difference", () => {
    expect(Ablation.manifestHash(["b", "a", "c"])).toBe(Ablation.manifestHash(["c", "b", "a"]))
    expect(Ablation.manifestHash(["a", "b"])).not.toBe(Ablation.manifestHash(["a", "b", "c"]))
  })

  const emptyContext: Ablation.Context = {
    client: "cli",
    enableQuestionTool: false,
    experimentalCodeMode: false,
    experimentalLspTool: false,
    experimentalPlanMode: false,
    customTools: [],
  }

  test("the receipt says what the hashes are and what a difference means", () => {
    const out = Ablation.describe({
      state: Ablation.BARE,
      spec: "all",
      promptSha256: "aa",
      toolManifestSha256: "bb",
      skillManifestSha256: "cc",
      tools: [],
      skills: [],
      context: emptyContext,
    })
    expect(out).toContain("What these hashes cover")
    expect(out).toContain("OFF")
  })

  // The fingerprint used to carry the state and three hashes and nothing
  // else, so two runs whose tool manifests differed for a reason that is not
  // the ablation were indistinguishable in every recorded field.
  test("two contexts differing only in client do not hash the same", () => {
    const a = Ablation.contextHash(emptyContext)
    const b = Ablation.contextHash({ ...emptyContext, client: "app" })
    expect(a).not.toBe(b)
  })

  test("an MCP or plugin tool changes the context hash, so a differing custom surface is visible", () => {
    const a = Ablation.contextHash(emptyContext)
    const b = Ablation.contextHash({ ...emptyContext, customTools: ["seqera_launch"] })
    expect(a).not.toBe(b)
    // ...and order must not fake a difference, same as the manifest hashes.
    expect(Ablation.contextHash({ ...emptyContext, customTools: ["a", "b"] })).toBe(
      Ablation.contextHash({ ...emptyContext, customTools: ["b", "a"] }),
    )
  })

  test("the receipt names the settings outside the ablation, not just the layers", () => {
    const out = Ablation.describe({
      state: Ablation.FULL,
      spec: "none",
      promptSha256: "aa",
      toolManifestSha256: "bb",
      skillManifestSha256: "cc",
      tools: [],
      skills: [],
      context: { ...emptyContext, client: "app", customTools: ["seqera_launch"] },
    })
    expect(out).toContain("client app")
    expect(out).toContain("seqera_launch")
    expect(out).toContain("context  sha256")
  })
})

// `parse` reports unknown tokens and lets the caller decide; every runtime
// call site decided the same wrong thing and dropped them, so a typo ran the
// wrong configuration in silence. `resolve` is the execution-path parse and refuses.
describe("nfcore.ablation resolve refuses a spec it does not understand", () => {
  test("a typo in a layer name throws instead of running the wrong configuration", () => {
    // The exact reported case: "skils" is not a layer, so the skills layer stays
    // ON while the operator believes they turned it off.
    expect(() => Ablation.resolve("persona,skils")).toThrow(/skils/)
    expect(() => Ablation.resolve("persona,skils")).toThrow(/valid layers/)
  })

  test("the error names every unknown token, not just the first", () => {
    expect(() => Ablation.resolve("persona,skils,toolz")).toThrow(/skils, toolz/)
  })

  test("a valid spec resolves to exactly what parse would have returned", () => {
    for (const spec of ["", "none", "all", "persona", "persona,tools", "skills provenance"]) {
      expect(Ablation.resolve(spec)).toEqual(Ablation.parse(spec).state)
    }
  })

  test("undefined is the full stack, because no spec means no ablation", () => {
    expect(Ablation.resolve(undefined)).toEqual(Ablation.FULL)
  })
})

// The list is matched against `Tool.define`'s first positional argument —
// the id — and not the camelCase key the registry stores it under. Getting that
// wrong is silent: the filter matches nothing and the bare configuration keeps every
// specialization tool while both still look valid. That already happened
// once, so it is pinned here at the source level.
describe("nfcore.ablation SPECIALIZATION_TOOLS matches the real tool ids", () => {
  const declaredIds = (() => {
    const dir = path.join(import.meta.dir, "..", "..", "src", "tool")
    const ids = new Set<string>()
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".ts")) continue
      const source = fs.readFileSync(path.join(dir, entry), "utf8")
      for (const m of source.matchAll(/Tool\.define(?:<[^>]*>)?\(\s*\n?\s*"([a-z0-9_]+)"/g)) ids.add(m[1]!)
    }
    return ids
  })()

  test("the source tree really does declare tools this way", () => {
    // Guards the regex itself: if `Tool.define` changes shape this collapses to an
    // empty set and every assertion below would pass vacuously.
    expect(declaredIds.size).toBeGreaterThan(20)
  })

  test("every ablated tool id exists as a declared tool", () => {
    const missing = Ablation.SPECIALIZATION_TOOLS.filter((id) => !declaredIds.has(id))
    expect(missing).toEqual([])
  })

  test("the base coding tools are deliberately absent, so the bare configuration keeps them", () => {
    for (const id of ["read", "write", "edit", "glob", "grep"]) {
      expect(declaredIds.has(id)).toBe(true)
      expect(Ablation.isSpecializationTool(id)).toBe(false)
    }
  })
})

describe("nfcore.ablation leak check", () => {
  const skills = ["discovery-campaign", "nfcore-workflow"]
  const tools = ["nfcorePipeline", "reportSave"]

  test("a bare prompt still carrying the persona is a leak", () => {
    const found = Ablation.leaks({
      state: Ablation.BARE,
      prompt: "You are Bioinformatica, a bioinformatics co-scientist.",
      personaMarker: "You are Bioinformatica",
      skillNames: skills,
      toolNames: tools,
    })
    expect(found.some((f) => f.startsWith("persona:"))).toBe(true)
  })

  test("a bare prompt still naming an ablated skill or tool is a leak", () => {
    const found = Ablation.leaks({
      state: Ablation.BARE,
      prompt: "use discovery-campaign, then nfcorePipeline",
      personaMarker: "You are Bioinformatica",
      skillNames: skills,
      toolNames: tools,
    })
    expect(found).toContain("skill: discovery-campaign")
    expect(found).toContain("tool: nfcorePipeline")
  })

  test("a genuinely bare prompt is clean", () => {
    expect(
      Ablation.leaks({
        state: Ablation.BARE,
        prompt: "You are a helpful coding assistant.",
        personaMarker: "You are Bioinformatica",
        skillNames: skills,
        toolNames: tools,
      }),
    ).toEqual([])
  })

  test("nothing is a leak when the layer is ON", () => {
    // The check must not fire with every layer on, or it would be noise rather than a guard.
    expect(
      Ablation.leaks({
        state: Ablation.FULL,
        prompt: "You are Bioinformatica. use discovery-campaign and nfcorePipeline",
        personaMarker: "You are Bioinformatica",
        skillNames: skills,
        toolNames: tools,
      }),
    ).toEqual([])
  })
})
