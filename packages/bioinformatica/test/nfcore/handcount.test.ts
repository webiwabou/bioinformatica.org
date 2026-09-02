import { describe, expect, test } from "bun:test"
import { HandCount } from "../../src/nfcore/handcount"
import { Effect } from "effect"
import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { HandCount as HandCountNs } from "@/nfcore/handcount"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import fsNode from "fs/promises"
import path from "path"

const svcEnv = LayerNode.compile(LayerNode.group([HandCountNs.node]))
const itSvc = testEffect(svcEnv)


// Hand-labelled turns. These are the ground truth for the classifier: the labels were
// assigned by reading each turn, not by running the classifier and writing down what it
// said. A change that degrades classification drops the agreement rate below the floor
// and fails this file.
//
// No class is a majority here (the largest is 10 of 43), so a classifier that always
// answers the same thing — including one that always answers "other" — scores at most
// 0.20 and cannot pass the 0.90 floor. That is the check that this test is worth
// anything: it fails for a degenerate implementation, not just for a missing one.
const LABELLED: readonly { text: string; expected: HandCount.Class }[] = [
  // --- factual-correction ---
  { text: "That's wrong — nf-core/rnaseq 3.14.0 came out in 2024, not 2022.", expected: "factual-correction" },
  { text: "There is no such pipeline as nf-core/repeatfinder; you made that up.", expected: "factual-correction" },
  { text: "You misremembered the paper: Kajava 2012 is a review, not a database release.", expected: "factual-correction" },
  { text: "The correct accession is P02751, not P02749.", expected: "factual-correction" },
  { text: "Incorrect. RepeatsDB does not annotate predicted models.", expected: "factual-correction" },
  { text: "I don't think that's right — salmon does not need a GTF to quantify.", expected: "factual-correction" },
  { text: "Actually the reference there is GRCh38, not GRCh37.", expected: "factual-correction" },

  // --- rejection ---
  { text: "No, don't run it on the full corpus yet.", expected: "rejection" },
  { text: "Stop — cancel that job before it eats the queue.", expected: "rejection" },
  { text: "Do not push anything to the shared bucket.", expected: "rejection" },
  { text: "Hold off on the alignment step until I have checked the samplesheet.", expected: "rejection" },
  { text: "Nope. Not that pipeline.", expected: "rejection" },
  { text: "I'm rejecting that plan; it commits us to a backend we don't have.", expected: "rejection" },

  // --- approval ---
  { text: "Yes, go ahead and run it.", expected: "approval" },
  { text: "Approved — proceed with the 3.14.0 release.", expected: "approval" },
  { text: "LGTM, ship it.", expected: "approval" },
  { text: "Sounds good, do it.", expected: "approval" },
  { text: "Okay, that works for me.", expected: "approval" },
  { text: "Sure, go for it.", expected: "approval" },

  // --- redirection ---
  { text: "Use salmon instead of STAR for the quantification.", expected: "redirection" },
  { text: "Let's switch to nf-core/sarek — this is a variant-calling question.", expected: "redirection" },
  { text: "Forget the corpus subtraction for now; focus on getting one clean run.", expected: "redirection" },
  { text: "Actually, let's take a different approach: start from the RepeatsDB dump.", expected: "redirection" },
  { text: "Scrap that and start over with the 2024 release.", expected: "redirection" },
  { text: "Rather than screening everything, restrict it to human.", expected: "redirection" },
  { text: "Ok, but use the singularity backend instead.", expected: "redirection" },
  // "there's no rush" trips a weak factual cue; the redirection evidence is far stronger.
  { text: "There's no rush — let's switch to sarek instead of rnaseq.", expected: "redirection" },

  // --- disambiguation ---
  { text: "I meant the second run, the one after the resume.", expected: "disambiguation" },
  { text: "To clarify: paired-end, and the reference build is GRCh38.", expected: "disambiguation" },
  { text: "The second one.", expected: "disambiguation" },
  { text: "Option 2, and use the default resource profile.", expected: "disambiguation" },
  { text: "Both — but I was asking about the human set.", expected: "disambiguation" },
  { text: "Sorry, I was referring to the samplesheet under data/raw.", expected: "disambiguation" },
  { text: "By 'novel' I mean absent from every curated database.", expected: "disambiguation" },
  { text: "To answer your question: they are all human samples.", expected: "disambiguation" },
  // "hold on" and "wait on" trip weak rejection cues that the clarification outweighs.
  { text: "Hold on, I mean the second run, the one after the resume.", expected: "disambiguation" },
  { text: "Wait on that — to clarify, I was asking about the human set.", expected: "disambiguation" },

  // --- other ---
  { text: "Continue.", expected: "other" },
  { text: "Thanks, that is helpful.", expected: "other" },
  { text: "How long will the full run take on this cluster?", expected: "other" },
  { text: "Keep going.", expected: "other" },
  { text: "What does the nextflow -resume flag actually do?", expected: "other" },
  { text: "Ping me when the run finishes.", expected: "other" },
]

const AGREEMENT_FLOOR = 0.9

describe("nfcore.handcount classifier", () => {
  test("agrees with the hand labels", () => {
    const result = HandCount.agreement(LABELLED)
    // Printed so the number is visible in the run, not just asserted.
    console.log(
      `hand-count agreement: ${result.agreed}/${result.total} = ${(result.rate * 100).toFixed(1)}%` +
        (result.mismatches.length
          ? `\n  mismatches:\n${result.mismatches.map((m) => `    [${m.expected} -> ${m.got}] ${m.text}`).join("\n")}`
          : ""),
    )
    expect(result.mismatches).toEqual([])
    expect(result.rate).toBeGreaterThanOrEqual(AGREEMENT_FLOOR)
  })

  test("the labelled set has no majority class, so a constant classifier cannot pass", () => {
    const counts = new Map<string, number>()
    for (const item of LABELLED) counts.set(item.expected, (counts.get(item.expected) ?? 0) + 1)
    const largest = Math.max(...counts.values())
    expect(largest / LABELLED.length).toBeLessThan(AGREEMENT_FLOOR)
  })

  test("is deterministic and stateless across calls", () => {
    // The cue regexes are module-level. A stray `g` flag would make `.test` stateful and
    // classification would depend on the order turns were seen in.
    const once = LABELLED.map((l) => HandCount.classify(l.text))
    const twice = LABELLED.map((l) => HandCount.classify(l.text))
    const reversed = [...LABELLED].reverse().map((l) => HandCount.classify(l.text))
    expect(twice).toEqual(once)
    expect(reversed).toEqual([...once].reverse())
  })

  test("a factual correction wins over a co-occurring refusal", () => {
    // "no" opens a rejection, but the reviewer-relevant fact is that the agent was wrong.
    expect(HandCount.classify("No, that's wrong — the release is 3.14.0.")).toBe("factual-correction")
  })

  test("stronger evidence beats a higher-precedence weak cue", () => {
    // Precedence only breaks ties. "there's no rush" is an idiom that trips a weak
    // factual-correction cue; without the score comparison it would outrank a turn whose
    // actual content is a change of approach, and the ledger would report a correction
    // the human never made.
    // On its own the idiom does trip the weak cue — a known false positive, kept visible.
    expect(HandCount.classifyDetailed("There's no rush.").cues).toContain("fc.nonexistent")
    expect(HandCount.classify("There's no rush.")).toBe("factual-correction")
    // Alongside real redirection evidence it is outranked.
    expect(HandCount.classify("There's no rush — let's switch to sarek instead.")).toBe("redirection")
  })

  test("a redirection wins over an opening pleasantry", () => {
    expect(HandCount.classify("Ok, sounds good, but run sarek instead.")).toBe("redirection")
  })

  test("pasted logs cannot manufacture interventions", () => {
    // A Nextflow failure quoted verbatim contains "No such file" and "not correct". If the
    // classifier scored code blocks, every debugging turn would be logged as the human
    // correcting a fact, and the ledger would be inflated by the agent's own errors.
    const turn = [
      "Here is what the cluster printed:",
      "```",
      "ERROR ~ No such file or directory: /scratch/samplesheet.csv",
      "The value is not correct. Stop.",
      "```",
    ].join("\n")
    expect(HandCount.classify(turn)).toBe("other")
    // Sanity: the same words outside a fence do classify, so the test above is about the
    // fence and not about the words being unrecognised.
    expect(HandCount.classify("The value is not correct.")).toBe("factual-correction")
  })

  test("quoted agent text is not read as the human's own words", () => {
    expect(HandCount.classify("> I will use STAR instead of salmon.\n\nSounds good, go ahead.")).toBe("approval")
  })

  test("a single weak cue is not enough to count as an intervention", () => {
    expect(HandCount.classify("Great.")).toBe("other")
    expect(HandCount.classify("Continue.")).toBe("other")
    expect(HandCount.classify("Great — go ahead.")).toBe("approval")
  })

  test("empty and whitespace turns are other, not a crash", () => {
    expect(HandCount.classify("")).toBe("other")
    expect(HandCount.classify("   \n\t ")).toBe("other")
  })

  test("records the cues behind a label so a disputed count is traceable", () => {
    const detail = HandCount.classifyDetailed("Use salmon instead of STAR.")
    expect(detail.class).toBe("redirection")
    expect(detail.cues).toContain("rd.instead")
    expect(detail.score).toBeGreaterThanOrEqual(HandCount.MIN_SCORE)
  })
})

describe("nfcore.handcount tally", () => {
  const turns = [
    "That's wrong, the release is 3.14.0.",
    "Yes, go ahead.",
    "Use salmon instead.",
    "Continue.",
    "Continue.",
  ]

  test("counts every turn exactly once", () => {
    const t = HandCount.tally(turns)
    expect(t.total).toBe(5)
    const summed = HandCount.CLASSES.reduce((acc, c) => acc + t.counts[c], 0)
    expect(summed).toBe(5)
    expect(t.counts["factual-correction"]).toBe(1)
    expect(t.counts.approval).toBe(1)
    expect(t.counts.redirection).toBe(1)
    expect(t.counts.other).toBe(2)
  })

  test("interventions exclude other", () => {
    const t = HandCount.tally(turns)
    expect(t.interventions).toBe(3)
    expect(t.interventions).toBe(t.total - t.counts.other)
  })

  test("entries keep the turn's position so the ledger reads against the transcript", () => {
    const t = HandCount.tally(turns)
    expect(t.entries.map((e) => e.index)).toEqual([0, 1, 2, 3, 4])
    expect(t.entries[0]!.text).toBe(turns[0]!)
  })

  test("an empty campaign tallies to zero rather than failing", () => {
    const t = HandCount.tally([])
    expect(t.total).toBe(0)
    expect(t.interventions).toBe(0)
    expect(t.counts.other).toBe(0)
  })
})

describe("nfcore.handcount methods paragraph", () => {
  const t = HandCount.tally([
    "That's wrong, the release is 3.14.0.",
    "The correct accession is P02751, not P02749.",
    "Yes, go ahead.",
    "Use salmon instead.",
    "Continue.",
  ])

  test("states the counts a committee would ask for", () => {
    const out = HandCount.methods(t)
    expect(out).toContain("2 factual corrections")
    expect(out).toContain("1 approval")
    expect(out).toContain("1 redirection")
    expect(out).toContain("5 turns")
    expect(out).toContain("4 turns intervened")
  })

  test("says the classifier is a heuristic and not a human or a model", () => {
    const out = HandCount.methods(t)
    expect(out).toContain("heuristic")
    expect(out).toContain("not by a human reviewer and not by a language model")
    expect(out).not.toContain("expert")
  })

  test("refuses to let 'other' read as 'no intervention'", () => {
    // This is the sentence a reader would otherwise supply wrongly on our behalf.
    expect(HandCount.methods(t)).toContain("not that none occurred")
  })

  test("names the frozen taxonomy and the classifier version, so the count is comparable later", () => {
    const out = HandCount.methods(t)
    expect(out).toContain(HandCount.TAXONOMY_VERSION)
    expect(out).toContain(HandCount.CLASSIFIER_VERSION)
  })

  test("points at the per-turn ledger", () => {
    expect(HandCount.methods(t)).toContain(".bioinformatica/handcount.json")
    expect(HandCount.methods(t, { ledger: "audit/handcount.json" })).toContain("audit/handcount.json")
  })

  test("singular and plural counts read correctly", () => {
    const one = HandCount.tally(["That's wrong."])
    const out = HandCount.methods(one)
    expect(out).toContain("1 factual correction (")
    expect(out).toContain("0 redirections")
    expect(out).toContain("The human took 1 turn over the campaign")
  })

  test("optional context is stated when given and omitted when not", () => {
    const bare = HandCount.methods(t)
    expect(bare).not.toContain("taken from")
    const rich = HandCount.methods(t, { agent: "Bioinformatica 0.1.0", objective: "Find uncatalogued repeat proteins.", source: "session ses_7f2a" })
    expect(rich).toContain("Bioinformatica 0.1.0")
    expect(rich).toContain("Find uncatalogued repeat proteins")
    expect(rich).toContain("taken from session ses_7f2a")
  })

  test("a campaign with no interventions is stated honestly, not as autonomy", () => {
    const none = HandCount.tally(["Continue.", "Keep going."])
    const out = HandCount.methods(none)
    expect(out).toContain("0 turns intervened")
    expect(out).toContain("0 factual corrections")
    expect(out).toContain("not that none occurred")
  })
})

describe("nfcore.handcount turn extraction", () => {
  const messages = [
    {
      info: { role: "user" },
      parts: [
        { type: "text", text: "Run rnaseq on the pilot samples." },
        { type: "text", text: "<campaign_objective>Find repeats</campaign_objective>", synthetic: true },
      ],
    },
    {
      info: { role: "assistant" },
      parts: [{ type: "text", text: "That's wrong, I should stop and reject this." }],
    },
    {
      info: { role: "user" },
      parts: [
        { type: "text", text: "No, don't push that." },
        { type: "tool", text: undefined },
      ],
    },
    { info: { role: "user" }, parts: [{ type: "text", text: "   ", synthetic: false }] },
  ]

  test("takes only human turns", () => {
    const turns = HandCount.turnsFromMessages(messages)
    expect(turns).toEqual(["Run rnaseq on the pilot samples.", "No, don't push that."])
    // The assistant's own words must never be counted as a human intervention: that would
    // let the agent inflate the ledger with its own text.
    expect(turns.join(" ")).not.toContain("I should stop")
  })

  test("drops synthetic and injected text so the scientist is not credited with it", () => {
    const turns = HandCount.turnsFromMessages(messages)
    expect(turns.join(" ")).not.toContain("campaign_objective")
  })

  test("strips system reminders that arrive inside a user turn", () => {
    const raw = "Use hg38.\n<system-reminder>The objective is unchanged. Stop and confirm.</system-reminder>"
    expect(HandCount.stripInjected(raw)).toBe("Use hg38.")
    expect(HandCount.classify(HandCount.stripInjected(raw))).not.toBe("rejection")
  })
})

describe("nfcore.handcount ledger record", () => {
  test("the persisted record carries the taxonomy, the counts and the paragraph together", () => {
    const record = HandCount.build(
      { turns: ["That's wrong.", "Continue."], context: { source: "turns.json" } },
      "2026-08-25T00:00:00.000Z",
    )
    expect(record.taxonomy).toBe(HandCount.TAXONOMY_VERSION)
    expect(record.classifier).toBe(HandCount.CLASSIFIER_VERSION)
    expect(record.source).toBe("turns.json")
    expect(record.total).toBe(2)
    expect(record.interventions).toBe(1)
    expect(record.entries).toHaveLength(2)
    expect(record.entries[0]!.class).toBe("factual-correction")
    expect(record.entries[0]!.cues.length).toBeGreaterThan(0)
    // The Methods paragraph travels with the counts; a paragraph that disagreed with the
    // JSON next to it would be worse than no paragraph.
    expect(record.methods).toContain("1 factual correction")
    expect(record.methods).toContain("taken from turns.json")
  })

  test("the ledger is project-local and keyed on the directory", () => {
    expect(HandCount.file("/work/proj")).toBe("/work/proj/.bioinformatica/handcount.json")
    expect(HandCount.file("/work/a")).not.toBe(HandCount.file("/work/b"))
  })
})


// B4 from the review: the pure layer was well covered, the PERSISTENCE layer was not —
// so `.bioinformatica/handcount.json` had never been written by a test, and the ReadResult union
// (the thing the missing/unreadable distinction rides on) had no coverage at all.
describe("nfcore.handcount persistence", () => {
  itSvc.instance("a ledger round-trips through disk", () =>
    Effect.gen(function* () {
      const svc = yield* HandCountNs.Service
      const before = yield* svc.read()
      expect(before.status).toBe("missing")

      const turns = ["no, the release is 3.19.0 not 3.20.0", "go ahead", "actually use sarek instead"]
      yield* svc.count({ turns })

      const after = yield* svc.read()
      expect(after.status).toBe("ok")
      if (after.status === "ok") {
        expect(after.record.total).toBe(3)
        expect(after.record.counts["factual-correction"]).toBeGreaterThanOrEqual(1)
      }
    }),
  )

  itSvc.instance("a ledger that exists but cannot be stat'd is NOT reported as missing", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const svc = yield* HandCountNs.Service
      yield* svc.count({ turns: ["go ahead"] })

      // The bug this guards against is specific: FSUtil.existsSafe turns ANY stat failure
      // into `false`, so a pre-check would report `missing` — which readers take as "no
      // interventions were recorded" — for a ledger that is merely unreachable.
      //
      // Corrupting the file's CONTENT does not exercise it: the file still stats fine and
      // the JSON parse fails either way. What does exercise it is making the PARENT
      // directory non-searchable, so stat itself fails while the file is still there.
      const dir = path.join(instance.directory, ".bioinformatica")
      yield* Effect.promise(() => fsNode.chmod(dir, 0o000))
      const result = yield* (yield* HandCountNs.Service)
        .read()
        .pipe(Effect.ensuring(Effect.promise(() => fsNode.chmod(dir, 0o755))))

      expect(result.status).not.toBe("missing")
      expect(result.status).toBe("unreadable")
    }),
  )
})
