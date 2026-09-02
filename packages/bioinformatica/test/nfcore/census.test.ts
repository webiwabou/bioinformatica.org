import { describe, expect, test } from "bun:test"
import fsNode from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { CrossSpawnSpawner } from "@bioinformatica/core/cross-spawn-spawner"
import { Census } from "@/nfcore/census"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const env = LayerNode.compile(LayerNode.group([Census.node, CrossSpawnSpawner.node]))
const it = testEffect(env)

// Realistic fixture: an nf-core demo run over four declared samples where two never
// finish. SAMPLE3 clears FASTQC and TRIMGALORE and then stops appearing — the join
// signature. SAMPLE4 never appears at all. Nothing in the trace is marked FAILED, the
// run exits cleanly, and MULTIQC still produces a report; only the per-sample census
// can say who is missing and where.

const HEADER = ["task_id", "hash", "native_id", "name", "status", "exit", "submit", "duration", "realtime", "%cpu", "peak_rss"]

const row = (taskId: number, name: string, status = "COMPLETED", exit = "0") =>
  [
    String(taskId),
    `${taskId.toString(16).padStart(2, "0")}/abc${taskId}`,
    String(1000 + taskId),
    name,
    status,
    exit,
    `2026-08-25 10:0${taskId % 10}:00`,
    "1.2s",
    "1.1s",
    "98.4%",
    "1.2 GB",
  ].join("\t")

const traceText = (rows: readonly string[]) => [HEADER.join("\t"), ...rows].join("\n") + "\n"

const FASTQC = "NFCORE_DEMO:DEMO:FASTQC"
const TRIM = "NFCORE_DEMO:DEMO:TRIMGALORE"
const ALIGN = "NFCORE_DEMO:DEMO:ALIGN"
const MULTIQC = "NFCORE_DEMO:DEMO:MULTIQC"

const SAMPLESHEET = [
  "sample,fastq_1,fastq_2",
  "SAMPLE1,s1_L1_R1.fastq.gz,s1_L1_R2.fastq.gz",
  "SAMPLE1,s1_L2_R1.fastq.gz,s1_L2_R2.fastq.gz",
  "SAMPLE2,s2_R1.fastq.gz,s2_R2.fastq.gz",
  "SAMPLE3,s3_R1.fastq.gz,s3_R2.fastq.gz",
  "SAMPLE4,s4_R1.fastq.gz,s4_R2.fastq.gz",
].join("\n")

const TRACE = traceText([
  row(1, `${FASTQC} (SAMPLE1_PE)`),
  row(2, `${FASTQC} (SAMPLE2_PE)`),
  row(3, `${FASTQC} (SAMPLE3_PE)`),
  row(4, `${TRIM} (SAMPLE1_PE)`),
  row(5, `${TRIM} (SAMPLE2_PE)`),
  row(6, `${TRIM} (SAMPLE3_PE)`),
  row(7, `${ALIGN} (SAMPLE1_PE)`),
  row(8, `${ALIGN} (SAMPLE2_PE)`),
  row(9, MULTIQC),
])

function report(sheet = SAMPLESHEET, trace = TRACE) {
  const parsed = Census.parseSamplesheet(sheet)
  if (!parsed.ok) throw new Error(parsed.problem)
  const tasks = Census.parseTrace(trace)
  if (!tasks.ok) throw new Error(tasks.problem)
  return Census.census(parsed.ids, tasks.tasks)
}

describe("nfcore.census parseSamplesheet", () => {
  test("finds the id column by header name, not by position", () => {
    // A positional read of column 0 here returns fastq paths as sample ids, and every
    // one of them then fails to match the trace.
    const parsed = Census.parseSamplesheet("fastq_1,fastq_2,sample\ns1_R1.fq.gz,s1_R2.fq.gz,SAMPLE1")
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.idColumn).toBe("sample")
    expect(parsed.ids).toEqual(["SAMPLE1"])
  })

  test("accepts the other names pipelines use for the id column", () => {
    for (const header of ["sample_id", "sampleID", "id"]) {
      const parsed = Census.parseSamplesheet(`${header},fastq_1\nSAMPLE1,s1.fq.gz`)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.ids).toEqual(["SAMPLE1"])
    }
  })

  test("N is distinct samples, not rows: a multi-lane sample is one sample", () => {
    const parsed = report()
    expect(parsed.declared).toBe(4)
    const sheet = Census.parseSamplesheet(SAMPLESHEET)
    expect(sheet.ok).toBe(true)
    if (!sheet.ok) return
    expect(sheet.rows).toBe(5)
    expect(sheet.duplicates).toEqual(["SAMPLE1"])
  })

  test("a sheet with no id column is a stated failure, never an empty cohort", () => {
    // The dangerous alternative is returning zero ids: a census of zero samples
    // reports nobody missing, which reads as a clean run.
    const parsed = Census.parseSamplesheet("fastq_1,fastq_2\ns1_R1.fq.gz,s1_R2.fq.gz")
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.problem).toContain("no sample id column")
    expect(parsed.problem).toContain("fastq_1")
  })

  test("quoted fields with commas do not shift the column", () => {
    const parsed = Census.parseSamplesheet('sample,notes\nSAMPLE1,"batch 2, re-sequenced"\nSAMPLE2,fine')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.ids).toEqual(["SAMPLE1", "SAMPLE2"])
  })

  test("rows with an empty id are counted, not silently dropped", () => {
    const parsed = Census.parseSamplesheet("sample,fastq_1\nSAMPLE1,a.fq.gz\n,b.fq.gz")
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.ids).toEqual(["SAMPLE1"])
      expect(parsed.blankRows).toBe(1)
    }
  })
})

describe("nfcore.census parseTrace", () => {
  test("reads columns by header name and splits the parenthesised tag off the process", () => {
    const parsed = Census.parseTrace(TRACE)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.tasks).toHaveLength(9)
    expect(parsed.tasks[0].process).toBe(FASTQC)
    expect(parsed.tasks[0].tag).toBe("SAMPLE1_PE")
    expect(parsed.tasks[0].status).toBe("COMPLETED")
    // MULTIQC runs once for the cohort and carries no tag at all.
    expect(parsed.tasks[8].process).toBe(MULTIQC)
    expect(parsed.tasks[8].tag).toBeUndefined()
  })

  test("a header without the columns it needs is a stated failure, not zero tasks", () => {
    const parsed = Census.parseTrace("task_id\thash\tduration\n1\tab/1234\t1.2s")
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.problem).toContain("'name'")
  })

  test("truncated lines are counted rather than parsed into half a task", () => {
    const parsed = Census.parseTrace(traceText([row(1, `${FASTQC} (SAMPLE1)`), "2\tab/12"]))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.tasks).toHaveLength(1)
      expect(parsed.malformed).toBe(1)
    }
  })

  test("picks the newest execution trace, so a -resume run is not censused from the old one", () => {
    expect(
      Census.pickLatestTrace([
        "execution_trace_2026-08-24_09-00-00.txt",
        "execution_report_2026-08-25_11-00-00.html",
        "execution_trace_2026-08-25_11-00-00.txt",
      ]),
    ).toBe("execution_trace_2026-08-25_11-00-00.txt")
    expect(Census.pickLatestTrace(["software_versions.yml"])).toBeUndefined()
  })
})

describe("nfcore.census matchTag", () => {
  test("a meta-id suffix still identifies the sample", () => {
    expect(Census.matchTag("SAMPLE1_PE", ["SAMPLE1", "SAMPLE2"]).ids).toEqual(["SAMPLE1"])
  })

  test("SAMPLE1 does not claim SAMPLE10's tasks", () => {
    // A substring match would attribute SAMPLE10's tasks to SAMPLE1, which both hides
    // SAMPLE10's disappearance and double-counts SAMPLE1.
    expect(Census.matchTag("SAMPLE10_PE", ["SAMPLE1", "SAMPLE10"]).ids).toEqual(["SAMPLE10"])
    expect(Census.matchTag("SAMPLE10", ["SAMPLE1"]).ids).toEqual([])
  })

  test("the more specific id wins when both explain the same part of the tag", () => {
    expect(Census.matchTag("SAMPLE1_L1_PE", ["SAMPLE1", "SAMPLE1_L1"]).ids).toEqual(["SAMPLE1_L1"])
  })

  test("a tag naming two samples credits both", () => {
    // Sarek names its variant-calling tasks after the pair. Crediting only the tumour
    // would report the normal as having stopped at the previous process on every run.
    const match = Census.matchTag("TUMOUR1_vs_NORMAL1", ["TUMOUR1", "NORMAL1"])
    expect(match.ids).toEqual(["TUMOUR1", "NORMAL1"])
    expect(match.ambiguous).toEqual([])
  })

  test("a numeric tag is a task index and identifies no sample", () => {
    expect(Census.isIndexTag("3")).toBe(true)
    expect(Census.matchTag("3", ["1", "3"]).ids).toEqual([])
  })

  test("an id longer than the tag does not match it", () => {
    expect(Census.matchTag("A_B", ["A_B_C", "X"]).ids).toEqual([])
  })

  test("ids that differ only by separator are ambiguous, and neither is credited", () => {
    const match = Census.matchTag("SAMPLE_1_PE", ["SAMPLE-1", "SAMPLE_1"])
    expect(match.ids).toEqual([])
    expect([...match.ambiguous].sort()).toEqual(["SAMPLE-1", "SAMPLE_1"])
  })
})

describe("nfcore.census attribution", () => {
  test("declared N in, per-stage headcount out", () => {
    const r = report()
    expect(r.declared).toBe(4)
    expect(r.observed).toBe(3)
    expect(r.stages.map((s) => [s.process, s.count])).toEqual([
      [FASTQC, 3],
      [TRIM, 3],
      [ALIGN, 2],
    ])
    expect(r.stages[2].missing).toEqual(["SAMPLE3", "SAMPLE4"])
    expect(r.deepestStage).toBe(ALIGN)
    expect(r.deepestCount).toBe(2)
    expect(r.complete).toBe(false)
  })

  test("names the dropped sample AND the last process that saw it", () => {
    // A count-only census reports "2 of 4" and stops, which is what MultiQC already
    // showed. Naming TRIMGALORE is what sends the scientist to the right join.
    const r = report()
    const dropped = r.attrition.find((a) => a.id === "SAMPLE3")
    expect(dropped).toBeDefined()
    expect(dropped!.reason).toBe("dropped_after")
    expect(dropped!.lastProcess).toBe(TRIM)
    expect(dropped!.lastStatus).toBe("COMPLETED")
    // Not the deepest stage it never reached, and not the aggregation step that ran after.
    expect(dropped!.lastProcess).not.toBe(ALIGN)
    expect(dropped!.lastProcess).not.toBe(MULTIQC)
  })

  test("a sample absent from the whole trace is named as never having entered", () => {
    const r = report()
    const missing = r.attrition.find((a) => a.id === "SAMPLE4")
    expect(missing).toBeDefined()
    expect(missing!.reason).toBe("never_entered")
    expect(missing!.lastProcess).toBeUndefined()
    expect(r.samples.find((s) => s.id === "SAMPLE4")!.tasks).toBe(0)
  })

  test("samples that finished are not reported as attrition", () => {
    const r = report()
    expect(r.attrition.map((a) => a.id).sort()).toEqual(["SAMPLE3", "SAMPLE4"])
    expect(r.samples.find((s) => s.id === "SAMPLE1")!.processes).toEqual([FASTQC, TRIM, ALIGN])
  })

  test("an untagged aggregation step is never blamed for a drop", () => {
    // MULTIQC carries no sample tag, so every sample is "missing" from it — true of the
    // survivors too, and therefore evidence about nobody. Attributing attrition there
    // would name the wrong process every time, and it is exactly the process whose
    // report looked healthy.
    const r = report()
    expect(r.stages.map((s) => s.process)).not.toContain(MULTIQC)
    expect(r.aggregations.map((a) => a.process)).toEqual([MULTIQC])
    expect(r.attrition.map((a) => a.lastProcess)).not.toContain(MULTIQC)
    expect(Census.format(r)).toContain("proves nothing")
  })

  test("tasks numbered by index are not read as sample evidence", () => {
    const r = report(
      SAMPLESHEET,
      traceText([
        row(1, `${FASTQC} (SAMPLE1_PE)`),
        row(2, `${FASTQC} (SAMPLE2_PE)`),
        row(3, `${FASTQC} (SAMPLE3_PE)`),
        row(4, `${FASTQC} (SAMPLE4_PE)`),
        row(5, `${ALIGN} (1)`),
        row(6, `${ALIGN} (2)`),
      ]),
    )
    expect(r.stages.map((s) => s.process)).toEqual([FASTQC])
    expect(r.aggregations.map((a) => [a.process, a.indexedTasks])).toEqual([[ALIGN, 2]])
    // Everyone reached the deepest stage that can actually be measured, so nothing is
    // reported as dropped on the strength of an unmeasurable one.
    expect(r.attrition).toEqual([])
  })

  test("a trace with no per-sample tag anywhere says so instead of condemning everyone", () => {
    // Every process ran without a `tag` directive. There is no evidence any sample was
    // lost — and none that any survived. Reporting four `never_entered` samples here
    // would be a confident claim built on the absence of evidence.
    const r = report(SAMPLESHEET, traceText([row(1, `${FASTQC} (1)`), row(2, `${FASTQC} (2)`), row(3, MULTIQC)]))
    expect(r.measurable).toBe(false)
    expect(r.attrition).toEqual([])
    expect(r.complete).toBe(false)
    const text = Census.format(r)
    expect(text).not.toContain("No attrition")
    expect(text).toContain("no headcount can be taken")
  })

  test("a failed task is attributed as a failure, not as a silent drop", () => {
    const r = report(
      SAMPLESHEET,
      traceText([
        row(1, `${FASTQC} (SAMPLE1_PE)`),
        row(2, `${FASTQC} (SAMPLE2_PE)`),
        row(3, `${FASTQC} (SAMPLE3_PE)`),
        row(4, `${FASTQC} (SAMPLE4_PE)`, "FAILED", "1"),
        row(5, `${ALIGN} (SAMPLE1_PE)`),
        row(6, `${ALIGN} (SAMPLE2_PE)`),
        row(7, `${ALIGN} (SAMPLE3_PE)`),
      ]),
    )
    const failed = r.attrition.find((a) => a.id === "SAMPLE4")
    expect(failed!.reason).toBe("failed")
    expect(failed!.lastProcess).toBe(FASTQC)
    expect(failed!.lastStatus).toBe("FAILED")
    expect(r.stages[0].failed).toEqual(["SAMPLE4"])
  })

  test("CACHED counts as having been seen, so -resume does not invent attrition", () => {
    const r = report(
      SAMPLESHEET,
      traceText([
        row(1, `${FASTQC} (SAMPLE1_PE)`, "CACHED", "-"),
        row(2, `${FASTQC} (SAMPLE2_PE)`, "CACHED", "-"),
        row(3, `${FASTQC} (SAMPLE3_PE)`, "CACHED", "-"),
        row(4, `${FASTQC} (SAMPLE4_PE)`, "CACHED", "-"),
      ]),
    )
    expect(r.attrition).toEqual([])
    expect(r.observed).toBe(4)
  })

  test("a run still in flight is said to be in flight, not declared a loss", () => {
    const r = report(
      SAMPLESHEET,
      traceText([
        row(1, `${FASTQC} (SAMPLE1_PE)`),
        row(2, `${FASTQC} (SAMPLE2_PE)`),
        row(3, `${FASTQC} (SAMPLE3_PE)`),
        row(4, `${FASTQC} (SAMPLE4_PE)`, "RUNNING", "-"),
        row(5, `${ALIGN} (SAMPLE1_PE)`),
        row(6, `${ALIGN} (SAMPLE2_PE)`),
        row(7, `${ALIGN} (SAMPLE3_PE)`),
      ]),
    )
    expect(r.attrition.find((a) => a.id === "SAMPLE4")!.reason).toBe("in_flight")
    expect(r.notes.some((n) => n.includes("run in progress"))).toBe(true)
  })

  test("a trace tag matching no declared sample is reported as a disagreement", () => {
    const r = report(
      "sample,fastq_1\nSAMPLE1,a.fq.gz",
      traceText([row(1, `${FASTQC} (SAMPLE1)`), row(2, `${FASTQC} (SAMPLE9)`)]),
    )
    expect(r.unexpected).toEqual(["SAMPLE9"])
    expect(r.notes.some((n) => n.includes("SAMPLE9"))).toBe(true)
  })

  test("stage order comes from submission order, not from the order tasks finished", () => {
    // The trace is written as tasks complete, so a fast downstream task lands above a
    // slow upstream one. Reading file order would call ALIGN the first stage and then
    // report the last process that saw SAMPLE2 as FASTQC.
    const r = report(
      "sample,fastq_1\nSAMPLE1,a.fq.gz\nSAMPLE2,b.fq.gz",
      traceText([
        row(3, `${ALIGN} (SAMPLE1_PE)`),
        row(1, `${FASTQC} (SAMPLE1_PE)`),
        row(2, `${FASTQC} (SAMPLE2_PE)`),
      ]),
    )
    expect(r.stages.map((s) => s.process)).toEqual([FASTQC, ALIGN])
    expect(r.attrition.find((a) => a.id === "SAMPLE2")!.lastProcess).toBe(FASTQC)
  })
})

describe("nfcore.census format", () => {
  test("puts the sample, the stage counts and the guilty process in the text", () => {
    const text = Census.format(report())
    expect(text).toContain("4 declared")
    expect(text).toContain(`${TRIM}`)
    expect(text).toContain("SAMPLE3")
    expect(text).toContain("SAMPLE4")
    expect(text).toContain("never entered")
    // The headcount line for the deepest stage names who is missing from it.
    expect(text).toMatch(/ALIGN\s+2\/4\s+missing: SAMPLE3, SAMPLE4/)
  })

  test("a clean run says so without inventing attrition", () => {
    const text = Census.format(
      report("sample,fastq_1\nSAMPLE1,a.fq.gz", traceText([row(1, `${FASTQC} (SAMPLE1)`), row(2, MULTIQC)])),
    )
    expect(text).toContain("No attrition")
  })
})

describe("nfcore.census service", () => {
  it.live("censuses a run from its outdir and names where each sample was last seen", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const info = path.join(dir, "results", "pipeline_info")
        yield* Effect.promise(() => fsNode.mkdir(info, { recursive: true }))
        yield* Effect.promise(() => fsNode.writeFile(path.join(dir, "samplesheet.csv"), SAMPLESHEET))
        // An earlier, smaller trace from before a -resume. Censusing this one would
        // report attrition the later run already resolved.
        yield* Effect.promise(() =>
          fsNode.writeFile(
            path.join(info, "execution_trace_2026-08-24_09-00-00.txt"),
            traceText([row(1, `${FASTQC} (SAMPLE1_PE)`)]),
          ),
        )
        yield* Effect.promise(() => fsNode.writeFile(path.join(info, "execution_trace_2026-08-25_11-00-00.txt"), TRACE))

        const census = yield* Census.Service
        expect(yield* census.locateTrace("results")).toBe(path.join(info, "execution_trace_2026-08-25_11-00-00.txt"))

        const report = yield* census.of({ samplesheet: "samplesheet.csv", outdir: "results" })
        expect(report.declared).toBe(4)
        expect(report.deepestCount).toBe(2)
        const dropped = report.attrition.find((a) => a.id === "SAMPLE3")
        expect(dropped!.lastProcess).toBe(TRIM)
        expect(report.attrition.find((a) => a.id === "SAMPLE4")!.reason).toBe("never_entered")
        // The multi-row sample is stated, not silently folded into the headcount.
        expect(report.notes.some((n) => n.includes("SAMPLE1"))).toBe(true)
      }),
    ),
  )

  it.live("a missing input fails loudly instead of censusing an empty cohort", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const census = yield* Census.Service
        const outcome = yield* census.of({ samplesheet: "absent.csv", trace: "absent.txt" }).pipe(Effect.result)
        // A silent fallback here would report "0 declared, 0 missing" — a clean bill of
        // health for a census that never ran.
        expect(outcome._tag).toBe("Failure")
        if (outcome._tag !== "Failure") return
        expect(outcome.failure.message).toContain("Cannot take a sample census")
        expect(outcome.failure.path).toBe(path.join(dir, "absent.csv"))
      }),
    ),
  )

  it.live("a trace directory with no execution trace is named as such", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fsNode.mkdir(path.join(dir, "results", "pipeline_info"), { recursive: true }))
        const census = yield* Census.Service
        const outcome = yield* census.locateTrace("results").pipe(Effect.result)
        expect(outcome._tag).toBe("Failure")
        if (outcome._tag !== "Failure") return
        expect(outcome.failure.problem).toContain("no execution_trace_")
      }),
    ),
  )
})
