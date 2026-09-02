import { EOL } from "os"
import { Effect } from "effect"
import { Protocol } from "@/nfcore/protocol"
import { effectCmd, fail } from "../../effect-cmd"
import { cmd } from "../cmd"

// Drive the Ulysses protocol from the CLI: commit it once, see what is in force, test a
// request against it, record a refusal, and print the ledger the report ships.
//
// The subcommand split is deliberate. `commit` is a single act at the start of a campaign;
// `amend` is the only way to change what was committed, and it demands a signature. There
// is no subcommand that edits a constraint in place, and none that deletes a refusal.

const out = (text: string) => process.stdout.write(text + EOL)

// Every typed protocol failure carries a message written for the scientist; surface it as
// a clean CLI failure rather than a stack trace.
const asCliError = <A, E extends { readonly message: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.catch((e) => fail(e.message)))

const parseTriggers = (specs: readonly string[] | undefined): Map<string, string[]> => {
  const map = new Map<string, string[]>()
  for (const spec of specs ?? []) {
    const at = spec.indexOf("=")
    if (at <= 0) continue
    const id = spec.slice(0, at).trim()
    const phrase = spec.slice(at + 1).trim()
    if (!id || !phrase) continue
    map.set(id, [...(map.get(id) ?? []), phrase])
  }
  return map
}

const CommitCommand = effectCmd({
  command: "commit <statement>",
  describe: "commit this campaign's protocol — the objective plus the constraints to be held to",
  builder: (yargs) =>
    yargs
      .positional("statement", { describe: "what this campaign is for", type: "string" })
      .option("constraint", {
        describe: "a constraint, as `id=text` or bare text (repeatable)",
        type: "array",
        string: true,
      })
      .option("trigger", {
        describe: "`constraintId=phrase` — a literal phrase that implicates that constraint (repeatable)",
        type: "array",
        string: true,
      })
      .option("by", { describe: "who commits to this", type: "string" })
      .option("co-signer", { describe: "a second name on the commitment", type: "string" })
      .option("advisory", {
        describe: "record conflicts without refusing them (default: binding)",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.debug.protocol.commit")(function* (args: {
    statement?: string
    constraint?: string[]
    trigger?: string[]
    by?: string
    coSigner?: string
    advisory?: boolean
  }) {
    if (!args.statement) return yield* fail("a statement is required")
    if (!args.constraint?.length) {
      return yield* fail("a protocol with no constraints binds nothing — pass at least one --constraint")
    }
    const triggers = parseTriggers(args.trigger)
    const constraints = args.constraint.map((spec, i) => {
      const parsed = Protocol.parseConstraint(spec, i)
      const t = triggers.get(parsed.id)
      return t ? { ...parsed, triggers: t } : parsed
    })
    const unknown = [...triggers.keys()].filter((id) => !constraints.some((c) => c.id === id))
    // A trigger naming no constraint would silently never fire, which is the failure mode
    // that makes a check look like it passed when it never ran.
    if (unknown.length) return yield* fail(`--trigger names no such constraint: ${unknown.join(", ")}`)

    const protocol = yield* Protocol.Service
    const { path, protocol: committed } = yield* asCliError(
      protocol.commit({
        statement: args.statement,
        constraints,
        ...(args.by ? { committedBy: args.by } : {}),
        ...(args.coSigner ? { coSigner: args.coSigner } : {}),
        posture: args.advisory ? "advisory" : "binding",
      }),
    )
    out(`Committed ${committed.constraints.length} constraint(s), posture ${committed.posture}, at ${path}`)
    const state = yield* asCliError(protocol.read())
    const rendered = Protocol.render(state)
    if (rendered) out("" + EOL + "--- as restated to the model every turn ---" + EOL + rendered)
  }),
})

const ListCommand = effectCmd({
  command: ["list", "$0"],
  describe: "show the protocol in force, with every amendment folded in",
  handler: Effect.fn("Cli.debug.protocol.list")(function* () {
    const protocol = yield* Protocol.Service
    const state = yield* asCliError(protocol.read())
    if (!state) {
      out("No protocol committed for this project. Nothing binds this campaign — that is the default.")
      return
    }
    const ledger = yield* asCliError(protocol.ledger())
    out(Protocol.summarize(state, ledger))
  }),
})

const CheckCommand = effectCmd({
  command: "check <request>",
  describe: "test a request against the committed protocol without recording anything",
  builder: (yargs) =>
    yargs
      .positional("request", { describe: "the request, verbatim", type: "string" })
      .option("detail", { describe: "extra text to match against (a command line, a path)", type: "string" })
      .option("implicates", {
        describe: "a constraint id you have already judged to apply (repeatable)",
        type: "array",
        string: true,
      }),
  handler: Effect.fn("Cli.debug.protocol.check")(function* (args: {
    request?: string
    detail?: string
    implicates?: string[]
  }) {
    if (!args.request) return yield* fail("a request is required")
    const protocol = yield* Protocol.Service
    const result = yield* asCliError(
      protocol.check({
        request: args.request,
        ...(args.detail ? { detail: args.detail } : {}),
        ...(args.implicates?.length ? { implicates: args.implicates } : {}),
      }),
    )
    if (!result.committed) {
      out("No protocol committed — nothing to check against.")
      return
    }
    out(`posture: ${result.enforced ? "binding" : "advisory"}    verdict: ${result.refused ? "REFUSED" : "not refused"}`)
    for (const v of result.violated) out(`violates [${v.constraint.id}] ${v.constraint.text}  (${v.why})`)
    for (const w of result.waived) {
      out(`waived   [${w.violation.constraint.id}] by ${w.amendment.signedBy} on ${w.amendment.at}`)
    }
    for (const c of result.cleared) out(`checked  [${c.id}] no trigger matched`)
    // Printed last and never folded into "cleared": these were not checked at all.
    for (const c of result.unevaluated) out(`NOT CHECKED [${c.id}] ${c.text} — judge this yourself`)
  }),
})

const RefuseCommand = effectCmd({
  command: "refuse <request>",
  describe: "check a request and append the attempt to the refusal ledger",
  builder: (yargs) =>
    yargs
      .positional("request", { describe: "the request, verbatim", type: "string" })
      .option("detail", { describe: "extra text to match against", type: "string" })
      .option("implicates", {
        describe: "a constraint id you have already judged to apply (repeatable)",
        type: "array",
        string: true,
      }),
  handler: Effect.fn("Cli.debug.protocol.refuse")(function* (args: {
    request?: string
    detail?: string
    implicates?: string[]
  }) {
    if (!args.request) return yield* fail("a request is required")
    const protocol = yield* Protocol.Service
    const outcome = yield* asCliError(
      protocol.guard({
        request: args.request,
        ...(args.detail ? { detail: args.detail } : {}),
        ...(args.implicates?.length ? { implicates: args.implicates } : {}),
      }),
    )
    if (!outcome.refusal) {
      if (!outcome.result.committed) {
        out("No protocol committed; nothing recorded.")
        return
      }
      // "Nothing was violated" and "nothing could be checked" are different statements, and
      // most real constraints cannot be decided by string matching — so the common case is
      // that some constraints were never evaluated at all. Printing a clean bill of health
      // over them turns an unchecked constraint into an implied pass. `check` already makes
      // this distinction; `refuse` used to discard it.
      const unevaluated = outcome.result.unevaluated ?? []
      out(
        unevaluated.length === 0
          ? "Nothing in the committed protocol was violated; nothing recorded."
          : `No constraint was mechanically violated, but ${unevaluated.length} could not be checked automatically; nothing recorded.`,
      )
      for (const c of unevaluated) out(`  NOT CHECKED [${c.id}] ${c.text} — judge this yourself`)
      return
    }
    out(outcome.message ?? "")
    out("")
    out(`Recorded at ${outcome.refusal.at}.`)
  }),
})

const AmendCommand = effectCmd({
  command: "amend <constraintId>",
  describe: "amend the committed protocol — the only way past a constraint, and always signed",
  builder: (yargs) =>
    yargs
      .positional("constraintId", { describe: "the constraint being amended", type: "string" })
      .option("action", {
        describe: "waive (this one request), retire, replace, or add",
        choices: ["waive", "retire", "replace", "add"] as const,
        default: "waive" as const,
      })
      .option("reason", { describe: "why the commitment is changing", type: "string" })
      .option("sign", { describe: "who signs this amendment", type: "string" })
      .option("co-signer", { describe: "a second signature", type: "string" })
      .option("text", { describe: "the constraint text, for replace/add", type: "string" })
      .option("scope", { describe: "for waive: the one request this covers, verbatim", type: "string" })
      .option("trigger", { describe: "a literal trigger phrase (repeatable)", type: "array", string: true }),
  handler: Effect.fn("Cli.debug.protocol.amend")(function* (args: {
    constraintId?: string
    action: "waive" | "retire" | "replace" | "add"
    reason?: string
    sign?: string
    coSigner?: string
    text?: string
    scope?: string
    trigger?: string[]
  }) {
    if (!args.constraintId) return yield* fail("a constraint id is required")
    const protocol = yield* Protocol.Service
    const amendment = yield* asCliError(
      protocol.amend({
        action: args.action,
        constraintId: args.constraintId,
        reason: args.reason ?? "",
        signedBy: args.sign ?? "",
        ...(args.coSigner ? { coSigner: args.coSigner } : {}),
        ...(args.text ? { text: args.text } : {}),
        ...(args.scope ? { scope: args.scope } : {}),
        ...(args.trigger?.length ? { triggers: args.trigger } : {}),
      }),
    )
    out(`Amendment recorded: ${amendment.action} [${amendment.constraintId}] signed by ${amendment.signedBy} at ${amendment.at}`)
  }),
})

const LedgerCommand = effectCmd({
  command: "ledger",
  describe: "print the append-only ledger: every amendment and every refused override",
  builder: (yargs) => yargs.option("json", { describe: "print the raw records as JSON", type: "boolean" }),
  handler: Effect.fn("Cli.debug.protocol.ledger")(function* (args: { json?: boolean }) {
    const protocol = yield* Protocol.Service
    const ledger = yield* asCliError(protocol.ledger())
    if (args.json) {
      out(JSON.stringify(ledger, null, 2))
      return
    }
    const state = yield* asCliError(protocol.read())
    out(Protocol.summarize(state, ledger))
  }),
})

export const ProtocolCommand = cmd({
  command: "protocol",
  describe: "commit and enforce this campaign's protocol (the Ulysses binding)",
  builder: (yargs) =>
    yargs
      .command(CommitCommand)
      .command(ListCommand)
      .command(CheckCommand)
      .command(RefuseCommand)
      .command(AmendCommand)
      .command(LedgerCommand),
  async handler() {},
})
