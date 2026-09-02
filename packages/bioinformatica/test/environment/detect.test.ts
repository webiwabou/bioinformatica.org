import { describe, expect, test } from "bun:test"
import { makeGlobalNode } from "@bioinformatica/core/effect/app-node"
import { LayerNode } from "@bioinformatica/core/effect/layer-node"
import { Effect, Layer, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@bioinformatica/core/cross-spawn-spawner"
import { Environment } from "../../src/environment/detect"
import { testEffect } from "../lib/effect"

const encoder = new TextEncoder()

type ProbeResult = { code: number; stdout?: string; stderr?: string }

function mockSpawner(handler: (cmd: string, args: readonly string[]) => ProbeResult) {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const output = handler(std?.command ?? "", std?.args ?? [])
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(output.code)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output.stdout ? Stream.make(encoder.encode(output.stdout)) : Stream.empty,
        stderr: output.stderr ? Stream.make(encoder.encode(output.stderr)) : Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function envLayer(handler: (cmd: string, args: readonly string[]) => ProbeResult) {
  const spawnerNode = makeGlobalNode({
    service: ChildProcessSpawner.ChildProcessSpawner,
    layer: mockSpawner(handler),
    deps: [],
  })
  return LayerNode.compile(Environment.node, [[CrossSpawnSpawner.node, spawnerNode]])
}

// A machine with a full, healthy nf-core stack.
const fullStack = (cmd: string, args: readonly string[]): ProbeResult => {
  if (cmd === "nextflow") return { code: 0, stdout: "nextflow version 24.10.0.5928" }
  if (cmd === "java") return { code: 0, stderr: 'openjdk version "17.0.10" 2024-01-16' }
  if (cmd === "nf-core") return { code: 0, stdout: "nf-core, version 2.14.1" }
  if (cmd === "nf-test") return { code: 0, stdout: "🚀 nf-test 0.9.2\nhttps://code.askimed.com/nf-test" }
  if (cmd === "docker" && args[0] === "--version") return { code: 0, stdout: "Docker version 27.1.1, build 1234567" }
  if (cmd === "docker" && args[0] === "info") return { code: 0, stdout: "27.1.1" }
  if (cmd === "conda") return { code: 0, stdout: "conda 24.5.0" }
  if (cmd === "nvidia-smi") return { code: 0, stdout: "NVIDIA GeForce RTX 3090, 24576, 550.54.14" }
  return { code: 127 }
}

describe("environment.detect", () => {
  const it = testEffect(envLayer(fullStack))

  it.effect("reports a healthy nf-core stack with Docker as the backend", () =>
    Effect.gen(function* () {
      const env = yield* Environment.Service
      const report = yield* env.detect()

      expect(report.nextflow).toEqual({ installed: true, version: "24.10.0.5928" })
      expect(report.java).toEqual({ installed: true, version: "17.0.10" })
      expect(report.nfcoreTools).toEqual({ installed: true, version: "2.14.1" })
      expect(report.nfTest).toEqual({ installed: true, version: "0.9.2" })
      expect(report.docker).toEqual({ installed: true, running: true, version: "27.1.1" })
      expect(report.conda).toEqual({ installed: true, flavor: "conda", version: "24.5.0" })
      expect(report.containerBackend).toBe("docker")
      expect(report.gpu.present).toBe(true)
      expect(report.gpu.name).toBe("NVIDIA GeForce RTX 3090")
      expect(report.gpu.memoryTotalMb).toBe(24576)
      expect(report.gpu.driverVersion).toBe("550.54.14")
      expect(report.resources.cpuCores).toBeGreaterThan(0)
    }),
  )

  const bare = testEffect(envLayer(() => ({ code: 127 })))
  bare.effect("reports nothing installed and no backend on a bare machine", () =>
    Effect.gen(function* () {
      const env = yield* Environment.Service
      const report = yield* env.detect()

      expect(report.nextflow.installed).toBe(false)
      expect(report.nfcoreTools.installed).toBe(false)
      expect(report.docker).toEqual({ installed: false, running: false })
      expect(report.conda.installed).toBe(false)
      expect(report.containerBackend).toBe("none")
      expect(report.gpu.present).toBe(false)
    }),
  )

  // Docker client present but daemon down: fall back to conda.
  const dockerDown = (cmd: string, args: readonly string[]): ProbeResult => {
    if (cmd === "docker" && args[0] === "--version") return { code: 0, stdout: "Docker version 27.1.1, build 1234567" }
    if (cmd === "docker" && args[0] === "info") return { code: 1, stderr: "Cannot connect to the Docker daemon" }
    if (cmd === "mamba") return { code: 0, stdout: "mamba 1.5.8\nconda 24.5.0" }
    return { code: 127 }
  }
  const fallback = testEffect(envLayer(dockerDown))
  fallback.effect("falls back to conda when the Docker daemon is not running", () =>
    Effect.gen(function* () {
      const env = yield* Environment.Service
      const report = yield* env.detect()

      expect(report.docker).toEqual({ installed: true, running: false, version: "27.1.1" })
      expect(report.conda.flavor).toBe("mamba")
      expect(report.containerBackend).toBe("conda")
    }),
  )
})

// The two things that would fail silently: a kernel release string that has to
// be read correctly to know which WSL this is, and the output of `wsl.exe -l -q`,
// which is UTF-16 and arrives full of null bytes when read as UTF-8.
describe("environment.detect WSL parsing", () => {
  test("recognises WSL 2 from the kernel release", () => {
    const wsl = Environment.parseWsl("5.15.90.1-microsoft-standard-WSL2", "/home/x", "Ubuntu")!
    expect(wsl.version).toBe(2)
    expect(wsl.distro).toBe("Ubuntu")
    expect(wsl.cwdOnWindowsDrive).toBe(false)
  })

  test("recognises WSL 1, which reports microsoft but not WSL2", () => {
    expect(Environment.parseWsl("4.4.0-19041-Microsoft", "/home/x")!.version).toBe(1)
  })

  test("is not WSL on an ordinary kernel", () => {
    expect(Environment.parseWsl("6.9.3-arch1-1", "/home/x")).toBeUndefined()
  })

  test("spots a working directory on a Windows drive, including /mnt/c itself", () => {
    const release = "5.15.90.1-microsoft-standard-WSL2"
    expect(Environment.parseWsl(release, "/mnt/c/Users/x/datos")!.cwdOnWindowsDrive).toBe(true)
    expect(Environment.parseWsl(release, "/mnt/c")!.cwdOnWindowsDrive).toBe(true)
    expect(Environment.parseWsl(release, "/mnt/d/datos")!.cwdOnWindowsDrive).toBe(true)
    expect(Environment.parseWsl(release, "/home/x/mnt/c")!.cwdOnWindowsDrive).toBe(false)
    expect(Environment.parseWsl(release, "/mnt/wsl/instances")!.cwdOnWindowsDrive).toBe(false)
  })

  test("reads distribution names out of UTF-16 output with a byte order mark", () => {
    const utf16ish = "\uFEFF\0U\0b\0u\0n\0t\0u\0\r\n\0D\0e\0b\0i\0a\0n\0\r\n"
    expect(Environment.parseWslDistros(utf16ish)).toEqual(["Ubuntu", "Debian"])
  })

  test("ignores the distributions Docker Desktop registers for itself", () => {
    expect(Environment.parseWslDistros("docker-desktop\ndocker-desktop-data\nUbuntu\n")).toEqual(["Ubuntu"])
    expect(Environment.parseWslDistros("docker-desktop\n")).toEqual([])
  })
})
