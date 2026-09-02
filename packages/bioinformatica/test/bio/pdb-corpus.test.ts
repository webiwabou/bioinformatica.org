import { describe, expect, test } from "bun:test"
import { PDB } from "../../src/bio/pdb"

describe("bio.pdb corpus retrieval", () => {
  test("reads ids from compact responses (bare strings)", () => {
    // results_verbosity: "compact" changes the ELEMENT TYPE of result_set.
    expect(PDB.parseSearchIds({ total_count: 2, result_set: ["3GOU", "6IHX"] })).toEqual(["3GOU", "6IHX"])
  })

  test("reads ids from default responses (objects with .identifier)", () => {
    expect(PDB.parseSearchIds({ result_set: [{ identifier: "3GOU", score: 1 }] })).toEqual(["3GOU"])
  })

  test("a missing result_set is an empty page, not a crash", () => {
    // Paging past the end returns HTTP 200 with the key absent entirely.
    expect(PDB.parseSearchIds({ query_id: "x", result_type: "entry", total_count: 9140 })).toEqual([])
    expect(PDB.parseSearchIds(undefined)).toEqual([])
  })

  test("SEQRES is per ENTITY and must be fanned out across author chains", () => {
    // 4HHB_1 is chains A and C; counting entities as chains undercuts the corpus by ~half.
    const body = {
      data: {
        entries: [
          {
            rcsb_id: "4HHB",
            polymer_entities: [
              {
                entity_poly: { pdbx_seq_one_letter_code_can: "VLSPADKTNVKAAWGKV" },
                rcsb_polymer_entity: { pdbx_description: "Hemoglobin subunit alpha" },
                rcsb_polymer_entity_container_identifiers: { entity_id: "1", auth_asym_ids: ["A", "C"] },
              },
              {
                entity_poly: { pdbx_seq_one_letter_code_can: "VHLTPEEKSAVTALWGKV" },
                rcsb_polymer_entity: { pdbx_description: "Hemoglobin subunit beta" },
                rcsb_polymer_entity_container_identifiers: { entity_id: "2", auth_asym_ids: ["B", "D"] },
              },
            ],
          },
        ],
      },
    }
    const chains = PDB.parseChains(body)
    expect(chains.map((c) => c.authChain)).toEqual(["A", "C", "B", "D"])
    expect(chains[1]!.sequence).toBe(chains[0]!.sequence)
    expect(chains[1]!.entityId).toBe("1")
  })

  test("the chain key uses the AUTHOR chain, matching RepeatsDB and SIFTS", () => {
    // A polymer_instance identifier like "7K00.DB" carries the LABEL asym id: for 7K00,
    // 35 of 56 instances differ from the author chain (DB is author chain "5"). Keying a
    // corpus on that suffix silently mis-joins a third of a large complex.
    expect(PDB.chainKey({ entry: "7K00", authChain: "5" })).toBe("7k00_5")
    expect(PDB.chainKey({ entry: "1A0C", authChain: "A" })).toBe("1a0c_A")
  })

  test("the GraphQL id cap is encoded and the batch stays well under it", () => {
    expect(PDB.GRAPHQL_MAX_IDS).toBe(1000)
    expect(PDB.GRAPHQL_BATCH).toBeLessThanOrEqual(PDB.GRAPHQL_MAX_IDS)
  })

  test("the mining fields exclude the one that is always null", () => {
    // struct.pdbx_descriptor was null in 60/60 sampled entries.
    expect(PDB.TEXT_FIELDS).not.toContain("struct.pdbx_descriptor")
    expect(PDB.TEXT_FIELDS).toContain("struct.title")
  })
})
