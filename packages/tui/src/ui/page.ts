/**
 * The page: the one grid the record is drawn on.
 *
 * Every row of the transcript lands on these columns and no others. Before this
 * existed, the same turn was drawn with three disagreeing left paddings: prose
 * at column 5, tool labels at 7, the turn footer at 8, and a pending tool's
 * marker at 10 that snapped to 7 the instant the call resolved, which made that
 * three column jump the dominant motion on screen over a long campaign.
 *
 *   0 . . . 4 | 5 | 6 | 7 . . . . . . . . . . . . . . . . . . . . . . . 77
 *   the margin  rule gap  the body, wrapping at 71 columns
 *
 * The margin carries the entry number on its first row and a clock underneath,
 * both right-aligned. The rule is one thin glyph that belongs to the entry, not
 * to the page: it stops at the blank row between entries, so scrolling shows a
 * column of interrupted strokes with numbers beside them, which is a ruled book
 * and not a rail.
 *
 * `body` is `margin + rule + gap` and is stated rather than computed at each
 * call site, because every one of those call sites getting it right separately
 * is exactly how the interface ended up with three of them.
 */
export const PAGE = {
  margin: 5,
  rule: 1,
  gap: 1,
  body: 7,
  measure: 71,
} as const

/** The margin's own width, for a component that needs to reserve it. */
export const MARGIN_WIDTH = PAGE.margin
