export * as Protocol from "./protocol"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { Context, Effect, Layer, Schema } from "effect"
import fsNode from "fs/promises"
import path from "path"

// The Ulysses binding. At campaign start the scientist commits a protocol:
// the objective plus the constraints they want to be held to for the rest of the work
// ("no tool substitution without calibration against ground truth", "figures only from
// manifested data"). From then on a request that violates a constraint is refused, the
// attempt is written to an append-only ledger with a timestamp and the request verbatim,
// and proceeding requires an amendment that someone signs.
//
// The point is the asymmetry. Committing is easy and happens once, when the scientist is
// cold. Overriding is deliberately harder and always leaves a mark, because that is the
// moment they are warm — mid-campaign, with a deadline, wanting the result. A constraint
// that can be talked out of in conversation is not a constraint.
//
// DEFAULT POSTURE: nothing binds until a protocol is committed. There is no protocol file
// in a fresh project, `check` on an uncommitted campaign returns `committed: false`, and
// nothing is refused. A lock that is on by default binds people who never chose to be
// bound, and would train them to route around it. Binding is opt-in, per campaign, by the
// deliberate act of committing. `posture: "advisory"` exists for the scientist who wants
// the record without the block — it still logs every violation, it just does not stop the
// work. Either way the change is never silent.
//
// State lives project-locally under `.bioinformatica/protocol/`, keyed on the project
// directory like the objective — a campaign outlives a context window, and a constraint
// that only exists in the context window is not a constraint at all.
//
//   .bioinformatica/protocol/protocol.json     the commitment, written once
//   .bioinformatica/protocol/amendments.jsonl  append-only, every signed change to the commitment
//   .bioinformatica/protocol/refusals.jsonl    append-only, every attempt that was refused
//
// The two logs are only ever appended to by this module — never truncated, never rewritten.
// A refusal that can be erased is not a ledger. The files are plain JSON lines so a third
// party can read the record without Bioinformatica, and `summarize` ships all three into the report.

const BIOINFORMATICA_DIR = ".bioinformatica"
const PROTOCOL_DIR = "protocol"
const PROTOCOL_FILE = "protocol.json"
const AMENDMENTS_FILE = "amendments.jsonl"
const REFUSALS_FILE = "refusals.jsonl"

/** Directory holding the protocol and its two append-only logs. */
export function directory(projectDir: string): string {
  return path.join(projectDir, BIOINFORMATICA_DIR, PROTOCOL_DIR)
}

/** The committed protocol itself. Written once; changing it takes an amendment. */
export function file(projectDir: string): string {
  return path.join(directory(projectDir), PROTOCOL_FILE)
}

export function amendmentsFile(projectDir: string): string {
  return path.join(directory(projectDir), AMENDMENTS_FILE)
}

export function refusalsFile(projectDir: string): string {
  return path.join(directory(projectDir), REFUSALS_FILE)
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const Constraint = Schema.Struct({
  /** Stable id. Refusals and amendments reference it, so it must not be reused. */
  id: Schema.String,
  /** The constraint in the scientist's own words. Stored verbatim and never rewritten. */
  text: Schema.String,
  /**
   * Literal phrases that mechanically implicate this constraint. Deliberately dumb
   * substring matching, and deliberately optional: most real constraints ("no tool
   * substitution without calibration") cannot be decided by string matching, and
   * pretending otherwise would produce a check that quietly clears everything. A
   * constraint with no triggers is reported as UNEVALUATED, never as cleared.
   */
  triggers: Schema.optional(Schema.Array(Schema.String)),
})
export type Constraint = Schema.Schema.Type<typeof Constraint>

export type Posture = "binding" | "advisory"

export const ProtocolRecord = Schema.Struct({
  /** What this campaign is for, in the scientist's words. */
  statement: Schema.String,
  constraints: Schema.Array(Constraint),
  committedAt: Schema.String,
  /** Who commits to this. Blank is allowed — the commitment still stands. */
  committedBy: Schema.optional(Schema.String),
  /** A second name on the commitment, for a lab that wants two people on the record. */
  coSigner: Schema.optional(Schema.String),
  /** "binding" refuses violations; "advisory" logs them and lets the work continue. */
  posture: Schema.Literals(["binding", "advisory"]),
})
export type ProtocolRecord = Schema.Schema.Type<typeof ProtocolRecord>

export type AmendmentAction = "waive" | "retire" | "replace" | "add"

export const Amendment = Schema.Struct({
  at: Schema.String,
  action: Schema.Literals(["waive", "retire", "replace", "add"]),
  constraintId: Schema.String,
  /** Why the commitment is changing. Recorded verbatim; the report prints it. */
  reason: Schema.String,
  /** The name that signs the change. An unsigned amendment is not an amendment. */
  signedBy: Schema.String,
  coSigner: Schema.optional(Schema.String),
  /** For "replace" and "add": the constraint text that applies from here on. */
  text: Schema.optional(Schema.String),
  triggers: Schema.optional(Schema.Array(Schema.String)),
  /**
   * For "waive": the one request this exception covers, verbatim. Matching is exact
   * (whitespace- and case-normalised) so a waiver for one request cannot silently
   * become a standing exemption for every later request touching that constraint.
   */
  scope: Schema.optional(Schema.String),
})
export type Amendment = Schema.Schema.Type<typeof Amendment>

export const Refusal = Schema.Struct({
  at: Schema.String,
  /** The request as it arrived. Verbatim, never paraphrased or summarised. */
  request: Schema.String,
  constraintIds: Schema.Array(Schema.String),
  /**
   * The constraint text as it read at the moment of refusal. Copied on purpose: a later
   * amendment must not be able to rewrite what the scientist was actually held to.
   */
  constraintTexts: Schema.Array(Schema.String),
  /** "refused" under a binding protocol; "advised" under an advisory one. */
  outcome: Schema.Literals(["refused", "advised"]),
  sessionID: Schema.optional(Schema.String),
})
export type Refusal = Schema.Schema.Type<typeof Refusal>

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

export class AlreadyCommitted extends Schema.TaggedErrorClass<AlreadyCommitted>()("Protocol.AlreadyCommitted", {
  file: Schema.String,
  committedAt: Schema.String,
}) {
  override get message() {
    return `A protocol was already committed for this project on ${this.committedAt} (${this.file}). Changing it takes a signed amendment, not a re-commit.`
  }
}

export class NotCommitted extends Schema.TaggedErrorClass<NotCommitted>()("Protocol.NotCommitted", {
  directory: Schema.String,
}) {
  override get message() {
    return `No protocol is committed for ${this.directory}. Commit one before amending or refusing against it.`
  }
}

export class UnsignedAmendment extends Schema.TaggedErrorClass<UnsignedAmendment>()("Protocol.UnsignedAmendment", {
  constraintId: Schema.String,
}) {
  override get message() {
    return `The amendment to "${this.constraintId}" carries no signature. Proceeding past a committed constraint requires a signed amendment; an unsigned one is exactly the silent override the protocol exists to prevent.`
  }
}

export class InvalidAmendment extends Schema.TaggedErrorClass<InvalidAmendment>()("Protocol.InvalidAmendment", {
  constraintId: Schema.String,
  problem: Schema.String,
}) {
  override get message() {
    return `Amendment to "${this.constraintId}" rejected: ${this.problem}`
  }
}

/**
 * The ledger exists on disk but could not be read. Never collapsed into "no refusals":
 * an unreadable ledger and an empty ledger mean opposite things, and treating the first
 * as the second would let a campaign proceed as if it had never been refused anything.
 */
export class LedgerUnreadable extends Schema.TaggedErrorClass<LedgerUnreadable>()("Protocol.LedgerUnreadable", {
  file: Schema.String,
  detail: Schema.String,
}) {
  override get message() {
    return `Could not read the protocol ledger at ${this.file}: ${this.detail}. Refuse to proceed rather than treat this as an empty record.`
  }
}

/** A refusal or amendment that could not be written. The caller must not proceed. */
export class LedgerUnwritable extends Schema.TaggedErrorClass<LedgerUnwritable>()("Protocol.LedgerUnwritable", {
  file: Schema.String,
  detail: Schema.String,
}) {
  override get message() {
    return `Could not append to the protocol ledger at ${this.file}: ${this.detail}. The attempt was not recorded, so it must not be allowed to proceed.`
  }
}

// ---------------------------------------------------------------------------
// Pure domain
// ---------------------------------------------------------------------------

/** Whitespace- and case-insensitive comparison key. Used for triggers and waiver scope. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}

/** Turn free text into a usable constraint id. */
export function slugId(text: string, fallback: string): string {
  const slug = normalize(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 6)
    .join("-")
  return slug || fallback
}

/**
 * Parse a `--constraint` spec. Either `id=text` or bare `text` (id derived from the text).
 * `index` only supplies a fallback id for text that slugs to nothing.
 */
export function parseConstraint(spec: string, index: number): Constraint {
  const at = spec.indexOf("=")
  // Only treat the prefix as an id if it looks like one, whitespace included. A constraint
  // sentence containing "=" ("p = 0.05 is not a threshold") must not lose its head to id
  // parsing — the space before the "=" is what tells the two forms apart.
  if (at > 0) {
    const head = spec.slice(0, at)
    const rest = spec.slice(at + 1).trim()
    if (rest && /^[a-z0-9][a-z0-9._-]*$/i.test(head)) return { id: head, text: rest }
  }
  const text = spec.trim()
  return { id: slugId(text, `constraint-${index + 1}`), text }
}

export interface RawLine {
  readonly index: number
  readonly raw: string
  /** Absent when the line is not valid JSON. */
  readonly json?: unknown
}

/** Split a JSONL file into candidate records. Pure; blank lines are skipped. */
export function jsonLines(text: string): RawLine[] {
  const out: RawLine[] = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (raw.trim() === "") continue
    try {
      out.push({ index: i + 1, raw, json: JSON.parse(raw) })
    } catch {
      out.push({ index: i + 1, raw })
    }
  }
  return out
}

export interface UnreadableLine {
  readonly file: string
  readonly line: number
  readonly raw: string
}

export interface Ledger {
  readonly amendments: readonly Amendment[]
  readonly refusals: readonly Refusal[]
  /**
   * Lines that are on disk but did not decode. Surfaced rather than dropped: a ledger
   * that quietly discards what it cannot parse under-reports the record, which is the
   * one thing it exists not to do.
   */
  readonly unreadable: readonly UnreadableLine[]
}

export const emptyLedger: Ledger = { amendments: [], refusals: [], unreadable: [] }

export interface RetiredConstraint {
  readonly constraint: Constraint
  readonly amendment: Amendment
}

export interface IgnoredAmendment {
  readonly amendment: Amendment
  readonly reason: string
}

/** The protocol as it stands now: the commitment with every amendment folded in. */
export interface EffectiveProtocol {
  readonly statement: string
  readonly posture: Posture
  readonly committedAt: string
  readonly committedBy?: string
  readonly coSigner?: string
  readonly constraints: readonly Constraint[]
  readonly retired: readonly RetiredConstraint[]
  /** Signed one-time exceptions. They stay on the record forever. */
  readonly waivers: readonly Amendment[]
  /**
   * Amendments that changed nothing (retiring a constraint that was already gone, adding
   * an id that exists). Kept visible so a scientist who thinks they lifted a constraint
   * and did not finds out here rather than at the next refusal.
   */
  readonly ignored: readonly IgnoredAmendment[]
}

/**
 * Fold the append-only amendment log over the committed protocol, in file order. The log
 * is the authority on every change: there is no path that edits a constraint in place, so
 * the current state can always be re-derived from the two files a third party can read.
 */
export function effective(protocol: ProtocolRecord, amendments: readonly Amendment[]): EffectiveProtocol {
  const active = new Map<string, Constraint>()
  for (const c of protocol.constraints) active.set(c.id, c)
  const retired: RetiredConstraint[] = []
  const waivers: Amendment[] = []
  const ignored: IgnoredAmendment[] = []

  for (const a of amendments) {
    switch (a.action) {
      case "retire": {
        const current = active.get(a.constraintId)
        if (!current) {
          ignored.push({ amendment: a, reason: `no active constraint "${a.constraintId}" to retire` })
          break
        }
        active.delete(a.constraintId)
        retired.push({ constraint: current, amendment: a })
        break
      }
      case "replace": {
        const current = active.get(a.constraintId)
        if (!current) {
          ignored.push({ amendment: a, reason: `no active constraint "${a.constraintId}" to replace` })
          break
        }
        if (!a.text?.trim()) {
          ignored.push({ amendment: a, reason: "replacement carries no constraint text" })
          break
        }
        active.set(a.constraintId, {
          id: current.id,
          text: a.text,
          ...(a.triggers ? { triggers: a.triggers } : current.triggers ? { triggers: current.triggers } : {}),
        })
        break
      }
      case "add": {
        if (active.has(a.constraintId)) {
          ignored.push({ amendment: a, reason: `constraint "${a.constraintId}" already exists` })
          break
        }
        if (!a.text?.trim()) {
          ignored.push({ amendment: a, reason: "new constraint carries no text" })
          break
        }
        active.set(a.constraintId, {
          id: a.constraintId,
          text: a.text,
          ...(a.triggers ? { triggers: a.triggers } : {}),
        })
        break
      }
      case "waive": {
        waivers.push(a)
        break
      }
    }
  }

  return {
    statement: protocol.statement,
    posture: protocol.posture,
    committedAt: protocol.committedAt,
    ...(protocol.committedBy ? { committedBy: protocol.committedBy } : {}),
    ...(protocol.coSigner ? { coSigner: protocol.coSigner } : {}),
    constraints: [...active.values()],
    retired,
    waivers,
    ignored,
  }
}

export interface Action {
  /** The request, verbatim as the scientist or the model stated it. */
  readonly request: string
  /** Extra text to match against — a command line, a file path, a tool name. */
  readonly detail?: string
  /**
   * Constraint ids the caller has already judged to apply. This is how a constraint that
   * no substring can catch still bites: the model, or a tool guard, names it explicitly.
   */
  readonly implicates?: readonly string[]
}

export interface Violation {
  readonly constraint: Constraint
  /** How this constraint was implicated, so the refusal can say why and not just that. */
  readonly why: string
}

export interface WaivedViolation {
  readonly violation: Violation
  readonly amendment: Amendment
}

export interface CheckResult {
  /** False when no protocol has been committed — nothing binds this campaign yet. */
  readonly committed: boolean
  /** True only under a binding posture. An advisory protocol reports but does not refuse. */
  readonly enforced: boolean
  readonly violated: readonly Violation[]
  /** Violations covered by a signed waiver scoped to exactly this request. */
  readonly waived: readonly WaivedViolation[]
  /**
   * Active constraints this check could not decide — no triggers, not named by the caller.
   * An empty `violated` list means nothing more than "nothing matched"; it is NOT a
   * clearance while this list is non-empty. Callers must present these for judgement
   * rather than reading silence as approval.
   */
  readonly unevaluated: readonly Constraint[]
  /** Constraints that were mechanically evaluated and did not match. */
  readonly cleared: readonly Constraint[]
  readonly refused: boolean
}

export const clearResult: CheckResult = {
  committed: false,
  enforced: false,
  violated: [],
  waived: [],
  unevaluated: [],
  cleared: [],
  refused: false,
}

/** The signed waiver covering exactly this request for this constraint, if one exists. */
export function waiverFor(
  state: EffectiveProtocol,
  constraintId: string,
  request: string,
): Amendment | undefined {
  const key = normalize(request)
  return state.waivers.find((w) => w.constraintId === constraintId && !!w.scope && normalize(w.scope) === key)
}

/**
 * Which committed constraints this action would violate. Pure: it takes the protocol and
 * the action and returns data, so the decision is testable without a filesystem.
 *
 * The three-way split is the whole design. `violated` is what we can show; `cleared` is
 * what we actually checked; `unevaluated` is what nobody has checked yet. Collapsing the
 * last two would turn "we have no way to tell" into "you are fine", which is how a lock
 * quietly stops locking.
 */
export function check(state: EffectiveProtocol | undefined, action: Action): CheckResult {
  if (!state) return clearResult
  const haystack = normalize(`${action.request} ${action.detail ?? ""}`)
  const named = new Set(action.implicates ?? [])

  const violated: Violation[] = []
  const waived: WaivedViolation[] = []
  const unevaluated: Constraint[] = []
  const cleared: Constraint[] = []

  for (const constraint of state.constraints) {
    let why: string | undefined
    if (named.has(constraint.id)) why = "named by the caller as implicated"
    else {
      const hit = constraint.triggers?.find((t) => t.trim() !== "" && haystack.includes(normalize(t)))
      if (hit) why = `the request mentions "${hit}"`
    }

    if (!why) {
      if (constraint.triggers?.some((t) => t.trim() !== "")) cleared.push(constraint)
      else unevaluated.push(constraint)
      continue
    }

    const violation: Violation = { constraint, why }
    const waiver = waiverFor(state, constraint.id, action.request)
    if (waiver) waived.push({ violation, amendment: waiver })
    else violated.push(violation)
  }

  const enforced = state.posture === "binding"
  return { committed: true, enforced, violated, waived, unevaluated, cleared, refused: enforced && violated.length > 0 }
}

function signature(state: EffectiveProtocol): string {
  const names = [state.committedBy, state.coSigner].filter((n): n is string => !!n && n.trim() !== "")
  return names.length ? names.join(" and ") : "(unsigned)"
}

/**
 * What the model and the scientist see when a request is refused. It quotes the request
 * back verbatim, names the constraint verbatim, and gives the one legitimate way forward.
 * It deliberately does not offer alternatives: suggesting a near-miss is how a refusal
 * becomes a negotiation.
 */
export function renderRefusal(state: EffectiveProtocol, action: Action, result: CheckResult): string {
  const advisory = !result.enforced
  const lines = [
    "<protocol_refusal>",
    advisory
      ? `This request conflicts with the protocol committed for this campaign on ${state.committedAt}. The protocol is ADVISORY, so it does not stop the work — but the conflict has been written to the refusal ledger and will appear in the report.`
      : `REFUSED by the protocol committed for this campaign on ${state.committedAt} by ${signature(state)}.`,
    "",
    "Requested:",
    action.request.trim(),
    "",
    advisory ? "In conflict with:" : "Refused by:",
  ]
  for (const v of result.violated) {
    lines.push(`- [${v.constraint.id}] ${v.constraint.text}`, `    implicated because ${v.why}`)
  }
  if (result.waived.length) {
    lines.push("", "Already waived for this exact request (signed):")
    for (const w of result.waived) {
      lines.push(`- [${w.violation.constraint.id}] waived ${w.amendment.at} by ${w.amendment.signedBy} — ${w.amendment.reason}`)
    }
  }
  if (result.unevaluated.length) {
    lines.push(
      "",
      "Not mechanically checked — judge these yourself before proceeding, and say so out loud:",
    )
    for (const c of result.unevaluated) lines.push(`- [${c.id}] ${c.text}`)
  }
  lines.push(
    "",
    advisory
      ? "Say plainly that this conflicts with the committed protocol before you continue."
      : [
          "There is exactly one way forward, and it is on the record:",
          `  bioinformatica protocol amend ${result.violated[0]?.constraint.id ?? "<constraint-id>"} --action waive --scope "<the request, verbatim>" --reason "<why this once>" --sign "<name>"`,
          "",
          "Do not work around the constraint, do not restate the request in different words, and do not treat the scientist saying \"go ahead\" in conversation as an amendment. The scientist committed to this while they were cold; you are talking to them while they are warm.",
        ].join("\n"),
    "This attempt has been appended to .bioinformatica/protocol/refusals.jsonl with a timestamp.",
    "</protocol_refusal>",
  )
  return lines.join("\n")
}

/**
 * The standing reminder, injected each turn like the objective. Short on purpose: it
 * restates what was committed and does not re-argue it. Returns undefined when nothing is
 * committed, so an unbound campaign gets no prompt weight at all.
 */
export function render(state: EffectiveProtocol | undefined): string | undefined {
  if (!state) return undefined
  if (state.constraints.length === 0) return undefined
  const lines = [
    "<committed_protocol>",
    `Committed ${state.committedAt} by ${signature(state)} — ${state.posture === "binding" ? "BINDING" : "advisory"}.`,
    state.statement.trim(),
    "",
    "Constraints you are held to for this campaign:",
  ]
  for (const c of state.constraints) lines.push(`- [${c.id}] ${c.text}`)
  if (state.waivers.length) {
    lines.push("", `${state.waivers.length} signed waiver(s) are on the record; each covers one specific request only.`)
  }
  lines.push(
    "",
    state.posture === "binding"
      ? "If a request would violate one of these, refuse it, say which constraint and why, and record the refusal. Proceeding takes a signed amendment — not agreement in conversation."
      : "If a request would violate one of these, say so plainly before you continue, and record it.",
    "</committed_protocol>",
  )
  return lines.join("\n")
}

/** The protocol section of the campaign report: the commitment, every amendment, every refusal. */
export function summarize(state: EffectiveProtocol | undefined, ledger: Ledger): string {
  if (!state) {
    return [
      "## Protocol",
      "",
      "No protocol was committed for this campaign. Nothing constrained the work beyond the objective, and no refusals were recorded.",
    ].join("\n")
  }

  const lines = [
    "## Protocol",
    "",
    `Committed ${state.committedAt} by ${signature(state)} — posture: ${state.posture}.`,
    "",
    state.statement.trim(),
    "",
    "### Constraints in force at the end of the campaign",
    "",
  ]
  if (state.constraints.length === 0) lines.push("_None — every committed constraint was retired by amendment._")
  for (const c of state.constraints) lines.push(`- **[${c.id}]** ${c.text}`)

  if (state.retired.length) {
    lines.push("", "### Constraints retired during the campaign", "")
    for (const r of state.retired) {
      lines.push(
        `- **[${r.constraint.id}]** ${r.constraint.text}`,
        `  retired ${r.amendment.at} by ${r.amendment.signedBy}${r.amendment.coSigner ? ` and ${r.amendment.coSigner}` : ""} — ${r.amendment.reason}`,
      )
    }
  }

  lines.push("", "### Amendments", "")
  if (ledger.amendments.length === 0) lines.push("_None. The protocol stands as committed._")
  for (const a of ledger.amendments) {
    lines.push(
      `- ${a.at} — **${a.action}** [${a.constraintId}] signed by ${a.signedBy}${a.coSigner ? ` and ${a.coSigner}` : ""}`,
      `  reason: ${a.reason}`,
    )
    if (a.scope) lines.push(`  scope (this request only): ${a.scope}`)
    if (a.text) lines.push(`  text: ${a.text}`)
  }

  lines.push("", "### Refused overrides", "")
  if (ledger.refusals.length === 0) lines.push("_None. No request conflicted with the committed protocol._")
  for (const r of ledger.refusals) {
    lines.push(
      `- ${r.at} — **${r.outcome}** under [${r.constraintIds.join(", ")}]`,
      `  requested: ${r.request}`,
    )
    for (const t of r.constraintTexts) lines.push(`  constraint as it read then: ${t}`)
  }

  if (state.ignored.length) {
    lines.push("", "### Amendments that changed nothing", "")
    for (const i of state.ignored) lines.push(`- ${i.amendment.at} [${i.amendment.constraintId}] — ${i.reason}`)
  }

  if (ledger.unreadable.length) {
    lines.push(
      "",
      "### Ledger lines that could not be read",
      "",
      "These are on disk but did not decode. They are reported rather than dropped — the record is incomplete and a reader should look at the files directly.",
      "",
    )
    for (const u of ledger.unreadable) lines.push(`- ${u.file}:${u.line} — \`${u.raw.slice(0, 200)}\``)
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface CommitInput {
  readonly statement: string
  readonly constraints: readonly Constraint[]
  readonly committedBy?: string
  readonly coSigner?: string
  /** Defaults to "binding": committing is itself the opt-in, so it binds unless asked not to. */
  readonly posture?: Posture
}

export interface AmendInput {
  readonly action: AmendmentAction
  readonly constraintId: string
  readonly reason: string
  readonly signedBy: string
  readonly coSigner?: string
  readonly text?: string
  readonly triggers?: readonly string[]
  /** Required for "waive": the one request, verbatim, that the exception covers. */
  readonly scope?: string
}

export interface RefuseInput {
  readonly request: string
  readonly constraintIds: readonly string[]
  readonly outcome?: "refused" | "advised"
  readonly sessionID?: string
}

export interface GuardOutcome {
  readonly result: CheckResult
  /** Present when the attempt was written to the ledger. */
  readonly refusal?: Refusal
  /** The text to show — the rendered refusal, or undefined when nothing conflicted. */
  readonly message?: string
}

export interface Interface {
  readonly commit: (
    input: CommitInput,
  ) => Effect.Effect<{ readonly path: string; readonly protocol: ProtocolRecord }, AlreadyCommitted | LedgerUnreadable | LedgerUnwritable>
  readonly read: () => Effect.Effect<EffectiveProtocol | undefined, LedgerUnreadable>
  readonly ledger: () => Effect.Effect<Ledger, LedgerUnreadable>
  readonly amend: (
    input: AmendInput,
  ) => Effect.Effect<Amendment, NotCommitted | UnsignedAmendment | InvalidAmendment | LedgerUnreadable | LedgerUnwritable>
  readonly refuse: (input: RefuseInput) => Effect.Effect<Refusal, NotCommitted | LedgerUnreadable | LedgerUnwritable>
  readonly check: (action: Action) => Effect.Effect<CheckResult, LedgerUnreadable>
  /**
   * Check and, when the action conflicts, record the refusal before returning. The two
   * steps are one call on purpose: a caller that has to remember to log the refusal will
   * eventually not, and an unlogged refusal is indistinguishable from a request nobody
   * ever made.
   */
  readonly guard: (action: Action) => Effect.Effect<GuardOutcome, LedgerUnreadable | LedgerUnwritable>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/NfcoreProtocol") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    // Reads the file, distinguishing "not there yet" from "there and unreadable". The
    // first is a normal empty ledger; the second must never be mistaken for one.
    const readText = (target: string) =>
      Effect.tryPromise({
        try: async (): Promise<string | undefined> => {
          try {
            return await fsNode.readFile(target, "utf8")
          } catch (cause) {
            if ((cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return undefined
            throw cause
          }
        },
        catch: (cause) =>
          new LedgerUnreadable({ file: target, detail: cause instanceof Error ? cause.message : String(cause) }),
      })

    // The only write path for the two logs. Append mode, never truncate: this is what
    // makes the ledger a ledger rather than a mutable note.
    const appendRecord = (target: string, record: unknown) =>
      Effect.tryPromise({
        try: async () => {
          await fsNode.mkdir(path.dirname(target), { recursive: true })
          await fsNode.appendFile(target, JSON.stringify(record) + "\n", "utf8")
        },
        catch: (cause) =>
          new LedgerUnwritable({ file: target, detail: cause instanceof Error ? cause.message : String(cause) }),
      })

    const decodeLines = Effect.fnUntraced(function* <S extends Schema.Top>(
      schema: S,
      target: string,
      text: string | undefined,
    ) {
      const records: Schema.Schema.Type<S>[] = []
      const unreadable: UnreadableLine[] = []
      if (text === undefined) return { records, unreadable }
      for (const line of jsonLines(text)) {
        if (line.json === undefined) {
          unreadable.push({ file: target, line: line.index, raw: line.raw })
          continue
        }
        const decoded = yield* Schema.decodeUnknownEffect(schema)(line.json).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        )
        // A decode failure is recorded, not swallowed: the line stays visible in the
        // report so the record's gaps are countable.
        if (decoded === undefined) unreadable.push({ file: target, line: line.index, raw: line.raw })
        else records.push(decoded as Schema.Schema.Type<S>)
      }
      return { records, unreadable }
    })

    const readProtocol = Effect.fnUntraced(function* () {
      const ctx = yield* InstanceState.context
      const target = file(ctx.directory)
      const text = yield* readText(target)
      if (text === undefined) return { directory: ctx.directory, target, protocol: undefined }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (cause) {
        return yield* Effect.fail(
          new LedgerUnreadable({ file: target, detail: cause instanceof Error ? cause.message : String(cause) }),
        )
      }
      const protocol = yield* Schema.decodeUnknownEffect(ProtocolRecord)(parsed).pipe(
        Effect.catch((cause) =>
          // A protocol file that exists but does not decode is a hard failure. Returning
          // "no protocol" here would silently unbind a campaign that had been bound.
          Effect.fail(new LedgerUnreadable({ file: target, detail: String(cause) })),
        ),
      )
      return { directory: ctx.directory, target, protocol }
    })

    const ledger = Effect.fn("NfcoreProtocol.ledger")(function* () {
      const ctx = yield* InstanceState.context
      const aFile = amendmentsFile(ctx.directory)
      const rFile = refusalsFile(ctx.directory)
      const amendments = yield* decodeLines(Amendment, aFile, yield* readText(aFile))
      const refusals = yield* decodeLines(Refusal, rFile, yield* readText(rFile))
      return {
        amendments: amendments.records,
        refusals: refusals.records,
        unreadable: [...amendments.unreadable, ...refusals.unreadable],
      } satisfies Ledger
    })

    const read = Effect.fn("NfcoreProtocol.read")(function* () {
      const { protocol } = yield* readProtocol()
      if (!protocol) return undefined
      const current = yield* ledger()
      return effective(protocol, current.amendments)
    })

    const commit = Effect.fn("NfcoreProtocol.commit")(function* (input: CommitInput) {
      const ctx = yield* InstanceState.context
      const target = file(ctx.directory)
      const existing = yield* readProtocol()
      if (existing.protocol) {
        return yield* Effect.fail(new AlreadyCommitted({ file: target, committedAt: existing.protocol.committedAt }))
      }
      const protocol = ProtocolRecord.make({
        statement: input.statement,
        constraints: input.constraints,
        committedAt: new Date().toISOString(),
        ...(input.committedBy ? { committedBy: input.committedBy } : {}),
        ...(input.coSigner ? { coSigner: input.coSigner } : {}),
        posture: input.posture ?? "binding",
      })
      // Temp path then rename, so an interrupted commit cannot leave a half-written
      // protocol that decodes to fewer constraints than the scientist committed to.
      const tmp = `${target}.${process.pid}.tmp`
      yield* fs
        .writeWithDirs(tmp, JSON.stringify(protocol, null, 2))
        .pipe(
          Effect.andThen(fs.rename(tmp, target)),
          Effect.catch((cause) => Effect.fail(new LedgerUnwritable({ file: target, detail: String(cause) }))),
        )
      return { path: target, protocol }
    })

    /**
     * Record a REJECTED amendment attempt, then fail with the original error.
     *
     * Refused requests were already logged; refused override attempts were not — and an
     * override attempt is the exact moment this binding exists for. Fifty unsigned
     * attempts to retire a constraint used to leave an empty ledger, which reads as
     * "nobody ever tried". Logging is best-effort: it must never convert a validation
     * failure into a different, more confusing one.
     */
    const rejectAmendment = Effect.fnUntraced(function* <E>(input: AmendInput, problem: string, error: E) {
      yield* appendRecord("amendments.jsonl", {
        at: new Date().toISOString(),
        action: input.action,
        constraintId: input.constraintId,
        reason: input.reason,
        signedBy: input.signedBy,
        ...(input.text ? { text: input.text } : {}),
        ...(input.scope ? { scope: input.scope } : {}),
        rejected: problem,
      }).pipe(Effect.ignore)
      return yield* Effect.fail(error)
    })

    const amend = Effect.fn("NfcoreProtocol.amend")(function* (input: AmendInput) {
      const { directory: dir, protocol } = yield* readProtocol()
      if (!protocol) return yield* Effect.fail(new NotCommitted({ directory: dir }))
      if (!input.signedBy.trim())
        return yield* rejectAmendment(input, "unsigned", new UnsignedAmendment({ constraintId: input.constraintId }))
      if (!input.reason.trim()) {
        return yield* rejectAmendment(
          input,
          "no reason given",
          new InvalidAmendment({ constraintId: input.constraintId, problem: "an amendment must carry a reason" }),
        )
      }

      const current = yield* ledger()
      const state = effective(protocol, current.amendments)
      const known = state.constraints.some((c) => c.id === input.constraintId)

      if (input.action === "add" && known) {
        return yield* rejectAmendment(
          input,
          "id already in force",
          new InvalidAmendment({ constraintId: input.constraintId, problem: "a constraint with that id is already in force" }),
        )
      }
      if (input.action !== "add" && !known) {
        return yield* Effect.fail(
          new InvalidAmendment({
            constraintId: input.constraintId,
            problem: `no constraint with that id is in force (in force: ${state.constraints.map((c) => c.id).join(", ") || "none"})`,
          }),
        )
      }
      if ((input.action === "add" || input.action === "replace") && !input.text?.trim()) {
        return yield* Effect.fail(
          new InvalidAmendment({ constraintId: input.constraintId, problem: `"${input.action}" needs the constraint text` }),
        )
      }
      if (input.action === "waive" && !input.scope?.trim()) {
        return yield* rejectAmendment(
          input,
          "waiver with no scope",
          new InvalidAmendment({
            constraintId: input.constraintId,
            problem: "a waiver must name the one request it covers (--scope), verbatim. A waiver with no scope is a repeal wearing a smaller hat.",
          }),
        )
      }

      const amendment = Amendment.make({
        at: new Date().toISOString(),
        action: input.action,
        constraintId: input.constraintId,
        reason: input.reason,
        signedBy: input.signedBy,
        ...(input.coSigner ? { coSigner: input.coSigner } : {}),
        ...(input.text ? { text: input.text } : {}),
        ...(input.triggers ? { triggers: input.triggers } : {}),
        ...(input.scope ? { scope: input.scope } : {}),
      })
      yield* appendRecord(amendmentsFile(dir), amendment)
      return amendment
    })

    const refuse = Effect.fn("NfcoreProtocol.refuse")(function* (input: RefuseInput) {
      const { directory: dir, protocol } = yield* readProtocol()
      if (!protocol) return yield* Effect.fail(new NotCommitted({ directory: dir }))
      const current = yield* ledger()
      const state = effective(protocol, current.amendments)
      const texts = input.constraintIds.map(
        (id) =>
          state.constraints.find((c) => c.id === id)?.text ??
          state.retired.find((r) => r.constraint.id === id)?.constraint.text ??
          "(no constraint with this id was in force; recorded as attempted)",
      )
      const refusal = Refusal.make({
        at: new Date().toISOString(),
        request: input.request,
        constraintIds: input.constraintIds,
        constraintTexts: texts,
        outcome: input.outcome ?? (state.posture === "binding" ? "refused" : "advised"),
        ...(input.sessionID ? { sessionID: input.sessionID } : {}),
      })
      yield* appendRecord(refusalsFile(dir), refusal)
      return refusal
    })

    const checkAction = Effect.fn("NfcoreProtocol.check")(function* (action: Action) {
      return check(yield* read(), action)
    })

    const guard = Effect.fn("NfcoreProtocol.guard")(function* (action: Action) {
      const { directory: dir, protocol } = yield* readProtocol()
      if (!protocol) return { result: clearResult } satisfies GuardOutcome
      const current = yield* ledger()
      const state = effective(protocol, current.amendments)
      const result = check(state, action)
      if (result.violated.length === 0) return { result } satisfies GuardOutcome

      const refusal = Refusal.make({
        at: new Date().toISOString(),
        request: action.request,
        constraintIds: result.violated.map((v) => v.constraint.id),
        constraintTexts: result.violated.map((v) => v.constraint.text),
        outcome: result.refused ? "refused" : "advised",
      })
      // Written BEFORE the caller is told anything. If this append fails the whole guard
      // fails, so a caller can never receive a refusal that was not recorded — nor,
      // worse, a clearance because the logging broke.
      yield* appendRecord(refusalsFile(dir), refusal)
      return { result, refusal, message: renderRefusal(state, action, result) } satisfies GuardOutcome
    })

    return Service.of({ commit, read, ledger, amend, refuse, check: checkAction, guard })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node] })
