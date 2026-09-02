import { Show } from "solid-js"
import type { JSX } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { PAGE } from "./page"

/**
 * The clock that fits the margin.
 *
 * Five columns, always. The design document asked for `+04:11` under the hour,
 * which is six characters and does not fit beside a five column number, so the
 * scale steps instead of counting: seconds, then minutes, then hours and
 * minutes. A reader does not need the seconds of a job that has been running
 * for forty one minutes, and the one thing the margin cannot do is change width.
 */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `+${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `+${minutes}m`
  const hours = Math.floor(minutes / 60)
  // Past ten hours the minutes would push the margin to six columns, and a job
  // that old is not read to the minute anyway.
  if (hours >= 10) return `+${hours}h`
  return `+${hours}h${String(minutes % 60).padStart(2, "0")}`
}

/** A twenty four hour clock, fixed width, unlike the locale's short time. */
export function clock(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

export type EntryProps = {
  /**
   * The entry's number, when it can be derived. Never invent one: the transcript
   * is a rolling window of the last hundred messages, so the position in the
   * loaded array is not the position in the record, and a number that moves
   * under the reader is worse than no number at all.
   */
  number?: number
  /** The opening time, or the elapsed time while the entry is still open. */
  clock?: string
  /** An open entry keeps its rule and counts in the margin. */
  open?: boolean
  children?: JSX.Element
}

/**
 * One entry of the record: a margin, a rule, and a body.
 *
 * The rule is drawn by the box's own left border with the default border
 * characters, whose vertical glyph is already the thin `│` the design wants, so
 * there is no character table here and no glyph arithmetic. It is never
 * coloured by anything: an agent, a severity or a state changes what is written
 * in the body, never the colour of the rule, because a rule that changes colour
 * is a rail and a rail is what this replaces.
 *
 * The separator between entries is a sibling blank row drawn by the caller, not
 * a gap on the parent, so that the rule visibly stops between one entry and the
 * next.
 */
export function Entry(props: EntryProps) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row">
      <box width={PAGE.margin} flexShrink={0}>
        <text fg={theme.text}>{props.number === undefined ? "" : String(props.number).padStart(PAGE.margin)}</text>
        <Show when={props.clock}>
          <text fg={theme.textMuted}>{props.clock!.padStart(PAGE.margin)}</text>
        </Show>
      </box>
      <box flexGrow={1} border={["left"]} borderColor={theme.border} paddingLeft={PAGE.gap}>
        {props.children}
      </box>
    </box>
  )
}

/**
 * A labelled hairline.
 *
 * Drawn with the engine's own title-in-border run, which the tree already
 * proves at routes/session/index.tsx for the compaction marker. Two constraints
 * are load bearing and neither is obvious:
 *
 *   - A title longer than `width - 4` is dropped silently. No truncation, no
 *     error, just an unlabelled line. The label is clipped here instead.
 *   - `bottomTitle` renders only when the border includes the bottom side, and
 *     there is no `bottomTitleColor` at all, so a rule under a block is another
 *     one of these placed after it, never one box with two titles.
 */
export function Hairline(props: { label?: string; align?: "left" | "center" | "right"; width?: number }) {
  const { theme } = useTheme()
  const label = () => {
    if (!props.label) return undefined
    const room = (props.width ?? PAGE.measure) - 4
    return props.label.length > room ? props.label.slice(0, Math.max(0, room)) : props.label
  }
  return <box border={["top"]} borderColor={theme.border} title={label()} titleAlignment={props.align ?? "left"} />
}
