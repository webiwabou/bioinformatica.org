import { Layer, ManagedRuntime } from "effect"
import { attach } from "./run-service"
import * as Observability from "@bioinformatica/core/observability"

import { FSUtil } from "@bioinformatica/core/fs-util"
import { Database } from "@bioinformatica/core/database/database"
import { Auth } from "@/auth"
import { Account } from "@/account/account"
import { Config } from "@/config/config"
import { Git } from "@/git"
import { Ripgrep } from "@bioinformatica/core/ripgrep"
import { Storage } from "@/storage/storage"
import { Snapshot } from "@/snapshot"
import { Plugin } from "@/plugin"
import { ModelsDev } from "@bioinformatica/core/models-dev"
import { Provider } from "@/provider/provider"
import { ProviderAuth } from "@/provider/auth"
import { Agent } from "@/agent/agent"
import { Skill } from "@/skill"
import { Discovery } from "@/skill/discovery"
import { Question } from "@/question"
import { Permission } from "@/permission"
import { Todo } from "@/session/todo"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { SessionRunState } from "@/session/run-state"
import { SessionProcessor } from "@/session/processor"
import { SessionCompaction } from "@/session/compaction"
import { SessionRevert } from "@/session/revert"
import { SessionSummary } from "@/session/summary"
import { SessionPrompt } from "@/session/prompt"
import { Instruction } from "@/session/instruction"
import { LLM } from "@/session/llm"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { McpAuth } from "@/mcp/auth"
import { Command } from "@/command"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { Format } from "@/format"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { Vcs } from "@/project/vcs"
import { Workspace } from "@/control-plane/workspace"
import { Worktree } from "@/worktree"
import { Installation } from "@/installation"
import { Environment } from "@/environment/detect"
import { Registry } from "@/nfcore/registry"
import { Objective } from "@/nfcore/objective"
import { RepeatsDB } from "@/bio/repeatsdb"
import { Sifts } from "@/bio/sifts"
import { CorpusSnapshot } from "@/bio/snapshot"
import { Glue } from "@/bio/glue"
import { Verify } from "@/nfcore/verify"
import { Protocol } from "@/nfcore/protocol"
import { HandCount } from "@/nfcore/handcount"
import { Census } from "@/nfcore/census"
import { SystemPrompt } from "@/session/system"
import { Samplesheet } from "@/nfcore/samplesheet"
import { Params } from "@/nfcore/params"
import { Failure } from "@/nfcore/failure"
import { Record as NfcoreRecord } from "@/nfcore/record"
import { Manifest } from "@/nfcore/manifest"
import { Report } from "@/nfcore/report"
import { Authoring } from "@/nfcore/authoring"
import { Fork } from "@/nfcore/fork"
import { Entrez } from "@/bio/entrez"
import { Ensembl } from "@/bio/ensembl"
import { UniProt } from "@/bio/uniprot"
import { PDB } from "@/bio/pdb"
import { KEGG } from "@/bio/kegg"
import { ShareNext } from "@/share/share-next"
import { SessionShare } from "@/share/session"
import { Npm } from "@bioinformatica/core/npm"
import { memoMap } from "@bioinformatica/core/effect/memo-map"
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { AppNodeBuilderV1 } from "./app-node-builder-v1"
import { SessionProjector } from "@bioinformatica/core/session/projector"

export const AppLayer = AppNodeBuilderV1.build(
  LayerNode.group([
    Npm.node,
    FSUtil.node,
    Database.node,
    Auth.node,
    Account.node,
    Config.node,
    Git.node,
    Storage.node,
    Snapshot.node,
    Plugin.node,
    ModelsDev.node,
    Provider.node,
    ProviderAuth.node,
    Agent.node,
    Skill.node,
    Discovery.node,
    Question.node,
    Permission.node,
    Todo.node,
    Session.node,
    SessionProjector.node,
    SessionStatus.node,
    BackgroundJob.node,
    RuntimeFlags.node,
    EventV2Bridge.node,
    SessionRunState.node,
    SessionProcessor.node,
    SessionCompaction.node,
    SessionRevert.node,
    SessionSummary.node,
    SessionPrompt.node,
    Instruction.node,
    LLM.node,
    LSP.node,
    MCP.node,
    McpAuth.node,
    Command.node,
    Truncate.node,
    ToolRegistry.node,
    Format.node,
    InstanceStore.node,
    Project.node,
    Vcs.node,
    Workspace.node,
    Worktree.node,
    Installation.node,
    Environment.node,
    Registry.node,
    Objective.node,
    RepeatsDB.node,
    Sifts.node,
    CorpusSnapshot.node,
    Glue.node,
    Verify.node,
    Protocol.node,
    HandCount.node,
    Census.node,
    SystemPrompt.node,
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
    ShareNext.node,
    SessionShare.node,
  ]),
).pipe(Layer.provideMerge(AppNodeBuilderV1.build(Ripgrep.node)), Layer.provideMerge(Observability.layer))

const rt = ManagedRuntime.make(AppLayer, { memoMap })
type Runtime = Pick<typeof rt, "runSync" | "runPromise" | "runPromiseExit" | "runFork" | "runCallback" | "dispose">

/** Services provided by AppRuntime — i.e. what an Effect run via AppRuntime.runPromise can yield. */
export type AppServices = ManagedRuntime.ManagedRuntime.Services<typeof rt>
const wrap = (effect: Parameters<typeof rt.runSync>[0]) => attach(effect as never) as never

export const AppRuntime: Runtime = {
  runSync(effect) {
    return rt.runSync(wrap(effect))
  },
  runPromise(effect, options) {
    return rt.runPromise(wrap(effect), options)
  },
  runPromiseExit(effect, options) {
    return rt.runPromiseExit(wrap(effect), options)
  },
  runFork(effect) {
    return rt.runFork(wrap(effect))
  },
  runCallback(effect) {
    return rt.runCallback(wrap(effect))
  },
  dispose: () => rt.dispose(),
}
