import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { CrossSpawnSpawner } from "@bioinformatica/core/cross-spawn-spawner"
import { PermissionV1 } from "@bioinformatica/core/v1/permission"
import { SessionID } from "../../src/session/schema"
import { Record } from "@/nfcore/record"
import { Permission } from "@/permission"
import { EventV2Bridge } from "@/event-v2-bridge"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import fsNode from "fs/promises"
import path from "path"

const env = LayerNode.compile(LayerNode.group([Record.node, EventV2Bridge.node, CrossSpawnSpawner.node]))
const it = testEffect(env)

const readSafe = (file: string) =>
  Effect.tryPromise(() => fsNode.readFile(file, "utf8")).pipe(Effect.catch(() => Effect.succeed("")))

describe("nfcore.record", () => {
  it.live("logs a granted approval to .bioinformatica/approvals.jsonl", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const record = yield* Record.Service
        yield* record.init() // starts the approval-log subscribers
        // Let the forked subscribers register before publishing. In real use they
        // start at instance bootstrap, long before any permission is asked.
        yield* Effect.sleep("150 millis")

        const events = yield* EventV2Bridge.Service
        const id = PermissionV1.ID.ascending()
        const sessionID = SessionID.make("ses_record_test")

        yield* events.publish(Permission.Event.Asked, {
          id,
          sessionID,
          permission: "bash",
          patterns: ["nextflow run nf-core/demo *"],
          metadata: { command: "nextflow run nf-core/demo -r 1.2.0 -profile test,docker --outdir out" },
          always: ["*"],
        })
        // Real ask→reply always has time between them; give the two subscriber
        // fibers a beat so the ask is cached before the reply is handled.
        yield* Effect.sleep("80 millis")
        yield* events.publish(Permission.Event.Replied, { sessionID, requestID: id, reply: "once" })
        yield* Effect.sleep("120 millis")

        const log = yield* readSafe(path.join(dir, ".bioinformatica", "approvals.jsonl"))
        expect(log).toContain("nextflow run nf-core/demo")
        expect(log).toContain('"decision":"once"')
        expect(log).toContain('"action":"bash"')
      }),
    ),
  )

  it.live("records a run to .bioinformatica/runs/ and lists it back", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const record = yield* Record.Service
        const command = "nextflow run nf-core/rnaseq -r 3.26.0 -profile test,docker --outdir results"
        const file = yield* record.run({
          pipeline: "rnaseq",
          release: "3.26.0",
          backend: "docker",
          mode: "test",
          command,
          outdir: "results",
          status: "succeeded",
        })

        expect(file).toContain(path.join(dir, ".bioinformatica", "runs"))
        const written = yield* readSafe(file)
        expect(written).toContain("rnaseq")
        expect(written).toContain("succeeded")

        const runs = yield* record.list()
        expect(runs.length).toBe(1)
        expect(runs[0].pipeline).toBe("rnaseq")
        expect(runs[0].command).toBe(command)
        expect(runs[0].startedAt).toBeTruthy()
      }),
    ),
  )
})

// Two things the artefact now says about itself, and one it must not break.
describe("nfcore.record says who authored it", () => {
  test("a record written today is stamped model-reported", () => {
    const decoded = Schema.decodeUnknownSync(Record.RunRecord)({
      pipeline: "rnaseq",
      release: "3.14.0",
      backend: "docker",
      mode: "run",
      command: "nextflow run nf-core/rnaseq",
      status: "started",
      startedAt: "2026-09-01T00:00:00.000Z",
      reportedBy: "model",
    })
    expect(decoded.reportedBy).toBe("model")
  })

  test("a record written before this field existed still decodes", () => {
    // `list()` swallows decode failures, so a required field here would have made
    // every pre run record disappear from the history in silence — the exact
    // failure mode this project exists to denounce.
    const decoded = Schema.decodeUnknownSync(Record.RunRecord)({
      pipeline: "rnaseq",
      release: "3.14.0",
      backend: "docker",
      mode: "run",
      command: "nextflow run nf-core/rnaseq",
      status: "started",
      startedAt: "2026-08-01T00:00:00.000Z",
    })
    expect(decoded.reportedBy).toBeUndefined()
    expect(decoded.pipeline).toBe("rnaseq")
  })

  test("finishedAt is gone, not merely unwritten", () => {
    // It was declared and never assigned anywhere in the tree, so every record read
    // `finishedAt: undefined` — which a consumer can only take as "still running".
    expect(Object.keys(Record.RunRecord.fields)).not.toContain("finishedAt")
  })
})
