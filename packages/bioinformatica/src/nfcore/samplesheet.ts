export * as Samplesheet from "./samplesheet"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { httpClient } from "@bioinformatica/core/effect/app-node-platform"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { Global } from "@bioinformatica/core/global"
import { InstallationVersion } from "@bioinformatica/core/installation/version"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { isRecord } from "@/util/record"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import path from "path"

// Every nf-core pipeline ships the definition of its own samplesheet in
// `assets/schema_input.json` (an nf-schema JSON Schema for the rows). Bioinformatica reads
// that file as the single source of truth for which columns exist, which are
// required, and what each value must look like. It never hardcodes
// per-pipeline column layouts. The pipeline itself does the authoritative
// validation at run time; the checks here are a light pre-flight so an obviously
// wrong samplesheet is caught before a run.

const USER_AGENT = `bioinformatica/${InstallationVersion}`
const rawUrl = (pipeline: string, release: string) =>
  `https://raw.githubusercontent.com/nf-core/${pipeline}/${release}/assets/schema_input.json`

export const Column = Schema.Struct({
  name: Schema.String,
  required: Schema.Boolean,
  type: Schema.optional(Schema.String),
  format: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  pattern: Schema.optional(Schema.String),
  enum: Schema.optional(Schema.Array(Schema.String)),
})
export type Column = Schema.Schema.Type<typeof Column>

export const Spec = Schema.Struct({
  pipeline: Schema.String,
  release: Schema.String,
  columns: Schema.Array(Column),
})
export type Spec = Schema.Schema.Type<typeof Spec>

export type Row = Record<string, string>

export interface ValidationIssue {
  readonly row: number
  readonly column: string
  readonly message: string
}
export interface Validation {
  readonly ok: boolean
  readonly rowCount: number
  readonly issues: ValidationIssue[]
}

export class SchemaUnavailableError extends Schema.TaggedErrorClass<SchemaUnavailableError>()(
  "Samplesheet.SchemaUnavailableError",
  { pipeline: Schema.String, release: Schema.String },
) {
  override get message() {
    return `Could not load assets/schema_input.json for nf-core/${this.pipeline}@${this.release}. The pipeline may not publish an input schema at that release, or the network is unavailable.`
  }
}

// Turn a pipeline's schema_input.json into a flat column spec. Pure and tolerant.
export function parseColumns(raw: unknown): Column[] {
  if (!isRecord(raw)) return []
  const items = isRecord(raw.items) ? raw.items : {}
  const required = Array.isArray(items.required) ? items.required.filter((c): c is string => typeof c === "string") : []
  const properties = isRecord(items.properties) ? items.properties : {}
  const columns: Column[] = []
  for (const [name, value] of Object.entries(properties)) {
    if (!isRecord(value)) continue
    columns.push({
      name,
      required: required.includes(name),
      type: typeof value.type === "string" ? value.type : undefined,
      format: typeof value.format === "string" ? value.format : undefined,
      description: typeof value.description === "string" ? value.description : undefined,
      pattern: typeof value.pattern === "string" ? value.pattern : undefined,
      enum: Array.isArray(value.enum) ? value.enum.filter((e): e is string => typeof e === "string") : undefined,
    })
  }
  return columns
}

// Pre-flight validation of proposed rows against the column spec. Catches the
// common ways a samplesheet is wrong (unknown/missing columns, bad enum, wrong
// file extension) without trying to replace the pipeline's own run-time check.
export function validate(columns: readonly Column[], rows: readonly Row[]): Validation {
  const issues: ValidationIssue[] = []
  const known = new Set(columns.map((c) => c.name))
  const requiredColumns = columns.filter((c) => c.required)

  rows.forEach((row, index) => {
    const rowNo = index + 1
    for (const key of Object.keys(row)) {
      if (!known.has(key)) issues.push({ row: rowNo, column: key, message: `unknown column "${key}" is not in the pipeline schema` })
    }
    for (const col of requiredColumns) {
      const value = row[col.name]
      if (value === undefined || value.trim() === "") {
        issues.push({ row: rowNo, column: col.name, message: `required column "${col.name}" is missing or empty` })
      }
    }
    for (const col of columns) {
      const value = row[col.name]
      if (value === undefined || value.trim() === "") continue
      if (col.enum && !col.enum.includes(value)) {
        issues.push({ row: rowNo, column: col.name, message: `"${value}" is not one of: ${col.enum.join(", ")}` })
      }
      if (col.pattern) {
        try {
          if (!new RegExp(col.pattern).test(value)) {
            issues.push({ row: rowNo, column: col.name, message: `"${value}" does not match the required format for "${col.name}"` })
          }
        } catch {
          // A malformed pattern in the schema should not crash validation.
        }
      }
    }
  })

  return { ok: issues.length === 0, rowCount: rows.length, issues }
}

export interface Interface {
  readonly schema: (pipeline: string, release: string) => Effect.Effect<Spec, SchemaUnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/NfcoreSamplesheet") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)

    const schema = Effect.fn("NfcoreSamplesheet.schema")(function* (pipeline: string, release: string) {
      const name = pipeline.replace(/^nf-core\//, "")
      // Schemas are immutable per release, so cache forever and fall back to the
      // cache when offline.
      const cacheFile = path.join(Global.Path.cache, "nfcore", "schema", `${name}@${release}.json`)

      const fromDisk = yield* fs.readJson(cacheFile).pipe(Effect.catch(() => Effect.succeed(undefined)))
      let raw = fromDisk
      if (raw === undefined) {
        const text = yield* HttpClientRequest.get(rawUrl(name, release)).pipe(
          HttpClientRequest.setHeader("User-Agent", USER_AGENT),
          http.execute,
          Effect.flatMap((res) => res.text),
          Effect.timeout("20 seconds"),
          Effect.catch(() => Effect.succeed(undefined)),
        )
        if (text === undefined) return yield* new SchemaUnavailableError({ pipeline: name, release })
        const tempfile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`
        yield* fs
          .writeWithDirs(tempfile, text)
          .pipe(Effect.andThen(fs.rename(tempfile, cacheFile)), Effect.catch(() => Effect.void))
        raw = yield* Effect.sync(() => {
          try {
            return JSON.parse(text) as unknown
          } catch {
            return undefined
          }
        })
        if (raw === undefined) return yield* new SchemaUnavailableError({ pipeline: name, release })
      }

      const columns = parseColumns(raw)
      if (columns.length === 0) return yield* new SchemaUnavailableError({ pipeline: name, release })
      return Spec.make({ pipeline: name, release, columns })
    })

    return Service.of({ schema })
  }),
)

export function summarizeColumns(spec: Spec): string {
  const lines = [`Samplesheet columns for nf-core/${spec.pipeline}@${spec.release}:`]
  for (const col of spec.columns) {
    const tags: string[] = [col.required ? "required" : "optional"]
    if (col.enum) tags.push(`one of: ${col.enum.join(", ")}`)
    else if (col.format === "file-path") tags.push("file path")
    else if (col.pattern) tags.push(`must match ${col.pattern}`)
    lines.push(`- ${col.name} (${tags.join("; ")})${col.description ? `: ${col.description}` : ""}`)
  }
  lines.push("")
  lines.push(
    "Build the samplesheet from the scientist's data using these exact columns. Inspect files by name and header only — never read whole data files. If sample grouping or read pairing is ambiguous, ask before writing it.",
  )
  return lines.join("\n")
}

export function summarizeValidation(pipeline: string, release: string, result: Validation): string {
  if (result.ok) {
    return `Samplesheet is valid against nf-core/${pipeline}@${release} (${result.rowCount} row${result.rowCount === 1 ? "" : "s"}). The pipeline will still run its own full validation.`
  }
  const lines = [`Samplesheet has ${result.issues.length} problem${result.issues.length === 1 ? "" : "s"}; fix before running:`]
  for (const issue of result.issues) lines.push(`- row ${issue.row}, ${issue.column}: ${issue.message}`)
  return lines.join("\n")
}

export const node = LayerNode.make({ service: Service, layer, deps: [httpClient, FSUtil.node] })
