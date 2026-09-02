export * as Objective from "./objective"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { Context, Effect, Layer, Schema } from "effect"
import path from "path"

// The campaign objective, persisted project-locally under `.bioinformatica/` and
// re-stated to the model on every turn.
//
// Keyed on the PROJECT DIRECTORY, deliberately not on the session or the step
// counter. `step` in the prompt loop is local to one user prompt, so seeding an
// objective there would overwrite it with the word "continue" the first time the
// scientist typed that. A directory-keyed objective also survives compaction and a
// fresh session, which is the whole point: a campaign outlives a context window.

const BIOINFORMATICA_DIR = ".bioinformatica"
const FILE = "objective.json"

export const ObjectiveRecord = Schema.Struct({
  /** The scientific objective in the scientist's own terms. */
  statement: Schema.String,
  /** What would count as done. */
  successCriteria: Schema.optional(Schema.Array(Schema.String)),
  /** Decisions fixed up front so a long stage never has to stop and ask. */
  decisions: Schema.optional(Schema.Array(Schema.String)),
  /** Ordered stage names, so a resumed session knows the shape of the work. */
  stages: Schema.optional(Schema.Array(Schema.String)),
  updatedAt: Schema.String,
})
export type ObjectiveRecord = Schema.Schema.Type<typeof ObjectiveRecord>

export interface ObjectiveInput {
  readonly statement: string
  readonly successCriteria?: readonly string[]
  readonly decisions?: readonly string[]
  readonly stages?: readonly string[]
}

/** Absolute path of the objective file for a project directory. */
export function file(directory: string): string {
  return path.join(directory, BIOINFORMATICA_DIR, FILE)
}

/**
 * The reminder injected each turn. Deliberately short: it restates the goal and the
 * fixed decisions, and it does not re-derive the plan — the point is that the model
 * cannot silently drift from, or forget, what it is doing.
 */
export function render(objective: ObjectiveRecord): string {
  const lines = [`<campaign_objective>`, objective.statement.trim()]
  if (objective.successCriteria?.length) {
    lines.push("", "Done when:")
    for (const c of objective.successCriteria) lines.push(`- ${c}`)
  }
  if (objective.decisions?.length) {
    lines.push("", "Decisions already fixed (do not re-litigate, do not stop to ask):")
    for (const d of objective.decisions) lines.push(`- ${d}`)
  }
  if (objective.stages?.length) {
    lines.push("", `Stages: ${objective.stages.join(" → ")}`)
  }
  lines.push(
    "",
    "This is the standing objective for this project. Keep working toward it, and never end a reply without saying what you did, what remains, and what you need from the scientist.",
    "</campaign_objective>",
  )
  return lines.join("\n")
}

export interface Interface {
  readonly set: (input: ObjectiveInput) => Effect.Effect<string>
  readonly read: () => Effect.Effect<ObjectiveRecord | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/NfcoreObjective") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const set = Effect.fn("NfcoreObjective.set")(function* (input: ObjectiveInput) {
      const ctx = yield* InstanceState.context
      const objective = ObjectiveRecord.make({ ...input, updatedAt: new Date().toISOString() })
      const target = file(ctx.directory)
      yield* fs.writeWithDirs(target, JSON.stringify(objective, null, 2)).pipe(Effect.orDie)
      return target
    })

    const read = Effect.fn("NfcoreObjective.read")(function* () {
      const ctx = yield* InstanceState.context
      const raw = yield* fs.readJson(file(ctx.directory)).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (raw === undefined) return undefined
      return yield* Schema.decodeUnknownEffect(ObjectiveRecord)(raw).pipe(Effect.catch(() => Effect.succeed(undefined)))
    })

    return Service.of({ set, read })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node] })
