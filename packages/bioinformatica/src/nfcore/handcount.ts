export * as HandCount from "./handcount"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { Context, Effect, Layer, Schema } from "effect"
import path from "path"

// Hand count: a ledger of where the human intervened in an agent-run campaign, and the
// Methods paragraph that states it out loud.
//
// The point of this module is that a reviewer can audit the number. A self-reported
// "the agent worked autonomously" is worth nothing, and so is a count produced by asking
// a model how much help it needed — a model that misjudged a fact is the last thing that
// should be scoring how often it was corrected. So classification here is a PURE,
// DETERMINISTIC function over the turn text: same text, same class, forever, with the
// matched cues recorded so anyone can see why a turn was labelled the way it was.
//
// The cost of that choice is stated rather than hidden: surface cues cannot read intent.
// A turn that intervenes without any of the wordings below lands in `other`, and `other`
// therefore means "no evidence found", NOT "no intervention happened". The Methods
// paragraph says exactly that, because a reader who takes `other` as a clean bill of
// health has been misled by us, not by the classifier.

const BIOINFORMATICA_DIR = ".bioinformatica"
const FILE = "handcount.json"

/** Frozen so a count published in a paper stays comparable to one produced later. */
export const TAXONOMY_VERSION = "bioinformatica-handcount-taxonomy/v1"
export const CLASSIFIER_VERSION = "bioinformatica-handcount-rules/v1"

export type Class =
  | "factual-correction"
  | "redirection"
  | "approval"
  | "rejection"
  | "disambiguation"
  | "other"

/** The frozen taxonomy, in a fixed order so reports and JSON keys never reshuffle. */
export const CLASSES = [
  "factual-correction",
  "redirection",
  "approval",
  "rejection",
  "disambiguation",
  "other",
] as const satisfies readonly Class[]

export type Intervention = Exclude<Class, "other">

export const DESCRIPTIONS: Record<Class, string> = {
  "factual-correction": "the human stated the agent had a fact wrong",
  redirection: "a change of goal or approach",
  approval: "authorising a proposed action",
  rejection: "refusing a proposed action",
  disambiguation: "answering a question the agent asked, or resolving an underspecified request",
  other: "no cue the classifier recognises",
}

/**
 * Tie-break order, frozen. Iterating in this order and keeping the strict maximum means a
 * turn that carries equal evidence for two classes takes the earlier one.
 *
 * The order is not arbitrary. A factual correction is the most consequential thing a
 * reviewer can learn and must never be swallowed by a milder co-occurring label — "no,
 * that's the 2022 release" is a correction first and a refusal second. Approval sits last
 * because it is the weakest signal: "ok, but use salmon instead" is a redirection that
 * happens to open with a pleasantry, and counting it as an approval would understate the
 * intervention.
 */
export const PRECEDENCE = [
  "factual-correction",
  "rejection",
  "redirection",
  "disambiguation",
  "approval",
] as const satisfies readonly Intervention[]

/**
 * Minimum evidence to leave `other`. Set to 2 so a single weak cue is not enough: a bare
 * "continue" or "thanks, great" is a nudge, not an authorisation of a proposed action, and
 * inflating the approval count with them would make the ledger look busier than the
 * campaign was.
 */
export const MIN_SCORE = 2

interface Cue {
  /** Recorded on the classification so a disputed label can be traced to the rule. */
  readonly id: string
  readonly test: RegExp
  readonly weight: number
}

// Weights: 3 = the wording is close to unambiguous for this class, 2 = suggestive,
// 1 = present but too common to stand alone (see MIN_SCORE).
// No cue carries the `g` flag: these RegExp objects are module-level and `g` would make
// `.test` stateful across calls, which would silently make classification depend on the
// order turns were classified in.
const CUES: Record<Intervention, readonly Cue[]> = {
  "factual-correction": [
    // "nothing wrong with that" is agreement, not a correction.
    { id: "fc.wrong", test: /(?<!nothing )(?<!anything )\b(wrong|incorrect|inaccurate|untrue)\b/, weight: 3 },
    { id: "fc.not-correct", test: /\bnot (correct|true|right|accurate)\b/, weight: 3 },
    { id: "fc.thats-not", test: /\bthat'?s not (right|what|how|the|a)\b/, weight: 3 },
    { id: "fc.dont-think", test: /\bi (don'?t|do not) think (that'?s|thats|it'?s|this is)\b/, weight: 3 },
    { id: "fc.nonexistent", test: /\b(doesn'?t exist|does not exist|no such|there is no|there'?s no)\b/, weight: 2 },
    { id: "fc.misread", test: /\byou (misread|misremembered|confused|conflated|mixed up|got .* backwards)\b/, weight: 3 },
    { id: "fc.invented", test: /\b(hallucinat\w+|made (that|it|this) up|fabricat\w+|invented)\b/, weight: 3 },
    { id: "fc.the-correct", test: /\bthe (correct|actual|real|right) \w+ (is|was|are|were)\b/, weight: 3 },
    // "X is 3.14, not 3.12" — the human supplies the right value alongside the wrong one.
    { id: "fc.is-not", test: /\b(is|was|are|were) [\w.:/-]+,? not\b/, weight: 3 },
    { id: "fc.actually", test: /\bactually,? (it|the|that|they|there|those)\b/, weight: 2 },
    { id: "fc.in-fact", test: /\bin fact\b/, weight: 2 },
    { id: "fc.you-said-but", test: /\byou (said|claimed|wrote|reported|cited) .* but\b/, weight: 2 },
  ],
  rejection: [
    { id: "rj.dont-verb", test: /\b(don'?t|do not) (do|run|use|make|write|create|change|touch|commit|push|delete|install|proceed|start|open|send)\b/, weight: 3 },
    { id: "rj.leading-no", test: /^(no|nope|nah)\b/, weight: 3 },
    { id: "rj.no-comma", test: /\bno,? (don'?t|do not|stop|please don'?t)\b/, weight: 3 },
    { id: "rj.stop", test: /\b(stop|halt|abort|cancel)\b/, weight: 3 },
    { id: "rj.refuse", test: /\b(reject\w*|deny|denied|denying|refus\w+)\b/, weight: 3 },
    { id: "rj.hold", test: /\b(hold off|hold on|not yet|wait on)\b/, weight: 2 },
    { id: "rj.drop-it", test: /\b(never mind|nevermind|forget it|skip (it|that|this)|leave it)\b/, weight: 2 },
  ],
  approval: [
    { id: "ap.leading-yes", test: /^(yes|yep|yeah|yup|ok|okay|sure|fine|correct|right)\b/, weight: 3 },
    { id: "ap.go-ahead", test: /\b(go ahead|proceed|go for it|do it|please do|run it|ship it|merge it)\b/, weight: 3 },
    { id: "ap.approved", test: /\b(approved?|authoriz\w+|authoris\w+|lgtm|sounds good|looks good|that works|works for me|agreed)\b/, weight: 3 },
    { id: "ap.confirm", test: /\b(confirm|confirmed)\b/, weight: 2 },
    // Too weak to stand alone: praise and bare nudges are not authorisations.
    { id: "ap.praise", test: /\b(perfect|great|excellent|nice work|good)\b/, weight: 1 },
    { id: "ap.nudge", test: /\b(continue|keep going|carry on|go on)\b/, weight: 1 },
  ],
  redirection: [
    { id: "rd.instead", test: /\binstead\b/, weight: 3 },
    { id: "rd.rather-than", test: /\brather than\b/, weight: 3 },
    { id: "rd.switch", test: /\b(switch|change|move|swap) (to|over to|back to)\b/, weight: 3 },
    { id: "rd.new-approach", test: /\b(new|different|another) (plan|approach|direction|angle|way|strategy|pipeline|method|tack)\b/, weight: 3 },
    { id: "rd.start-over", test: /\b(start over|scrap (that|it|this)|redo|back up|backtrack|pivot|change of plan)\b/, weight: 3 },
    // "actually, let's ..." is a change of mind; "actually, the release is 3.14" is a
    // correction. The word after "actually" is what separates them, so the cue requires it.
    { id: "rd.actually-lets", test: /\b(actually|on second thought),? (let'?s|lets|can you|could you|i want|i'?d like|we should)\b/, weight: 3 },
    { id: "rd.lets-verb", test: /\b(let'?s|lets|we should|we need to|can you) (try|use|do|switch|run|go|focus)\b/, weight: 2 },
    { id: "rd.forget-the", test: /\b(forget|drop|park|shelve) (the|that|those|this)\b/, weight: 2 },
    { id: "rd.focus", test: /\b(focus on|prioriti[sz]e|concentrate on)\b/, weight: 2 },
  ],
  disambiguation: [
    { id: "dm.i-mean", test: /\bi mean(t)?\b|\bwhat i meant\b/, weight: 3 },
    { id: "dm.clarify", test: /\b(to clarify|to be clear|for clarity|clarif\w+)\b/, weight: 3 },
    { id: "dm.ordinal", test: /\bthe (first|second|third|latter|former|last) one\b/, weight: 3 },
    { id: "dm.option", test: /\boption (\d+|one|two|three|a|b)\b/, weight: 3 },
    { id: "dm.was-asking", test: /\bi was (asking|referring|talking) (about|to)\b/, weight: 3 },
    { id: "dm.to-answer", test: /\bto answer (your|the) question\b/, weight: 3 },
    { id: "dm.the-one-in", test: /\bthe one (in|under|at|from|with|that)\b/, weight: 2 },
    { id: "dm.specifically", test: /\b(specifically|precisely|namely|i.e\.)\b/, weight: 2 },
    { id: "dm.both", test: /\b(both|either|neither)\b/, weight: 2 },
  ],
}

/**
 * Reduce a turn to the human's own prose before matching.
 *
 * Fenced and inline code is dropped, because a pasted stack trace is the single most
 * effective way to fake this ledger: a Nextflow error containing "No such file" or
 * "command not found" would otherwise be scored as the human correcting a fact. Quoted
 * lines are dropped for the same reason — they are the agent's words, not the human's.
 */
export function normalize(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/^[ \t]*>.*$/gm, " ")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[–—]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Machine-injected text that arrives inside a user message but was not typed by a human. */
export function stripInjected(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ")
    .replace(/<campaign_objective>[\s\S]*?<\/campaign_objective>/g, " ")
    .trim()
}

/**
 * Contrastive conjunctions. Used to score approval on the clause AFTER the contrast, when
 * there is one: "ok, sounds good, but run sarek instead" opens with approval words and
 * then overrides them. Counting the opener would file a redirection as an approval, which
 * is exactly the direction of error that flatters the agent — so it is ruled out here
 * rather than left to the tie-break. Only approval is treated this way; it is the one
 * class whose cues are routinely a pleasantry the rest of the turn contradicts.
 */
const CONTRAST = /\b(but|however|though|except|although)\b/

function scoringText(cls: Intervention, normalized: string): string {
  if (cls !== "approval") return normalized
  const match = CONTRAST.exec(normalized)
  return match ? normalized.slice(match.index + match[0].length) : normalized
}

export interface Classification {
  readonly class: Class
  /** Total weight of the cues that fired for the winning class. 0 for `other`. */
  readonly score: number
  /** Cue ids that fired, so a disputed label is traceable to a rule. */
  readonly cues: readonly string[]
}

/** Pure, deterministic, no I/O and no model. Same text in, same class out. */
export function classifyDetailed(text: string): Classification {
  const normalized = normalize(text)
  if (!normalized) return { class: "other", score: 0, cues: [] }

  let best: Classification | undefined
  // Iterating PRECEDENCE and comparing with a strict `>` is what implements the tie-break:
  // the earlier class keeps the win when the scores are equal.
  for (const cls of PRECEDENCE) {
    const target = scoringText(cls, normalized)
    let score = 0
    const cues: string[] = []
    for (const cue of CUES[cls]) {
      if (!cue.test.test(target)) continue
      score += cue.weight
      cues.push(cue.id)
    }
    if (score < MIN_SCORE) continue
    if (!best || score > best.score) best = { class: cls, score, cues }
  }
  return best ?? { class: "other", score: 0, cues: [] }
}

export function classify(text: string): Class {
  return classifyDetailed(text).class
}

export interface Classified extends Classification {
  /** Position in the campaign, 0-based, so the ledger can be read against the transcript. */
  readonly index: number
  readonly text: string
}

export interface Tally {
  readonly total: number
  /** Turns in one of the five intervention classes. Excludes `other`. */
  readonly interventions: number
  readonly counts: Record<Class, number>
  readonly entries: readonly Classified[]
}

function emptyCounts(): Record<Class, number> {
  return { "factual-correction": 0, redirection: 0, approval: 0, rejection: 0, disambiguation: 0, other: 0 }
}

/** Pure. Classifies every turn and counts by class. */
export function tally(turns: readonly string[]): Tally {
  const counts = emptyCounts()
  const entries: Classified[] = []
  for (const [index, text] of turns.entries()) {
    const result = classifyDetailed(text)
    counts[result.class] += 1
    entries.push({ ...result, index, text })
  }
  return {
    total: turns.length,
    interventions: turns.length - counts.other,
    counts,
    entries,
  }
}

/** Simple agreement against hand labels. Pure; used by the test and by anyone re-checking. */
export function agreement(labelled: readonly { readonly text: string; readonly expected: Class }[]): {
  readonly total: number
  readonly agreed: number
  readonly rate: number
  readonly mismatches: readonly { readonly text: string; readonly expected: Class; readonly got: Class }[]
} {
  const mismatches: { text: string; expected: Class; got: Class }[] = []
  let agreed = 0
  for (const item of labelled) {
    const got = classify(item.text)
    if (got === item.expected) agreed += 1
    else mismatches.push({ text: item.text, expected: item.expected, got })
  }
  return { total: labelled.length, agreed, rate: labelled.length === 0 ? 0 : agreed / labelled.length, mismatches }
}

export interface MethodsContext {
  /** What the campaign was, in the scientist's own words. */
  readonly objective?: string
  /** The agent that did the work, e.g. "Bioinformatica 0.1.0 (claude-opus-5)". */
  readonly agent?: string
  /** Where the turns came from, e.g. "session ses_7f2a" or "turns.json". */
  readonly source?: string
  /** Where the per-turn ledger was written, quoted so a reader can go and check it. */
  readonly ledger?: string
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/**
 * The Methods paragraph. It states what the agent did, where the human intervened, and
 * what the classifier is — a heuristic. It deliberately does not claim the counts are
 * human-level judgement, and it says in plain words that `other` is absence of evidence
 * rather than evidence of absence, because that is the sentence a reader would otherwise
 * supply wrongly on our behalf.
 */
export function methods(t: Tally, context: MethodsContext = {}): string {
  const agent = context.agent ?? "an AI agent"
  const ledger = context.ledger ?? path.join(BIOINFORMATICA_DIR, FILE)
  const c = t.counts

  const sentences: string[] = []
  sentences.push(
    `The analysis was carried out by ${agent} under human supervision` +
      (context.objective ? `, working toward a standing objective: ${context.objective.trim().replace(/\.$/, "")}.` : "."),
  )
  sentences.push(
    `The human took ${count(t.total, "turn", "turns")} over the campaign` +
      (context.source ? `, taken from ${context.source}` : "") +
      `.`,
  )
  sentences.push(
    `Classified against a frozen taxonomy (${TAXONOMY_VERSION}), ${count(t.interventions, "turn", "turns")} intervened in the agent's work: ` +
      [
        `${count(c["factual-correction"], "factual correction", "factual corrections")} (${DESCRIPTIONS["factual-correction"]})`,
        `${count(c.redirection, "redirection", "redirections")} (${DESCRIPTIONS.redirection})`,
        `${count(c.approval, "approval", "approvals")} (${DESCRIPTIONS.approval})`,
        `${count(c.rejection, "rejection", "rejections")} (${DESCRIPTIONS.rejection})`,
        `${count(c.disambiguation, "disambiguation", "disambiguations")} (${DESCRIPTIONS.disambiguation})`,
      ].join("; ") +
      `.`,
  )
  sentences.push(
    `The remaining ${count(c.other, "turn", "turns")} matched no cue in the taxonomy and are recorded as "other"; that means no evidence of an intervention was found in them, not that none occurred.`,
  )
  sentences.push(
    `Classification was done by a deterministic keyword-and-pattern classifier (${CLASSIFIER_VERSION}) applied to the text of each turn — not by a human reviewer and not by a language model. It is a heuristic: it reproduces exactly from the turn text, and it will misclassify turns whose intent is not marked in their wording.`,
  )
  sentences.push(`The per-turn classification and the cues behind it are recorded in ${ledger}, so every count above can be re-checked by hand.`)
  return sentences.join(" ")
}

/** Human-readable tally for the terminal. */
export function summarize(t: Tally): string {
  const lines = [`${t.total} human turns, ${t.interventions} classified as interventions (${TAXONOMY_VERSION}):`]
  for (const cls of CLASSES) {
    lines.push(`  ${cls.padEnd(19)} ${String(t.counts[cls]).padStart(4)}   ${DESCRIPTIONS[cls]}`)
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Reading turns out of a session. Pure extraction, so it is testable without a database.
// ---------------------------------------------------------------------------

/** Structural shape of `Session.messages` output; typed loosely so the extractor stays pure. */
export interface MessageLike {
  readonly info: { readonly role: string }
  readonly parts: readonly {
    readonly type: string
    readonly text?: string
    readonly synthetic?: boolean
    readonly ignored?: boolean
  }[]
}

/**
 * The human turns in a transcript, in order.
 *
 * Only text parts of user messages count, and synthetic or ignored parts are dropped:
 * those are text Bioinformatica injected into the user turn (reminders, the restated objective),
 * and counting them would put words in the scientist's mouth and inflate the ledger.
 */
export function turnsFromMessages(messages: readonly MessageLike[]): string[] {
  const turns: string[] = []
  for (const message of messages) {
    if (message.info.role !== "user") continue
    const text = message.parts
      .filter((part) => part.type === "text" && !part.synthetic && !part.ignored && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("\n")
    const cleaned = stripInjected(text)
    if (cleaned) turns.push(cleaned)
  }
  return turns
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export const HandCountEntry = Schema.Struct({
  index: Schema.Number,
  class: Schema.String,
  score: Schema.Number,
  cues: Schema.Array(Schema.String),
  text: Schema.String,
})

export const HandCountRecord = Schema.Struct({
  taxonomy: Schema.String,
  classifier: Schema.String,
  source: Schema.optional(Schema.String),
  countedAt: Schema.String,
  total: Schema.Number,
  interventions: Schema.Number,
  counts: Schema.Record(Schema.String, Schema.Number),
  /** Full turn text, deliberately: the Methods paragraph promises the counts can be re-checked. */
  entries: Schema.Array(HandCountEntry),
  methods: Schema.String,
})
export type HandCountRecord = Schema.Schema.Type<typeof HandCountRecord>

/** Absolute path of the ledger for a project directory. */
export function file(directory: string): string {
  return path.join(directory, BIOINFORMATICA_DIR, FILE)
}

export interface RecordInput {
  readonly turns: readonly string[]
  readonly context?: MethodsContext
}

export interface Written {
  readonly path: string
  readonly record: HandCountRecord
}

/**
 * Read outcome. A missing ledger and an unreadable one are separate cases on purpose: a
 * corrupt or truncated file must never come back as "no interventions recorded", which is
 * the reading a bare `undefined` would invite.
 */
export type ReadResult =
  | { readonly status: "missing" }
  | { readonly status: "unreadable"; readonly path: string; readonly reason: string }
  | { readonly status: "ok"; readonly record: HandCountRecord }

export interface Interface {
  readonly count: (input: RecordInput) => Effect.Effect<Written>
  readonly read: () => Effect.Effect<ReadResult>
  /** Human turns of a session, in order. Fails if the session does not exist. */
  readonly turns: (sessionID: SessionID) => Effect.Effect<string[], Session.NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/NfcoreHandCount") {}

export const use = serviceUse(Service)

/** Pure assembly of the persisted record, so the shape is testable without a filesystem. */
export function build(input: RecordInput, countedAt: string): HandCountRecord {
  const t = tally(input.turns)
  const ledger = input.context?.ledger ?? path.join(BIOINFORMATICA_DIR, FILE)
  return HandCountRecord.make({
    taxonomy: TAXONOMY_VERSION,
    classifier: CLASSIFIER_VERSION,
    ...(input.context?.source ? { source: input.context.source } : {}),
    countedAt,
    total: t.total,
    interventions: t.interventions,
    counts: t.counts,
    entries: t.entries.map((e) => ({ index: e.index, class: e.class, score: e.score, cues: e.cues, text: e.text })),
    methods: methods(t, { ...input.context, ledger }),
  })
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const session = yield* Session.Service

    const count = Effect.fn("NfcoreHandCount.count")(function* (input: RecordInput) {
      const ctx = yield* InstanceState.context
      const target = file(ctx.directory)
      const record = build(input, new Date().toISOString())
      // Temp path then rename: a ledger interrupted mid-write would parse as a shorter
      // campaign than actually happened, and nothing downstream would notice.
      const tmp = `${target}.${process.pid}.tmp`
      yield* fs
        .writeWithDirs(tmp, JSON.stringify(record, null, 2))
        .pipe(Effect.andThen(fs.rename(tmp, target)), Effect.orDie)
      return { path: target, record }
    })

    const read = Effect.fn("NfcoreHandCount.read")(function* () {
      const ctx = yield* InstanceState.context
      const target = file(ctx.directory)
      // No existsSafe pre-check: FSUtil.existsSafe turns ANY stat failure into `false`, so a
      // ledger that exists but cannot be read (EACCES on the file or a parent) would report
      // `missing` — which every reader takes as "no interventions were recorded". Missing and
      // unreadable are separate cases on purpose; read first and classify the failure.
      const raw = yield* Effect.result(fs.readJson(target))
      if (raw._tag === "Failure") {
        const reason = String(raw.failure)
        const notFound = /ENOENT|NotFound|no such file/i.test(reason)
        return notFound
          ? ({ status: "missing" } as const)
          : ({ status: "unreadable", path: target, reason } as const)
      }
      const decoded = yield* Effect.result(Schema.decodeUnknownEffect(HandCountRecord)(raw.success))
      if (decoded._tag === "Failure") return { status: "unreadable", path: target, reason: String(decoded.failure) } as const
      return { status: "ok", record: decoded.success } as const
    })

    const turns = Effect.fn("NfcoreHandCount.turns")(function* (sessionID: SessionID) {
      const messages = yield* session.messages({ sessionID })
      return turnsFromMessages(messages as unknown as MessageLike[])
    })

    return Service.of({ count, read, turns })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node, Session.node] })
