import { describe, expect, test } from "bun:test"
import { UniProt } from "../../src/bio/uniprot"

describe("bio.uniprot bulk retrieval", () => {
  test("cursor pagination follows the Link header verbatim", () => {
    const header =
      '<https://rest.uniprot.org/uniprotkb/search?format=json&query=reviewed%3Atrue&cursor=8e9tj6dnc2z&size=500>; rel="next"'
    expect(UniProt.nextLink(header)).toBe(
      "https://rest.uniprot.org/uniprotkb/search?format=json&query=reviewed%3Atrue&cursor=8e9tj6dnc2z&size=500",
    )
  })

  test("the ABSENCE of a Link header is the only termination signal", () => {
    // Not an empty page and not a short page: the API keeps returning full pages until
    // it simply stops emitting the header.
    expect(UniProt.nextLink(undefined)).toBeUndefined()
    expect(UniProt.nextLink("")).toBeUndefined()
    expect(UniProt.nextLink('<https://x>; rel="prev"')).toBeUndefined()
  })

  test("the page size is set explicitly because the default silently truncates", () => {
    // Live: a request with no `size` returns 25 rows with HTTP 200 while
    // X-Total-Results says 575503. No warning, no error.
    expect(UniProt.MAX_PAGE).toBe(500)
  })

  test("the mining projection requests the fields that carry free text and the PDB join", () => {
    // None of these are in the default projection, and TSV/FASTA default to 7 columns
    // that include none of them — so text mining over defaults finds nothing.
    for (const f of ["keyword", "cc_function", "cc_domain", "cc_similarity", "ft_repeat", "xref_pdb", "reviewed"]) {
      expect(UniProt.MINING_FIELDS.split(",")).toContain(f)
    }
    // It is `keyword`, singular. `keywords` is not a legal field name and returns 400.
    expect(UniProt.MINING_FIELDS.split(",")).not.toContain("keywords")
  })
})
