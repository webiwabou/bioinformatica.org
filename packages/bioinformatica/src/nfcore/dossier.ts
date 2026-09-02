export * as Dossier from "./dossier"

import { createHash } from "crypto"
import path from "path"

// Assemble the four run artefacts into one directory a third party can check.
//
// They exist already and each is reachable on its own; what did not exist is a single
// object to hand someone. They lived in different formats, in different places — `corpus/`
// visible, `.bioinformatica/` hidden, the census only in memory — and none referenced any of the
// others, so a reviewer receiving a folder had no entry point and no way to know what
// should have been in it.
//
// Two things this deliberately is NOT.
//
// It is not a new interchange format, and it is not a substitute for one. The index below
// is a listing with digests, not a vocabulary: provenance like this belongs in a conformant
// Workflow Run RO-Crate, a published community profile with validators a reviewer already
// has. Inventing a format here and defending it later is the mistake to avoid.
//
// It is not a claim that the campaign was complete. The index records what is ABSENT by
// name, because a dossier that silently omits an artefact reads exactly like a campaign
// that never produced one — and the reader cannot tell the difference. Absence is a finding.

/** One file carried in the dossier, with what makes it checkable. */
export interface Entry {
  /** Path inside the dossier, always relative and always POSIX-separated. */
  readonly path: string
  /** Where it came from in the project, for a reader tracing it back. */
  readonly origin: string
  readonly bytes: number
  readonly sha256: string
}

/** One of the four artefacts this project commits to, and whether this campaign produced it. */
export interface Artefact {
  readonly id: "manifest" | "protocol" | "handcount" | "methods"
  readonly title: string
  readonly present: boolean
  /** Entries in the dossier that constitute it. Empty when absent. */
  readonly entries: readonly string[]
  /** When absent: what is missing and what would produce it. Never a silent omission. */
  readonly missing?: string
}

export interface Index {
  readonly kind: "bioinformatica-dossier"
  /** Bumped when the shape changes; a reader that does not know it should say so. */
  readonly version: 1
  readonly project: string
  readonly generatedAt: string
  /** The frozen versions the hand count was classified under, when there is one. */
  readonly taxonomyVersion?: string
  readonly classifierVersion?: string
  /** Which arm produced this, from the ablation switch. */
  readonly ablation?: { readonly spec: string; readonly contextSha256: string }
  readonly artefacts: readonly Artefact[]
  /**
   * The cold verification of the SOURCE project, run at assembly time.
   *
   * Without this a dossier assembled over a corpus that fails its own manifests still
   * verifies clean, because it faithfully records the corrupt digests — the receipt would
   * attest that nothing changed SINCE assembly while saying nothing about whether the data
   * ever matched what the campaign claimed. That gap was found by the differential test
   * that runs the emitted receipt over a project whose corpus does not match its own
   * manifests, and it is precisely the silent failure the artefact exists to prevent, so
   * the verdict travels inside the dossier and the receipt refuses on it.
   */
  readonly verification: {
    readonly ok: boolean
    readonly passed: number
    readonly failed: number
    /** The failing checks, verbatim, so the reader does not have to take `ok` on trust. */
    readonly failures: readonly string[]
  }
  readonly entries: readonly Entry[]
  /** Stated in the artefact rather than in a README nobody reads. */
  readonly limits: readonly Limit[]
}

/**
 * A limit of what this dossier can show, with somewhere to check it.
 *
 * Structured rather than prose because a limitation nobody can verify is a disclaimer,
 * and a disclaimer is what a reader discounts. `evidence` points at the code that makes
 * the statement true, and a test fails if that path does not exist — so a limit cannot
 * quietly outlive the defect it describes, and cannot be written about code that was
 * never there.
 *
 * They live in `index.json` rather than a separate file with a schema of its own: the
 * dossier is a listing, and inventing a second bespoke format is the thing to avoid.
 */
export interface Limit {
  readonly id: string
  readonly statement: string
  /** `path:line` or `path`, relative to the repository root. Must resolve. */
  readonly evidence: string
  /** What would remove this limit, in words. `null` when it is inherent, not a defect. */
  readonly retiredBy: string | null
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/** POSIX-separated relative path, so an index written on Windows verifies on Linux. */
export function relative(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/")
}

/**
 * The exact bytes the index is written as. One function, so the digest can never be taken
 * over a different serialisation than the one on disk.
 *
 * That is not hypothetical: the first version of this hashed the compact form and wrote
 * the indented one, so `verify.sh` reported the index as CHANGED on a dossier nobody had
 * touched. A receipt that cries wolf on an intact artefact is worse than no receipt.
 */
export function serialize(index: Index): string {
  return JSON.stringify(index, null, 2) + "\n"
}

/**
 * The digest of the index itself.
 *
 * A reader checks two things: that every entry still hashes to what the index says, and
 * that the index still hashes to what the receipt says. Without the second, someone who
 * edits a file can edit its recorded digest in the same pass and the dossier still
 * verifies — which is the whole failure the digests are there to prevent.
 */
export function indexDigest(index: Index): string {
  return sha256(serialize(index))
}

/**
 * The limits every dossier carries, whatever else is in it.
 *
 * These are the ones a reader would otherwise have to discover by reading the source, and
 * the first is the most expensive thing this project can say about itself. Stating them
 * inside the artefact is the only version a reviewer actually receives.
 */
export const LIMITS: readonly Limit[] = [
  {
    id: "not-correctness",
    statement:
      "This dossier shows that the recorded work was not misreported. It does not show the result was correct: the instruments of correctness — null models, known-answer controls, detector calibration — do not exist in this project, and none of them is in here.",
    evidence: "packages/bioinformatica/src/nfcore/verify.ts",
    retiredBy: "null models, known-answer controls and detector calibration, none of which this project implements",
  },
  {
    id: "run-records-self-reported",
    statement:
      "Run records are the model's account of a run, not the substrate's. Every field including `status` is a free tool parameter, which is why each record carries `reportedBy`. Only the corpus manifests are independent of the agent.",
    evidence: "packages/bioinformatica/src/nfcore/record.ts",
    retiredBy: "a record written from the substrate's own process exit rather than from the model's account",
  },
  {
    id: "ledgers-not-chained",
    statement:
      "The ledgers are append-only by writing convention, not by a hash chain. A line removed from a refusals or approvals ledger is not detectable from this dossier.",
    evidence: "packages/bioinformatica/src/nfcore/protocol.ts",
    retiredBy: "a hash chain over the ledger lines, so a removed line is detectable",
  },
  {
    id: "execution-manifest-unverified",
    statement:
      "Cold verification covers corpus snapshots. The execution manifest is named with a hyphen, does not match the verifier's glob, and carries no digest per artefact — so what is verifiable here is a data download, not a run.",
    evidence: "packages/bioinformatica/src/nfcore/manifest.ts",
    retiredBy: "a per-artefact digest in the execution manifest, under a name the verifier's glob matches",
  },
  {
    id: "handcount-monolingual",
    statement:
      "The hand-count classifier is deterministic and its cues are English only, so a campaign conducted in another language falls entirely into `other` and the Methods paragraph under-reports interventions.",
    evidence: "packages/bioinformatica/src/nfcore/handcount.ts",
    retiredBy: "cues for the languages a campaign is actually conducted in",
  },
  {
    id: "bespoke-listing-format",
    statement:
      "Provenance travels in this project's own listing format, which no third-party tool reads. A conformant Workflow Run RO-Crate — a published community profile with existing validators — is what would replace it.",
    evidence: "packages/bioinformatica/src/nfcore/dossier.ts",
    retiredBy: "emitting a conformant Workflow Run RO-Crate instead of this listing",
  },
]

/** The POSIX receipt that travels with the dossier. */
export function verifyScript(index: Index, digest: string): string {
  const lines = [
    "#!/bin/sh",
    "# Check this dossier without Bioinformatica, without a model and without a network.",
    "#",
    "# Generated by `bioinformatica dossier`. It re-computes the same two things `bioinformatica verify`",
    "# does — every file against the digest recorded for it, and the index against the",
    "# digest recorded here — using only sha256sum (or shasum) and wc.",
    "#",
    "# This is a convenience, not a second implementation: the authority is index.json,",
    "# and a differential test asserts this script and `bioinformatica verify` agree.",
    "",
    "set -eu",
    'cd "$(dirname "$0")"',
    "",
    "# BSD/macOS ships `shasum -a 256`; GNU ships `sha256sum`.",
    'if command -v sha256sum >/dev/null 2>&1; then HASH="sha256sum"',
    'elif command -v shasum >/dev/null 2>&1; then HASH="shasum -a 256"',
    'else echo "need sha256sum or shasum" >&2; exit 2; fi',
    "",
    "fail=0",
    'digest() { $HASH "$1" | cut -d" " -f1; }',
    "",
    "check() {",
    '  want="$1"; file="$2"',
    '  if [ ! -f "$file" ]; then echo "MISSING  $file" >&2; fail=$((fail+1)); return; fi',
    '  got=$(digest "$file")',
    '  if [ "$got" != "$want" ]; then',
    '    echo "CHANGED  $file" >&2',
    '    echo "         recorded $want" >&2',
    '    echo "         on disk  $got" >&2',
    "    fail=$((fail+1))",
    "  else",
    '    echo "ok       $file"',
    "  fi",
    "}",
    "",
    "# The source project's own cold verification, as recorded when this was assembled.",
    "# Checked FIRST: if the corpus never matched its manifests, whether the dossier is",
    "# internally consistent is beside the point.",
  ]
  if (!index.verification.ok) {
    lines.push(
      'echo "REFUSED  the project this dossier was assembled from did not verify" >&2',
      `echo "         ${index.verification.failed} check(s) failed at assembly time:" >&2`,
      ...index.verification.failures.map((f) => `echo ${shellQuote("           " + f)} >&2`),
      'echo "" >&2',
      "exit 1",
      "",
    )
  }
  lines.push("# The index last, so a tampered index cannot rewrite the checks above it.")
  for (const entry of index.entries) {
    lines.push(`check ${entry.sha256} ${shellQuote(entry.path)}`)
  }
  lines.push(
    "",
    `check ${digest} index.json`,
    "",
    'if [ "$fail" -ne 0 ]; then',
    '  echo "" >&2',
    '  echo "FAILED — $fail file(s) do not match what this dossier records." >&2',
    "  exit 1",
    "fi",
    'echo ""',
    `echo "OK — ${index.entries.length + 1} file(s) match. This says nothing about whether the result was right."`,
    "",
  )
  return lines.join("\n")
}

/** Single-quote for /bin/sh, the only quoting that needs no escape table. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Human-readable receipt for the terminal. */
export function format(index: Index, digest: string): string {
  const out: string[] = []
  out.push(`Dossier — ${index.project}`)
  out.push("")
  for (const a of index.artefacts) {
    const mark = a.present ? "✓" : "✗"
    out.push(`  ${mark} ${a.title}`)
    if (!a.present && a.missing) out.push(`      ${a.missing}`)
  }
  out.push("")
  out.push(`  ${index.entries.length} file(s), index sha256 ${digest.slice(0, 12)}…`)
  out.push(
    index.verification.ok
      ? `  cold verification at assembly: ${index.verification.passed} passed`
      : `  cold verification at assembly: FAILED — ${index.verification.failed} check(s)`,
  )
  if (index.ablation) out.push(`  arm: ${index.ablation.spec}`)
  out.push("")
  const absent = index.artefacts.filter((a) => !a.present).length
  if (absent > 0) {
    out.push(
      absent === 1
        ? "1 of the four artefacts is not in this dossier — see index.json, it is named there."
        : `${absent} of the four artefacts are not in this dossier — see index.json, they are named there.`,
    )
  }
  out.push("Run `sh verify.sh` to check it without Bioinformatica installed.")
  return out.join("\n")
}
