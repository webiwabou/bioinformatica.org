import { describe, expect, test } from "bun:test"
import { Glue } from "../../src/bio/glue"

const body = (name: string) => Glue.SCRIPTS.find((s) => s.name === name)!.content

describe("bio.glue", () => {
  test("ships the three coordinate-bookkeeping scripts with real content", () => {
    expect(Glue.SCRIPTS.map((s) => s.name)).toEqual([
      "map-seqres-atom.py",
      "cut-fragments.py",
      "propagate-representatives.py",
    ])
    for (const s of Glue.SCRIPTS) {
      // A bare `.py` import returns the PATH, not the file — this asserts the text
      // loader actually inlined the source.
      expect(s.content).toContain("#!/usr/bin/env python3")
      expect(s.content.length).toBeGreaterThan(500)
    }
  })

  test("the cutter never uses Dice.extract", () => {
    // Verified live on 1VJE 301:401 — Dice.extract wrote an EMPTY file and raised
    // nothing, because both residues in that range are MSE, which is a HETATM.
    const text = body("cut-fragments.py")
    // The docstring names it deliberately; what must be absent is any USE of it.
    expect(text).not.toMatch(/^\s*(from|import).*\bDice\b/m)
    expect(text).not.toContain("Dice.extract(")
    expect(text).toContain("Deliberately NOT Bio.PDB.Dice.extract")
  })

  test("the cutter keys on (resseq, icode), not the residue number alone", () => {
    const text = body("cut-fragments.py")
    expect(text).toContain("(resseq, icode)")
    // 12E8 chain H numbers residues 82, 82A, 82B, 82C — selecting on the number alone
    // collapses four residues into one.
    expect(text).toContain("icode")
  })

  test("the cutter keeps modified residues", () => {
    // standard=False is what retains MSE; is_aa(..., standard=True) would drop it.
    expect(body("cut-fragments.py")).toContain("standard=False")
  })

  test("the mapper reads SEQRES from the author-chain field, not SeqIO's label ids", () => {
    const text = body("map-seqres-atom.py")
    expect(text).toContain("_entity_poly.pdbx_strand_id")
    expect(text).toContain("pdbx_seq_one_letter_code_can")
    // In 12E8 cif-seqres reports A/B/C/D while the model chains are L/H/M/P, so
    // matching a SeqIO record id against an author chain finds nothing.
    expect(text).toContain("cif-seqres")
    expect(text).toContain("NOT SeqIO")
  })

  test("the mapper uses the modern aligner and derives the map from aligned blocks", () => {
    const text = body("map-seqres-atom.py")
    expect(text).toContain("PairwiseAligner")
    expect(text).not.toContain("pairwise2")
    expect(text).toContain("alignment.aligned")
    // Unmodelled termini are a fact of crystallography, not a mismatch.
    expect(text).toContain("target_end_gap_score")
  })

  test("propagation refuses to cross a length difference", () => {
    // CD-HIT normalises identity by the SHORTER sequence, so a perfect substring
    // clusters at 100% with numbering offset from the representative's.
    const text = body("propagate-representatives.py")
    expect(text).toContain("SHORTER")
    expect(text).toContain("length differs from representative")
    expect(text).toContain("-aL 1.0")
    expect(text).toContain("-d 0")
  })

  test("every script states what it guards against", () => {
    for (const s of Glue.SCRIPTS) expect(s.guards.length).toBeGreaterThan(80)
    expect(Glue.describe()).toContain("Dice.extract")
  })
})
