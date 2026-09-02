import { Config, ConfigProvider, Context, Effect, Layer, Option } from "effect"
import { ConfigService } from "@/effect/config-service"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))
const positiveInteger = (name: string) =>
  Config.number(name).pipe(
    Config.map((value) => (Number.isInteger(value) && value > 0 ? value : undefined)),
    Config.orElse(() => Config.succeed(undefined)),
  )
const experimental = bool("BIOINFORMATICA_EXPERIMENTAL")
const enabledByExperimental = (name: string) =>
  Config.all({ experimental, enabled: Config.boolean(name).pipe(Config.option) }).pipe(
    Config.map((flags) => Option.getOrElse(flags.enabled, () => flags.experimental)),
  )

export class Service extends ConfigService.Service<Service>()("@bioinformatica/RuntimeFlags", {
  autoShare: bool("BIOINFORMATICA_AUTO_SHARE"),
  pure: bool("BIOINFORMATICA_PURE"),
  disableDefaultPlugins: bool("BIOINFORMATICA_DISABLE_DEFAULT_PLUGINS"),
  disableEmbeddedWebUi: bool("BIOINFORMATICA_DISABLE_EMBEDDED_WEB_UI"),
  disableExternalSkills: bool("BIOINFORMATICA_DISABLE_EXTERNAL_SKILLS"),
  disableLspDownload: bool("BIOINFORMATICA_DISABLE_LSP_DOWNLOAD"),
  disableClaudeCodePrompt: Config.all({
    broad: bool("BIOINFORMATICA_DISABLE_CLAUDE_CODE"),
    direct: bool("BIOINFORMATICA_DISABLE_CLAUDE_CODE_PROMPT"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  disableClaudeCodeSkills: Config.all({
    broad: bool("BIOINFORMATICA_DISABLE_CLAUDE_CODE"),
    direct: bool("BIOINFORMATICA_DISABLE_CLAUDE_CODE_SKILLS"),
  }).pipe(Config.map((flags) => flags.broad || flags.direct)),
  enableExa: Config.all({
    experimental,
    enabled: bool("BIOINFORMATICA_ENABLE_EXA"),
    legacy: bool("BIOINFORMATICA_EXPERIMENTAL_EXA"),
  }).pipe(Config.map((flags) => flags.experimental || flags.enabled || flags.legacy)),
  enableParallel: Config.all({
    enabled: bool("BIOINFORMATICA_ENABLE_PARALLEL"),
    legacy: bool("BIOINFORMATICA_EXPERIMENTAL_PARALLEL"),
  }).pipe(Config.map((flags) => flags.enabled || flags.legacy)),
  enableExperimentalModels: bool("BIOINFORMATICA_ENABLE_EXPERIMENTAL_MODELS"),
  enableQuestionTool: bool("BIOINFORMATICA_ENABLE_QUESTION_TOOL"),
  experimentalReferences: enabledByExperimental("BIOINFORMATICA_EXPERIMENTAL_REFERENCES"),
  experimentalBackgroundSubagents: enabledByExperimental("BIOINFORMATICA_EXPERIMENTAL_BACKGROUND_SUBAGENTS"),
  experimentalLspTy: bool("BIOINFORMATICA_EXPERIMENTAL_LSP_TY"),
  experimentalLspTool: enabledByExperimental("BIOINFORMATICA_EXPERIMENTAL_LSP_TOOL"),
  experimentalOxfmt: enabledByExperimental("BIOINFORMATICA_EXPERIMENTAL_OXFMT"),
  experimentalPlanMode: enabledByExperimental("BIOINFORMATICA_EXPERIMENTAL_PLAN_MODE"),
  experimentalCodeMode: enabledByExperimental("BIOINFORMATICA_EXPERIMENTAL_CODE_MODE"),
  experimentalEventSystem: enabledByExperimental("BIOINFORMATICA_EXPERIMENTAL_EVENT_SYSTEM"),
  experimentalWorkspaces: enabledByExperimental("BIOINFORMATICA_EXPERIMENTAL_WORKSPACES"),
  experimentalIconDiscovery: enabledByExperimental("BIOINFORMATICA_EXPERIMENTAL_ICON_DISCOVERY"),
  outputTokenMax: positiveInteger("BIOINFORMATICA_EXPERIMENTAL_OUTPUT_TOKEN_MAX"),
  bashDefaultTimeoutMs: positiveInteger("BIOINFORMATICA_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"),
  experimentalNativeLlm: bool("BIOINFORMATICA_EXPERIMENTAL_NATIVE_LLM"),
  experimentalWebSockets: bool("BIOINFORMATICA_EXPERIMENTAL_WEBSOCKETS"),
  /**
   * Ablation instrument: which parts of the specialization layer to DISABLE.
   * "" or "none" = full stack (the default), "all" = bare, or a comma list of
   * persona/skills/tools/provenance. See src/nfcore/ablation.ts.
   */
  ablate: Config.string("BIOINFORMATICA_ABLATE").pipe(Config.withDefault("")),
  client: Config.string("BIOINFORMATICA_CLIENT").pipe(Config.withDefault("cli")),
}) {}

export type Info = Context.Service.Shape<typeof Service>

const emptyConfigLayer = Service.layer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
  Layer.orDie,
)

export const layer = (overrides: Partial<Info> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const flags = yield* Service
      return Service.of({ ...flags, ...overrides })
    }),
  ).pipe(Layer.provide(emptyConfigLayer))

export const node = LayerNode.make({ service: Service, layer: Service.layer.pipe(Layer.orDie), deps: [] })

export * as RuntimeFlags from "./runtime-flags"
import { LayerNode } from "@bioinformatica/core/effect/layer-node"
