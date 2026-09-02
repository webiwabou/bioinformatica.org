import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { BioHttp } from "../../src/bio/http"

describe("bio.http", () => {
  test("a short download fails rather than becoming the answer", () => {
    const exit = Effect.runSyncExit(BioHttp.assertComplete("RepeatsDB", 15165, 15100))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(Effect.runSync(BioHttp.assertComplete("RepeatsDB", 100, 100).pipe(Effect.as("ok")))).toBe("ok")
  })

  test("the incompleteness message names both numbers", () => {
    const err = new BioHttp.Incomplete({ source: "RepeatsDB", expected: 15165, received: 15100 })
    expect(err.message).toContain("15100 of 15165")
  })

  test("a failed request is explicitly not an empty result", () => {
    const err = new BioHttp.RequestFailed({ source: "UniProt", url: "https://x", reason: "HTTP 429", status: 429 })
    expect(err.message).toContain("NOT an empty result")
  })

  test("only transient statuses are retried", () => {
    // A 400 means the request itself is wrong; retrying multiplies the same error.
    expect(BioHttp.isTransient(400)).toBe(false)
    expect(BioHttp.isTransient(404)).toBe(false)
    expect(BioHttp.isTransient(429)).toBe(true)
    expect(BioHttp.isTransient(503)).toBe(true)
    expect(BioHttp.isTransient(undefined)).toBe(true)
  })

  test("GraphQL errors arriving with a 200 are detected", () => {
    expect(BioHttp.graphqlErrors({ data: {}, errors: [{ message: "bad field" }] })).toBe("bad field")
    expect(BioHttp.graphqlErrors({ data: {} })).toBeUndefined()
    expect(BioHttp.graphqlErrors({ data: {}, errors: [] })).toBeUndefined()
  })
})
