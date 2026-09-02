export * as Manifest from "./manifest"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { Environment } from "@/environment/detect"
import { InstanceState } from "@/effect/instance-state"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { Context, Effect, Layer } from "effect"
import fsNode from "fs/promises"
import path from "path"

// Reproducibility manifest. Bioinformatica does NOT reinvent provenance
// formats: it references the ecosystem's own artifacts — nf-core's
// `<outdir>/pipeline_info/` (software versions, params, execution reports) and,
// when present, Nextflow `nf-prov` output (BCO manifest.json + WRROC/RO-Crate) —
// and adds the Bioinformatica-native layer those don't capture: the human approval log
// and the session context/summary.

const BIOINFORMATICA_DIR = ".bioinformatica"

export type ArtifactKind =
  | "software-versions"
  | "params"
  | "execution-report"
  | "execution-timeline"
  | "execution-trace"
  | "dag"
  | "bco"
  | "ro-crate"
  | "other"

export interface Artifact {
  readonly name: string
  readonly path: string
  readonly kind: ArtifactKind
}

export interface Manifest {
  readonly generatedAt: string
  readonly outdir: string
  readonly run?: unknown
  readonly environment: {
    readonly nextflow?: string
    readonly java?: string
    readonly nfcoreTools?: string
    readonly backend: string
  }
  readonly software: { readonly tool: string; readonly version: string }[]
  readonly artifacts: Artifact[]
  // Bioinformatica-native layer (what nf-prov / pipeline_info do not cover):
  readonly approvals: unknown[]
  readonly session: { readonly summary?: string }
}

// Classify a pipeline_info / nf-prov file by its name. Pure.
export function classifyArtifact(name: string): ArtifactKind {
  const n = name.toLowerCase()
  if (n.includes("software") && (n.endsWith(".yml") || n.endsWith(".yaml"))) return "software-versions"
  if (n.startsWith("params") && n.endsWith(".json")) return "params"
  if (n.startsWith("execution_report")) return "execution-report"
  if (n.startsWith("execution_timeline")) return "execution-timeline"
  if (n.startsWith("execution_trace")) return "execution-trace"
  if (n.startsWith("pipeline_dag")) return "dag"
  if (n === "ro-crate-metadata.json" || n.includes("ro-crate")) return "ro-crate"
  if (n === "manifest.json" || n.includes("bco")) return "bco"
  return "other"
}

// Best-effort extraction of tool → version pairs from nf-core's
// software_versions.yml (nested: process → { tool: version }). Pure. The file
// itself remains the source of truth and is always referenced by path.
export function parseSoftwareVersions(yaml: string): { tool: string; version: string }[] {
  const out: { tool: string; version: string }[] = []
  const seen = new Set<string>()
  for (const line of yaml.split(/\r?\n/)) {
    // Indented `  tool: version` lines are the leaf entries; top-level
    // (unindented) keys are process names and are skipped.
    const m = line.match(/^\s+([A-Za-z0-9_.\/+-]+):\s*"?([^"\n]+?)"?\s*$/)
    if (!m) continue
    const tool = m[1]
    const version = m[2].trim()
    const key = `${tool}=${version}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ tool, version })
  }
  return out
}

export interface Interface {
  readonly build: (input: { outdir: string; sessionSummary?: string }) => Effect.Effect<{ manifest: Manifest; file: string }>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/NfcoreManifest") {}

export const use = serviceUse(Service)

const readTextSafe = (file: string) =>
  Effect.tryPromise(() => fsNode.readFile(file, "utf8")).pipe(Effect.catch(() => Effect.succeed(undefined)))

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const environment = yield* Environment.Service

    const build = Effect.fn("NfcoreManifest.build")(function* (input: { outdir: string; sessionSummary?: string }) {
      const ctx = yield* InstanceState.context
      const outdir = path.isAbsolute(input.outdir) ? input.outdir : path.join(ctx.directory, input.outdir)
      const infoDir = path.join(outdir, "pipeline_info")

      // Reference every native provenance artifact under pipeline_info/ (and any
      // nf-prov BCO / RO-Crate files that landed there).
      const names = yield* Effect.tryPromise(() => fsNode.readdir(infoDir)).pipe(
        Effect.catch(() => Effect.succeed([] as string[])),
      )
      const artifacts: Artifact[] = names
        .sort()
        .map((name) => ({ name, path: path.join(infoDir, name), kind: classifyArtifact(name) }))

      // Embed a light copy of the authoritative tool versions for a self-contained
      // manifest; the .yml file is still referenced above.
      const versionsArtifact = artifacts.find((a) => a.kind === "software-versions")
      const versionsText = versionsArtifact ? yield* readTextSafe(versionsArtifact.path) : undefined
      const software = versionsText ? parseSoftwareVersions(versionsText) : []

      // Bioinformatica-native layer: the human approval log.
      const approvalsText = yield* readTextSafe(path.join(ctx.directory, BIOINFORMATICA_DIR, "approvals.jsonl"))
      const approvals = approvalsText
        ? approvalsText
            .split(/\r?\n/)
            .filter((l) => l.trim().length > 0)
            .flatMap((l) => {
              try {
                return [JSON.parse(l) as unknown]
              } catch {
                return []
              }
            })
        : []

      // Correlate the most recent Bioinformatica run record for this outdir.
      const runsDir = path.join(ctx.directory, BIOINFORMATICA_DIR, "runs")
      const runFiles = yield* Effect.tryPromise(() => fsNode.readdir(runsDir)).pipe(
        Effect.catch(() => Effect.succeed([] as string[])),
      )
      let run: unknown
      for (const name of runFiles.filter((f) => f.endsWith(".json") && !f.includes("manifest")).sort().reverse()) {
        const raw = yield* fs.readJson(path.join(runsDir, name)).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (raw && typeof raw === "object" && (raw as any).outdir === input.outdir) {
          run = raw
          break
        }
        if (!run) run = raw // fall back to most recent if none match the outdir
      }

      const report = yield* environment.detect()
      const manifest: Manifest = {
        generatedAt: new Date().toISOString(),
        outdir,
        run,
        environment: {
          nextflow: report.nextflow.version,
          java: report.java.version,
          nfcoreTools: report.nfcoreTools.version,
          backend: report.containerBackend,
        },
        software,
        artifacts,
        approvals,
        session: { summary: input.sessionSummary },
      }

      const file = path.join(
        ctx.directory,
        BIOINFORMATICA_DIR,
        "manifests",
        `${manifest.generatedAt.replace(/[:.]/g, "-")}-manifest.json`,
      )
      yield* fs.writeWithDirs(file, JSON.stringify(manifest, null, 2)).pipe(Effect.orDie)
      return { manifest, file }
    })

    return Service.of({ build })
  }),
)

export function summarize(manifest: Manifest): string {
  const kinds = manifest.artifacts.reduce<Record<string, number>>((acc, a) => {
    acc[a.kind] = (acc[a.kind] ?? 0) + 1
    return acc
  }, {})
  const hasNative = manifest.artifacts.some((a) => a.kind === "bco" || a.kind === "ro-crate")
  return [
    `Reproducibility manifest for ${manifest.outdir}`,
    `- Environment: Nextflow ${manifest.environment.nextflow ?? "?"}, backend ${manifest.environment.backend}${manifest.environment.nfcoreTools ? `, nf-core tools ${manifest.environment.nfcoreTools}` : ""}`,
    `- Tool versions recorded: ${manifest.software.length}`,
    `- Native provenance artifacts referenced: ${manifest.artifacts.length} (${Object.entries(kinds).map(([k, n]) => `${k}:${n}`).join(", ") || "none"})`,
    `- nf-prov BCO/RO-Crate present: ${hasNative ? "yes" : "no"}`,
    `- Human approvals logged (Bioinformática.org layer): ${manifest.approvals.length}`,
    `- Session summary: ${manifest.session.summary ? "included" : "none provided"}`,
  ].join("\n")
}

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node, Environment.node] })
