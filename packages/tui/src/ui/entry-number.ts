/**
 * Entry numbers for the record.
 *
 * The number in the margin is the design's strongest signature and its most
 * fragile claim: a record whose numbers move under the reader is worse than a
 * record with no numbers at all. Everything here exists to make that impossible
 * rather than unlikely.
 *
 * Three facts about the data force the shape of this module.
 *
 * 1. An entry is a turn, not a message. An assistant turn arrives as several
 *    step messages that already render as one body, so the group key is the
 *    user message's own id, or an assistant message's parent id. Numbering by
 *    message would make the number advance while the model works.
 *
 * 2. The position in the loaded array is NOT the position in the record. The
 *    store keeps a rolling window of the last hundred messages and shifts the
 *    oldest out, so `index() + 1` is wrong for every session that outlives the
 *    window, and wrong in the direction that renumbers everything on screen.
 *
 * 3. Therefore the count of entries before the window has to come from outside,
 *    and until it does there is no honest number. `assign` returns undefined,
 *    the margin shows the clock alone, and nothing is invented. When the base
 *    arrives the numbers paint in. A number that appears is honest; a number
 *    that changes is the failure the design cannot survive.
 */

export type NumberedMessage = {
  id: string
  role?: string
  parentID?: string
}

/**
 * The key that identifies the turn a message belongs to. Undefined when the
 * message belongs to no turn that can be identified, in which case it is drawn
 * without a number rather than folded into its neighbour.
 */
export function groupKey(message: NumberedMessage): string | undefined {
  if (message.role === "user") return message.id
  return message.parentID ?? undefined
}

export type Numbering = {
  /**
   * Supplies the count of numbered entries that exist before the loaded window.
   * Called once, when the count is known. Calling it again with a different
   * value is ignored: a base that moves would move every number with it.
   */
  seed(base: number): void
  seeded(): boolean
  /**
   * The number for a turn, or undefined while the base is unknown. Stable for
   * the life of the process: a key that has been given a number keeps it, even
   * if the window slides past it and it comes back.
   */
  assign(key: string): number | undefined
  /** For tests and diagnostics. */
  size(): number
}

export function createNumbering(): Numbering {
  const assigned = new Map<string, number>()
  let base: number | undefined
  let next = 0

  return {
    seed(value) {
      if (base !== undefined) return
      if (!Number.isInteger(value) || value < 0) return
      base = value
      next = value
    },
    seeded() {
      return base !== undefined
    },
    assign(key) {
      if (base === undefined) return undefined
      const existing = assigned.get(key)
      if (existing !== undefined) return existing
      next += 1
      assigned.set(key, next)
      return next
    },
    size() {
      return assigned.size
    },
  }
}
