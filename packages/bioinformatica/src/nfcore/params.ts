export * as Params from "./params"

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

// Every nf-core pipeline describes its parameters in `nextflow_schema.json`
// (grouped, with types, defaults, allowed values, and help text). Bioinformatica reads
// that file to explain parameters in plain language on request.
// It reads the published artifact; it does not reimplement nf-core's schema logic.

const USER_AGENT = `bioinformatica/${InstallationVersion}`
const rawUrl = (pipeline: string, release: string) =>
  `https://raw.githubusercontent.com/nf-core/${pipeline}/${release}/nextflow_schema.json`

export const Param = Schema.Struct({
  name: Schema.String,
  group: Schema.String,
  type: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  help: Schema.optional(Schema.String),
  default: Schema.optional(Schema.String),
  enum: Schema.optional(Schema.Array(Schema.String)),
  required: Schema.Boolean,
})
export type Param = Schema.Schema.Type<typeof Param>

export function parseParams(raw: unknown): Param[] {
  if (!isRecord(raw)) return []
  const groups = isRecord(raw.$defs) ? raw.$defs : isRecord(raw.definitions) ? raw.definitions : {}
  const params: Param[] = []
  for (const [groupKey, group] of Object.entries(groups)) {
    if (!isRecord(group)) continue
    const groupName = typeof group.title === "string" ? group.title : groupKey
    const required = Array.isArray(group.required) ? group.required.filter((r): r is string => typeof r === "string") : []
    const properties = isRecord(group.properties) ? group.properties : {}
    for (const [name, spec] of Object.entries(properties)) {
      if (!isRecord(spec)) continue
      params.push({
        name,
        group: groupName,
        type: typeof spec.type === "string" ? spec.type : undefined,
        description: typeof spec.description === "string" ? spec.description : undefined,
        help: typeof spec.help_text === "string" ? spec.help_text : undefined,
        default: spec.default === undefined ? undefined : String(spec.default),
        enum: Array.isArray(spec.enum) ? spec.enum.map((e) => String(e)) : undefined,
        required: required.includes(name),
      })
    }
  }
  return params
}

export function find(params: readonly Param[], query: string, limit = 12): Param[] {
  const q = query.toLowerCase().trim()
  if (q.length === 0) return params.filter((p) => p.required).slice(0, limit)
  const terms = q.split(/\s+/).filter(Boolean)
  return params
    .map((param) => {
      const name = param.name.toLowerCase()
      const desc = (param.description ?? "").toLowerCase()
      let s = 0
      if (name === q) s += 100
      else if (name.includes(q)) s += 40
      for (const term of terms) {
        if (name.includes(term)) s += 20
        if (desc.includes(term)) s += 5
      }
      return { param, s }
    })
    .filter((e) => e.s > 0)
    .sort((a, b) => b.s - a.s || a.param.name.localeCompare(b.param.name))
    .slice(0, limit)
    .map((e) => e.param)
}

export class SchemaUnavailableError extends Schema.TaggedErrorClass<SchemaUnavailableError>()(
  "Params.SchemaUnavailableError",
  { pipeline: Schema.String, release: Schema.String },
) {
  override get message() {
    return `Could not load nextflow_schema.json for nf-core/${this.pipeline}@${this.release}.`
  }
}

export interface Interface {
  readonly all: (pipeline: string, release: string) => Effect.Effect<Param[], SchemaUnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/NfcoreParams") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)

    const all = Effect.fn("NfcoreParams.all")(function* (pipeline: string, release: string) {
      const name = pipeline.replace(/^nf-core\//, "")
      const cacheFile = path.join(Global.Path.cache, "nfcore", "params", `${name}@${release}.json`)

      let raw = yield* fs.readJson(cacheFile).pipe(Effect.catch(() => Effect.succeed(undefined)))
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
      }

      const params = parseParams(raw)
      if (params.length === 0) return yield* new SchemaUnavailableError({ pipeline: name, release })
      return params
    })

    return Service.of({ all })
  }),
)

export function summarize(params: readonly Param[]): string {
  if (params.length === 0) return "No matching parameters found."
  return params
    .map((p) => {
      const bits: string[] = [p.required ? "required" : "optional"]
      if (p.type) bits.push(p.type)
      if (p.enum) bits.push(`one of: ${p.enum.join(", ")}`)
      if (p.default !== undefined && p.default !== "") bits.push(`default: ${p.default}`)
      const head = `--${p.name} (${bits.join("; ")}) [${p.group}]`
      const body = [p.description, p.help].filter(Boolean).join(" ")
      return body ? `${head}\n    ${body}` : head
    })
    .join("\n")
}

export const node = LayerNode.make({ service: Service, layer, deps: [httpClient, FSUtil.node] })
