import { Global } from "@bioinformatica/core/global"
import { InstallationVersion } from "@bioinformatica/core/installation/version"
import { Flag } from "@bioinformatica/core/flag/flag"
import os from "os"
import { Duration, Effect } from "effect"
import { effectCmd } from "../../effect-cmd"
import { cmd } from "../cmd"
import { ConfigCommand } from "./config"
import { FileCommand } from "./file"
import { LSPCommand } from "./lsp"
import { RipgrepCommand } from "./ripgrep"
import { ScrapCommand } from "./scrap"
import { SkillCommand } from "./skill"
import { EnvCommand } from "./env"
import { PipelinesCommand } from "./pipelines"
import { ObjectiveCommand } from "./objective"
import { RepeatsdbCommand, SiftsCommand } from "./subtraction"
import { CorpusCommand } from "./corpus"
import { GlueCommand } from "./glue"
import { AblationCommand } from "./ablation"
import { SamplesheetCommand } from "./samplesheet"
import { RunCommandCommand } from "./run-command"
import { ResourcesCommand } from "./resources"
import { ParamsCommand } from "./params"
import { DiagnoseCommand } from "./diagnose"
import { RunsCommand } from "./runs"
import { ValidateCommand } from "./validate"
import { ManifestCommand } from "./manifest"
import { CritiqueCommand } from "./critique"
import { ReportCommand } from "./report"
import { LintCommand } from "./lint"
import { ForkCommand } from "./fork"
import { HypothesisCommand } from "./hypothesis"
import { PubmedCommand } from "./pubmed"
import { GeneCommand, ProteinCommand, StructureCommand, PathwayCommand } from "./bio"
import { SnapshotCommand } from "./snapshot"
import { AgentCommand } from "./agent"
import { StartupCommand } from "./startup"
import { V2Command } from "./v2"

// verify / protocol / handcount / census are NOT here any more. They are the four run
// artefacts a third party can check, and reaching them meant typing a word whose describe
// string is "debugging and troubleshooting tools" — two of them had no other route at
// all. They are top-level commands now; see src/index.ts.
export const DebugCommand = cmd({
  command: "debug",
  describe: "debugging and troubleshooting tools",
  builder: (yargs) =>
    yargs
      .command(ConfigCommand)
      .command(LSPCommand)
      .command(RipgrepCommand)
      .command(FileCommand)
      .command(ScrapCommand)
      .command(SkillCommand)
      .command(EnvCommand)
      .command(ObjectiveCommand)
      .command(RepeatsdbCommand)
      .command(SiftsCommand)
      .command(CorpusCommand)
      .command(GlueCommand)
      .command(AblationCommand)
      .command(PipelinesCommand)
      .command(SamplesheetCommand)
      .command(RunCommandCommand)
      .command(ResourcesCommand)
      .command(ParamsCommand)
      .command(DiagnoseCommand)
      .command(RunsCommand)
      .command(ValidateCommand)
      .command(ManifestCommand)
      .command(CritiqueCommand)
      .command(ReportCommand)
      .command(LintCommand)
      .command(ForkCommand)
      .command(HypothesisCommand)
      .command(PubmedCommand)
      .command(GeneCommand)
      .command(ProteinCommand)
      .command(StructureCommand)
      .command(PathwayCommand)
      .command(SnapshotCommand)
      .command(StartupCommand)
      .command(AgentCommand)
      .command(V2Command)
      .command(InfoCommand)
      .command(PathsCommand)
      .command(WaitCommand)
      .demandCommand(),
  async handler() {},
})

const WaitCommand = effectCmd({
  command: "wait",
  describe: "wait indefinitely (for debugging)",
  handler: Effect.fn("Cli.debug.wait")(function* () {
    yield* Effect.sleep(Duration.days(1))
  }),
})

const InfoCommand = effectCmd({
  command: "info",
  describe: "show debug information",
  handler: Effect.fn("Cli.debug.info")(function* () {
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const { ConfigPlugin } = yield* Effect.promise(() => import("@/config/plugin"))
    const config = yield* Config.Service.use((cfg) => cfg.get())
    const termProgram = process.env.TERM_PROGRAM
      ? `${process.env.TERM_PROGRAM}${process.env.TERM_PROGRAM_VERSION ? ` ${process.env.TERM_PROGRAM_VERSION}` : ""}`
      : undefined
    const terminal = [termProgram, process.env.TERM].filter((item): item is string => Boolean(item)).join(" / ")

    console.log(`bioinformatica version: ${InstallationVersion}`)
    console.log(`os: ${os.type()} ${os.release()} ${os.arch()}`)
    console.log(`terminal: ${terminal || "unknown"}`)
    console.log("plugins:")
    if (Flag.BIOINFORMATICA_PURE) {
      console.log("external plugins disabled (--pure)")
      return
    }
    if (!config.plugin_origins?.length) {
      console.log("none")
      return
    }
    for (const plugin of config.plugin_origins) {
      console.log(`- ${ConfigPlugin.pluginSpecifier(plugin.spec)}`)
    }
  }),
})

const PathsCommand = cmd({
  command: "paths",
  describe: "show global paths (data, config, cache, state)",
  handler() {
    for (const [key, value] of Object.entries(Global.Path)) {
      console.log(key.padEnd(10), value)
    }
  },
})
