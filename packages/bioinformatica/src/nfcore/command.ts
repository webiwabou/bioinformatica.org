export * as NfcoreCommand from "./command"

// Deterministic construction of the exact `nextflow run` command for an nf-core
// pipeline. This module only builds the command string — it never runs anything.
// Execution goes through the shell tool, which shows the command and asks for
// approval before running it. A test-profile run is compute
// like any other and is the session's first approval gate.

export type Backend = "docker" | "conda" | "singularity"
export type Mode = "test" | "run"

export interface BuildInput {
  readonly pipeline: string
  readonly release: string
  readonly backend: Backend
  readonly mode: Mode
  readonly outdir: string
  // Samplesheet path; used for a real run. The test profile bundles its own input.
  readonly input?: string
  readonly params?: Record<string, string>
  readonly extraProfiles?: readonly string[]
  readonly resume?: boolean
  // Extra Nextflow config files (`-c`), e.g. a resource-limits config.
  readonly configs?: readonly string[]
}

export interface Built {
  readonly command: string
  readonly argv: string[]
  readonly notes: string[]
}

// Quote a value for a copy-pasteable shell command only when it needs it.
function shellQuote(value: string): string {
  if (value.length > 0 && /^[A-Za-z0-9_@%+=:,.\/-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function build(input: BuildInput): Built {
  const pipeline = input.pipeline.replace(/^nf-core\//, "")
  const profiles = [
    ...(input.mode === "test" ? ["test"] : []),
    ...(input.extraProfiles ?? []),
    input.backend,
  ]

  const argv = ["nextflow", "run", `nf-core/${pipeline}`, "-r", input.release, "-profile", profiles.join(",")]
  for (const config of input.configs ?? []) argv.push("-c", config)
  argv.push("--outdir", input.outdir)

  // A real run consumes the samplesheet; the test profile supplies its own data,
  // so never pass --input in test mode (it would override the bundled test input).
  if (input.mode === "run" && input.input) argv.push("--input", input.input)

  for (const [key, value] of Object.entries(input.params ?? {})) {
    argv.push(`--${key}`, value)
  }

  if (input.resume) argv.push("-resume")

  const command = argv.map((token, i) => (i >= 4 ? shellQuote(token) : token)).join(" ")

  const notes: string[] = []
  notes.push(
    "This is a compute run: show this exact command and get approval before running it through the shell tool.",
  )
  if (input.mode === "test") {
    notes.push(
      "Test profile: runs the pipeline on tiny bundled reference data to prove the environment works. Run this before the real data.",
    )
  } else {
    notes.push("Real run: uses the samplesheet you built. Only do this after a successful test-profile run.")
    if (!input.input) notes.push("No --input samplesheet was provided; a real run needs one.")
  }
  notes.push(`Container backend: ${input.backend}.`)

  return { command, argv, notes }
}

export function summarize(built: Built): string {
  return [built.command, "", ...built.notes.map((n) => `- ${n}`)].join("\n")
}
