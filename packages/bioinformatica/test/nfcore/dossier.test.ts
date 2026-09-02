import { describe, expect, test } from "bun:test"
import { execFileSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { Dossier } from "../../src/nfcore/dossier"

// The dossier's whole claim is that someone without Bioinformatica can check it, so the
// tests that matter run the emitted shell script rather than re-implementing its logic.

const index = (entries: Dossier.Entry[]): Dossier.Index => ({
  kind: "bioinformatica-dossier",
  version: 1,
  project: "fixture",
  generatedAt: "2026-09-01T00:00:00.000Z",
  taxonomyVersion: "bioinformatica-handcount-taxonomy/v1",
  classifierVersion: "bioinformatica-handcount-rules/v1",
  artefacts: [],
  verification: { ok: true, passed: 1, failed: 0, failures: [] },
  entries,
  limits: Dossier.LIMITS,
})

/** Build a dossier on disk exactly as the command does, then run its receipt. */
function fixture(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bioinformatica-dossier-"))
  const entries: Dossier.Entry[] = []
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
    entries.push({
      path: rel,
      origin: rel,
      bytes: Buffer.byteLength(content, "utf8"),
      sha256: Dossier.sha256(content),
    })
  }
  const idx = index(entries.sort((a, b) => (a.path < b.path ? -1 : 1)))
  const text = Dossier.serialize(idx)
  const digest = Dossier.sha256(text)
  fs.writeFileSync(path.join(dir, "index.json"), text)
  fs.writeFileSync(path.join(dir, "verify.sh"), Dossier.verifyScript(idx, digest))
  return { dir, index: idx, digest }
}

/** Run the receipt the way a reviewer would: /bin/sh, no Bioinformatica, no environment. */
function runReceipt(dir: string): { code: number; out: string } {
  try {
    const out = execFileSync("/bin/sh", ["verify.sh"], { cwd: dir, encoding: "utf8", env: { PATH: "/usr/bin:/bin" } })
    return { code: 0, out }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` }
  }
}

describe("nfcore.dossier receipt", () => {
  test("an intact dossier verifies with no Bioinformatica and no network", () => {
    const { dir } = fixture({ "corpus/a.ndjson": '{"x":1}\n', "corpus/a.manifest.json": '{"rows":1}\n' })
    const result = runReceipt(dir)
    expect(result.code).toBe(0)
    expect(result.out).toContain("OK —")
    // The receipt must not let the reader think it checked more than it did.
    expect(result.out).toContain("says nothing about whether the result was right")
  })

  test("a changed byte in any carried file fails", () => {
    const { dir } = fixture({ "corpus/a.ndjson": '{"x":1}\n' })
    fs.writeFileSync(path.join(dir, "corpus/a.ndjson"), '{"x":2}\n')
    const result = runReceipt(dir)
    expect(result.code).toBe(1)
    expect(result.out).toContain("CHANGED")
    expect(result.out).toContain("corpus/a.ndjson")
  })

  test("a removed file fails rather than being skipped", () => {
    // The failure that matters most: an absent file must not read as nothing to check.
    const { dir } = fixture({ "corpus/a.ndjson": '{"x":1}\n' })
    fs.rmSync(path.join(dir, "corpus/a.ndjson"))
    const result = runReceipt(dir)
    expect(result.code).toBe(1)
    expect(result.out).toContain("MISSING")
  })

  test("editing a file AND its recorded digest still fails, because the index is covered", () => {
    // Without the index digest, whoever changes a file can change its recorded hash in the
    // same pass and the dossier still verifies — the exact failure digests exist to prevent.
    const { dir, index: idx } = fixture({ "corpus/a.ndjson": '{"x":1}\n' })
    const tampered = '{"x":999}\n'
    fs.writeFileSync(path.join(dir, "corpus/a.ndjson"), tampered)
    const rewritten: Dossier.Index = {
      ...idx,
      entries: idx.entries.map((e) => ({ ...e, sha256: Dossier.sha256(tampered), bytes: Buffer.byteLength(tampered) })),
    }
    fs.writeFileSync(path.join(dir, "index.json"), Dossier.serialize(rewritten))
    const result = runReceipt(dir)
    expect(result.code).toBe(1)
    expect(result.out).toContain("index.json")
  })

  test("the digest is taken over exactly the bytes written, not a different serialisation", () => {
    // This shipped broken once: the digest was computed over the compact form while the
    // indented form was written, so a pristine dossier reported its own index as CHANGED.
    const idx = index([])
    expect(Dossier.indexDigest(idx)).toBe(Dossier.sha256(Dossier.serialize(idx)))
  })

  test("a path with a quote or a space in it cannot break out of the receipt", () => {
    const { dir } = fixture({ "corpus/od d' name.ndjson": "x\n" })
    expect(runReceipt(dir).code).toBe(0)
  })
})

describe("nfcore.dossier limits", () => {
  test("every declared limit points at evidence that exists", () => {
    // A limitation nobody can check is a disclaimer, and a disclaimer is discounted. This
    // also stops a limit outliving the defect it describes: delete the file, fail the test.
    const root = path.join(import.meta.dir, "..", "..", "..", "..")
    for (const limit of Dossier.LIMITS) {
      const file = limit.evidence.split(":")[0]!
      expect({ id: limit.id, file, exists: fs.existsSync(path.join(root, file)) }).toEqual({
        id: limit.id,
        file,
        exists: true,
      })
    }
  })

  test("every limit says in words what would retire it, or says it is inherent", () => {
    // A reader outside this project has to be able to act on it, so the condition is stated
    // rather than referred to: `null` means inherent, anything else names what removes it.
    for (const limit of Dossier.LIMITS) {
      expect({ id: limit.id, ok: limit.retiredBy === null || limit.retiredBy.trim().length > 0 }).toEqual({
        id: limit.id,
        ok: true,
      })
    }
  })

  test("the first limit is the expensive one, stated plainly", () => {
    // The most costly thing this project can say about itself belongs in the artefact a
    // reviewer actually receives, not in a plan they will not read.
    expect(Dossier.LIMITS[0]!.statement).toContain("does not show the result was correct")
  })
})

describe("nfcore.dossier refuses on a project that did not verify", () => {
  test("a recorded verification failure makes the receipt refuse, whatever the digests say", () => {
    // The gap the differential test found: every carried file can hash correctly — the
    // dossier faithfully recorded the corrupt bytes — while the corpus never matched its
    // own manifest. Internal consistency is not the claim; the receipt has to refuse.
    const { dir } = fixture({ "corpus/a.ndjson": '{"x":1}\n' })
    const broken: Dossier.Index = {
      ...index([]),
      verification: { ok: false, passed: 0, failed: 1, failures: ["corpus/a.manifest.json: sha256 mismatch"] },
    }
    const text = Dossier.serialize(broken)
    fs.writeFileSync(path.join(dir, "index.json"), text)
    fs.writeFileSync(path.join(dir, "verify.sh"), Dossier.verifyScript(broken, Dossier.sha256(text)))

    const result = runReceipt(dir)
    expect(result.code).toBe(1)
    expect(result.out).toContain("REFUSED")
    expect(result.out).toContain("did not verify")
    // The failing check travels verbatim, so the reader need not take `ok:false` on trust.
    expect(result.out).toContain("corpus/a.manifest.json")
  })
})
