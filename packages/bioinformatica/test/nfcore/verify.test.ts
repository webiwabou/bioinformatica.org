import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { CorpusSnapshot } from "@/bio/snapshot"
import { Verify } from "@/nfcore/verify"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import fsNode from "fs/promises"
import path from "path"

const env = LayerNode.compile(LayerNode.group([Verify.node, CorpusSnapshot.node]))
const it = testEffect(env)

const ROWS = [{ id: "AAAA" }, { id: "BBBB" }]
const TEXT = CorpusSnapshot.toNdjson(ROWS)

const manifest = (over: Partial<CorpusSnapshot.Manifest> = {}): CorpusSnapshot.Manifest => ({
  source: "RepeatsDB",
  endpoint: "https://repeatsdb.org/api/production/annotations",
  fetchedAt: "2026-08-25T00:00:00.000Z",
  rows: ROWS.length,
  bytes: Buffer.byteLength(TEXT, "utf8"),
  sha256: CorpusSnapshot.sha256(TEXT),
  data: "sample.ndjson",
  ...over,
})

const ok = <A>(value: A) => ({ ok: true as const, value })
const bad = (error: string) => ({ ok: false as const, error })

describe("nfcore.verify pure checks", () => {
  test("counts NDJSON records, ignoring the trailing newline", () => {
    expect(Verify.countRows(TEXT)).toBe(2)
    expect(Verify.countRows("")).toBe(0)
    expect(Verify.countRows('{"a":1}')).toBe(1)
  })

  test("intact data passes and the receipt names what was compared", () => {
    const check = Verify.checkSnapshot({ name: "corpus/sample.manifest.json", manifest: ok(manifest()), data: ok(TEXT) })
    expect(check.verdict).toBe("pass")
    expect(check.detail).toContain("2 rows")
  })

  test("one altered byte fails, even when the length is unchanged", () => {
    // Same byte count, same row count — only the content differs, so nothing but the
    // digest can catch it.
    const flipped = Buffer.from(TEXT, "utf8")
    flipped[8] = flipped[8]! ^ 0x01
    const altered = flipped.toString("utf8")
    expect(altered).not.toBe(TEXT)
    expect(Buffer.byteLength(altered, "utf8")).toBe(Buffer.byteLength(TEXT, "utf8"))

    const check = Verify.checkSnapshot({ name: "corpus/sample.manifest.json", manifest: ok(manifest()), data: ok(altered) })
    expect(check.verdict).toBe("fail")
    expect(check.detail).toContain("sha256")
  })

  test("a row count that disagrees fails on its own terms", () => {
    // Digest and byte count both match here, so this fails only if the row comparison
    // is actually performed rather than assumed to follow from the hash.
    const check = Verify.checkSnapshot({
      name: "corpus/sample.manifest.json",
      manifest: ok(manifest({ rows: 15165 })),
      data: ok(TEXT),
    })
    expect(check.verdict).toBe("fail")
    expect(check.detail).toContain("2 rows on disk")
    expect(check.detail).toContain("15165")
    expect(check.detail).not.toContain("sha256")
  })

  test("a missing data file is a failure, never a skip", () => {
    const check = Verify.checkSnapshot({
      name: "corpus/sample.manifest.json",
      manifest: ok(manifest()),
      data: bad("ENOENT: no such file or directory"),
    })
    expect(check.verdict).toBe("fail")
    expect(check.detail).toContain("missing or unreadable")
  })

  test("an empty data file is not the same evidence as an unreadable one", () => {
    // A zero-row snapshot is legitimately empty on disk. If the reader collapsed
    // "read nothing" and "could not read" into one value, this pair would agree.
    const empty = manifest({ rows: 0, bytes: 0, sha256: CorpusSnapshot.sha256(""), data: "empty.ndjson" })
    expect(Verify.checkSnapshot({ name: "a", manifest: ok(empty), data: ok("") }).verdict).toBe("pass")
    expect(Verify.checkSnapshot({ name: "a", manifest: ok(empty), data: bad("EACCES") }).verdict).toBe("fail")
  })

  test("a manifest that cannot be decoded fails rather than disappearing", () => {
    const check = Verify.checkSnapshot({ name: "corpus/x.manifest.json", manifest: bad("Unexpected token }") })
    expect(check.verdict).toBe("fail")
    expect(check.detail).toContain("manifest could not be read")
  })

  test("staged and vendored trees are not this project's records", () => {
    expect(Verify.isScanned("corpus/sample.manifest.json")).toBe(true)
    expect(Verify.isScanned("work/ab/cd12/sample.manifest.json")).toBe(false)
    expect(Verify.isScanned("node_modules/pkg/x.manifest.json")).toBe(false)
    expect(Verify.isManifestPath("corpus/sample.ndjson")).toBe(false)
    // nf-prov writes a bare `manifest.json`; it is not a corpus snapshot manifest.
    expect(Verify.isManifestPath("pipeline_info/manifest.json")).toBe(false)
  })
})

describe("nfcore.verify report and receipt", () => {
  test("no manifests means nothing to verify, and says so instead of claiming a pass", () => {
    const empty = Verify.report("/work/proj", [])
    expect(empty.ok).toBe(true)
    expect(empty.counts).toEqual({ pass: 0, fail: 0, skip: 0 })
    const out = Verify.format(empty)
    expect(out).toContain("Nothing to verify")
    expect(out).toContain("no snapshots")
  })

  test("one failure sinks the report regardless of how many passed", () => {
    const value = Verify.report("/work/proj", [
      { name: "b.manifest.json", verdict: "pass", detail: "fine" },
      { name: "a.manifest.json", verdict: "fail", detail: "sha256 mismatch" },
    ])
    expect(value.ok).toBe(false)
    expect(value.counts.fail).toBe(1)
    // Sorted, so two runs over the same project produce the same receipt.
    expect(value.checks.map((c) => c.name)).toEqual(["a.manifest.json", "b.manifest.json"])
    expect(Verify.format(value)).toContain("FAILED")
  })

  test("plain output carries no escape codes; colour is opt-in", () => {
    const value = Verify.report("/work/proj", [{ name: "a", verdict: "fail", detail: "x" }])
    expect(Verify.format(value)).not.toContain("\x1b[")
    expect(Verify.format(value, { color: true })).toContain("\x1b[91m")
  })
})

describe("nfcore.verify against real files", () => {
  const write = (dir: string) =>
    Effect.gen(function* () {
      const snapshots = yield* CorpusSnapshot.Service
      return yield* snapshots.write({
        name: "sample",
        source: "RepeatsDB",
        endpoint: "https://repeatsdb.org/api/production/annotations",
        rows: ROWS,
        directory: path.join(dir, "corpus"),
      })
    })

  it.instance("an untouched project verifies without touching the network", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      yield* write(instance.directory)

      // A verifier that needs the network is not a verifier. Any fetch here is a defect,
      // so make one fatal for the duration of the check.
      const realFetch = globalThis.fetch
      globalThis.fetch = (() => {
        throw new Error("verify reached for the network")
      }) as unknown as typeof fetch

      const report = yield* (yield* Verify.Service)
        .verify()
        .pipe(Effect.ensuring(Effect.sync(() => (globalThis.fetch = realFetch))))

      expect(report.checks).toHaveLength(1)
      expect(report.checks[0]!.name).toBe("corpus/sample.manifest.json")
      expect(report.checks[0]!.verdict).toBe("pass")
      expect(report.ok).toBe(true)
    }),
  )

  it.instance("one flipped byte in the NDJSON makes the project fail", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const written = yield* write(instance.directory)

      const before = yield* (yield* Verify.Service).verify()
      expect(before.ok).toBe(true)

      yield* Effect.promise(async () => {
        const buffer = await fsNode.readFile(written.path)
        buffer[8] = buffer[8]! ^ 0x01
        await fsNode.writeFile(written.path, buffer)
      })

      const after = yield* (yield* Verify.Service).verify()
      expect(after.ok).toBe(false)
      expect(after.counts.fail).toBe(1)
      expect(after.checks[0]!.detail).toContain("sha256")
      expect(Verify.format(after)).toContain("FAILED")
    }),
  )

  it.instance("a manifest whose data file was deleted fails; it is not a missing snapshot", () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const written = yield* write(instance.directory)
      yield* Effect.promise(() => fsNode.rm(written.path))

      const report = yield* (yield* Verify.Service).verify()
      expect(report.ok).toBe(false)
      expect(report.checks[0]!.verdict).toBe("fail")
      expect(report.checks[0]!.detail).toContain("missing or unreadable")
    }),
  )

  it.instance("a project with no snapshots has nothing to verify and stays ok", () =>
    Effect.gen(function* () {
      const report = yield* (yield* Verify.Service).verify()
      expect(report.checks).toHaveLength(0)
      expect(report.ok).toBe(true)
      expect(Verify.format(report)).toContain("Nothing to verify")
    }),
  )
})
