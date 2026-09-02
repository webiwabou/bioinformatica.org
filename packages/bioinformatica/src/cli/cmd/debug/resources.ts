import { EOL } from "os"
import { Effect } from "effect"
import { Environment } from "@/environment/detect"
import { Resource } from "@/environment/resource"
import { effectCmd } from "../../effect-cmd"

export const ResourcesCommand = effectCmd({
  command: "resources",
  describe: "show the recommended nf-core run resource ceiling for this machine (read-only)",
  instance: false,
  builder: (yargs) => yargs.option("requested", { describe: "test a memory request (GB) against the margin", type: "number" }),
  handler: Effect.fn("Cli.debug.resources")(function* (args: { requested?: number }) {
    const environment = yield* Environment.Service
    const report = yield* environment.detect()
    let out = Resource.summarizeCeiling(report)
    if (args.requested !== undefined) {
      const availableMb = report.resources.memoryAvailableMb ?? report.resources.memoryTotalMb ?? 0
      const decision = Resource.adapt(args.requested * 1024, availableMb)
      out += `${EOL}${EOL}Request ${args.requested} GB -> ${decision.action.toUpperCase()}: ${decision.rationale}`
    }
    process.stdout.write(out + EOL)
  }),
})
