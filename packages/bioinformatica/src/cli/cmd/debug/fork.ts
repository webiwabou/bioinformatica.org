import { EOL } from "os"
import { Effect } from "effect"
import { Fork } from "@/nfcore/fork"
import { effectCmd, fail } from "../../effect-cmd"

export const ForkCommand = effectCmd({
  command: "fork [pipeline] [release]",
  describe: "plan/record a local pipeline fork, or show its divergence from upstream (read-only)",
  builder: (yargs) =>
    yargs
      .positional("pipeline", { describe: "nf-core pipeline to fork", type: "string" })
      .positional("release", { describe: "release tag to pin the fork to", type: "string" })
      .option("status", { describe: "show the git divergence of a fork at this path", type: "string" })
      .option("baseline", { describe: "baseline commit to diff against (with --status)", type: "string" })
      .option("list", { describe: "list recorded forks", type: "boolean" }),
  handler: Effect.fn("Cli.debug.fork")(function* (args: {
    pipeline?: string
    release?: string
    status?: string
    baseline?: string
    list?: boolean
  }) {
    const service = yield* Fork.Service

    if (args.list) {
      const records = yield* service.list()
      if (records.length === 0) {
        process.stdout.write("No recorded forks." + EOL)
        return
      }
      for (const r of records)
        process.stdout.write(`- nf-core/${r.pipeline}@${r.release} at ${r.path} (${r.baselineSha?.slice(0, 10) ?? "?"})` + EOL)
      return
    }

    if (args.status) {
      const st = yield* service.status({ path: args.status, baselineSha: args.baseline })
      process.stdout.write(Fork.summarizeStatus(st) + EOL)
      return
    }

    if (!args.pipeline || !args.release) return yield* fail("provide <pipeline> <release>, --status <path>, or --list")
    const result = yield* service.fork({ pipeline: args.pipeline, release: args.release })
    if (result.kind === "plan") {
      process.stdout.write(`Plan: ${result.plan.command}${EOL}Lands in: ${result.plan.path}${EOL}`)
      return
    }
    process.stdout.write(`Recorded to ${result.file}${EOL}${EOL}${Fork.summarizeStatus(result.status)}${EOL}`)
  }),
})
