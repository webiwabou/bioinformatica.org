import { EOL } from "os"
import { Effect } from "effect"
import { Census } from "@/nfcore/census"
import { effectCmd, fail } from "../../effect-cmd"

// Take a sample census over a finished (or running) nf-core run: N declared in the
// samplesheet, headcount at each per-sample process, and the last process that saw
// every sample that did not make it to the end.
export const CensusCommand = effectCmd({
  command: "census <samplesheet> [trace]",
  describe: "count samples through an nf-core run and name where each missing one was last seen (read-only)",
  builder: (yargs) =>
    yargs
      .positional("samplesheet", { describe: "the samplesheet CSV the run was launched with", type: "string" })
      .positional("trace", { describe: "pipeline_info/execution_trace_*.txt (or pass --outdir)", type: "string" })
      .option("outdir", {
        describe: "the run's outdir; the newest pipeline_info/execution_trace_*.txt under it is used",
        type: "string",
      })
      .option("json", { describe: "print the full report as JSON", type: "boolean", default: false }),
  handler: Effect.fn("Cli.debug.census")(function* (args: {
    samplesheet?: string
    trace?: string
    outdir?: string
    json?: boolean
  }) {
    if (!args.samplesheet) return yield* fail("a samplesheet path is required")
    if (!args.trace && !args.outdir) return yield* fail("pass the execution trace path, or --outdir to find it")
    const census = yield* Census.Service
    const report = yield* census
      .of({ samplesheet: args.samplesheet, trace: args.trace, outdir: args.outdir })
      .pipe(Effect.catch((e) => fail(e.message)))
    process.stdout.write((args.json ? JSON.stringify(report, null, 2) : Census.format(report)) + EOL)
    // A run that lost samples exits non-zero, so this is usable as a gate in a script.
    //
    // Three arms, not two. `complete` is `measurable && attrition.length === 0`, so a trace
    // nothing could be measured from also reports `complete: false` with an EMPTY attrition
    // list — and a two-arm gate then prints "0 of 4 declared samples did not finish" and
    // exits 1. That is a confident, false, affirmative claim, and it is exactly the claim
    // the census module refuses to make; reintroducing it one layer up would be worse than
    // not having the gate.
    if (!report.measurable) {
      return yield* fail(
        `Could not measure attrition: no process in this trace tags its tasks per sample. This is not a finding about the samples.`,
        2,
      )
    }
    if (report.attrition.length > 0) {
      return yield* fail(`${report.attrition.length} of ${report.declared} declared samples did not finish`, 1)
    }
  }),
})
