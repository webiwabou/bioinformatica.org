export * as BioHttp from "./http"

import { Data, Effect, Schedule } from "effect"
import { isRecord } from "@/util/record"

// Shared HTTP behaviour for the biological database clients.
//
// The rule this file exists to enforce: a request that failed must never look like a
// query that found nothing. Every client here used to end in
// `Effect.catch(() => Effect.succeed(undefined))`, so a 429 from a rate limiter, a 400
// from an oversized page request, or a dropped connection all reached the model as
// "No entries found." That is survivable when citing a paper and fatal when building a
// set that will be SUBTRACTED from another: whatever survives the subtraction is called
// novel, so a silently truncated download does not weaken a novelty claim — it
// manufactures one.

/** A request that did not produce trustworthy data. Never conflate with an empty result. */
export class RequestFailed extends Data.TaggedError("BioRequestFailed")<{
  readonly source: string
  readonly url: string
  readonly reason: string
  /** HTTP status where there was one. */
  readonly status?: number
}> {
  override get message(): string {
    return `${this.source} request failed (${this.reason}) — this is NOT an empty result: ${this.url}`
  }
}

/** A paginated download whose row count disagreed with the total the service reported. */
export class Incomplete extends Data.TaggedError("BioIncomplete")<{
  readonly source: string
  readonly expected: number
  readonly received: number
}> {
  override get message(): string {
    return `${this.source} returned ${this.received} of ${this.expected} records. Refusing to treat a partial download as a complete set.`
  }
}

export type BioError = RequestFailed | Incomplete

/**
 * Retry transient failures only. A 400 means the request was wrong and will stay wrong;
 * retrying it just multiplies the same error. 429 and 5xx are worth backing off from.
 */
export function isTransient(status: number | undefined): boolean {
  if (status === undefined) return true // network-level: worth one retry
  return status === 408 || status === 429 || status >= 500
}

export const retryPolicy = Schedule.exponential("500 millis").pipe(Schedule.take(4))

/**
 * Minimum spacing between requests to one host. Serialising per host costs less
 * wall-clock than tripping a limiter, and a throttled request fails silently.
 */
export const DEFAULT_SPACING_MS = 350

/**
 * Retry a request, but only for statuses that can plausibly succeed on a second attempt.
 * Typed once here so every client gets the same policy and the same error channel.
 */
export function retryTransient<A, R>(
  effect: Effect.Effect<A, RequestFailed, R>,
): Effect.Effect<A, RequestFailed, R> {
  return Effect.retry(effect, { schedule: retryPolicy, while: (e: RequestFailed) => isTransient(e.status) })
}

export function pace(spacingMs = DEFAULT_SPACING_MS) {
  let last = 0
  return Effect.fnUntraced(function* () {
    const wait = Math.max(0, last + spacingMs - Date.now())
    if (wait > 0) yield* Effect.sleep(`${wait} millis`)
    last = Date.now()
  })
}

/**
 * GraphQL reports errors in the body with a 200 status, so `filterStatusOk` passes them
 * through as if they were data. Callers must check.
 */
export function graphqlErrors(body: unknown): string | undefined {
  if (!isRecord(body) || !Array.isArray(body.errors) || body.errors.length === 0) return undefined
  return body.errors
    .map((e) => (isRecord(e) && typeof e.message === "string" ? e.message : JSON.stringify(e)))
    .join("; ")
}

/**
 * Assert a paginated download is complete. `expected` is the total the service itself
 * reported; refusing to continue is the point.
 */
export function assertComplete(source: string, expected: number, received: number): Effect.Effect<void, Incomplete> {
  if (received === expected) return Effect.void
  return Effect.fail(new Incomplete({ source, expected, received }))
}
