export * as Environment from "./detect"

import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { AppProcess } from "@bioinformatica/core/process"
import { serviceUse } from "@bioinformatica/core/effect/service-use"
import { ChildProcess } from "effect/unstable/process"
import { Context, Effect, Layer, Schema } from "effect"
import os from "os"
import fs from "fs/promises"

// A read-only snapshot of everything Bioinformatica needs to know before it can run an
// nf-core pipeline. Detection never writes or changes anything — it
// only inspects. Repair (self-install / show-the-sudo-command) is planned
// separately in ./remediate; this service just reports what is (and isn't)
// present.

const ToolStatus = Schema.Struct({
  installed: Schema.Boolean,
  version: Schema.optional(Schema.String),
})

const Docker = Schema.Struct({
  installed: Schema.Boolean,
  running: Schema.Boolean,
  version: Schema.optional(Schema.String),
})

const CondaFlavor = Schema.Literals(["mamba", "micromamba", "conda"])

const Conda = Schema.Struct({
  installed: Schema.Boolean,
  flavor: Schema.optional(CondaFlavor),
  version: Schema.optional(Schema.String),
})

const Resources = Schema.Struct({
  cpuCores: Schema.Number,
  memoryTotalMb: Schema.optional(Schema.Number),
  memoryAvailableMb: Schema.optional(Schema.Number),
})

const Gpu = Schema.Struct({
  present: Schema.Boolean,
  name: Schema.optional(Schema.String),
  memoryTotalMb: Schema.optional(Schema.Number),
  driverVersion: Schema.optional(Schema.String),
})

// Which container backend Bioinformatica would actually use, resolved from what's
// present: Docker primary, conda/mamba fallback, otherwise none.
const ContainerBackend = Schema.Literals(["docker", "conda", "none"])

// Running inside a WSL distribution, which is how this stack reaches a Windows
// machine at all. Three things follow from it and none of them is cosmetic:
//
//   - The working directory may sit on a Windows drive, mounted into the
//     distribution across a bridge slow enough to change the shape of a run.
//   - The memory reported here is the ceiling of a virtual machine, roughly
//     half the computer's RAM by default, and the scientist can raise it.
//   - Docker usually means Docker Desktop with integration enabled, not a
//     daemon this distribution starts.
const Wsl = Schema.Struct({
  // 2 for WSL 2 (a real kernel in a VM), 1 for the original translation layer.
  version: Schema.Number,
  distro: Schema.optional(Schema.String),
  // The current working directory as the distribution sees it.
  cwd: Schema.String,
  // ...and whether that directory is on a Windows drive (/mnt/c and friends).
  cwdOnWindowsDrive: Schema.Boolean,
})
export type Wsl = Schema.Schema.Type<typeof Wsl>

const Platform = Schema.Struct({
  os: Schema.Literals(["linux", "darwin", "windows", "other"]),
  // Set only when running inside a WSL distribution.
  wsl: Schema.optional(Wsl),
  // Windows only: whether there is any user distribution of WSL to run in.
  // Undefined everywhere else, because the question does not arise.
  wslAvailable: Schema.optional(Schema.Boolean),
})
export type Platform = Schema.Schema.Type<typeof Platform>

export const Report = Schema.Struct({
  platform: Platform,
  nextflow: ToolStatus,
  java: ToolStatus,
  nfcoreTools: ToolStatus,
  // The module/subworkflow testing framework nf-core authoring depends on. Only
  // needed once a scientist authors or tests modules, so it is reported but not
  // required for ordinary pipeline execution.
  nfTest: ToolStatus,
  docker: Docker,
  conda: Conda,
  containerBackend: ContainerBackend,
  resources: Resources,
  gpu: Gpu,
})
export type Report = Schema.Schema.Type<typeof Report>

export interface Interface {
  readonly detect: () => Effect.Effect<Report>
}

export class Service extends Context.Service<Service, Interface>()("@bioinformatica/Environment") {}

export const use = serviceUse(Service)

// Pull the first capture group of `re` out of `text`, trimmed, or undefined.
function match(text: string, re: RegExp): string | undefined {
  const m = text.match(re)
  return m?.[1]?.trim() || undefined
}

// Read a WSL environment out of the kernel release string.
//
// WSL 2 reports something like `5.15.90.1-microsoft-standard-WSL2`, WSL 1 like
// `4.4.0-19041-Microsoft`. Both carry "microsoft"; only the second generation
// says WSL2, and that distinction decides whether the memory figure is a VM
// ceiling or the machine's own.
export function parseWsl(release: string, cwd: string, distro?: string): Wsl | undefined {
  if (!/microsoft/i.test(release)) return undefined
  return {
    version: /wsl2/i.test(release) ? 2 : 1,
    distro: distro || undefined,
    cwd,
    // A trailing slash so that /mnt/c itself matches, not just paths under it.
    cwdOnWindowsDrive: /^\/mnt\/[a-z]\//i.test(cwd.endsWith("/") ? cwd : cwd + "/"),
  }
}

// Distributions worth installing into, out of the output of `wsl.exe -l -q`.
//
// Two traps live in that output. It is UTF-16, so read as UTF-8 it arrives with
// a null byte between every character and a byte order mark in front; and
// Docker Desktop and Rancher Desktop register distributions of their own, which
// are service machines and not places to install anything.
const SERVICE_DISTROS = new Set(["docker-desktop", "docker-desktop-data", "rancher-desktop", "rancher-desktop-data"])

export function parseWslDistros(stdout: string): string[] {
  return stdout
    .replace(/\0/g, "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !SERVICE_DISTROS.has(line.toLowerCase()))
}

async function readMemInfoMb(): Promise<{ total?: number; available?: number }> {
  // Linux-only: /proc/meminfo is authoritative and reports MemAvailable
  // (reclaimable-aware), which matters more than free memory for run sizing.
  try {
    const text = await fs.readFile("/proc/meminfo", "utf8")
    const totalKb = match(text, /MemTotal:\s+(\d+)\s*kB/)
    const availKb = match(text, /MemAvailable:\s+(\d+)\s*kB/)
    const toMb = (kb?: string) => (kb ? Math.round(Number(kb) / 1024) : undefined)
    const total = toMb(totalKb)
    const available = toMb(availKb)
    if (total !== undefined || available !== undefined) return { total, available }
  } catch {
    // fall through to os fallback
  }
  return {
    total: Math.round(os.totalmem() / 1024 / 1024),
    available: Math.round(os.freemem() / 1024 / 1024),
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service

    // Run a read-only probe command. A missing binary or any failure resolves to
    // a non-zero code with empty output rather than raising, so detection of one
    // tool never aborts detection of the rest.
    const probe = Effect.fnUntraced(
      function* (cmd: string[]) {
        const result = yield* appProcess.run(ChildProcess.make(cmd[0], cmd.slice(1), { extendEnv: true }))
        return {
          code: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        }
      },
      Effect.catch(() => Effect.succeed({ code: 127, stdout: "", stderr: "" })),
    )

    const detectNextflow = Effect.fnUntraced(function* () {
      const r = yield* probe(["nextflow", "-v"])
      if (r.code !== 0) return { installed: false }
      return { installed: true, version: match(r.stdout, /version\s+([0-9][^\s]*)/i) }
    })

    const detectJava = Effect.fnUntraced(function* () {
      // `java -version` prints to stderr.
      const r = yield* probe(["java", "-version"])
      if (r.code !== 0) return { installed: false }
      return { installed: true, version: match(r.stderr || r.stdout, /version\s+"([^"]+)"/) }
    })

    const detectNfcore = Effect.fnUntraced(function* () {
      const r = yield* probe(["nf-core", "--version"])
      if (r.code !== 0) return { installed: false }
      return { installed: true, version: match(r.stdout, /version\s+([0-9][^\s]*)/i) }
    })

    const detectNfTest = Effect.fnUntraced(function* () {
      // `nf-test version` prints a banner like "nf-test 0.9.2".
      const r = yield* probe(["nf-test", "version"])
      if (r.code !== 0) return { installed: false }
      return { installed: true, version: match(r.stdout, /nf-test\s+v?([0-9][^\s]*)/i) }
    })

    const detectDocker = Effect.fnUntraced(function* () {
      const client = yield* probe(["docker", "--version"])
      if (client.code !== 0) return { installed: false, running: false }
      const version = match(client.stdout, /version\s+([0-9][^\s,]*)/i)
      // `docker info` only succeeds when the daemon is reachable.
      const info = yield* probe(["docker", "info", "--format", "{{.ServerVersion}}"])
      const running = info.code === 0 && info.stdout.trim().length > 0
      return { installed: true, running, version }
    })

    const detectConda = Effect.fnUntraced(function* () {
      // Prefer mamba/micromamba over conda when more than one is present.
      for (const flavor of ["mamba", "micromamba", "conda"] as const) {
        const r = yield* probe([flavor, "--version"])
        if (r.code !== 0) continue
        return { installed: true, flavor, version: match(r.stdout, /([0-9]+\.[0-9][^\s]*)/) }
      }
      return { installed: false }
    })

    // Where this is running. On Windows the question is not what is installed
    // but whether there is a Linux to install it in: nothing in this stack runs
    // natively there, so every other probe below is going to come back empty
    // and the remediation plan needs to say why.
    const detectPlatform = Effect.fnUntraced(function* () {
      if (process.platform === "win32") {
        const r = yield* probe(["wsl.exe", "-l", "-q"])
        const distros = parseWslDistros(r.stdout)
        return { os: "windows" as const, wslAvailable: r.code === 0 && distros.length > 0 }
      }
      if (process.platform === "darwin") return { os: "darwin" as const }
      if (process.platform !== "linux") return { os: "other" as const }
      const release = yield* Effect.promise(() =>
        fs.readFile("/proc/sys/kernel/osrelease", "utf8").catch(() => ""),
      )
      const wsl = parseWsl(release, process.cwd(), process.env["WSL_DISTRO_NAME"])
      return wsl ? { os: "linux" as const, wsl } : { os: "linux" as const }
    })

    const detectGpu = Effect.fnUntraced(function* () {
      const r = yield* probe([
        "nvidia-smi",
        "--query-gpu=name,memory.total,driver_version",
        "--format=csv,noheader,nounits",
      ])
      if (r.code !== 0 || r.stdout.trim().length === 0) return { present: false }
      const [name, memory, driver] = r.stdout.trim().split("\n")[0].split(",").map((part) => part.trim())
      const memoryTotalMb = Number(memory)
      return {
        present: true,
        name: name || undefined,
        memoryTotalMb: Number.isFinite(memoryTotalMb) ? memoryTotalMb : undefined,
        driverVersion: driver || undefined,
      }
    })

    const detect = Effect.fn("Environment.detect")(function* () {
      const [platform, nextflow, java, nfcoreTools, nfTest, docker, conda, gpu, mem] = yield* Effect.all(
        [
          detectPlatform(),
          detectNextflow(),
          detectJava(),
          detectNfcore(),
          detectNfTest(),
          detectDocker(),
          detectConda(),
          detectGpu(),
          Effect.promise(() => readMemInfoMb()),
        ],
        { concurrency: "unbounded" },
      )

      const containerBackend = docker.running ? "docker" : conda.installed ? "conda" : "none"
      const cpuCores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length

      return Report.make({
        platform,
        nextflow,
        java,
        nfcoreTools,
        nfTest,
        docker,
        conda,
        containerBackend,
        resources: { cpuCores, memoryTotalMb: mem.total, memoryAvailableMb: mem.available },
        gpu,
      })
    })

    return Service.of({ detect })
  }),
)

// One line for the platform, saying the part that changes what happens next.
export function describePlatform(platform: Platform): string {
  if (platform.os === "windows") {
    return platform.wslAvailable
      ? "Windows, running natively. WSL is installed but this process is not inside it, and the nf-core stack does not run natively here"
      : "Windows, running natively, with no WSL distribution installed. The nf-core stack does not run natively here"
  }
  if (!platform.wsl) return platform.os
  const wsl = platform.wsl
  const name = wsl.distro ? ` (${wsl.distro})` : ""
  const where = wsl.cwdOnWindowsDrive
    ? `. Working directory ${wsl.cwd} is on a Windows drive, reached across the bridge to Windows and slow for pipeline I/O`
    : ""
  return `Linux inside WSL ${wsl.version}${name} on Windows${where}`
}

export function summarize(report: Report): string {
  const yes = (b: boolean) => (b ? "yes" : "no")
  const versioned = (s: { installed: boolean; version?: string }) =>
    s.installed ? s.version ?? "installed (version unknown)" : "not found"
  const lines = [
    "nf-core execution environment:",
    `- Platform: ${describePlatform(report.platform)}`,
    `- Nextflow: ${versioned(report.nextflow)}`,
    `- Java (Nextflow runtime): ${versioned(report.java)}`,
    `- nf-core tools (CLI): ${versioned(report.nfcoreTools)}`,
    `- nf-test (module testing): ${versioned(report.nfTest)}`,
    `- Docker: ${report.docker.installed ? `${report.docker.version ?? "installed"} (daemon running: ${yes(report.docker.running)})` : "not found"}`,
    `- conda/mamba: ${report.conda.installed ? `${report.conda.flavor} ${report.conda.version ?? ""}`.trim() : "not found"}`,
    `- Container backend Bioinformatica would use: ${report.containerBackend}`,
    `- CPU cores: ${report.resources.cpuCores}`,
    `- Memory: ${report.resources.memoryTotalMb ?? "?"} MB total, ${report.resources.memoryAvailableMb ?? "?"} MB available`,
    `- GPU: ${report.gpu.present ? `${report.gpu.name ?? "present"}${report.gpu.memoryTotalMb ? `, ${report.gpu.memoryTotalMb} MB VRAM` : ""}${report.gpu.driverVersion ? `, driver ${report.gpu.driverVersion}` : ""}` : "none detected"}`,
  ]
  return lines.join("\n")
}

export const node = LayerNode.make({ service: Service, layer, deps: [AppProcess.node] })
