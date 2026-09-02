import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@bioinformatica/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~bioinformatica/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~bioinformatica/WorkspaceRef", {
  defaultValue: () => undefined,
})
