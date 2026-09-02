#!/usr/bin/env bun
//
// Freeze the nf-core catalogue.
//
// `nfcore/registry.ts` reads https://nf-co.re/pipelines.json live, writes it to a
// mutable cache under `Global.Path.cache` and re-fetches when it is older than an
// hour. That is right for interactive use and wrong for a measurement: "the
// nf-core catalogue" is not a thing a result can be attributed to unless the
// result names *which* catalogue, and an hour-old mutable cache cannot be named.
// Two runs a week apart resolve different pipelines and nothing anywhere records
// that they did.
//
// The output is deliberately in `CorpusSnapshot`'s format rather than a new one,
// which buys cold verification for free: `bioinformatica verify` already re-hashes every
// `*.manifest.json` it finds and its data file, with no model and no network. The
// frozen catalogue is therefore an artefact a third party can check without
// installing anything, like every other corpus this project produces.
//
//   bun run script/freeze-pipelines.ts [--out <dir>]
//
// Re-run to refresh; the manifest's `fetchedAt` and `sha256` are what change, and
// a diff on them is the record that the catalogue moved under the campaign.

import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"

const SOURCE = "https://nf-co.re/pipelines.json"

const outIndex = process.argv.indexOf("--out")
const outDir = path.resolve(outIndex === -1 ? "corpus" : process.argv[outIndex + 1]!)
const name = "nfcore-pipelines"

console.log(`fetching ${SOURCE}`)
const res = await fetch(SOURCE, { headers: { "User-Agent": "bioinformatica/freeze-pipelines" } })
if (!res.ok) {
  // A failed fetch must never be written as an empty catalogue: a snapshot of
  // nothing that verifies cleanly is worse than no snapshot at all.
  console.error(`refusing to freeze: ${SOURCE} returned ${res.status} ${res.statusText}`)
  process.exit(1)
}
const raw = (await res.json()) as { remote_workflows?: unknown[] }
const workflows = Array.isArray(raw.remote_workflows) ? raw.remote_workflows : []
if (workflows.length === 0) {
  console.error("refusing to freeze: the response carried no remote_workflows")
  process.exit(1)
}

// One workflow per line, so `rows` in the manifest is a count of pipelines and not
// a count of files — which is what makes the row check in `verify` mean something.
const text = workflows.map((w) => JSON.stringify(w)).join("\n") + "\n"
const sha256 = createHash("sha256").update(text, "utf8").digest("hex")

await fs.mkdir(outDir, { recursive: true })
const dataName = `${name}.ndjson`
const dataPath = path.join(outDir, dataName)
const manifestPath = path.join(outDir, `${name}.manifest.json`)

const tmp = `${dataPath}.${process.pid}.tmp`
await fs.writeFile(tmp, text)
await fs.rename(tmp, dataPath)

await fs.writeFile(
  manifestPath,
  JSON.stringify(
    {
      source: "nf-core",
      endpoint: SOURCE,
      // nf-core publishes no version or checksum for this document, and recording
      // that explicitly is the point: the sha256 below is the only identity it has.
      fetchedAt: new Date().toISOString(),
      rows: workflows.length,
      bytes: Buffer.byteLength(text, "utf8"),
      sha256,
      data: dataName,
    },
    null,
    2,
  ) + "\n",
)

console.log(`froze ${workflows.length} pipelines -> ${path.relative(process.cwd(), dataPath)}`)
console.log(`sha256 ${sha256}`)
console.log(`manifest ${path.relative(process.cwd(), manifestPath)}`)
console.log("")
console.log("To pin a run to this catalogue instead of the live one:")
console.log(`  BIOINFORMATICA_NFCORE_PIPELINES=${path.relative(process.cwd(), manifestPath)} bioinformatica ...`)
