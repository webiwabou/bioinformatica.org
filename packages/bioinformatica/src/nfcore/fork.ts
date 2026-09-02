export * as Fork from "./fork"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { AppProcess } from "@bioinformatica/core/process"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { ChildProcess } from "effect/unstable/process"
import { Context, Effect, Layer } from "effect"
import fsNode from "fs/promises"
import path from "path"

// Local pipeline forking. Forking is a rarer, more complex
// operation than adjusting parameters: the scientist wants to change a pipeline's code.
// The fork's CODE lives in a VISIBLE project folder (pipelines/<name>-fork/) — it is the
// scientist's working content, not agent-internal state — pinned to a fixed upstream
// release. Only the fork's provenance and its diff vs upstream go in .bioinformatica/,
// reusing the existing Record/Manifest layer. Cloning is a data write run through the
// shell tool (approval); this module plans that command, records provenance, and reports
// how the fork has diverged from its pinned upstream (read-only git).

const BIOINFORMATICA_DIR = ".bioinformatica"

export interface ForkPlan {
  readonly pipeline: string
  readonly release: string
  readonly path: string
  readonly command: string
}

// The clone command and the visible location a fork lands in. Pure. The fork is pinned to
// a single release tag so the adaptation is reproducible and can be diffed against a known
// upstream point. The command is shown and run through the shell tool, not here.
export function plan(input: { pipeline: string; release: string }): ForkPlan {
  const p = `pipelines/${input.pipeline}-fork`
  const command = `git clone --branch ${input.release} --single-branch https://github.com/nf-core/${input.pipeline}.git ${p}`
  return { pipeline: input.pipeline, release: input.release, path: p, command }
}

export interface ForkChange {
  readonly file: string
  readonly status: string
}

// Parse `git status --porcelain`: each line is "XY path" (XY = 2-char status code). Pure.
export function parseStatus(porcelain: string): ForkChange[] {
  const out: ForkChange[] = []
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    const status = line.slice(0, 2).trim()
    const file = line.slice(2).trim()
    if (file) out.push({ file, status })
  }
  return out
}

export interface DiffStat {
  readonly files: number
  readonly insertions: number
  readonly deletions: number
}

// Parse `git diff --shortstat`, e.g. " 3 files changed, 12 insertions(+), 4 deletions(-)". Pure.
export function parseDiffStat(text: string): DiffStat {
  const num = (re: RegExp) => {
    const m = text.match(re)
    return m ? Number(m[1]) : 0
  }
  return {
    files: num(/(\d+)\s+files?\s+changed/),
    insertions: num(/(\d+)\s+insertions?\(\+\)/),
    deletions: num(/(\d+)\s+deletions?\(-\)/),
  }
}

export interface ForkRecord {
  readonly pipeline: string
  readonly release: string
  readonly path: string
  readonly baselineSha?: string
  readonly forkedAt: string
}

export interface ForkStatus {
  readonly path: string
  readonly currentSha?: string
  readonly baselineSha?: string
  readonly changes: ForkChange[]
  readonly diverged?: DiffStat
  readonly clean: boolean
}

export type ForkResult =
  | { readonly kind: "plan"; readonly plan: ForkPlan }
  | { readonly kind: "recorded"; readonly record: ForkRecord; readonly file: string; readonly status: ForkStatus }

export interface Interface {
  // Plan a fork if it does not exist yet, or record its provenance if it has been cloned.
  readonly fork: (input: { pipeline: string; release: string }) => Effect.Effect<ForkResult>
  // Read-only divergence of a fork from its pinned upstream.
  readonly status: (input: { path: string; baselineSha?: string }) => Effect.Effect<ForkStatus>
  readonly list: () => Effect.Effect<ForkRecord[]>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/NfcoreFork") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service
    const fs = yield* FSUtil.Service

    const git = Effect.fnUntraced(
      function* (args: string[], cwd: string) {
        const result = yield* appProcess.run(ChildProcess.make("git", args, { extendEnv: true, cwd }))
        return { code: result.exitCode, stdout: result.stdout.toString("utf8"), stderr: result.stderr.toString("utf8") }
      },
      Effect.catch(() => Effect.succeed({ code: 127, stdout: "", stderr: "" })),
    )

    const status = Effect.fn("NfcoreFork.status")(function* (input: { path: string; baselineSha?: string }) {
      const ctx = yield* InstanceState.context
      const dir = path.isAbsolute(input.path) ? input.path : path.join(ctx.directory, input.path)

      const head = yield* git(["rev-parse", "HEAD"], dir)
      const currentSha = head.code === 0 ? head.stdout.trim() || undefined : undefined
      const porcelain = yield* git(["status", "--porcelain"], dir)
      const changes = parseStatus(porcelain.stdout)

      let diverged: DiffStat | undefined
      if (input.baselineSha) {
        const short = yield* git(["diff", "--shortstat", input.baselineSha], dir)
        if (short.code === 0) diverged = parseDiffStat(short.stdout)
      }
      const clean = changes.length === 0 && (!diverged || diverged.files === 0)
      return { path: dir, currentSha, baselineSha: input.baselineSha, changes, diverged, clean } satisfies ForkStatus
    })

    const fork = Effect.fn("NfcoreFork.fork")(function* (input: { pipeline: string; release: string }) {
      const ctx = yield* InstanceState.context
      const forkPlan = plan(input)
      const dir = path.join(ctx.directory, forkPlan.path)

      const exists = yield* Effect.tryPromise(() => fsNode.stat(dir))
        .pipe(Effect.map(() => true), Effect.catch(() => Effect.succeed(false)))
      if (!exists) return { kind: "plan", plan: forkPlan } satisfies ForkResult

      // The fork is on disk: capture the pinned baseline commit and record provenance.
      const head = yield* git(["rev-parse", "HEAD"], dir)
      const baselineSha = head.code === 0 ? head.stdout.trim() || undefined : undefined
      const record: ForkRecord = {
        pipeline: input.pipeline,
        release: input.release,
        path: forkPlan.path,
        baselineSha,
        forkedAt: new Date().toISOString(),
      }
      const file = path.join(
        ctx.directory,
        BIOINFORMATICA_DIR,
        "forks",
        `${input.pipeline}-${record.forkedAt.replace(/[:.]/g, "-")}.json`,
      )
      yield* fs.writeWithDirs(file, JSON.stringify(record, null, 2)).pipe(Effect.orDie)
      const st = yield* status({ path: dir, baselineSha })
      return { kind: "recorded", record, file, status: st } satisfies ForkResult
    })

    const list = Effect.fn("NfcoreFork.list")(function* () {
      const ctx = yield* InstanceState.context
      const dir = path.join(ctx.directory, BIOINFORMATICA_DIR, "forks")
      const names = yield* Effect.tryPromise(() => fsNode.readdir(dir)).pipe(Effect.catch(() => Effect.succeed([] as string[])))
      const out: ForkRecord[] = []
      for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
        const raw = yield* fs.readJson(path.join(dir, name)).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (raw && typeof raw === "object") out.push(raw as ForkRecord)
      }
      return out
    })

    return Service.of({ fork, status, list })
  }),
)

export function summarizeStatus(st: ForkStatus): string {
  const lines = [
    `Fork at ${st.path}`,
    `- Pinned baseline: ${st.baselineSha ? st.baselineSha.slice(0, 10) : "unknown"}${st.currentSha ? `, current HEAD ${st.currentSha.slice(0, 10)}` : ""}`,
  ]
  if (st.diverged) {
    lines.push(
      `- Diverged from upstream: ${st.diverged.files} file(s), +${st.diverged.insertions}/-${st.diverged.deletions}`,
    )
  }
  lines.push(`- Uncommitted changes: ${st.changes.length === 0 ? "none" : `${st.changes.length} file(s)`}`)
  for (const c of st.changes.slice(0, 20)) lines.push(`    ${c.status} ${c.file}`)
  lines.push(st.clean ? "- Status: identical to the pinned upstream." : "- Status: modified from the pinned upstream.")
  return lines.join("\n")
}

export const node = LayerNode.make({ service: Service, layer, deps: [AppProcess.node, FSUtil.node] })
