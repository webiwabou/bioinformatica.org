import { describe, expect, test } from "bun:test"
import { CorpusSnapshot } from "../../src/bio/snapshot"

describe("bio.snapshot", () => {
  test("NDJSON is one record per line and ends with a newline", () => {
    const text = CorpusSnapshot.toNdjson([{ a: 1 }, { b: 2 }])
    expect(text).toBe('{"a":1}\n{"b":2}\n')
    expect(text.split("\n").filter(Boolean)).toHaveLength(2)
  })

  test("an empty corpus writes no trailing newline, so rows==0 is unambiguous", () => {
    expect(CorpusSnapshot.toNdjson([])).toBe("")
  })

  test("the checksum is stable and content-dependent", () => {
    const a = CorpusSnapshot.sha256(CorpusSnapshot.toNdjson([{ x: 1 }]))
    expect(a).toBe(CorpusSnapshot.sha256(CorpusSnapshot.toNdjson([{ x: 1 }])))
    expect(a).not.toBe(CorpusSnapshot.sha256(CorpusSnapshot.toNdjson([{ x: 2 }])))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  test("a missing upstream release is stated, not hidden", () => {
    // Some sources publish no version at all (RepeatsDB is one). Recording that fact is
    // the honest outcome; silently omitting the line would read as though it were versioned.
    const out = CorpusSnapshot.describe({
      source: "RepeatsDB",
      endpoint: "https://repeatsdb.org/api/production/annotations",
      fetchedAt: "2026-08-25T00:00:00.000Z",
      rows: 15165,
      bytes: 100,
      sha256: "abc",
      data: "repeatsdb.ndjson",
    })
    expect(out).toContain("source publishes no version")
  })

  test("a release stamp is surfaced verbatim when the source has one", () => {
    const out = CorpusSnapshot.describe({
      source: "SIFTS",
      endpoint: "https://ftp.ebi.ac.uk/...",
      release: "PDB: 33.26 | UniProt: 2026.03",
      fetchedAt: "2026-08-25T00:00:00.000Z",
      rows: 1013122,
      bytes: 100,
      sha256: "abc",
      data: "sifts.ndjson",
    })
    expect(out).toContain("PDB: 33.26 | UniProt: 2026.03")
  })
})
