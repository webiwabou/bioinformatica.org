import { describe, expect, test } from "bun:test"
import fsNode from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { CrossSpawnSpawner } from "@bioinformatica/core/cross-spawn-spawner"
import { Protocol } from "@/nfcore/protocol"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const env = LayerNode.compile(LayerNode.group([Protocol.node, CrossSpawnSpawner.node]))
const it = testEffect(env)

const CALIBRATION: Protocol.Constraint = {
  id: "calibration",
  text: "No tool substitution without calibration against ground truth.",
  triggers: ["swap in", "substitute", "instead of"],
}

// A constraint no substring can decide. It exists in every fixture on purpose.
const FIGURES: Protocol.Constraint = {
  id: "figures",
  text: "Figures only from manifested data.",
}

const committed = (over?: Partial<Protocol.ProtocolRecord>): Protocol.ProtocolRecord => ({
  statement: "Catalogue repeat proteins the public databases have missed.",
  constraints: [CALIBRATION, FIGURES],
  committedAt: "2026-08-01T09:00:00.000Z",
  committedBy: "R. Bioinformatica",
  posture: "binding",
  ...over,
})

const state = (over?: Partial<Protocol.ProtocolRecord>, amendments: Protocol.Amendment[] = []) =>
  Protocol.effective(committed(over), amendments)

const signed = (over: Partial<Protocol.Amendment>): Protocol.Amendment => ({
  at: "2026-08-05T12:00:00.000Z",
  action: "waive",
  constraintId: "calibration",
  reason: "the reference set is embargoed until October",
  signedBy: "R. Bioinformatica",
  ...over,
})

const readSafe = (file: string) =>
  Effect.tryPromise(() => fsNode.readFile(file, "utf8")).pipe(Effect.catch(() => Effect.succeed("")))

const tagOf = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map(() => "no-failure"),
    Effect.catch((e) => Effect.succeed(e._tag)),
  )

describe("nfcore.protocol paths", () => {
  test("the commitment and its ledgers live project-locally under .bioinformatica/protocol/", () => {
    expect(Protocol.file("/work/proj")).toBe(path.join("/work/proj", ".bioinformatica", "protocol", "protocol.json"))
    expect(Protocol.refusalsFile("/work/proj")).toBe(
      path.join("/work/proj", ".bioinformatica", "protocol", "refusals.jsonl"),
    )
    // Two campaigns are independently bound; nothing is keyed on a session.
    expect(Protocol.file("/work/a")).not.toBe(Protocol.file("/work/b"))
  })
})

describe("nfcore.protocol default posture", () => {
  test("an uncommitted campaign is not bound and refuses nothing", () => {
    const result = Protocol.check(undefined, { request: "swap in the fast aligner instead of the reference one" })
    expect(result.committed).toBe(false)
    expect(result.refused).toBe(false)
    expect(result.violated).toHaveLength(0)
  })

  test("render is silent when nothing is committed, so an unbound campaign carries no prompt weight", () => {
    expect(Protocol.render(undefined)).toBeUndefined()
  })

  test("an advisory protocol reports the conflict but does not refuse", () => {
    const result = Protocol.check(state({ posture: "advisory" }), {
      request: "substitute the quick caller for the validated one",
    })
    expect(result.committed).toBe(true)
    expect(result.enforced).toBe(false)
    expect(result.violated).toHaveLength(1)
    // The conflict is real and reportable; it just is not a block.
    expect(result.refused).toBe(false)
  })
})

describe("nfcore.protocol check", () => {
  test("a request that trips a trigger is refused, and says which constraint and why", () => {
    const result = Protocol.check(state(), {
      request: "Let's substitute the fast caller for the validated one to save a day.",
    })
    expect(result.refused).toBe(true)
    expect(result.violated).toHaveLength(1)
    expect(result.violated[0].constraint.id).toBe("calibration")
    expect(result.violated[0].why).toContain("substitute")
  })

  test("a constraint no string can decide is UNEVALUATED, never cleared", () => {
    // The load-bearing distinction. If `unevaluated` were folded into `cleared`, an empty
    // `violated` list would read as a clearance for a constraint nobody ever checked.
    const result = Protocol.check(state(), { request: "plot the coverage histogram" })
    expect(result.violated).toHaveLength(0)
    expect(result.unevaluated.map((c) => c.id)).toEqual(["figures"])
    expect(result.cleared.map((c) => c.id)).toEqual(["calibration"])
    expect(result.unevaluated.some((c) => result.cleared.includes(c))).toBe(false)
  })

  test("a caller that names the constraint gets a refusal even with no trigger to match", () => {
    const result = Protocol.check(state(), {
      request: "draw the figure from the numbers in my notes",
      implicates: ["figures"],
    })
    expect(result.refused).toBe(true)
    expect(result.violated[0].constraint.id).toBe("figures")
    expect(result.unevaluated).toHaveLength(0)
  })

  test("matching ignores case and whitespace, so re-typing the request does not slip past", () => {
    const result = Protocol.check(state(), { request: "SUBSTITUTE   the\ncaller" })
    expect(result.refused).toBe(true)
  })
})

describe("nfcore.protocol amendments", () => {
  test("a signed waiver clears the exact request it names — and nothing else", () => {
    const request = "Let's substitute the fast caller for the validated one to save a day."
    const waiver = signed({ scope: request })
    const bound = state(undefined, [waiver])

    expect(Protocol.check(bound, { request }).refused).toBe(false)
    expect(Protocol.check(bound, { request }).waived).toHaveLength(1)

    // A waiver is not a repeal. A different request touching the same constraint is
    // still refused, which is the whole reason waivers carry a verbatim scope.
    const other = Protocol.check(bound, { request: "substitute the quick assembler as well" })
    expect(other.refused).toBe(true)
    expect(other.violated[0].constraint.id).toBe("calibration")
  })

  test("retiring a constraint takes it out of force and keeps it in the record", () => {
    const retire = signed({ action: "retire", reason: "the ground truth set was withdrawn" })
    const bound = state(undefined, [retire])
    expect(bound.constraints.map((c) => c.id)).toEqual(["figures"])
    expect(bound.retired[0].constraint.text).toBe(CALIBRATION.text)
    expect(Protocol.check(bound, { request: "substitute the fast caller" }).refused).toBe(false)
  })

  test("replace changes the text in force without losing what it replaced", () => {
    const replace = signed({
      action: "replace",
      constraintId: "figures",
      text: "Figures only from manifested data, or from a snapshot with a sha256.",
      reason: "snapshots gained manifests",
    })
    const bound = state(undefined, [replace])
    expect(bound.constraints.find((c) => c.id === "figures")?.text).toContain("sha256")
  })

  test("an amendment that changes nothing is surfaced, not silently dropped", () => {
    // A scientist who believes they lifted a constraint and did not must find out here,
    // not at the next refusal.
    const bound = state(undefined, [signed({ action: "retire", constraintId: "no-such-constraint" })])
    expect(bound.ignored).toHaveLength(1)
    expect(bound.ignored[0].reason).toContain("no-such-constraint")
    expect(bound.constraints).toHaveLength(2)
  })
})

describe("nfcore.protocol rendering", () => {
  test("a refusal quotes the request verbatim and names the one legitimate way forward", () => {
    const request = "just swap in the fast caller, we can calibrate later"
    const result = Protocol.check(state(), { request })
    const text = Protocol.renderRefusal(state(), { request }, result)
    expect(text).toContain("REFUSED")
    expect(text).toContain(request)
    expect(text).toContain(CALIBRATION.text)
    expect(text).toContain("--action waive")
    // The unchecked constraint is carried into the refusal rather than hidden by it.
    expect(text).toContain("Not mechanically checked")
    expect(text).toContain(FIGURES.text)
  })

  test("the standing reminder restates what is binding without re-arguing it", () => {
    const text = Protocol.render(state())
    expect(text).toContain("<committed_protocol>")
    expect(text).toContain("BINDING")
    expect(text).toContain(CALIBRATION.text)
    expect(text).toContain("signed amendment")
  })

  test("the report section ships the protocol, every amendment and every refusal", () => {
    const waiver = signed({ scope: "swap in the fast caller" })
    const ledger: Protocol.Ledger = {
      amendments: [waiver],
      refusals: [
        {
          at: "2026-08-05T11:59:00.000Z",
          request: "swap in the fast caller",
          constraintIds: ["calibration"],
          constraintTexts: [CALIBRATION.text],
          outcome: "refused",
        },
      ],
      unreadable: [],
    }
    const text = Protocol.summarize(state(undefined, [waiver]), ledger)
    expect(text).toContain(CALIBRATION.text)
    expect(text).toContain("the reference set is embargoed until October")
    expect(text).toContain("2026-08-05T11:59:00.000Z")
    expect(text).toContain("swap in the fast caller")
    expect(text).toContain("R. Bioinformatica")
  })

  test("an uncommitted campaign says so in the report rather than printing an empty section", () => {
    expect(Protocol.summarize(undefined, Protocol.emptyLedger)).toContain("No protocol was committed")
  })
})

describe("nfcore.protocol parsing", () => {
  test("a constraint spec takes an explicit id or derives one", () => {
    expect(Protocol.parseConstraint("calibration=No tool substitution.", 0)).toEqual({
      id: "calibration",
      text: "No tool substitution.",
    })
    expect(Protocol.parseConstraint("Figures only from manifested data", 0).id).toBe("figures-only-from-manifested-data")
    // A constraint sentence containing "=" must not lose its head to id parsing.
    expect(Protocol.parseConstraint("p = 0.05 is not a threshold for a claim", 0).text).toBe(
      "p = 0.05 is not a threshold for a claim",
    )
  })

  test("unparseable ledger lines are kept as lines, not discarded", () => {
    const lines = Protocol.jsonLines('{"a":1}\nnot json\n\n{"b":2}\n')
    expect(lines).toHaveLength(3)
    expect(lines[1].json).toBeUndefined()
    expect(lines[1].raw).toBe("not json")
  })
})

describe("nfcore.protocol service", () => {
  it.live("a refusal is written to the ledger and survives a session restart", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const protocol = yield* Protocol.Service
        yield* protocol.commit({
          statement: "Catalogue repeat proteins the public databases have missed.",
          constraints: [CALIBRATION, FIGURES],
          committedBy: "R. Bioinformatica",
        })

        const request = "Just swap in the fast caller for tonight's run, we can calibrate later."
        const outcome = yield* protocol.guard({ request })
        expect(outcome.result.refused).toBe(true)
        expect(outcome.refusal).toBeDefined()
        expect(outcome.message).toContain("REFUSED")

        // The ledger is on disk, verbatim, with a timestamp — not in a context window.
        const ledgerPath = path.join(dir, ".bioinformatica", "protocol", "refusals.jsonl")
        const raw = yield* readSafe(ledgerPath)
        expect(raw).toContain(request)
        expect(raw).toContain('"outcome":"refused"')
        expect(outcome.refusal!.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)

        // Now the restart. This line was written by a session that is gone: nothing in
        // this process ever saw it. A ledger held in memory cannot produce it.
        const earlier = {
          at: "2026-07-31T08:00:00.000Z",
          request: "substitute the quick assembler, the validated one is too slow",
          constraintIds: ["calibration"],
          constraintTexts: [CALIBRATION.text],
          outcome: "refused",
        }
        yield* Effect.tryPromise(() => fsNode.appendFile(ledgerPath, JSON.stringify(earlier) + "\n", "utf8"))

        const ledger = yield* protocol.ledger()
        expect(ledger.refusals).toHaveLength(2)
        expect(ledger.refusals[0].request).toBe(request)
        expect(ledger.refusals[1].request).toBe(earlier.request)
        expect(ledger.unreadable).toHaveLength(0)

        // And the report a fresh session would ship carries both.
        const current = yield* protocol.read()
        const report = Protocol.summarize(current, ledger)
        expect(report).toContain(request)
        expect(report).toContain(earlier.request)
      }),
    ),
  )

  it.live("refusals accumulate; recording one never overwrites the last", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const protocol = yield* Protocol.Service
        yield* protocol.commit({ statement: "s", constraints: [CALIBRATION] })
        yield* protocol.guard({ request: "substitute the caller" })
        yield* protocol.guard({ request: "swap in the other aligner" })
        const ledger = yield* protocol.ledger()
        expect(ledger.refusals.map((r) => r.request)).toEqual(["substitute the caller", "swap in the other aligner"])
      }),
    ),
  )

  it.live("proceeding takes a signed amendment; an unsigned one is rejected", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const protocol = yield* Protocol.Service
        yield* protocol.commit({ statement: "s", constraints: [CALIBRATION], committedBy: "R. Bioinformatica" })
        const request = "substitute the fast caller for the validated one"

        expect((yield* protocol.check({ request })).refused).toBe(true)

        // No signature, no amendment. This is the exact override the protocol exists to stop.
        expect(
          yield* tagOf(
            protocol.amend({ action: "waive", constraintId: "calibration", reason: "deadline", signedBy: "  ", scope: request }),
          ),
        ).toBe("Protocol.UnsignedAmendment")
        // A waiver with no scope is a repeal in disguise, so it is rejected too.
        expect(
          yield* tagOf(
            protocol.amend({ action: "waive", constraintId: "calibration", reason: "deadline", signedBy: "R. Bioinformatica" }),
          ),
        ).toBe("Protocol.InvalidAmendment")
        // Still bound.
        expect((yield* protocol.check({ request })).refused).toBe(true)

        yield* protocol.amend({
          action: "waive",
          constraintId: "calibration",
          reason: "the reference set is embargoed until October",
          signedBy: "R. Bioinformatica",
          scope: request,
        })

        expect((yield* protocol.check({ request })).refused).toBe(false)
        // The waiver covers that request and no other.
        expect((yield* protocol.check({ request: "substitute the assembler too" })).refused).toBe(true)

        const ledger = yield* protocol.ledger()
        expect(ledger.amendments).toHaveLength(1)
        expect(ledger.amendments[0].signedBy).toBe("R. Bioinformatica")
      }),
    ),
  )

  it.live("committing twice is refused; the commitment changes only by amendment", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const protocol = yield* Protocol.Service
        yield* protocol.commit({ statement: "first", constraints: [CALIBRATION] })
        expect(yield* tagOf(protocol.commit({ statement: "second", constraints: [] }))).toBe(
          "Protocol.AlreadyCommitted",
        )
        const state = yield* protocol.read()
        expect(state?.statement).toBe("first")
      }),
    ),
  )

  it.live("an unreadable ledger line is reported, not counted as an empty record", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const protocol = yield* Protocol.Service
        yield* protocol.commit({ statement: "s", constraints: [CALIBRATION] })
        yield* protocol.guard({ request: "substitute the caller" })
        const ledgerPath = path.join(dir, ".bioinformatica", "protocol", "refusals.jsonl")
        yield* Effect.tryPromise(() => fsNode.appendFile(ledgerPath, "{ truncated mid-write\n", "utf8"))

        const ledger = yield* protocol.ledger()
        expect(ledger.refusals).toHaveLength(1)
        expect(ledger.unreadable).toHaveLength(1)
        expect(ledger.unreadable[0].raw).toContain("truncated")
        // And the gap is visible to whoever reads the report.
        expect(Protocol.summarize(yield* protocol.read(), ledger)).toContain("could not be read")
      }),
    ),
  )

  it.live("a protocol file that exists but does not decode fails loudly instead of unbinding the campaign", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const target = path.join(dir, ".bioinformatica", "protocol", "protocol.json")
        yield* Effect.tryPromise(() => fsNode.mkdir(path.dirname(target), { recursive: true }))
        yield* Effect.tryPromise(() => fsNode.writeFile(target, "{ half a protoc", "utf8"))
        const protocol = yield* Protocol.Service
        // Returning "no protocol" here would silently release a campaign that was bound.
        expect(yield* tagOf(protocol.read())).toBe("Protocol.LedgerUnreadable")
      }),
    ),
  )

  it.live("nothing is written, and nothing refused, before a protocol is committed", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const protocol = yield* Protocol.Service
        const outcome = yield* protocol.guard({ request: "substitute the fast caller", implicates: ["calibration"] })
        expect(outcome.result.committed).toBe(false)
        expect(outcome.refusal).toBeUndefined()
        expect(yield* readSafe(path.join(dir, ".bioinformatica", "protocol", "refusals.jsonl"))).toBe("")
        expect(yield* protocol.read()).toBeUndefined()
      }),
    ),
  )
})
