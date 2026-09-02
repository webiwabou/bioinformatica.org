import { EOL } from "os"
import path from "path"
import { Effect } from "effect"
import { Verify } from "@/nfcore/verify"
import { effectCmd, fail } from "../../effect-cmd"

// `bioinformatica verify <dir>` — the cold check a third party runs. No model, no network: it
// re-hashes what is on disk and compares it with the manifests the campaign wrote.
// Exits non-zero when they disagree, so CI and a reviewer's shell both get the answer
// without reading the receipt.
export const VerifyCommand = effectCmd({
  command: "verify [directory]",
  describe: "re-check every corpus manifest against its data file (no model, no network)",
  builder: (yargs) =>
    yargs
      .positional("directory", { describe: "project directory to verify (default: cwd)", type: "string" })
      // yargs' boolean negation turns `--no-color` into `color: false`.
      .option("color", { describe: "colourise the receipt (default: only on a terminal)", type: "boolean" }),
  // Root the instance at the directory under test, so the report and the paths in it
  // are about that project rather than wherever the reviewer happened to be standing.
  directory: (args: { directory?: string }) =>
    args.directory ? path.resolve(process.cwd(), args.directory) : process.cwd(),
  handler: Effect.fn("Cli.debug.verify")(function* (args: { directory?: string; color?: boolean }) {
    const report = yield* (yield* Verify.Service).verify()
    const color = args.color ?? process.stdout.isTTY === true
    process.stdout.write(Verify.format(report, { color }) + EOL)
    if (!report.ok) {
      return yield* fail(`${report.counts.fail} check(s) failed in ${report.directory}.`)
    }
  }),
})
