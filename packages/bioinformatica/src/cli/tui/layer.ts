import { run as runTui, type TuiInput } from "@bioinformatica/tui"
import { Global } from "@bioinformatica/core/global"
import { AppNodeBuilder } from "@bioinformatica/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
