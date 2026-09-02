import { describe, expect, test } from "bun:test"
import { createNumbering, groupKey } from "../../src/ui/entry-number"
import { clock, elapsed } from "../../src/ui/entry"

describe("entry numbering", () => {
  test("a turn is keyed by the user message, and its assistant steps join it", () => {
    expect(groupKey({ id: "msg_a", role: "user" })).toBe("msg_a")
    expect(groupKey({ id: "msg_b", role: "assistant", parentID: "msg_a" })).toBe("msg_a")
    expect(groupKey({ id: "msg_c", role: "assistant", parentID: "msg_a" })).toBe("msg_a")
  })

  test("a message that belongs to no identifiable turn gets no key", () => {
    expect(groupKey({ id: "msg_x", role: "assistant" })).toBeUndefined()
  })

  // The whole point of the module: no base, no number. The margin shows the
  // clock alone rather than a position in a window that slides.
  test("nothing is numbered until the base is known", () => {
    const numbering = createNumbering()
    expect(numbering.seeded()).toBe(false)
    expect(numbering.assign("msg_a")).toBeUndefined()
    expect(numbering.assign("msg_b")).toBeUndefined()
    expect(numbering.size()).toBe(0)
  })

  test("numbers start after the entries that came before the window", () => {
    const numbering = createNumbering()
    numbering.seed(12)
    expect(numbering.assign("msg_a")).toBe(13)
    expect(numbering.assign("msg_b")).toBe(14)
  })

  test("a number, once given, never changes", () => {
    const numbering = createNumbering()
    numbering.seed(0)
    expect(numbering.assign("msg_a")).toBe(1)
    expect(numbering.assign("msg_b")).toBe(2)
    // The window slides, msg_a leaves and comes back on a scroll.
    expect(numbering.assign("msg_a")).toBe(1)
    expect(numbering.assign("msg_c")).toBe(3)
  })

  test("a second base is refused, because it would move every number", () => {
    const numbering = createNumbering()
    numbering.seed(10)
    expect(numbering.assign("msg_a")).toBe(11)
    numbering.seed(500)
    expect(numbering.assign("msg_b")).toBe(12)
  })

  test("a nonsense base is refused rather than trusted", () => {
    const numbering = createNumbering()
    numbering.seed(-1)
    expect(numbering.seeded()).toBe(false)
    numbering.seed(1.5)
    expect(numbering.seeded()).toBe(false)
    numbering.seed(0)
    expect(numbering.seeded()).toBe(true)
  })

  test("numbering survives a long record without renumbering", () => {
    const numbering = createNumbering()
    numbering.seed(0)
    const first = Array.from({ length: 150 }, (_, i) => numbering.assign(`msg_${i}`))
    // Everything re-rendered, as it is on every store update.
    const again = Array.from({ length: 150 }, (_, i) => numbering.assign(`msg_${i}`))
    expect(again).toEqual(first)
    expect(first[0]).toBe(1)
    expect(first[149]).toBe(150)
  })
})

describe("the margin never changes width", () => {
  test("the clock is five columns", () => {
    expect(clock(new Date(2026, 8, 1, 4, 7).getTime())).toBe("04:07")
    expect(clock(new Date(2026, 8, 1, 16, 41).getTime())).toBe("16:41")
    expect(clock(new Date(2026, 8, 1, 16, 41).getTime()).length).toBe(5)
  })

  test("elapsed time steps its scale so it always fits", () => {
    expect(elapsed(0)).toBe("+0s")
    expect(elapsed(11_000)).toBe("+11s")
    expect(elapsed(60_000)).toBe("+1m")
    expect(elapsed(41 * 60_000)).toBe("+41m")
    expect(elapsed(3 * 3_600_000 + 14 * 60_000)).toBe("+3h14")
    expect(elapsed(12 * 3_600_000 + 5 * 60_000)).toBe("+12h")
    for (const ms of [0, 999, 59_000, 60_000, 3_599_000, 3_600_000, 12 * 3_600_000 + 5 * 60_000]) {
      expect(elapsed(ms).length).toBeLessThanOrEqual(5)
    }
  })
})
