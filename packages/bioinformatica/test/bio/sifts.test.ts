import { describe, expect, test } from "bun:test"
import { Sifts } from "../../src/bio/sifts"

// Verbatim from the live file, 2026-08-25.
const HEADER = "# 2026/08/17 - 18:31 | PDB: 33.26 | UniProt: 2026.03"
const COLUMNS = "PDB\tCHAIN\tSP_PRIMARY\tRES_BEG\tRES_END\tPDB_BEG\tPDB_END\tSP_BEG\tSP_END"
const ROW = "101m\tA\tP02185\t1\t154\t0\t153\t1\t154"

describe("bio.sifts", () => {
  test("captures the release stamp, which is the file's only version identity", () => {
    const v = Sifts.parseVersion(HEADER)!
    expect(v.pdb).toBe("33.26")
    expect(v.uniprot).toBe("2026.03")
    expect(v.line).toBe(HEADER)
  })

  test("the provenance line is not a data row", () => {
    // Treating '#' as the header shifts every column by one line and silently
    // mislabels the whole mapping.
    expect(Sifts.parseVersion(COLUMNS)).toBeUndefined()
    expect(Sifts.parseVersion(ROW)).toBeUndefined()
  })

  test("parses a table, skipping the comment and the column header", () => {
    const { table } = Sifts.parseTable([HEADER, COLUMNS, ROW, ""].join("\n"))
    expect(table!.rows).toHaveLength(1)
    expect(table!.rows[0]).toMatchObject({ pdb: "101m", chain: "A", accession: "P02185", spBeg: "1", spEnd: "154" })
    expect(table!.version.pdb).toBe("33.26")
  })

  test("refuses a file with no version stamp instead of inventing one", () => {
    // An unversioned join at the base of a campaign cannot be cited or reproduced.
    const { table, error } = Sifts.parseTable([COLUMNS, ROW].join("\n"))
    expect(table).toBeUndefined()
    expect(error).toContain("provenance")
  })

  test("PDB ids are normalised to lowercase so the join key matches RepeatsDB", () => {
    expect(Sifts.parseRow("101M\tA\tP02185\t1\t154\t0\t153\t1\t154")!.pdb).toBe("101m")
    expect(Sifts.chainKey({ pdb: "101M", chain: "A" })).toBe("101m_A")
  })

  test("CRLF line endings do not contaminate the last field", () => {
    // The live EBI files are CRLF. Without stripping it, SP_END parses as "154\r" and
    // every numeric comparison against it silently fails.
    const row = Sifts.parseRow("101m\tA\tP02185\t1\t154\t0\t153\t1\t154\r")!
    expect(row.spEnd).toBe("154")
    const { table } = Sifts.parseTable([HEADER, COLUMNS, ROW + "\r", ""].join("\n"))
    expect(table!.rows[0]!.spEnd).toBe("154")
  })

  test("an empty column is preserved as empty, not shifted away", () => {
    // Real row from 1a0c: PDB_END is genuinely blank. Collapsing it would shift every
    // later field left by one and mislabel the UniProt range.
    const row = Sifts.parseRow("1a0c\tA\tP19148\t1\t438\t1\t\t2\t439")!
    expect(row.pdbBeg).toBe("1")
    expect(row.pdbEnd).toBe("")
    expect(row.spBeg).toBe("2")
    expect(row.spEnd).toBe("439")
  })

  test("short or malformed lines are skipped, not half-parsed", () => {
    expect(Sifts.parseRow("101m\tA\tP02185")).toBeUndefined()
  })
})
