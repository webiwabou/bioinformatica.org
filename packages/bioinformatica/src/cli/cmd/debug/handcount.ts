import { EOL } from "os"
import fs from "fs/promises"
import { Effect } from "effect"
import { HandCount } from "@/nfcore/handcount"
import type { SessionID } from "@/session/schema"
import { effectCmd, fail } from "../../effect-cmd"

export const HandCountCommand = effectCmd({
  command: "handcount [file]",
  describe: "classify human turns against the frozen intervention taxonomy and print the Methods paragraph (read-only unless --write)",
  builder: (yargs) =>
    yargs
      .positional("file", { describe: "JSON file holding an array of turn strings", type: "string" })
      .option("session", { describe: "read the human turns from this session id instead of a file", type: "string" })
      .option("agent", { describe: "agent name for the Methods paragraph", type: "string" })
      .option("objective", { describe: "campaign objective for the Methods paragraph", type: "string" })
      .option("write", { describe: "also write the ledger to .bioinformatica/handcount.json", type: "boolean", default: false }),
  handler: Effect.fn("Cli.debug.handcount")(function* (args: {
    file?: string
    session?: string
    agent?: string
    objective?: string
    write: boolean
  }) {
    const handcount = yield* HandCount.Service

    let turns: readonly string[]
    let source: string
    if (args.session) {
      // A missing session must not read as a campaign with no human turns, so the failure
      // is surfaced rather than folded into an empty list.
      turns = yield* handcount
        .turns(args.session as SessionID)
        .pipe(Effect.catch(() => fail(`no session ${args.session}`)))
      source = `session ${args.session}`
    } else if (args.file) {
      const text = yield* Effect.tryPromise(() => fs.readFile(args.file!, "utf8")).pipe(
        Effect.catch(() => fail(`could not read ${args.file}`)),
      )
      const parsed = yield* Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: (cause) => cause,
      }).pipe(Effect.catch(() => fail(`${args.file} is not valid JSON`)))
      if (!Array.isArray(parsed) || parsed.some((t) => typeof t !== "string")) {
        return yield* fail(`${args.file} must hold a JSON array of turn strings`)
      }
      turns = parsed as string[]
      source = args.file
    } else {
      return yield* fail("a JSON file of turn strings, or --session <id>, is required")
    }

    const context: HandCount.MethodsContext = {
      source,
      ...(args.agent ? { agent: args.agent } : {}),
      ...(args.objective ? { objective: args.objective } : {}),
    }
    const t = HandCount.tally(turns)

    process.stdout.write(HandCount.summarize(t) + EOL + EOL)
    for (const entry of t.entries) {
      if (entry.class === "other") continue
      const excerpt = entry.text.replace(/\s+/g, " ").trim()
      process.stdout.write(
        `  #${entry.index}  ${entry.class.padEnd(19)} [${entry.cues.join(", ")}]  ${excerpt.slice(0, 100)}${excerpt.length > 100 ? "…" : ""}` + EOL,
      )
    }

    process.stdout.write(EOL + "--- Methods ---" + EOL + HandCount.methods(t, context) + EOL)

    if (args.write) {
      const written = yield* handcount.count({ turns, context })
      process.stdout.write(EOL + `Ledger written to ${written.path}` + EOL)
    }
  }),
})
