import { describe, expect, test } from "bun:test"
import { RepeatsDB } from "../../src/bio/repeatsdb"

// Shape taken verbatim from a live response (2026-08-25).
const page = {
  count: 47427,
  items: {
    "0": {
      content: {
        chain: { structure: "1a0c", id: "A", source: "RCSB/PDB" },
        loci: [
          { type: "region", start: "42", end: "375", class: "4.1.1" },
          { type: "unit", start: "42", end: "93", parent: 0, class: "" },
          { type: "unit", start: "94", end: "132", parent: 0, class: "" },
        ],
        features: { "UniProt-P19148": { uniprot_id: "P19148" }, "GO-0000287": { go_id: "GO:0000287" } },
      },
    },
    "1": {
      content: {
        chain: { structure: "A0A010", id: "A", source: "AlphaFoldDB" },
        loci: [{ type: "region", start: "1", end: "99", class: "3.2" }],
        features: {},
      },
    },
  },
}

describe("bio.repeatsdb parsing", () => {
  test("items is an OBJECT keyed by index, not an array", () => {
    // A naive `Array.isArray(items)` client parses zero records here and reports an
    // empty already-annotated set — which would make every entry look novel.
    expect(Array.isArray(page.items)).toBe(false)
    const parsed = RepeatsDB.parsePage(page)!
    expect(parsed.annotations).toHaveLength(2)
    expect(parsed.count).toBe(47427)
  })

  test("keys are read in numeric order", () => {
    const shuffled = { count: 3, items: { "2": page.items["0"], "10": page.items["1"], "1": page.items["0"] } }
    const parsed = RepeatsDB.parsePage(shuffled)!
    // "10" must sort after "2", not before it as a string compare would give.
    expect(parsed.annotations).toHaveLength(3)
    expect(parsed.annotations[2]!.source).toBe("AlphaFoldDB")
  })

  test("coordinates arrive as strings and are preserved verbatim", () => {
    const a = RepeatsDB.parsePage(page)!.annotations[0]!
    expect(a.loci[0]!.start).toBe("42")
    expect(typeof a.loci[0]!.start).toBe("string")
  })

  test("UniProt accessions are lifted out of the prefixed feature keys", () => {
    const a = RepeatsDB.parsePage(page)!.annotations[0]!
    expect(a.uniprot).toEqual(["P19148"])
    // GO features share the dictionary and must not be mistaken for accessions.
    expect(a.uniprot).not.toContain("0000287")
  })

  test("the join key is lowercase pdb id plus author chain", () => {
    expect(RepeatsDB.chainKey({ structure: "1A0C", chain: "A" })).toBe("1a0c_A")
  })

  test("an AlphaFoldDB record carries a UniProt accession in the structure field", () => {
    const a = RepeatsDB.parsePage(page)!.annotations[1]!
    expect(a.source).toBe("AlphaFoldDB")
    expect(a.structure).toBe("A0A010")
  })

  test("an unrecognised body is rejected rather than read as empty", () => {
    expect(RepeatsDB.parsePage(null)).toBeUndefined()
    expect(RepeatsDB.parsePage({ items: {} })).toBeUndefined()
    // A body with a count but no items is a real (if odd) empty page.
    expect(RepeatsDB.parsePage({ count: 0, items: {} })?.annotations).toEqual([])
  })

  test("the API's hard page cap is encoded, not assumed", () => {
    expect(RepeatsDB.MAX_LIMIT).toBe(100)
  })
})
