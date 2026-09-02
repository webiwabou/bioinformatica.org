import { EOL } from "os"
import fs from "fs/promises"
import { Effect } from "effect"
import { Authoring } from "@/nfcore/authoring"
import { effectCmd, fail } from "../../effect-cmd"

export const LintCommand = effectCmd({
  command: "lint [directory]",
  describe: "run or parse nf-core lint results and report contribution readiness (read-only)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("directory", { describe: "pipeline/module repo to lint (needs nf-core tools)", type: "string" })
      .option("module", { describe: "lint just this module instead of the whole pipeline", type: "string" })
      .option("file", { describe: "parse a saved `nf-core lint --json` file instead of running it", type: "string" })
      .option("inspect", { describe: "check the module structure of this directory (no nf-core tools needed)", type: "string" }),
  handler: Effect.fn("Cli.debug.lint")(function* (args: {
    directory?: string
    module?: string
    file?: string
    inspect?: string
  }) {
    if (args.inspect) {
      const files = yield* Effect.tryPromise(() => fs.readdir(args.inspect!, { recursive: true })).pipe(
        Effect.catch(() => fail(`could not read ${args.inspect}`)),
      )
      const shape = Authoring.inspectModule(files as string[])
      process.stdout.write(
        `Module structure of ${args.inspect}: ${shape.conformant ? "conformant" : `missing ${shape.missing.join(", ")}`}` +
          ` (main.nf: ${shape.hasMain}, meta.yml: ${shape.hasMeta}, environment.yml: ${shape.hasEnvironment}, tests/main.nf.test: ${shape.hasTest})` +
          EOL,
      )
      return
    }

    if (args.file) {
      const text = yield* Effect.tryPromise(() => fs.readFile(args.file!, "utf8")).pipe(
        Effect.catch(() => fail(`could not read ${args.file}`)),
      )
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return yield* fail(`${args.file} is not valid JSON`)
      }
      const report = Authoring.parseLintJson(parsed)
      process.stdout.write(Authoring.summarizeLint(report) + EOL + EOL + Authoring.readiness(report).summary + EOL)
      return
    }

    if (!args.directory) return yield* fail("provide a directory to lint, --file to parse, or --inspect to check structure")
    const run = yield* (yield* Authoring.Service).lint({ directory: args.directory, module: args.module })
    if (!run.installed) return yield* fail("nf-core tools is not installed")
    if (!run.report) {
      process.stdout.write((run.error ?? "no structured results") + (run.raw ? EOL + EOL + run.raw : "") + EOL)
      return
    }
    process.stdout.write(Authoring.summarizeLint(run.report) + EOL + EOL + Authoring.readiness(run.report).summary + EOL)
  }),
})
