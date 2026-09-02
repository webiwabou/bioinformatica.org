export * as Failure from "./failure"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { Context, Effect, Layer, Schema } from "effect"
import path from "path"

// When a Nextflow run fails, Bioinformatica follows a fixed sequence:
// diagnose the real cause, explain it, offer a specific fix (if reparable) with
// approval, suggest `-resume` rather than starting over, and — when the cause is
// beyond what it can fix (hardware, permissions, external outages) — say so and
// stop rather than retrying blindly.
//
// This module classifies the failure from the run's logs. It only diagnoses;
// applying a fix and re-running go through the existing tools with approval.

export type Category =
  | "resources"
  | "container"
  | "nextflow_version"
  | "input"
  | "params"
  | "pipeline_ref"
  | "network"
  | "process_error"
  | "unknown"

export const Diagnosis = Schema.Struct({
  category: Schema.Literals([
    "resources",
    "container",
    "nextflow_version",
    "input",
    "params",
    "pipeline_ref",
    "network",
    "process_error",
    "unknown",
  ]),
  summary: Schema.String,
  explanation: Schema.String,
  // Can Bioinformatica reasonably fix this itself (config, dependency, resource, input)?
  reparable: Schema.Boolean,
  // Is `-resume` useful (were there cached tasks to continue from)?
  resumable: Schema.Boolean,
  suggestedFix: Schema.String,
})
export type Diagnosis = Schema.Schema.Type<typeof Diagnosis>

const has = (text: string, re: RegExp) => re.test(text)

// Pull the failed task's work directory out of a Nextflow error block, so the
// caller can read that task's own .command.err for the tool-level error.
export function extractWorkDir(text: string): string | undefined {
  const match = text.match(/Work dir:\s*(?:\r?\n\s*)?(\S+)/i)
  return match?.[1]
}

// Classify a failure from the combined log / error text (and exit code if known).
export function classify(text: string, exitCode?: number): Diagnosis {
  const t = text.toLowerCase()
  const oom = exitCode === 137 || has(t, /exit status:\s*137/)

  if (oom || has(t, /out of memory|oomkilled|\bkilled\b|exceeds available memory|not enough memory|cannot allocate memory/)) {
    return {
      category: "resources",
      summary: "A step ran out of memory (or was killed for exceeding resources).",
      explanation:
        "A process needed more memory than was available and was killed (exit 137 is the usual out-of-memory signature). This is a resource limit, not a problem with your data.",
      reparable: true,
      resumable: true,
      suggestedFix:
        "Cap resources to fit this machine: use nfcore_resources to generate a process.resourceLimits config, write it (with approval), then re-run with that config and -resume. If the ceiling is far below what the step needs, tell the scientist the run may still fail and confirm before retrying.",
    }
  }

  if (has(t, /cannot connect to the docker daemon|docker[^\n]*permission denied|permission denied while trying to connect to the docker|unable to find image|failed to pull|cannot pull image|error pulling image|is the docker daemon running/)) {
    return {
      category: "container",
      summary: "The container backend failed (Docker not reachable or image unavailable).",
      explanation:
        "Nextflow could not use the container engine — the Docker daemon isn't running/accessible, or an image couldn't be pulled.",
      reparable: true,
      resumable: true,
      suggestedFix:
        "Check the environment tool. If the Docker daemon is stopped, the scientist can start it (sudo systemctl start docker — needs root), or switch to the conda backend. If an image failed to pull, retry (often transient). Then re-run with -resume.",
    }
  }

  if (has(t, /does not match.*version|requires nextflow|nextflow version[^\n]*required|nxf_ver|requires version [0-9]/)) {
    return {
      category: "nextflow_version",
      summary: "The installed Nextflow version does not satisfy the pipeline's requirement.",
      explanation:
        "This pipeline release needs a specific Nextflow version range that the installed Nextflow does not meet.",
      reparable: true,
      resumable: true,
      suggestedFix:
        "Check the pipeline's required Nextflow version (nfcore_pipeline_search shows it) against the installed one (environment tool). Update Nextflow via the environment remediation (no root), or pin a pipeline release that matches. Then re-run with -resume.",
    }
  }

  if (has(t, /validation of pipeline parameters failed|does not match pattern|missing required|the following invalid input values|no such file or directory|path does not exist|does not exist:|is not a recognis?zed/)) {
    return {
      category: "input",
      summary: "An input or samplesheet value is missing, mis-typed, or points to a file that doesn't exist.",
      explanation:
        "The pipeline's input validation failed — a required column is missing, a value doesn't match the expected format, or a file path is wrong. This corrupts the run before compute, so it must be fixed exactly.",
      reparable: true,
      resumable: true,
      suggestedFix:
        "Re-check the samplesheet against the schema (nfcore_samplesheet_schema / nfcore_samplesheet_validate) and confirm every file path exists. Fix the samplesheet or paths (with approval), then re-run with -resume.",
    }
  }

  if (has(t, /unrecognis?zed option|unknown parameter|is not a valid parameter|unrecognis?zed param/)) {
    return {
      category: "params",
      summary: "A pipeline parameter name or value is not recognized.",
      explanation: "A `--parameter` passed to the run isn't valid for this pipeline (wrong name or unsupported value).",
      reparable: true,
      resumable: true,
      suggestedFix:
        "Use nfcore_params to check the correct parameter name and allowed values, correct the command, then re-run with -resume.",
    }
  }

  if (
    has(
      t,
      /cannot find revision|remote resource not found|not found.*revision|unknown revision|couldn't find.*pipeline|refnotfound|ref .+ cannot be resolved/,
    )
  ) {
    return {
      category: "pipeline_ref",
      summary: "The pipeline name or release could not be found.",
      explanation: "Nextflow could not resolve the pipeline or the requested revision (-r). Nothing ran yet.",
      reparable: true,
      resumable: false,
      suggestedFix:
        "Confirm the pipeline name and a valid release with nfcore_pipeline_search, then rebuild the command with nfcore_run_command. -resume won't help since no task ran.",
    }
  }

  if (has(t, /connection timed out|could not resolve host|failed to download|read timed out|temporary failure in name resolution|unable to fetch|502 bad gateway|connection refused|network is unreachable/)) {
    return {
      category: "network",
      summary: "An external network or service problem (download, DNS, or connectivity).",
      explanation:
        "The failure is an external issue — a download failed, a host couldn't be resolved, or a service was unreachable. This is outside what Bioinformatica can fix.",
      reparable: false,
      resumable: true,
      suggestedFix:
        "This is an external network/service problem, not something Bioinformatica can repair. Check connectivity or try again later; Nextflow can then re-run with -resume to continue where it stopped.",
    }
  }

  if (has(t, /error executing process|command exit status:\s*[1-9]|caused by:/)) {
    return {
      category: "process_error",
      summary: "A tool inside the pipeline exited with an error.",
      explanation:
        "A process ran but its underlying tool failed. The specific cause is in that task's .command.err — sometimes it's fixable (a parameter or resource), sometimes it's data-specific and may not be.",
      reparable: false,
      resumable: true,
      suggestedFix:
        "Read the failed task's .command.err (in its work dir) to see the tool's own error before retrying. If it points to a parameter or resource issue, fix that and re-run with -resume; if it's a data or algorithm problem, explain it honestly rather than retrying blindly.",
    }
  }

  return {
    category: "unknown",
    summary: "The failure cause could not be identified from the log.",
    explanation: "Nothing in the log matched a known failure signature.",
    reparable: false,
    resumable: true,
    suggestedFix:
      "Inspect .nextflow.log and the failed task's work dir directly, and share the error. Do not retry blindly without understanding the cause.",
  }
}

export interface Interface {
  readonly diagnose: (input: { runDir?: string; error?: string }) => Effect.Effect<Diagnosis>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/NfcoreFailure") {}

export const use = serviceUse(Service)

const TAIL = 16000

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const readTail = Effect.fnUntraced(function* (file: string) {
      const text = yield* fs.readFileStringSafe(file).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!text) return undefined
      return text.length > TAIL ? text.slice(-TAIL) : text
    })

    const diagnose = Effect.fn("NfcoreFailure.diagnose")(function* (input: { runDir?: string; error?: string }) {
      const chunks: string[] = []
      if (input.error) chunks.push(input.error)

      if (input.runDir) {
        const log = yield* readTail(path.join(input.runDir, ".nextflow.log"))
        if (log) chunks.push(log)
        const workDir = extractWorkDir(chunks.join("\n"))
        if (workDir) {
          const commandErr = yield* readTail(path.join(workDir, ".command.err"))
          if (commandErr) chunks.push(`--- .command.err (${workDir}) ---\n${commandErr}`)
        }
      }

      const text = chunks.join("\n")
      if (text.trim().length === 0) {
        return classify("", undefined)
      }
      return classify(text)
    })

    return Service.of({ diagnose })
  }),
)

export function summarize(d: Diagnosis): string {
  return [
    `Diagnosis: ${d.summary}`,
    `Category: ${d.category}`,
    "",
    d.explanation,
    "",
    d.reparable
      ? "Bioinformatica can likely fix this with your approval."
      : "This is beyond what Bioinformatica can safely fix on its own — be honest about that.",
    d.resumable ? "After fixing, re-run with -resume to continue rather than restart." : "-resume will not help here.",
    "",
    `Suggested next step: ${d.suggestedFix}`,
  ].join("\n")
}

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node] })
