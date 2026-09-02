import { createSignal, onCleanup } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"

/**
 * The pulse: the application's only clock.
 *
 * Everything that moves in this interface moves against this counter rather
 * than against a timer of its own. There used to be two independent animation
 * machines (the braille cycle of `<spinner>` at 80ms and the Knight Rider sweep
 * of `ui/spinner.ts` at 40ms), and neither of them said anything: both were
 * identical at minute one and at hour four of a run.
 *
 * It beats once a second, and only while someone is watching. Every consumer
 * asks for a subscription when it mounts and drops it when it unmounts; with no
 * subscribers the interval stops, so a still screen never wakes the renderer.
 * The timer is unref'd so it cannot hold the process open on exit.
 *
 * Apparent rhythm is changed by counting beats, never by speeding the clock up:
 * whoever draws decides how many pulses one of its steps consumes. That is what
 * lets the ring slow down as a job ages without touching the interval, which is
 * also the only safe way to do it. `opentui-spinner` throws a RangeError for any
 * interval above 1000ms instead of clamping it.
 */
export const { use: usePulse, provider: PulseProvider } = createSimpleContext({
  name: "Pulse",
  init: () => {
    const renderer = useRenderer()
    const [pulse, setPulse] = createSignal(0)
    let timer: ReturnType<typeof setInterval> | undefined
    let subscribers = 0

    const start = () => {
      if (timer) return
      timer = setInterval(() => {
        setPulse((previous) => previous + 1)
        renderer.requestRender()
      }, 1000)
      timer.unref?.()
    }

    const stop = () => {
      if (!timer) return
      clearInterval(timer)
      timer = undefined
    }

    return {
      /** Seconds elapsed since the pulse started. */
      pulse,
      /**
       * Keeps the clock alive for as long as the calling component stays
       * mounted. Returns the same counter, for convenience at the call site.
       */
      follow() {
        subscribers++
        start()
        onCleanup(() => {
          subscribers--
          if (subscribers <= 0) stop()
        })
        return pulse
      },
    }
  },
})
