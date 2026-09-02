export * as Ablation from "./ablation"

import { createHash } from "crypto"

// The ablation switch: run the identical model, shell and workspace with Bioinformatica's
// specialization layer switched off, so the only thing that differs between two runs is
// the layer itself.
//
// It works because Bioinformatica is a fork of opencode: with every layer off, what is
// left is the base coding agent. That only holds if the switch really switches, which is
// why `bioinformatica debug ablation` prints hashes rather than claims. A switch nobody
// can check is worth nothing, and the failure mode is silent: one that disables less than
// it says produces two configurations that look different and are not.
//
// The four layers are gated independently rather than behind one flag, because turning
// the whole layer off only says whether the layer changed anything; turning one part off
// is what says which part did.

/** The four independently-disableable parts of the specialization layer. */
export const LAYERS = ["persona", "skills", "tools", "provenance"] as const
export type Layer = (typeof LAYERS)[number]

export interface State {
  readonly persona: boolean
  readonly skills: boolean
  readonly tools: boolean
  readonly provenance: boolean
}

/** Everything on. The default, and what a scientist gets unless they ask otherwise. */
export const FULL: State = { persona: true, skills: true, tools: true, provenance: true }
/** Everything off — `--bare`. Must be equivalent to upstream opencode; see `debug ablation`. */
export const BARE: State = { persona: false, skills: false, tools: false, provenance: false }

export function isLayer(value: string): value is Layer {
  return (LAYERS as readonly string[]).includes(value)
}

export interface Parsed {
  readonly state: State
  /** Tokens that named no layer. Reported rather than ignored — a typo in an ablation
   *  spec would otherwise silently run a different configuration than the one asked
   *  for, which is the one mistake this switch cannot survive. */
  readonly unknown: string[]
}

/**
 * Parse an ablation spec: `""`/`"none"` -> everything on; `"all"` -> everything off;
 * otherwise a comma- or space-separated list of layers to DISABLE (`"persona,tools"`).
 */
export function parse(spec: string | undefined): Parsed {
  const tokens = (spec ?? "")
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === "none")) {
    return { state: FULL, unknown: [] }
  }
  if (tokens.length === 1 && tokens[0] === "all") return { state: BARE, unknown: [] }
  const off = new Set<Layer>()
  const unknown: string[] = []
  for (const t of tokens) {
    if (t === "none") continue
    if (t === "all") {
      for (const l of LAYERS) off.add(l)
      continue
    }
    if (isLayer(t)) off.add(t)
    else unknown.push(t)
  }
  return {
    state: {
      persona: !off.has("persona"),
      skills: !off.has("skills"),
      tools: !off.has("tools"),
      provenance: !off.has("provenance"),
    },
    unknown,
  }
}

/**
 * Parse for the execution path: the state, or a hard failure on a token that
 * names no layer.
 *
 * `parse` reports unknown tokens and lets the caller decide. Every runtime call
 * site decided the same wrong thing — `Ablation.parse(x).state`, dropping
 * `.unknown` on the floor — so `BIOINFORMATICA_ABLATE=persona,skils` ran with the skills
 * layer ON while the operator believed it was off, and the session was recorded
 * under the wrong configuration with nothing anywhere to say so. Only `bioinformatica
 * debug ablation` ever checked.
 *
 * This throws rather than returning a fallback, and it throws at layer
 * construction, so a mistyped spec cannot start a session at all. That is the
 * intended severity: a switch that disables less than it says is the one mistake
 * this module cannot survive, and a session recorded under a configuration it did
 * not run misdescribes everything it produced.
 */
export function resolve(spec: string | undefined): State {
  const parsed = parse(spec)
  if (parsed.unknown.length > 0) {
    throw new Error(
      [
        `unknown ablation layer(s): ${parsed.unknown.join(", ")}`,
        `valid layers: ${LAYERS.join(", ")} (also "none" and "all")`,
        "",
        "Refusing to start: an unrecognised token would silently run a different",
        "configuration than the one you asked for, and the session would be recorded",
        "under the wrong label. Fix BIOINFORMATICA_ABLATE (or --ablate) and try again.",
      ].join("\n"),
    )
  }
  return parsed.state
}

export function isFull(state: State): boolean {
  return LAYERS.every((l) => state[l])
}

/** The spec that would reproduce this state, for the run manifest. */
export function spec(state: State): string {
  const off = LAYERS.filter((l) => !state[l])
  return off.length === 0 ? "none" : off.length === LAYERS.length ? "all" : off.join(",")
}

/**
 * Tool IDS that belong to the specialization layer — the id passed to `Tool.define`,
 * NOT the camelCase key it is registered under in the tool registry. Getting that wrong
 * is silent: the filter matches nothing, the bare configuration keeps every specialization
 * tool, and both still look valid. It was caught here only because `debug ablation` prints
 * the tool-manifest hash and the two configurations produced the same one.
 *
 * Listed explicitly rather than matched by prefix: `report_save`, `environment` and the
 * four `*_lookup` clients carry no `nfcore` prefix, and a prefix rule would leave them
 * enabled with the layer off — a switch that disables less than it says.
 */
export const SPECIALIZATION_TOOLS: readonly string[] = [
  // nf-core execution and authoring
  "nfcore_pipeline_search",
  "nfcore_samplesheet_schema",
  "nfcore_samplesheet_validate",
  "nfcore_run_command",
  "nfcore_resources",
  "nfcore_params",
  "nfcore_diagnose",
  "nfcore_record",
  "nfcore_manifest",
  "nfcore_critique",
  "nfcore_lint",
  "nfcore_fork",
  "nfcore_fork_status",
  "nfcore_hypothesis_rank",
  "nfcore_objective_set",
  "nfcore_census",
  "environment",
  // reporting
  "report_save",
  // literature and database clients
  "pubmed_search",
  "pubmed_fetch",
  "gene_lookup",
  "protein_lookup",
  "structure_lookup",
  "pathway_lookup",
]

export function isSpecializationTool(key: string): boolean {
  return SPECIALIZATION_TOOLS.includes(key)
}

/** Stable digest of a text block; used for the prompt and manifest hashes. */
export function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/** Order-independent digest of a tool or skill name list. */
export function manifestHash(names: readonly string[]): string {
  return digest([...names].sort().join("\n"))
}

/**
 * The settings that change the tool manifest without being part of the ablation.
 *
 * The fingerprint used to carry the state and three hashes and nothing else, so
 * two runs could differ in what the model could actually reach and produce
 * fingerprints that were indistinguishable in every recorded field. `client`
 * alone decides whether the `question` tool exists at all; the experimental
 * flags add or remove tools outright; the custom surface is whatever MCP servers
 * and plugins contributed.
 *
 * These are not ablation layers and must not be confused with them: they are the
 * rest of the environment, and the point of recording them is that anyone
 * comparing two runs can show it was held constant instead of assuming it.
 */
export interface Context {
  /** Decides whether the `question` tool is registered at all. */
  readonly client: string
  readonly enableQuestionTool: boolean
  readonly experimentalCodeMode: boolean
  readonly experimentalLspTool: boolean
  readonly experimentalPlanMode: boolean
  /** Tools contributed by MCP servers, plugins and `tool/*.ts` files on disk. */
  readonly customTools: readonly string[]
}

export interface Fingerprint {
  readonly state: State
  readonly spec: string
  readonly promptSha256: string
  readonly toolManifestSha256: string
  readonly skillManifestSha256: string
  readonly tools: readonly string[]
  readonly skills: readonly string[]
  readonly context: Context
}

/**
 * A digest over everything that is NOT the ablation but still shapes the run.
 * Two runs being compared must produce the same value here; when they do not,
 * something other than the ablation changed, and `context` names what.
 */
export function contextHash(ctx: Context): string {
  return digest(
    [
      `client=${ctx.client}`,
      `question=${ctx.enableQuestionTool}`,
      `codeMode=${ctx.experimentalCodeMode}`,
      `lspTool=${ctx.experimentalLspTool}`,
      `planMode=${ctx.experimentalPlanMode}`,
      `custom=${[...ctx.customTools].sort().join(",")}`,
    ].join("\n"),
  )
}

export function describe(fp: Fingerprint): string {
  const line = (name: Layer) => `  ${name.padEnd(12)} ${fp.state[name] ? "on" : "OFF"}`
  return [
    `ablation: ${fp.spec}${isFull(fp.state) ? " (full stack)" : ""}`,
    ...LAYERS.map(line),
    "",
    `  prompt   sha256 ${fp.promptSha256}`,
    `  tools    sha256 ${fp.toolManifestSha256}  (${fp.tools.length} tools)`,
    `  skills   sha256 ${fp.skillManifestSha256}  (${fp.skills.length} built-in skills)`,
    `  context  sha256 ${contextHash(fp.context)}`,
    "",
    // Not part of the ablation, but it changes what the model can reach. Two runs
    // being compared must match on this line, or they differ by more than the layers.
    `  client ${fp.context.client}` +
      `  question ${fp.context.enableQuestionTool}` +
      `  codeMode ${fp.context.experimentalCodeMode}` +
      `  lsp ${fp.context.experimentalLspTool}` +
      `  planMode ${fp.context.experimentalPlanMode}`,
    `  custom tools (mcp/plugin/disk): ${fp.context.customTools.length === 0 ? "none" : fp.context.customTools.join(", ")}`,
    "",
    // The point of printing these: a run that claims to differ must differ HERE.
    "What these hashes cover: the exact prompt the model was given, the tool and skill",
    "manifests it could reach, and the settings that shaped them. Two runs meant to differ",
    "only in the layers listed above must match on every other hash — when one of the",
    "others differs too, the difference between the runs is not only the layer.",
  ].join("\n")
}

/**
 * The leak check. Returns the offending strings found in an assembled prompt that should
 * not be there when a layer is off. Empty means clean.
 */
export function leaks(input: {
  readonly state: State
  readonly prompt: string
  readonly personaMarker: string
  readonly skillNames: readonly string[]
  readonly toolNames: readonly string[]
}): string[] {
  const found: string[] = []
  if (!input.state.persona && input.prompt.includes(input.personaMarker)) found.push(`persona: ${input.personaMarker}`)
  if (!input.state.skills) {
    for (const name of input.skillNames) if (input.prompt.includes(name)) found.push(`skill: ${name}`)
  }
  if (!input.state.tools) {
    for (const name of input.toolNames) if (input.prompt.includes(name)) found.push(`tool: ${name}`)
  }
  return found
}
