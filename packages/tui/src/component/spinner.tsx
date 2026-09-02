import { Show, createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import { usePulse } from "../context/pulse"
import { MARK_INNER, MARK_OUTER } from "../logo"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"

/**
 * The ring: the product's mark, linearised, waiting.
 *
 * Six cells, one filled dot travelling among five hollow ones, wrapping around.
 * A ring cycles; it does not bounce, because a bounce reads as a scanner and
 * this scans nothing. It replaces the ten braille frames at 80ms, which are the
 * single most recognisable glyph set in any generic CLI and were also the only
 * motion in the application.
 *
 * The rhythm carries information: one step per second for the first minute,
 * every two after that, every four past ten minutes and every twelve past the
 * hour. At hour three the ring completes a turn every seventy-two seconds, and
 * the machine visibly settles into its breathing. Without that, the busy state
 * was identical at minute one and at hour four.
 *
 * It does not use `<spinner>`: the rhythm comes from counting beats of the
 * application's single clock, never from changing an interval. opentui-spinner
 * 0.0.7 throws a RangeError for any interval outside [1000/60, 1000] rather than
 * clamping it, so any step slower than a second would crash the component.
 *
 * The glyphs come from `logo.ts` on purpose, so that the ring is the mark and
 * not a shape that resembles it.
 */
export const RING_CELLS = 6

/** How many beats one step consumes, given the age of the work. */
export function ringStep(ageMs: number): number {
  if (ageMs < 60_000) return 1
  if (ageMs < 600_000) return 2
  if (ageMs < 3_600_000) return 4
  return 12
}

export function ring(position: number): string {
  let out = ""
  for (let cell = 0; cell < RING_CELLS; cell++) out += cell === position ? MARK_OUTER : MARK_INNER
  return out
}

/** The ring stopped at its first position: nothing is moving, it is your turn. */
export const RING_STILL = ring(0)

/**
 * The ring as a plain frame list, for renderers that cannot reach the pulse.
 *
 * The CLI's run footer draws its own opentui tree outside the TUI application,
 * so it has no PulseProvider above it and cannot use `<Spinner>`. It gets the
 * same six frames at a fixed second per step instead of the rhythm that slows
 * with the age of the job.
 */
export const RING_FRAMES = Array.from({ length: RING_CELLS }, (_, cell) => ring(cell))

export function Spinner(props: {
  children?: JSX.Element
  color?: RGBA
  /** When the work started, if known, so the ring can slow down as it ages. */
  since?: number
}) {
  const { theme } = useTheme()
  const kv = useKV()
  const pulse = usePulse()
  const color = () => props.color ?? theme.textMuted

  const tick = pulse.follow()
  const frame = createMemo(() => {
    const age = props.since ? Date.now() - props.since : 0
    return ring(Math.floor(tick() / ringStep(age)) % RING_CELLS)
  })

  return (
    <Show
      when={kv.get("animations_enabled", true)}
      fallback={
        <text fg={color()}>
          {RING_STILL} {props.children}
        </text>
      }
    >
      <box flexDirection="row" gap={1}>
        <text fg={color()}>{frame()}</text>
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
