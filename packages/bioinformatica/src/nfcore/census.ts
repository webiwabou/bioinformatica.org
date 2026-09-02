export * as Census from "./census"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { Context, Effect, Layer, Schema } from "effect"
import path from "path"

// Sample census: how many samples went in, how many survived each stage, and — for
// every sample that did not finish — the last process that saw it.
//
// The failure this exists to catch: Nextflow's `join` operator drops unmatched keys
// silently unless the pipeline passes `failOnMismatch`/`remainder`. A sample whose
// key does not match on one side simply stops existing in that channel. Nothing
// errors, the run exits 0, and MultiQC renders a healthy report — of a smaller
// cohort. The scientist reads a study of 38 samples believing it covers 40.
//
// A count alone does not help: the count is exactly what MultiQC already shows, and
// it is exactly what looks fine. What is needed is attribution — this sample, that
// process, that status — which is why every declared id is tracked individually and
// why an id with no trace evidence is reported by name rather than absorbed into a
// difference of two numbers.
//
// Everything up to `census()` is pure: text in, data out. The service only reads the
// two files off disk.

const SEP = /[_\-.]/

// -------------------------------------------------------------------------------------
// Samplesheet
// -------------------------------------------------------------------------------------

export interface SamplesheetCensus {
  readonly ok: true
  /** The header column the ids were read from, so the caller can check we picked the right one. */
  readonly idColumn: string
  readonly columns: readonly string[]
  /** Distinct declared sample ids, in samplesheet order. This is N. */
  readonly ids: readonly string[]
  /** Data rows, which is NOT N: nf-core sheets carry one row per fastq pair/lane. */
  readonly rows: number
  /** Ids appearing on more than one row (legitimate for multi-run samples; worth stating). */
  readonly duplicates: readonly string[]
  /** Rows whose id cell was empty or missing — declared nothing, so they cannot be tracked. */
  readonly blankRows: number
}

export interface ParseProblem {
  readonly ok: false
  readonly problem: string
}

export type SamplesheetParse = SamplesheetCensus | ParseProblem

/**
 * Header names that carry the sample identity, most specific first. nf-core pipelines
 * are not consistent here (`sample` in rnaseq, `sample`/`patient` in sarek, `id` in a
 * few community pipelines), which is why the column is found by name rather than by
 * position — a positional guess silently reads the fastq path column on any pipeline
 * that orders its sheet differently, and every id then fails to match the trace.
 */
const ID_COLUMNS = ["sample", "sampleid", "samplename", "id", "name"]

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "")

/** One CSV line into fields, honouring double-quoted fields and "" escapes. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else quoted = false
      } else current += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") {
      fields.push(current)
      current = ""
    } else current += ch
  }
  fields.push(current)
  return fields.map((f) => f.trim())
}

export function parseSamplesheet(text: string): SamplesheetParse {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0 && !l.startsWith("#"))
  if (lines.length === 0) return { ok: false, problem: "the samplesheet is empty" }

  const columns = splitCsvLine(lines[0])
  const normalized = columns.map(normalizeHeader)
  let index = -1
  for (const candidate of ID_COLUMNS) {
    const found = normalized.indexOf(candidate)
    if (found !== -1) {
      index = found
      break
    }
  }
  // No id column is a hard failure, never an empty cohort. Returning zero declared
  // samples here would make the census report "0 in, 0 out — nothing lost", which is
  // the one answer that is always reassuring and never true.
  if (index === -1) {
    return {
      ok: false,
      problem: `no sample id column in the header (looked for ${ID_COLUMNS.join(", ")}); columns are: ${columns.join(", ")}`,
    }
  }

  const seen = new Map<string, number>()
  const ids: string[] = []
  let blankRows = 0
  for (const line of lines.slice(1)) {
    const value = splitCsvLine(line)[index]?.trim() ?? ""
    if (value.length === 0) {
      blankRows++
      continue
    }
    const count = seen.get(value) ?? 0
    seen.set(value, count + 1)
    if (count === 0) ids.push(value)
  }

  return {
    ok: true,
    idColumn: columns[index],
    columns,
    ids,
    rows: lines.length - 1,
    duplicates: ids.filter((id) => (seen.get(id) ?? 0) > 1),
    blankRows,
  }
}

// -------------------------------------------------------------------------------------
// Execution trace
// -------------------------------------------------------------------------------------

export interface Task {
  readonly taskId: string
  /** The raw `name` field, e.g. `NFCORE_DEMO:DEMO:FASTQC (SAMPLE1_PE)`. */
  readonly name: string
  /** The name with the parenthesised tag removed: the fully-qualified process. */
  readonly process: string
  /** The parenthesised tag, absent when the process emits no per-task name. */
  readonly tag?: string
  readonly status: string
  readonly exit?: string
  readonly hash?: string
}

export interface TraceCensus {
  readonly ok: true
  readonly tasks: readonly Task[]
  readonly columns: readonly string[]
  /** Lines with fewer fields than the header — a truncated or mangled trace. */
  readonly malformed: number
}

export type TraceParse = TraceCensus | ParseProblem

const SUCCEEDED = new Set(["COMPLETED", "CACHED"])
const IN_FLIGHT = new Set(["SUBMITTED", "RUNNING", "NEW", "PENDING"])

export const succeeded = (status: string) => SUCCEEDED.has(status.toUpperCase())
export const inFlight = (status: string) => IN_FLIGHT.has(status.toUpperCase())

/** Split `PROCESS (tag)` into its parts. A name with no parentheses has no tag. */
export function splitTaskName(name: string): { process: string; tag?: string } {
  const match = name.trim().match(/^(.*?)\s*\(([^()]*)\)$/)
  if (!match) return { process: name.trim() }
  const tag = match[2].trim()
  return tag.length === 0 ? { process: match[1].trim() } : { process: match[1].trim(), tag }
}

/**
 * A tag that is only digits is Nextflow's fallback task index, used when a process
 * declares no `tag` directive. It identifies the task, not the sample, so it must not
 * be matched against sample ids — `FASTQC (3)` is not evidence about a sample called 3.
 */
export const isIndexTag = (tag: string) => /^\d+$/.test(tag)

export function parseTrace(text: string): TraceParse {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { ok: false, problem: "the execution trace is empty" }

  const columns = lines[0].split("\t").map((c) => c.trim().toLowerCase())
  const nameAt = columns.indexOf("name")
  const statusAt = columns.indexOf("status")
  // Trace columns are configurable through `trace.fields`, so they are read by name.
  // Without `name` there is no sample tag anywhere in the file and no census is
  // possible; saying so beats reporting a cohort of zero.
  if (nameAt === -1 || statusAt === -1) {
    return {
      ok: false,
      problem: `the trace header has no ${nameAt === -1 ? "'name'" : "'status'"} column (found: ${columns.join(", ")}). Expected a tab-separated Nextflow execution trace.`,
    }
  }
  const taskAt = columns.indexOf("task_id")
  const exitAt = columns.indexOf("exit")
  const hashAt = columns.indexOf("hash")

  const tasks: Task[] = []
  let malformed = 0
  for (const line of lines.slice(1)) {
    const fields = line.split("\t")
    if (fields.length <= Math.max(nameAt, statusAt)) {
      malformed++
      continue
    }
    const name = fields[nameAt].trim()
    const { process, tag } = splitTaskName(name)
    tasks.push({
      taskId: taskAt === -1 ? String(tasks.length + 1) : (fields[taskAt]?.trim() ?? ""),
      name,
      process,
      ...(tag ? { tag } : {}),
      status: fields[statusAt].trim().toUpperCase(),
      ...(exitAt !== -1 && fields[exitAt] !== undefined ? { exit: fields[exitAt].trim() } : {}),
      ...(hashAt !== -1 && fields[hashAt] !== undefined ? { hash: fields[hashAt].trim() } : {}),
    })
  }

  return { ok: true, tasks, columns, malformed }
}

/**
 * The newest `execution_trace_*.txt` in a `pipeline_info/` listing. Nextflow stamps
 * these `YYYY-MM-DD_HH-MM-SS`, which sorts chronologically as text; a resumed run
 * leaves the older ones in place, and censusing the wrong one reports attrition that
 * a later run already fixed.
 */
export function pickLatestTrace(names: readonly string[]): string | undefined {
  const traces = names.filter((n) => /^execution_trace_.*\.txt$/.test(n)).sort()
  return traces[traces.length - 1]
}

// -------------------------------------------------------------------------------------
// Matching a trace tag back to a declared sample
// -------------------------------------------------------------------------------------

export interface TagMatch {
  /**
   * Declared ids this tag names. Usually one; more than one when a process names a task
   * after several samples at once, as a tumour/normal variant caller does.
   */
  readonly ids: readonly string[]
  /** Ids that fit the same piece of the tag equally well; nothing was attributed to them. */
  readonly ambiguous: readonly string[]
}

const parts = (value: string) =>
  value
    .toLowerCase()
    .split(SEP)
    .filter((p) => p.length > 0)

/** Earliest position where an id's parts occur as a contiguous run in the tag's parts. */
function alignment(tagParts: readonly string[], idParts: readonly string[]): number | undefined {
  if (idParts.length === 0 || idParts.length > tagParts.length) return undefined
  for (let start = 0; start + idParts.length <= tagParts.length; start++) {
    if (idParts.every((p, i) => tagParts[start + i] === p)) return start
  }
  return undefined
}

/**
 * Match a trace tag to the declared samples it names. nf-core meta ids are usually the
 * sample id with a suffix (`SAMPLE1_PE`, `SAMPLE1_T1`), and joint processes name both
 * members of a pair, so the match is on whole separator-delimited parts rather than on
 * substrings, and every sample the tag names is returned.
 *
 * Two rules earn their keep. Matching whole parts stops SAMPLE1 claiming SAMPLE10's
 * tasks — a substring match would hide SAMPLE10's disappearance and count SAMPLE1
 * twice. Returning every disjoint match stops a paired task being credited to one
 * member, which would report the other as having stopped a process earlier on every
 * tumour/normal run.
 *
 * Where two ids cover the same parts of the tag, the longer one wins: it explains more
 * of the tag, so SAMPLE1_L1 beats SAMPLE1 instead of the two contradicting each other.
 * Only ids that are indistinguishable once separators and case are normalised count as
 * ambiguous, and then nothing is attributed — a wrong attribution is worse than a
 * reported gap, because the census is worth having only if its names can be trusted.
 */
export function matchTag(tag: string, ids: readonly string[]): TagMatch {
  if (isIndexTag(tag)) return { ids: [], ambiguous: [] }
  const exact = ids.find((id) => id === tag) ?? ids.find((id) => id.toLowerCase() === tag.toLowerCase())
  if (exact !== undefined) return { ids: [exact], ambiguous: [] }

  const tagParts = parts(tag)
  const groups = new Map<string, { start: number; length: number; ids: string[] }>()
  for (const id of ids) {
    const idParts = parts(id)
    const start = alignment(tagParts, idParts)
    if (start === undefined) continue
    const key = `${start}:${idParts.length}`
    const group = groups.get(key) ?? { start, length: idParts.length, ids: [] }
    group.ids.push(id)
    groups.set(key, group)
  }

  const ambiguous: string[] = []
  const usable = [...groups.values()].filter((group) => {
    if (group.ids.length === 1) return true
    ambiguous.push(...group.ids)
    return false
  })
  // Longest first: a more specific id gets to claim the parts it explains before a
  // shorter one that is only a prefix of the same thing.
  usable.sort((a, b) => b.length - a.length || a.start - b.start)

  const matched: { id: string; start: number }[] = []
  const taken: { start: number; end: number }[] = []
  for (const group of usable) {
    const end = group.start + group.length
    if (taken.some((t) => group.start < t.end && t.start < end)) continue
    taken.push({ start: group.start, end })
    matched.push({ id: group.ids[0], start: group.start })
  }
  matched.sort((a, b) => a.start - b.start)
  return { ids: matched.map((m) => m.id), ambiguous }
}

// -------------------------------------------------------------------------------------
// The census
// -------------------------------------------------------------------------------------

export interface StageCensus {
  readonly process: string
  /** Position in the run, from the order tasks were submitted. */
  readonly order: number
  readonly tasks: number
  /** Tasks named by index rather than by sample tag — they identify no sample. */
  readonly indexedTasks: number
  /** Tasks with no parenthesised tag at all (aggregation steps). */
  readonly untaggedTasks: number
  /** Declared ids seen here, in declaration order. */
  readonly samples: readonly string[]
  readonly count: number
  readonly missing: readonly string[]
  /** Declared ids whose task here ended other than COMPLETED/CACHED. */
  readonly failed: readonly string[]
  /** Tags at this process that matched no declared id. */
  readonly unmatchedTags: readonly string[]
  /**
   * Whether this process names its tasks per sample. False for aggregation steps and
   * for processes whose tasks are numbered; their headcount says nothing about who
   * survived.
   */
  readonly perSample: boolean
}

export type AttritionReason = "never_entered" | "failed" | "dropped_after" | "in_flight"

export interface Attrition {
  readonly id: string
  readonly reason: AttritionReason
  /** The last per-sample process that has a task for this id. Absent when there is none. */
  readonly lastProcess?: string
  readonly lastStatus?: string
  readonly detail: string
}

export interface SampleTrack {
  readonly id: string
  /** Per-sample processes that touched this id, in run order. */
  readonly processes: readonly string[]
  readonly lastProcess?: string
  readonly lastStatus?: string
  readonly tasks: number
  readonly failedAt: readonly string[]
}

export interface CensusReport {
  /** N: distinct ids the samplesheet declared. */
  readonly declared: number
  /** Distinct declared ids with at least one task in the trace. */
  readonly observed: number
  /**
   * Whether any process in the trace names its tasks after a sample. When false the
   * trace carries no per-sample evidence at all, and the census says so instead of
   * concluding anything about who survived.
   */
  readonly measurable: boolean
  /** The deepest per-sample stage any sample reached, and how many got there. */
  readonly deepestStage?: string
  readonly deepestCount: number
  readonly complete: boolean
  readonly stages: readonly StageCensus[]
  readonly aggregations: readonly StageCensus[]
  readonly samples: readonly SampleTrack[]
  readonly attrition: readonly Attrition[]
  /** Tags in the trace matching no declared id — the samplesheet and the run disagree. */
  readonly unexpected: readonly string[]
  readonly ambiguous: readonly { readonly tag: string; readonly candidates: readonly string[] }[]
  readonly notes: readonly string[]
}

interface Accumulator {
  process: string
  order: number
  tasks: number
  indexedTasks: number
  untaggedTasks: number
  samples: Set<string>
  failed: Set<string>
  unmatchedTags: Set<string>
}

/**
 * Order tasks the way the run produced them. The trace file is written as tasks
 * *finish*, so a fast downstream task can be written before a slow upstream one and
 * a naive read of file order would report the pipeline's stages out of sequence, and
 * with them the wrong "last process that saw it". `task_id` is assigned at submission,
 * and a task cannot be submitted before its inputs exist, so it is the better proxy
 * for position in the pipeline. Falls back to file order when ids are not numeric.
 */
export function inRunOrder(tasks: readonly Task[]): readonly Task[] {
  const numeric = tasks.every((t) => /^\d+$/.test(t.taskId))
  if (!numeric) return tasks
  return [...tasks].sort((a, b) => Number(a.taskId) - Number(b.taskId))
}

export function census(declared: readonly string[], tasks: readonly Task[], warnings: readonly string[] = []): CensusReport {
  const ids = [...new Set(declared)]
  const ordered = inRunOrder(tasks)

  const stages = new Map<string, Accumulator>()
  const unexpected = new Set<string>()
  const ambiguous = new Map<string, readonly string[]>()
  const lastAt = new Map<string, { order: number; process: string; status: string }>()
  const touched = new Map<string, Set<string>>()
  const taskCount = new Map<string, number>()
  let running = 0

  const stageOf = (process: string) => {
    let acc = stages.get(process)
    if (!acc) {
      acc = {
        process,
        order: stages.size + 1,
        tasks: 0,
        indexedTasks: 0,
        untaggedTasks: 0,
        samples: new Set(),
        failed: new Set(),
        unmatchedTags: new Set(),
      }
      stages.set(process, acc)
    }
    return acc
  }

  for (const task of ordered) {
    const acc = stageOf(task.process)
    acc.tasks++
    if (inFlight(task.status)) running++

    if (task.tag === undefined) {
      acc.untaggedTasks++
      continue
    }
    if (isIndexTag(task.tag)) {
      acc.indexedTasks++
      continue
    }
    const match = matchTag(task.tag, ids)
    if (match.ambiguous.length > 0) ambiguous.set(task.tag, match.ambiguous)
    if (match.ids.length === 0) {
      if (match.ambiguous.length === 0) unexpected.add(task.tag)
      acc.unmatchedTags.add(task.tag)
      continue
    }

    for (const id of match.ids) {
      // CACHED counts as "this process saw this sample": on a resumed run the cached
      // task is the same completed work, and treating it as absent would invent
      // attrition on every `-resume`.
      acc.samples.add(id)
      // Nextflow writes BOTH attempts to the trace under errorStrategy 'retry', so a
      // sample that failed once and then succeeded appears twice in this process. Treat
      // the latest outcome as the outcome: a success clears an earlier failure, otherwise
      // `failed` reports a sample as lost at a stage it actually cleared. Tasks arrive in
      // submission order, so the last write wins.
      if (succeeded(task.status)) acc.failed.delete(id)
      else if (!inFlight(task.status)) acc.failed.add(id)
      taskCount.set(id, (taskCount.get(id) ?? 0) + 1)
      let seen = touched.get(id)
      if (!seen) touched.set(id, (seen = new Set()))
      seen.add(task.process)
      const previous = lastAt.get(id)
      if (!previous || acc.order >= previous.order) {
        lastAt.set(id, { order: acc.order, process: task.process, status: task.status })
      }
    }
  }

  const all = [...stages.values()]
  const build = (acc: Accumulator, perSample: boolean): StageCensus => ({
    process: acc.process,
    order: acc.order,
    tasks: acc.tasks,
    indexedTasks: acc.indexedTasks,
    untaggedTasks: acc.untaggedTasks,
    samples: ids.filter((id) => acc.samples.has(id)),
    count: acc.samples.size,
    missing: perSample ? ids.filter((id) => !acc.samples.has(id)) : [],
    failed: ids.filter((id) => acc.failed.has(id)),
    unmatchedTags: [...acc.unmatchedTags],
    perSample,
  })

  // A process is a stage only if it names at least one task after a declared sample.
  // MULTIQC and friends run once over the whole cohort and carry no sample tag, so
  // "sample X is missing from MULTIQC" is true of every sample and evidence about
  // none. Attributing a drop there would name the wrong process every single time —
  // and worse, it would name the very process whose report is the thing that looked
  // healthy.
  const stageList = all.filter((acc) => acc.samples.size > 0).map((acc) => build(acc, true))
  const aggregations = all.filter((acc) => acc.samples.size === 0).map((acc) => build(acc, false))

  const deepest = stageList.reduce<StageCensus | undefined>((max, s) => (!max || s.order > max.order ? s : max), undefined)

  const samples: SampleTrack[] = ids.map((id) => {
    const last = lastAt.get(id)
    const seen = touched.get(id) ?? new Set<string>()
    return {
      id,
      processes: stageList.filter((s) => seen.has(s.process)).map((s) => s.process),
      ...(last ? { lastProcess: last.process, lastStatus: last.status } : {}),
      tasks: taskCount.get(id) ?? 0,
      failedAt: stageList.filter((s) => s.failed.includes(id)).map((s) => s.process),
    }
  })

  const measurable = stageList.length > 0
  const attrition: Attrition[] = []
  // With no per-sample stage there is nothing to attribute. Listing every declared
  // sample as "never entered" here would be a confident claim built on the absence of
  // evidence rather than on evidence of absence.
  for (const track of measurable ? samples : []) {
    const last = lastAt.get(track.id)
    if (!last) {
      attrition.push({
        id: track.id,
        reason: "never_entered",
        detail:
          "declared in the samplesheet but no task in the trace ever carried its id — it never entered the pipeline. Usually the id in the samplesheet does not match the file it points at, the file was missing, or the row was filtered before the first process.",
      })
      continue
    }
    if (deepest && last.order >= deepest.order && succeeded(last.status)) continue

    const base = { id: track.id, lastProcess: last.process, lastStatus: last.status }
    if (inFlight(last.status)) {
      attrition.push({ ...base, reason: "in_flight", detail: `still ${last.status.toLowerCase()} in ${last.process}; the run is not finished.` })
      continue
    }
    if (!succeeded(last.status)) {
      attrition.push({ ...base, reason: "failed", detail: `its task in ${last.process} ended ${last.status}; the sample stopped there.` })
      continue
    }
    attrition.push({
      ...base,
      reason: "dropped_after",
      detail: `last seen in ${last.process} (${last.status}), which is upstream of ${deepest?.process ?? "the deepest stage"}. Its task succeeded and then the sample stopped appearing — the signature of a channel join dropping an unmatched key.`,
    })
  }

  const notes = [...warnings]
  if (!measurable) {
    notes.push(
      "no process in this trace names its tasks after a sample, so this run cannot be censused per sample. Either every process ran without a `tag` directive, or the tags use ids that are not in the samplesheet.",
    )
  }
  if (running > 0) notes.push(`${running} task(s) are still submitted or running; this trace is from a run in progress.`)
  if (unexpected.size > 0) {
    notes.push(
      `${unexpected.size} trace tag(s) match no declared sample (${[...unexpected].join(", ")}) — the run and the samplesheet disagree about the cohort.`,
    )
  }
  for (const [tag, candidates] of ambiguous) {
    notes.push(`tag '${tag}' fits ${candidates.join(" and ")} equally well; its tasks were not attributed to either.`)
  }

  return {
    declared: ids.length,
    observed: touched.size,
    ...(deepest ? { deepestStage: deepest.process } : {}),
    deepestCount: deepest?.count ?? 0,
    measurable,
    complete: measurable && attrition.length === 0,
    stages: stageList,
    aggregations,
    samples,
    attrition,
    unexpected: [...unexpected],
    ambiguous: [...ambiguous].map(([tag, candidates]) => ({ tag, candidates })),
    notes,
  }
}

// -------------------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------------------

const pad = (value: string, width: number) => value + " ".repeat(Math.max(0, width - value.length))

export function format(report: CensusReport): string {
  const lines: string[] = []
  if (!report.measurable) {
    lines.push(
      `Sample census — ${report.declared} declared. No process in this trace names its tasks after a sample, so no headcount can be taken from it and nothing here says whether any sample was lost.`,
    )
  } else {
    lines.push(
      report.complete
        ? `Sample census — ${report.declared} declared, all ${report.declared} reached ${report.deepestStage}.`
        : `Sample census — ${report.declared} declared, ${report.deepestCount} reached ${report.deepestStage}.`,
    )
    lines.push("", "Per-stage headcount:")
    const width = Math.max(...report.stages.map((s) => s.process.length))
    for (const stage of report.stages) {
      const missing = stage.missing.length > 0 ? `  missing: ${stage.missing.join(", ")}` : ""
      const failed = stage.failed.length > 0 ? `  failed: ${stage.failed.join(", ")}` : ""
      lines.push(`  ${String(stage.order).padStart(2)}. ${pad(stage.process, width)}  ${stage.count}/${report.declared}${missing}${failed}`)
    }
  }

  if (report.aggregations.length > 0) {
    lines.push("", "Steps with no sample attributed — their headcount proves nothing about who survived:")
    for (const stage of report.aggregations) {
      const why =
        stage.indexedTasks > 0
          ? " (tasks named by index, not by sample)"
          : stage.unmatchedTags.length > 0
            ? ` (tags match no declared sample: ${stage.unmatchedTags.join(", ")})`
            : " (aggregation step — one task for the whole cohort)"
      lines.push(`  ${stage.process}  ${stage.tasks} task(s)${why}`)
    }
  }

  // An unmeasurable trace gets no attrition verdict at all, in either direction:
  // "no attrition" about a cohort that was never counted is the exact reassurance this
  // module exists to withhold.
  if (report.measurable && report.attrition.length === 0) {
    lines.push("", "No attrition: every declared sample reached the deepest per-sample stage.")
  } else if (report.measurable) {
    lines.push("", `Attrition — ${report.attrition.length} of ${report.declared} declared samples did not finish:`)
    for (const a of report.attrition) {
      lines.push(`  ${a.id}  [${a.reason}]  ${a.lastProcess ? `last process: ${a.lastProcess} (${a.lastStatus})` : "no process ever saw it"}`)
      lines.push(`      ${a.detail}`)
    }
  }

  if (report.notes.length > 0) {
    lines.push("", "Notes:")
    for (const note of report.notes) lines.push(`  - ${note}`)
  }

  return lines.join("\n")
}

// -------------------------------------------------------------------------------------
// Service
// -------------------------------------------------------------------------------------

export class CensusUnavailableError extends Schema.TaggedErrorClass<CensusUnavailableError>()("Census.UnavailableError", {
  path: Schema.String,
  problem: Schema.String,
}) {
  override get message() {
    return `Cannot take a sample census from ${this.path}: ${this.problem}`
  }
}

export interface CensusInput {
  readonly samplesheet: string
  /** Path to an execution_trace_*.txt. One of `trace` or `outdir` is required. */
  readonly trace?: string
  /** A pipeline outdir; the newest `pipeline_info/execution_trace_*.txt` under it is used. */
  readonly outdir?: string
}

export interface Interface {
  readonly of: (input: CensusInput) => Effect.Effect<CensusReport, CensusUnavailableError>
  readonly locateTrace: (outdir: string) => Effect.Effect<string, CensusUnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/NfcoreCensus") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const resolve = Effect.fnUntraced(function* (target: string) {
      if (path.isAbsolute(target)) return target
      const ctx = yield* InstanceState.context
      return path.join(ctx.directory, target)
    })

    // Read a required input. A missing or unreadable file is a typed failure, never an
    // empty string: an empty samplesheet parses to zero declared samples, and a census
    // of zero samples never reports anyone missing.
    const readText = Effect.fnUntraced(function* (file: string) {
      const text = yield* fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (text === undefined) return yield* new CensusUnavailableError({ path: file, problem: "the file could not be read" })
      return text
    })

    const locateTrace = Effect.fn("NfcoreCensus.locateTrace")(function* (outdir: string) {
      const root = yield* resolve(outdir)
      const dir = path.basename(root) === "pipeline_info" ? root : path.join(root, "pipeline_info")
      const entries = yield* fs.readDirectoryEntries(dir).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (entries === undefined) {
        return yield* new CensusUnavailableError({ path: dir, problem: "no such directory — was the run given this outdir?" })
      }
      const latest = pickLatestTrace(entries.map((e) => e.name))
      if (!latest) {
        return yield* new CensusUnavailableError({
          path: dir,
          problem: "no execution_trace_*.txt. Nextflow writes one per run unless tracing is disabled in the config.",
        })
      }
      return path.join(dir, latest)
    })

    const of = Effect.fn("NfcoreCensus.of")(function* (input: CensusInput) {
      const sheetPath = yield* resolve(input.samplesheet)
      const sheet = parseSamplesheet(yield* readText(sheetPath))
      if (!sheet.ok) return yield* new CensusUnavailableError({ path: sheetPath, problem: sheet.problem })

      const tracePath = input.trace
        ? yield* resolve(input.trace)
        : input.outdir
          ? yield* locateTrace(input.outdir)
          : yield* new CensusUnavailableError({ path: sheetPath, problem: "no trace file and no outdir given" })
      const trace = parseTrace(yield* readText(tracePath))
      if (!trace.ok) return yield* new CensusUnavailableError({ path: tracePath, problem: trace.problem })

      const warnings: string[] = []
      warnings.push(`${sheet.rows} samplesheet row(s) declare ${sheet.ids.length} distinct sample(s) in column '${sheet.idColumn}'.`)
      if (sheet.duplicates.length > 0) {
        warnings.push(`${sheet.duplicates.length} sample(s) span several rows (${sheet.duplicates.join(", ")}); counted once each.`)
      }
      if (sheet.blankRows > 0) warnings.push(`${sheet.blankRows} samplesheet row(s) have an empty '${sheet.idColumn}' and declare nothing.`)
      if (trace.malformed > 0) {
        warnings.push(`${trace.malformed} trace line(s) had too few fields and were skipped — the trace may be truncated, so treat the headcount as a floor.`)
      }

      return census(sheet.ids, trace.tasks, warnings)
    })

    return Service.of({ of, locateTrace })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node] })
