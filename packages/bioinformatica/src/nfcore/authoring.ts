export * as Authoring from "./authoring"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { AppProcess } from "@bioinformatica/core/process"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { ChildProcess } from "effect/unstable/process"
import { Context, Effect, Layer } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

// Authoring & contribution backbone. Bioinformatica does not
// reimplement nf-core's scaffolding or linting — it runs the official `nf-core lint` /
// `nf-core modules lint` (read-only) and turns their results into a structured report
// and a contribution-readiness verdict, which is exactly where structured output helps
// the model. Creating modules/pipelines is `nf-core … create` run through the
// shell tool (a data write, approval); this module is the verification half.

export type LintStatus = "passed" | "warned" | "failed" | "ignored"

export interface LintFinding {
  readonly status: LintStatus
  readonly check: string
  readonly message?: string
  readonly file?: string
}

export interface LintReport {
  readonly nfCoreVersion?: string
  readonly counts: Record<LintStatus, number>
  readonly findings: LintFinding[]
}

function statusForKey(key: string): LintStatus | undefined {
  const k = key.toLowerCase()
  if (/pass/.test(k)) return "passed"
  if (/warn/.test(k)) return "warned"
  if (/fail/.test(k)) return "failed"
  if (/ignor/.test(k)) return "ignored"
  return undefined
}

// Normalize one lint entry, which `nf-core lint --json` has expressed across versions as
// a bare string, a [check, message, file?] tuple, or an object. Defensive so version
// drift in the tool's output shape degrades gracefully rather than dropping findings.
function normalizeEntry(status: LintStatus, entry: unknown): LintFinding | undefined {
  if (typeof entry === "string") return { status, check: entry }
  if (Array.isArray(entry)) {
    const check = entry[0] != null ? String(entry[0]) : ""
    if (!check) return undefined
    return { status, check, message: entry[1] != null ? String(entry[1]) : undefined, file: entry[2] != null ? String(entry[2]) : undefined }
  }
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>
    const check = o.test_name ?? o.lint_test ?? o.check ?? o.name ?? o.test
    if (check == null) return undefined
    const file = o.file ?? o.file_path ?? o.path
    return {
      status,
      check: String(check),
      message: o.message != null ? String(o.message) : undefined,
      file: file != null ? String(file) : undefined,
    }
  }
  return undefined
}

// Parse the object produced by `nf-core lint --json` into a normalized report. Pure.
export function parseLintJson(json: unknown): LintReport {
  const counts: Record<LintStatus, number> = { passed: 0, warned: 0, failed: 0, ignored: 0 }
  const findings: LintFinding[] = []
  let nfCoreVersion: string | undefined
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>
    const v = obj.nf_core_version ?? obj.nfCoreVersion ?? obj.version
    if (typeof v === "string") nfCoreVersion = v
    for (const [key, value] of Object.entries(obj)) {
      const status = statusForKey(key)
      if (!status || !Array.isArray(value)) continue
      for (const entry of value) {
        const finding = normalizeEntry(status, entry)
        if (!finding) continue
        findings.push(finding)
        counts[status]++
      }
    }
  }
  return { nfCoreVersion, counts, findings }
}

export interface Readiness {
  readonly ready: boolean
  readonly blockers: LintFinding[]
  readonly warnings: LintFinding[]
  readonly summary: string
}

// A component/pipeline is ready to contribute when lint has zero failures; warnings are
// surfaced to review but do not block (they mirror nf-core's own pass/warn/fail model).
export function readiness(report: LintReport): Readiness {
  const blockers = report.findings.filter((f) => f.status === "failed")
  const warnings = report.findings.filter((f) => f.status === "warned")
  const ready = blockers.length === 0
  const summary = !ready
    ? `Not ready: ${blockers.length} failing lint check(s) must be fixed before contributing.`
    : warnings.length === 0
      ? "Ready: lint is clean (no failures, no warnings)."
      : `Ready with caveats: no failures, but ${warnings.length} warning(s) to review before contributing.`
  return { ready, blockers, warnings, summary }
}

export function summarizeLint(report: LintReport): string {
  const c = report.counts
  const lines = [
    `nf-core lint${report.nfCoreVersion ? ` (tools ${report.nfCoreVersion})` : ""}: ${c.passed} passed, ${c.warned} warned, ${c.failed} failed, ${c.ignored} ignored`,
  ]
  for (const f of report.findings.filter((f) => f.status === "failed" || f.status === "warned")) {
    lines.push(`  ${f.status === "failed" ? "✘" : "!"} ${f.check}${f.message ? `: ${f.message}` : ""}${f.file ? ` (${f.file})` : ""}`)
  }
  return lines.join("\n")
}

export interface ModuleShape {
  readonly hasMain: boolean
  readonly hasMeta: boolean
  readonly hasEnvironment: boolean
  readonly hasTest: boolean
  readonly conformant: boolean
  readonly missing: string[]
}

// Quick shape check of a module directory from a listing of its (relative) file paths.
// The required set follows the official nf-core module specification (source of truth,
// not general knowledge): a conformant module MUST have main.nf (with a stub block),
// meta.yml, environment.yml (Conda deps), and an nf-test test with a stub test
// (tests/main.nf.test). See https://nf-co.re/docs/specifications/components/modules/general
// and .../testing. This complements `nf-core modules lint`, which remains authoritative.
export function inspectModule(files: string[]): ModuleShape {
  const norm = files.map((f) => f.replace(/\\/g, "/"))
  const has = (re: RegExp) => norm.some((f) => re.test(f))
  const hasMain = has(/(^|\/)main\.nf$/)
  const hasMeta = has(/(^|\/)meta\.ya?ml$/)
  const hasEnvironment = has(/(^|\/)environment\.ya?ml$/)
  const hasTest = has(/(^|\/)tests\/main\.nf\.test$/) || has(/\.nf\.test$/)
  const missing: string[] = []
  if (!hasMain) missing.push("main.nf")
  if (!hasMeta) missing.push("meta.yml")
  if (!hasEnvironment) missing.push("environment.yml")
  if (!hasTest) missing.push("tests/main.nf.test")
  return { hasMain, hasMeta, hasEnvironment, hasTest, conformant: missing.length === 0, missing }
}

export interface LintRun {
  readonly installed: boolean
  readonly report?: LintReport
  readonly raw?: string
  readonly error?: string
}

export interface Interface {
  readonly lint: (input: { directory: string; module?: string }) => Effect.Effect<LintRun>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/NfcoreAuthoring") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service

    const probe = Effect.fnUntraced(
      function* (cmd: string[], cwd?: string) {
        const result = yield* appProcess.run(ChildProcess.make(cmd[0], cmd.slice(1), { extendEnv: true, cwd }))
        return { code: result.exitCode, stdout: result.stdout.toString("utf8"), stderr: result.stderr.toString("utf8") }
      },
      Effect.catch(() => Effect.succeed({ code: 127, stdout: "", stderr: "" })),
    )

    const lint = Effect.fn("NfcoreAuthoring.lint")(function* (input: { directory: string; module?: string }) {
      const version = yield* probe(["nf-core", "--version"], input.directory)
      if (version.code !== 0) return { installed: false } as LintRun

      // Ask nf-core to dump machine-readable results; parse those rather than scraping
      // the pretty console output.
      const tmp = path.join(os.tmpdir(), `bioinformatica-lint-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
      const args = input.module
        ? ["nf-core", "modules", "lint", input.module, "--json", tmp]
        : ["nf-core", "lint", "--json", tmp]
      const r = yield* probe(args, input.directory)

      const jsonText = yield* Effect.tryPromise(() => fs.readFile(tmp, "utf8")).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      yield* Effect.tryPromise(() => fs.unlink(tmp)).pipe(Effect.catch(() => Effect.succeed(undefined)))

      if (!jsonText) {
        return { installed: true, raw: (r.stdout || r.stderr).slice(-4000), error: "lint produced no JSON output" } as LintRun
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(jsonText)
      } catch {
        return { installed: true, raw: jsonText.slice(-4000), error: "could not parse lint JSON" } as LintRun
      }
      return { installed: true, report: parseLintJson(parsed), raw: (r.stdout || "").slice(-2000) } as LintRun
    })

    return Service.of({ lint })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [AppProcess.node] })
