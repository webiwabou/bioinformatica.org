import { expect, test } from "bun:test"
import { copyCommand, resolveResult } from "../src/clipboard"

test("prefers Wayland clipboard when available", () => {
  expect(copyCommand("linux", true, (name) => name === "wl-copy")).toEqual(["wl-copy"])
})

test("uses osascript on macOS", () => {
  expect(copyCommand("darwin", false, (name) => name === "osascript")).toEqual(["osascript"])
})

test("falls back through X11 clipboard commands", () => {
  expect(copyCommand("linux", true, (name) => name === "xclip")).toEqual(["xclip", "-selection", "clipboard"])
  expect(copyCommand("linux", false, (name) => name === "xsel")).toEqual(["xsel", "--clipboard", "--input"])
})

test("returns undefined when native clipboard is unavailable", () => {
  expect(copyCommand("linux", false, () => false)).toBeUndefined()
})

test("a confirmed backend write is reported as copied", () => {
  expect(resolveResult({ emitted: true, hasNative: true, ranOk: true })).toBe("copied")
  expect(resolveResult({ emitted: false, hasNative: false, ranOk: true })).toBe("copied")
})

test("a present-but-erroring backend is a real failure, not a false success", () => {
  expect(resolveResult({ emitted: true, hasNative: true, ranOk: false })).toBe("failed")
})

test("with no backend, OSC 52 emission is reported honestly as unverifiable", () => {
  // The Ptyxis/VTE case: no wl-copy/xclip/xsel, OSC 52 emitted but may be dropped.
  expect(resolveResult({ emitted: true, hasNative: false, ranOk: false })).toBe("osc52-only")
})

test("no backend and not even a TTY to emit OSC 52 is a failure", () => {
  expect(resolveResult({ emitted: false, hasNative: false, ranOk: false })).toBe("failed")
})
