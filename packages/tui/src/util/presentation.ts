const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"

// Printed to the terminal scrollback when an interactive session ends. Intentionally
// logo-free: just the resume hint, no branding art.
export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}bioinformatica -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}
