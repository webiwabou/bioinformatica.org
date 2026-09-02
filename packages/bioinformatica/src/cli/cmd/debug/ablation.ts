import { EOL } from "os"
import { Effect } from "effect"
import { Ablation } from "@/nfcore/ablation"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BUILTIN_LOCATION, Skill } from "@/skill"
import { SystemPrompt } from "@/session/system"
import { NfcorePersona } from "@/nfcore/persona"
import { ToolRegistry } from "@/tool/registry"
import { Provider } from "@/provider/provider"
import { effectCmd, fail } from "../../effect-cmd"

export const AblationCommand = effectCmd({
  command: "ablation",
  describe: "show which specialization layers are active, with the hashes that prove it (read-only)",
  builder: (yargs) =>
    yargs
      .option("model", { describe: "model id to assemble the prompt for", type: "string" })
      .option("leaks", { describe: "fail if an ablated layer still appears in the prompt", type: "boolean" }),
  handler: Effect.fn("Cli.debug.ablation")(function* (args: { model?: string; leaks?: boolean }) {
    const flags = yield* RuntimeFlags.Service
    const parsed = Ablation.parse(flags.ablate)
    if (parsed.unknown.length > 0) {
      // A typo in the spec would otherwise run the wrong arm silently, which is the one
      // mistake this instrument cannot survive.
      return yield* fail(`unknown ablation layer(s): ${parsed.unknown.join(", ")} — valid: ${Ablation.LAYERS.join(", ")}`)
    }

    const system = yield* SystemPrompt.Service
    const registry = yield* ToolRegistry.Service
    const skills = yield* Skill.Service

    const persona = yield* system.persona().pipe(Effect.catch((e) => fail(String(e))))
    const model = args.model ? Provider.parseModel(args.model) : undefined
    const tools = (yield* registry.all()).map((t) => t.id)
    const builtinSkills = (yield* skills.all())
      .filter((info) => info.location === BUILTIN_LOCATION)
      .map((info) => info.name)

    const fp: Ablation.Fingerprint = {
      state: parsed.state,
      spec: Ablation.spec(parsed.state),
      promptSha256: Ablation.digest(persona),
      toolManifestSha256: Ablation.manifestHash(tools),
      skillManifestSha256: Ablation.manifestHash(builtinSkills),
      tools,
      skills: builtinSkills,
      // the confounders. None of these is an ablation layer, and every one
      // of them changes what the model can reach — `client` alone decides whether
      // the `question` tool exists. Recorded so two arms can be shown to have held
      // them constant rather than assumed to have.
      context: {
        client: flags.client,
        enableQuestionTool: flags.enableQuestionTool,
        experimentalCodeMode: flags.experimentalCodeMode,
        experimentalLspTool: flags.experimentalLspTool,
        experimentalPlanMode: flags.experimentalPlanMode,
        customTools: yield* registry.customIds(),
      },
    }
    process.stdout.write(Ablation.describe(fp) + EOL)
    if (model) process.stdout.write(`  model    ${model.providerID}/${model.modelID}` + EOL)

    if (args.leaks) {
      const found = Ablation.leaks({
        state: parsed.state,
        prompt: persona,
        // Derived from the persona itself, never hardcoded. A literal drifts the moment
        // the identity text changes — and it did: the marker read "You are Bioinformatica"
        // while the persona opens "You are Bioinformática.org,", so this check reported
        // "no leak" unconditionally. A verifier that cannot fail is worse than none.
        personaMarker: NfcorePersona.Persona.split("\n")[0]!.slice(0, 40),
        skillNames: builtinSkills,
        toolNames: tools.filter((t) => Ablation.isSpecializationTool(t)),
      })
      if (found.length > 0) {
        process.stdout.write(EOL + "LEAKS — an ablated layer is still present:" + EOL)
        for (const f of found) process.stdout.write(`  ${f}` + EOL)
        return yield* fail(`${found.length} ablated layer(s) leaked into the assembled prompt`)
      }
      process.stdout.write(EOL + "No leak: nothing from an ablated layer appears in the prompt." + EOL)
    }
  }),
})
