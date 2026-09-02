import { AgentV2 } from "@bioinformatica/core/agent"
import { AISDK } from "@bioinformatica/core/aisdk"
import { Catalog } from "@bioinformatica/core/catalog"
import { CommandV2 } from "@bioinformatica/core/command"
import { Credential } from "@bioinformatica/core/credential"
import { AppNodeBuilder } from "@bioinformatica/core/effect/app-node-builder"
import { LayerNodePlatform } from "@bioinformatica/core/effect/app-node-platform"
import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { EventV2 } from "@bioinformatica/core/event"
import { FileSystem } from "@bioinformatica/core/filesystem"
import { FSUtil } from "@bioinformatica/core/fs-util"
import { Integration } from "@bioinformatica/core/integration"
import { Location } from "@bioinformatica/core/location"
import { Npm } from "@bioinformatica/core/npm"
import { PluginV2 } from "@bioinformatica/core/plugin"
import { Reference } from "@bioinformatica/core/reference"
import { SkillV2 } from "@bioinformatica/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
