// The CLI banner, rendered two columns at a time by `logo()` in the CLI's ui.ts:
// the left column is the mark, the right column the name. It used to be the product
// name set as block letterforms, which works for a five-letter name and not for an
// eighteen-character one — the same reason the home mark below is built the way it is.
export const logo = {
  left: ["╲    ╱", " ╲╱╲╱ ", " ╱╲╱╲ ", "╱    ╲"],
  right: ["", "Bioinformática.org", "co-científico de bioinformática", ""],
}

// The home / session-start wordmark.
//
// The previous mark set the product name as tall box-drawing letterforms, which
// works for a five-letter name and not for this one: "Bioinformática.org" is
// eighteen characters and would run off a standard terminal before it finished.
// So the mark carries the meaning and the name is set as text beside it — a
// double helix, drawn in the same monoline weight as the CLI logo above.
export const home = {
  word: [
    "╲    ╱",
    " ╲╱╲╱ ",
    " ╱╲╱╲    Bioinformática.org",
    "╱    ╲",
    "╲    ╱   co-científico de bioinformática",
    " ╲╱╲╱ ",
    " ╱╲╱╲ ",
    "╱    ╲",
  ],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
