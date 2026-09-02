import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { httpClient } from "@bioinformatica/core/effect/app-node-platform"
import { Ripgrep } from "@bioinformatica/core/ripgrep"
import { PlanExitTool } from "./plan"
import { Session } from "@/session/session"
import { QuestionTool } from "./question"
import { ShellTool } from "./shell"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { Database } from "@bioinformatica/core/database/database"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import * as Tool from "./tool"
import { Config } from "@/config/config"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@bioinformatica/plugin"
import type { JSONSchema7, JSONSchema7Definition } from "@ai-sdk/provider"
import { Schema } from "effect"
import z from "zod"
import { Plugin } from "../plugin"
import { Provider } from "@/provider/provider"

import { WebSearchTool } from "./websearch"
import { EnvironmentTool } from "./environment"
import { Environment } from "@/environment/detect"
import { NfcorePipelineTool } from "./nfcore-pipeline"
import { NfcoreObjectiveTool } from "./nfcore-objective"
import { NfcoreCensusTool } from "./nfcore-census"
import { Registry } from "@/nfcore/registry"
import { Objective } from "@/nfcore/objective"
import { Census } from "@/nfcore/census"
import { NfcoreSamplesheetSchemaTool, NfcoreSamplesheetValidateTool } from "./nfcore-samplesheet"
import { Samplesheet } from "@/nfcore/samplesheet"
import { NfcoreRunTool } from "./nfcore-run"
import { NfcoreResourcesTool } from "./nfcore-resources"
import { NfcoreParamsTool } from "./nfcore-params"
import { Params } from "@/nfcore/params"
import { NfcoreDiagnoseTool } from "./nfcore-diagnose"
import { Failure } from "@/nfcore/failure"
import { NfcoreRecordTool } from "./nfcore-record"
import { Record as NfcoreRecord } from "@/nfcore/record"
import { NfcoreManifestTool } from "./nfcore-manifest"
import { Manifest } from "@/nfcore/manifest"
import { NfcoreCritiqueTool } from "./nfcore-critique"
import { ReportSaveTool } from "./report"
import { Report } from "@/nfcore/report"
import { NfcoreLintTool } from "./nfcore-lint"
import { Authoring } from "@/nfcore/authoring"
import { NfcoreForkTool, NfcoreForkStatusTool } from "./nfcore-fork"
import { Fork } from "@/nfcore/fork"
import { NfcoreHypothesisTool } from "./nfcore-hypothesis"
import { PubmedSearchTool, PubmedFetchTool } from "./pubmed"
import { Entrez } from "@/bio/entrez"
import { GeneLookupTool, ProteinLookupTool, StructureLookupTool, PathwayLookupTool } from "./bio"
import { Ensembl } from "@/bio/ensembl"
import { UniProt } from "@/bio/uniprot"
import { PDB } from "@/bio/pdb"
import { KEGG } from "@/bio/kegg"
import { LspTool } from "./lsp"
import * as Truncate from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { Glob } from "@bioinformatica/core/util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@bioinformatica/core/cross-spawn-spawner"
import { Format } from "../format"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "../session/instruction"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Permission } from "@/permission"
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Ablation } from "@/nfcore/ablation"
import { ProviderV2 } from "@bioinformatica/core/provider"
import { ModelV2 } from "@bioinformatica/core/model"
import { MCP } from "@/mcp"
import { PermissionV1 } from "@bioinformatica/core/v1/permission"
import { McpCatalog } from "@/mcp/catalog"

export function webSearchEnabled(providerID: ProviderV2.ID, flags = { exa: false, parallel: false }) {
  return providerID === ProviderV2.ID.bioinformatica || flags.exa || flags.parallel
}

type TaskDef = Tool.InferDef<typeof TaskTool>
type ReadDef = Tool.InferDef<typeof ReadTool>

type State = {
  custom: Tool.Def[]
  builtin: Tool.Def[]
  task: TaskDef
  read: ReadDef
}

export interface Interface {
  readonly ids: () => Effect.Effect<string[]>
  readonly all: () => Effect.Effect<Tool.Def[]>
  /** Ids contributed by MCP servers, plugins and `tool/*.ts` files — not built in.
   *  Recorded in the ablation fingerprint as a confounder. */
  readonly customIds: () => Effect.Effect<string[]>
  readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>
  readonly tools: (model: {
    providerID: ProviderV2.ID
    modelID: ModelV2.ID
    agent: Agent.Info
    permission?: PermissionV1.Ruleset
  }) => Effect.Effect<Tool.Def[]>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/ToolRegistry") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const agents = yield* Agent.Service
    const truncate = yield* Truncate.Service
    const flags = yield* RuntimeFlags.Service
    const ablation = Ablation.resolve(flags.ablate)
    /** Drop the specialization tools when that layer is ablated. */
    const ablationTools = (defs: Tool.Def[]): Tool.Def[] =>
      ablation.tools ? defs : defs.filter((d) => !Ablation.isSpecializationTool(d.id))
    const mcp = yield* MCP.Service

    const invalid = yield* InvalidTool
    const task = yield* TaskTool
    const read = yield* ReadTool
    const question = yield* QuestionTool
    const todo = yield* TodoWriteTool
    const lsptool = yield* LspTool
    const plan = yield* PlanExitTool
    const webfetch = yield* WebFetchTool
    const websearch = yield* WebSearchTool
    const shell = yield* ShellTool
    const globtool = yield* GlobTool
    const writetool = yield* WriteTool
    const edit = yield* EditTool
    const greptool = yield* GrepTool
    const patchtool = yield* ApplyPatchTool
    const skilltool = yield* SkillTool
    const environmenttool = yield* EnvironmentTool
    const nfcorepipelinetool = yield* NfcorePipelineTool
    const nfcoreobjectivetool = yield* NfcoreObjectiveTool
    const nfcorecensustool = yield* NfcoreCensusTool
    const nfcoreschematool = yield* NfcoreSamplesheetSchemaTool
    const nfcorevalidatetool = yield* NfcoreSamplesheetValidateTool
    const nfcoreruntool = yield* NfcoreRunTool
    const nfcoreresourcestool = yield* NfcoreResourcesTool
    const nfcoreparamstool = yield* NfcoreParamsTool
    const nfcorediagnosetool = yield* NfcoreDiagnoseTool
    const nfcorerecordtool = yield* NfcoreRecordTool
    const nfcoremanifesttool = yield* NfcoreManifestTool
    const nfcorecritiquetool = yield* NfcoreCritiqueTool
    const reportsavetool = yield* ReportSaveTool
    const nfcorelinttool = yield* NfcoreLintTool
    const nfcoreforktool = yield* NfcoreForkTool
    const nfcoreforkstatustool = yield* NfcoreForkStatusTool
    const nfcorehypothesistool = yield* NfcoreHypothesisTool
    const pubmedsearchtool = yield* PubmedSearchTool
    const pubmedfetchtool = yield* PubmedFetchTool
    const genelookuptool = yield* GeneLookupTool
    const proteinlookuptool = yield* ProteinLookupTool
    const structurelookuptool = yield* StructureLookupTool
    const pathwaylookuptool = yield* PathwayLookupTool
    const agent = yield* Agent.Service
    const codeMode = flags.experimentalCodeMode ? yield* Effect.promise(() => import("./code-mode")) : undefined
    const codeModeTool = codeMode ? yield* codeMode.CodeModeTool : undefined

    const state = yield* InstanceState.make<State>(
      Effect.fn("ToolRegistry.state")(function* (ctx) {
        const custom: Tool.Def[] = []

        function fromPlugin(id: string, def: ToolDefinition): Tool.Def {
          // Plugin tools still expose Zod args publicly; keep that compatibility
          // boxed at the registry boundary and give the LLM the original JSON Schema.
          // Normalize missing args to `{}` once — pre-1.14.49 the code was
          // `z.object(def.args)` and Zod silently tolerated undefined (#27451, #27630).
          const args = def.args ?? {}
          const entries = Object.entries(args)
          const allZod = entries.every((entry) => isZodType(entry[1]))
          const zodParams = allZod ? z.object(args) : undefined
          const jsonSchema = zodParams ? zodJsonSchema(zodParams) : legacyJsonSchema(entries)
          const parameters = zodParams
            ? Schema.declare<unknown>((u): u is unknown => zodParams.safeParse(u).success)
            : Schema.Unknown
          return {
            id,
            parameters,
            jsonSchema,
            description: def.description,
            execute: (args, toolCtx) =>
              Effect.gen(function* () {
                // Bridge the host's Effect-based `ask` into a Promise-returning
                // function for the plugin to make sure context persists
                const bridge = yield* EffectBridge.make()
                const pluginCtx: PluginToolContext = {
                  ...toolCtx,
                  ask: (req) => bridge.promise(toolCtx.ask(req)),
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = yield* Effect.promise(() => def.execute(args as any, pluginCtx))
                const output = typeof result === "string" ? result : result.output
                const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
                const attachments = typeof result === "string" ? undefined : result.attachments
                const info = yield* agent.get(toolCtx.agent)
                const out = yield* truncate.output(output, {}, info)
                return {
                  title: typeof result === "string" ? "" : (result.title ?? ""),
                  output: out.truncated ? out.content : output,
                  attachments,
                  metadata: {
                    ...metadata,
                    truncated: out.truncated,
                    ...(out.truncated && { outputPath: out.outputPath }),
                  },
                }
              }).pipe(
                Effect.withSpan("Tool.execute", {
                  attributes: {
                    "tool.name": id,
                    "session.id": toolCtx.sessionID,
                    "message.id": toolCtx.messageID,
                    ...(toolCtx.callID ? { "tool.call_id": toolCtx.callID } : {}),
                  },
                }),
              ),
          }
        }

        const dirs = yield* config.directories()
        const matches = dirs.flatMap((dir) =>
          Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
        )
        if (matches.length) yield* config.waitForDependencies()
        for (const match of matches) {
          const namespace = path.basename(match, path.extname(match))
          // `match` is an absolute filesystem path from `Glob.scanSync(..., { absolute: true })`.
          // Import it as `file://` so Node on Windows accepts the dynamic import.
          const mod = yield* Effect.promise(() => import(pathToFileURL(match).href))
          for (const [id, def] of Object.entries(mod)) {
            if (!isPluginTool(def)) continue
            custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
          }
        }

        const plugins = yield* plugin.list()
        for (const p of plugins) {
          for (const [id, def] of Object.entries(p.tool ?? {})) {
            custom.push(fromPlugin(id, def))
          }
        }

        yield* config.get()
        const questionEnabled = ["app", "cli", "desktop"].includes(flags.client) || flags.enableQuestionTool

        const tool = yield* Effect.all({
          invalid: Tool.init(invalid),
          shell: Tool.init(shell),
          read: Tool.init(read),
          glob: Tool.init(globtool),
          grep: Tool.init(greptool),
          edit: Tool.init(edit),
          write: Tool.init(writetool),
          task: Tool.init(task),
          fetch: Tool.init(webfetch),
          todo: Tool.init(todo),
          search: Tool.init(websearch),
          skill: Tool.init(skilltool),
          environment: Tool.init(environmenttool),
          nfcorePipeline: Tool.init(nfcorepipelinetool),
          nfcoreObjective: Tool.init(nfcoreobjectivetool),
          nfcoreCensus: Tool.init(nfcorecensustool),
          nfcoreSchema: Tool.init(nfcoreschematool),
          nfcoreValidate: Tool.init(nfcorevalidatetool),
          nfcoreRun: Tool.init(nfcoreruntool),
          nfcoreResources: Tool.init(nfcoreresourcestool),
          nfcoreParams: Tool.init(nfcoreparamstool),
          nfcoreDiagnose: Tool.init(nfcorediagnosetool),
          nfcoreRecord: Tool.init(nfcorerecordtool),
          nfcoreManifest: Tool.init(nfcoremanifesttool),
          nfcoreCritique: Tool.init(nfcorecritiquetool),
          reportSave: Tool.init(reportsavetool),
          nfcoreLint: Tool.init(nfcorelinttool),
          nfcoreFork: Tool.init(nfcoreforktool),
          nfcoreForkStatus: Tool.init(nfcoreforkstatustool),
          nfcoreHypothesis: Tool.init(nfcorehypothesistool),
          pubmedSearch: Tool.init(pubmedsearchtool),
          pubmedFetch: Tool.init(pubmedfetchtool),
          geneLookup: Tool.init(genelookuptool),
          proteinLookup: Tool.init(proteinlookuptool),
          structureLookup: Tool.init(structurelookuptool),
          pathwayLookup: Tool.init(pathwaylookuptool),
          patch: Tool.init(patchtool),
          question: Tool.init(question),
          lsp: Tool.init(lsptool),
          plan: Tool.init(plan),
          ...(codeModeTool ? { execute: Tool.init(codeModeTool) } : {}),
        })

        return {
          // `custom` — MCP servers, plugins, and `tool/*.ts` files on disk —
          // used to bypass the ablation filter entirely, so the comment below claimed
          // an invariant the code did not hold: a specialization tool delivered by a
          // plugin or an MCP server stayed live in the bare arm.
          //
          // Note what this deliberately does NOT do: it does not strip every custom
          // tool. An unrelated MCP tool is user configuration, not part of Bioinformatica's
          // specialization layer, and it is present in upstream opencode too — so
          // removing it would make the bare arm differ from the control by MORE than
          // the layer, which is the same class of error in the opposite direction.
          // Held constant across arms it is not a confound; the fingerprint records
          // the custom surface so an operator can confirm it really was constant.
          custom: ablationTools(custom),
          // the bare arm ships none of the specialization tools. The filter runs
          // over the assembled list rather than each entry so that a tool added later is
          // covered by default — the failure mode being avoided is a tool that stays
          // enabled in the bare arm and makes the two arms differ by less than claimed.
          builtin: ablationTools([
            tool.invalid,
            ...(questionEnabled ? [tool.question] : []),
            tool.shell,
            tool.read,
            tool.glob,
            tool.grep,
            tool.edit,
            tool.write,
            tool.task,
            tool.fetch,
            tool.todo,
            tool.search,
            tool.skill,
            tool.environment,
            tool.nfcorePipeline,
            tool.nfcoreObjective,
            tool.nfcoreCensus,
            tool.nfcoreSchema,
            tool.nfcoreValidate,
            tool.nfcoreRun,
            tool.nfcoreResources,
            tool.nfcoreParams,
            tool.nfcoreDiagnose,
            tool.nfcoreRecord,
            tool.nfcoreManifest,
            tool.nfcoreCritique,
            tool.reportSave,
            tool.nfcoreLint,
            tool.nfcoreFork,
            tool.nfcoreForkStatus,
            tool.nfcoreHypothesis,
            tool.pubmedSearch,
            tool.pubmedFetch,
            tool.geneLookup,
            tool.proteinLookup,
            tool.structureLookup,
            tool.pathwayLookup,
            tool.patch,
            ...(tool.execute ? [tool.execute] : []),
            ...(flags.experimentalLspTool ? [tool.lsp] : []),
            ...(flags.experimentalPlanMode && flags.client === "cli" ? [tool.plan] : []),
          ]),
          task: tool.task,
          read: tool.read,
        }
      }),
    )

    const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.builtin, ...s.custom] as Tool.Def[]
    })

    const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
      return (yield* all()).map((tool) => tool.id)
    })

    const customIds: Interface["customIds"] = Effect.fn("ToolRegistry.customIds")(function* () {
      const s = yield* InstanceState.get(state)
      return s.custom.map((tool) => tool.id)
    })

    const describeTask = Effect.fn("ToolRegistry.describeTask")(function* (agent: Agent.Info) {
      const items = (yield* agents.list()).filter((item) => item.mode !== "primary")
      const filtered = items.filter(
        (item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny",
      )
      const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
      const description = list
        .map(
          (item) =>
            `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`,
        )
        .join("\n")
      return ["Available agent types and the tools they have access to:", description].join("\n")
    })

    const describeCodeMode = Effect.fn("ToolRegistry.describeCodeMode")(function* (input: {
      agent: Agent.Info
      permission?: PermissionV1.Ruleset
    }) {
      if (!codeMode) return
      const ruleset = Permission.merge(input.agent.permission, input.permission ?? [])
      const tools = Permission.visibleTools(yield* mcp.tools(), ruleset)
      if (Object.keys(tools).length === 0) return
      return codeMode.describeCatalog(tools, Object.keys(yield* mcp.clients()).map(McpCatalog.sanitize))
    })

    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const filtered = (yield* all()).filter((tool) => {
        if (tool.id === WebSearchTool.id) {
          return webSearchEnabled(input.providerID, { exa: flags.enableExa, parallel: flags.enableParallel })
        }

        const usePatch =
          input.modelID.includes("gpt-") && !input.modelID.includes("oss") && !input.modelID.includes("gpt-4")
        if (tool.id === ApplyPatchTool.id) return usePatch
        if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch

        return true
      })

      const codeModeDescription = filtered.some((tool) => tool.id === "execute")
        ? yield* describeCodeMode(input)
        : undefined
      const visible = filtered.filter((tool) => tool.id !== "execute" || codeModeDescription)

      return yield* Effect.forEach(
        visible,
        Effect.fnUntraced(function* (tool: Tool.Def) {
          const output = {
            description: tool.description,
            parameters: tool.parameters,
            jsonSchema: tool.jsonSchema,
          }
          yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
          const jsonSchema =
            output.parameters === tool.parameters || output.jsonSchema !== tool.jsonSchema
              ? output.jsonSchema
              : undefined
          return {
            id: tool.id,
            description: [
              output.description,
              tool.id === TaskTool.id ? yield* describeTask(input.agent) : undefined,
              tool.id === "execute" ? codeModeDescription : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
            parameters: output.parameters,
            jsonSchema,
            execute: tool.execute,
            formatValidationError: tool.formatValidationError,
          }
        }),
        { concurrency: "unbounded" },
      )
    })

    const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
      const s = yield* InstanceState.get(state)
      return { task: s.task, read: s.read }
    })

    return Service.of({ ids, all, customIds, named, tools })
  }),
)

function isZodType(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value
}

function isPluginTool(value: unknown): value is ToolDefinition {
  return typeof value === "object" && value !== null && "args" in value && "description" in value && "execute" in value
}

function isJsonSchemaDefinition(value: unknown): value is JSONSchema7Definition {
  return typeof value === "boolean" || (typeof value === "object" && value !== null && !Array.isArray(value))
}

function legacyJsonSchema(entries: [string, unknown][]): JSONSchema7 {
  const properties = Object.fromEntries(
    entries.filter((entry): entry is [string, JSONSchema7Definition] => isJsonSchemaDefinition(entry[1])),
  )
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
  }
}

function zodJsonSchema(schema: z.ZodType): JSONSchema7 {
  const result = normalizeZodJsonSchema(z.toJSONSchema(schema, { io: "input", metadata: zodMetadataRegistry(schema) }))
  if (!isJsonSchemaObject(result)) throw new Error("plugin tool Zod schema produced a non-object JSON Schema")
  const { $defs, ...rest } = result
  return (
    $defs && isJsonSchemaObject($defs) ? { ...rest, definitions: $defs as JSONSchema7["definitions"] } : rest
  ) as JSONSchema7
}

function zodMetadataRegistry(schema: z.ZodType) {
  const registry = z.registry<Record<string, unknown>>()
  const seen = new WeakSet<object>()
  const collect = (value: unknown) => {
    if (typeof value !== "object" || value === null) return
    if (seen.has(value)) return
    seen.add(value)

    if (isZodType(value)) {
      const metadata = typeof value.meta === "function" ? value.meta() : undefined
      const description = typeof value.description === "string" ? value.description : undefined
      const merged = {
        ...(metadata && typeof metadata === "object" ? metadata : {}),
        ...(description ? { description } : {}),
      }
      if (Object.keys(merged).length) registry.add(value, merged)
      collect(value._zod.def)
      return
    }

    for (const item of Object.values(value)) collect(item)
  }
  collect(schema)
  return registry
}

function normalizeZodJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeZodJsonSchema(item))
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) =>
        (entry[0] === "exclusiveMaximum" || entry[0] === "exclusiveMinimum") && typeof entry[1] === "boolean"
          ? false
          : true,
      )
      .map(([key, item]) => [key, normalizeZodJsonSchema(item)]),
  )
}

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    Config.node,
    Plugin.node,
    Question.node,
    Todo.node,
    Agent.node,
    Skill.node,
    Session.node,
    BackgroundJob.node,
    Provider.node,
    LSP.node,
    Instruction.node,
    FSUtil.node,
    EventV2Bridge.node,
    httpClient,
    CrossSpawnSpawner.node,
    Format.node,
    Truncate.node,
    RuntimeFlags.node,
    MCP.node,
    Database.node,
    Ripgrep.node,
    Environment.node,
    Registry.node,
    Objective.node,
    Census.node,
    Samplesheet.node,
    Params.node,
    Failure.node,
    NfcoreRecord.node,
    Manifest.node,
    Report.node,
    Authoring.node,
    Fork.node,
    Entrez.node,
    Ensembl.node,
    UniProt.node,
    PDB.node,
    KEGG.node,
  ],
})

export * as ToolRegistry from "./registry"
