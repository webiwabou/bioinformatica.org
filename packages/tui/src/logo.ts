// The product mark: two nested rings of six dots, the inner ring rotated a sixth
// of a turn against the outer one.
//
// The two rings use different glyphs rather than relying on colour alone, so the
// shape still reads on a terminal with no colour, in a pipe, or in a screenshot.
// A renderer that does have colour paints them apart: teal outside, muted inside.
export const MARK_OUTER = "●"
export const MARK_INNER = "◦"

export const mark = [
  "      ●      ",
  "●    ◦ ◦    ●",
  "    ◦   ◦    ",
  "●    ◦ ◦    ●",
  "      ●      ",
]

// The CLI banner, rendered two columns at a time by `logo()` in the CLI's ui.ts:
// the left column is the mark, the right column the name.
export const logo = {
  left: mark,
  right: ["", "Bioinformática.org", "bioinformatics co-scientist", "", ""],
}

// The home / session-start wordmark. The name is set as text beside the mark
// rather than as block letterforms: "Bioinformática.org" is eighteen characters
// and would run off a standard terminal before it finished.
export const home = {
  word: [
    "      ●      ",
    "●    ◦ ◦    ●   Bioinformática.org",
    "    ◦   ◦    ",
    "●    ◦ ◦    ●   bioinformatics co-scientist",
    "      ●      ",
  ],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
