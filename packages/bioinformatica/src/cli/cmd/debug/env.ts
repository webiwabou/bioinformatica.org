import { EOL } from "os"
import { Effect } from "effect"
import { Environment } from "@/environment/detect"
import { Remediate } from "@/environment/remediate"
import { effectCmd } from "../../effect-cmd"

export const EnvCommand = effectCmd({
  command: "env",
  describe: "inspect the local nf-core execution environment and remediation plan (read-only)",
  // Pure system inspection; no project InstanceContext needed.
  instance: false,
  builder: (yargs) => yargs.option("json", { describe: "print the raw report and plan as JSON", type: "boolean" }),
  handler: Effect.fn("Cli.debug.env")(function* (args: { json?: boolean }) {
    const environment = yield* Environment.Service
    const report = yield* environment.detect()
    const plan = Remediate.plan(report)
    if (args.json) {
      process.stdout.write(JSON.stringify({ report, plan }, null, 2) + EOL)
      return
    }
    process.stdout.write(Environment.summarize(report) + EOL + EOL + Remediate.summarize(plan) + EOL)
  }),
})
