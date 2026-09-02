export * as Record from "./record"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Ablation } from "@/nfcore/ablation"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { InstanceState } from "@/effect/instance-state"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import fsNode from "fs/promises"
import path from "path"

// Project-local provenance under `.bioinformatica/` in the working directory:
//   - `.bioinformatica/runs/`         one JSON manifest per pipeline run (history + outcome)
//   - `.bioinformatica/approvals.jsonl`  an append-only log of every approval/denial
// This is a first subset of the reproducibility manifest, not the whole of it.
// Approvals are captured deterministically from the permission event stream, so
// the log doesn't depend on the model remembering to write it.

const BIOINFORMATICA_DIR = ".bioinformatica"

/**
 * Two corrections to what this record claims about itself.
 *
 * `reportedBy` is stamped by the substrate, never by the caller. Every other
 * field here — including `status` — is a free tool parameter the model fills in,
 * so a run record is the model's account of a run, written once at the moment it
 * says the run started. This project defines its artefacts as the ones the agent
 * *cannot* author about itself; this one is authored by the agent, so the record
 * says so rather than letting a reader assume otherwise. If a record is ever
 * written from a genuinely correlated process exit, that stamp becomes
 * `"substrate"` and the difference is visible in the artefact.
 *
 * `finishedAt` is gone. It was declared here and written nowhere — a `grep` over
 * `src` and `test` returned exactly one line, its own declaration — so every
 * record ever produced read `finishedAt: undefined`, which a consumer can only
 * read as "still running". A field that is structurally always absent is a claim
 * the artefact cannot support. Completion belongs to whatever correlates the
 * process exit, and until that exists the honest schema does not mention it.
 */
export const RunRecord = Schema.Struct({
  pipeline: Schema.String,
  release: Schema.String,
  backend: Schema.String,
  mode: Schema.String,
  command: Schema.String,
  outdir: Schema.optional(Schema.String),
  status: Schema.String,
  startedAt: Schema.String,
  // Optional on READ, always stamped on WRITE. Records written before the field
  // existed carry none, and a required one would make them fail to decode — `list()`
  // swallows a decode failure, so every pre-existing run record would have
  // vanished from the history without a word. An absent value means the same
  // thing it would have said: model-reported.
  reportedBy: Schema.optional(Schema.Literals(["model", "substrate"])),
  notes: Schema.optional(Schema.String),
})
export type RunRecord = Schema.Schema.Type<typeof RunRecord>

export interface RunInput {
  readonly pipeline: string
  readonly release: string
  readonly backend: string
  readonly mode: string
  readonly command: string
  readonly outdir?: string
  readonly status: string
  readonly notes?: string
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly run: (input: RunInput) => Effect.Effect<string>
  readonly list: () => Effect.Effect<RunRecord[]>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/NfcoreRecord") {}

export const use = serviceUse(Service)

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run"
}

const appendLine = (file: string, line: string) =>
  Effect.tryPromise(() => fsNode.mkdir(path.dirname(file), { recursive: true }).then(() => fsNode.appendFile(file, line))).pipe(
    Effect.ignore,
  )

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const events = yield* EventV2Bridge.Service

    // Per-instance: start the approval-log subscribers against the instance scope
    // (they're cleaned up when the instance is disposed) and remember its worktree.
    // with provenance ablated, nothing is recorded — no approvals log, no run
    // records. Gated here rather than at each write so the bare arm produces no `.bioinformatica/`
    // side effects at all, which is what makes it comparable to a stock harness.
    const ablation = Ablation.resolve((yield* RuntimeFlags.Service).ablate)

    const state = yield* InstanceState.make(
      Effect.fn("NfcoreRecord.state")(function* (ctx) {
        // `.bioinformatica/` lives in the working directory Bioinformatica was invoked from — the
        // current investigation folder.
        const approvals = path.join(ctx.directory, BIOINFORMATICA_DIR, "approvals.jsonl")
        // Correlate a permission ask (which carries the command/resources) with
        // its reply (which carries the decision), then write one approval record.
        const pending = new Map<string, { permission: string; patterns: readonly string[]; metadata: unknown }>()

        if (!ablation.provenance) return { directory: ctx.directory }
        yield* events.subscribe(Permission.Event.Asked).pipe(
          Stream.runForEach((event) =>
            Effect.sync(() =>
              pending.set(event.data.id, {
                permission: event.data.permission,
                patterns: event.data.patterns,
                metadata: event.data.metadata,
              }),
            ),
          ),
          Effect.forkScoped,
        )

        yield* events.subscribe(Permission.Event.Replied).pipe(
          Stream.runForEach((event) => {
            const asked = pending.get(event.data.requestID)
            pending.delete(event.data.requestID)
            const line =
              JSON.stringify({
                ts: new Date().toISOString(),
                sessionID: event.data.sessionID,
                decision: event.data.reply,
                action: asked?.permission,
                resources: asked?.patterns,
                metadata: asked?.metadata,
              }) + "\n"
            return appendLine(approvals, line)
          }),
          Effect.forkScoped,
        )

        return { directory: ctx.directory }
      }),
    )

    const init = Effect.fn("NfcoreRecord.init")(function* () {
      yield* InstanceState.get(state)
    })

    const run = Effect.fn("NfcoreRecord.run")(function* (input: RunInput) {
      if (!ablation.provenance) return ""
      const { directory } = yield* InstanceState.get(state)
      const startedAt = new Date().toISOString()
      // `reportedBy` is stamped here, not accepted from the caller: the point of the
      // field is that the model cannot claim its own record was substrate-verified.
      const record = RunRecord.make({ ...input, startedAt, reportedBy: "model" })
      const file = path.join(
        directory,
        BIOINFORMATICA_DIR,
        "runs",
        `${startedAt.replace(/[:.]/g, "-")}-${slug(input.pipeline)}-${slug(input.mode)}.json`,
      )
      yield* fs.writeWithDirs(file, JSON.stringify(record, null, 2)).pipe(Effect.orDie)
      return file
    })

    const list = Effect.fn("NfcoreRecord.list")(function* () {
      const { directory } = yield* InstanceState.get(state)
      const dir = path.join(directory, BIOINFORMATICA_DIR, "runs")
      const files = yield* Effect.tryPromise(() => fsNode.readdir(dir)).pipe(Effect.catch(() => Effect.succeed([] as string[])))
      const records: RunRecord[] = []
      for (const name of files.filter((f) => f.endsWith(".json")).sort()) {
        const raw = yield* fs.readJson(path.join(dir, name)).pipe(Effect.catch(() => Effect.succeed(undefined)))
        const parsed = yield* Schema.decodeUnknownEffect(RunRecord)(raw).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (parsed) records.push(parsed)
      }
      return records
    })

    return Service.of({ init, run, list })
  }),
)

export function summarize(records: readonly RunRecord[]): string {
  if (records.length === 0) return "No recorded runs in .bioinformatica/runs/ yet."
  return records
    .map((r) => `- ${r.startedAt}  nf-core/${r.pipeline}@${r.release} (${r.mode}, ${r.backend}) — ${r.status}\n    ${r.command}`)
    .join("\n")
}

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node, EventV2Bridge.node, RuntimeFlags.node] })
