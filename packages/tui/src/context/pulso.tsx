import { createSignal, onCleanup } from "solid-js"
import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"

/**
 * El pulso: el unico reloj de la aplicacion.
 *
 * Todo lo que se mueve en esta interfaz se mueve contra este contador y no
 * contra un temporizador propio. Antes habia dos maquinarias de animacion
 * independientes (el ciclo braille de `<spinner>` a 80 ms y el barrido estilo
 * Knight Rider de `ui/spinner.ts` a 40 ms), ninguna de las cuales decia nada:
 * eran identicas en el minuto uno y en la hora cuatro de una ejecucion.
 *
 * Late una vez por segundo, y solo mientras alguien mira. Cada consumidor pide
 * su suscripcion al montarse y la suelta al desmontarse; sin suscriptores el
 * intervalo se para, asi que una pantalla quieta no despierta al renderizador.
 * El temporizador va `unref`'d para que no sostenga el proceso al salir.
 *
 * El ritmo aparente no se cambia acelerando el reloj sino contando pasos: quien
 * dibuja decide cuantos pulsos consume cada paso suyo. Eso permite que el
 * anillo frene conforme envejece el trabajo sin tocar el intervalo, que es
 * ademas la unica forma segura de hacerlo: `opentui-spinner` lanza `RangeError`
 * con cualquier intervalo por encima de 1000 ms en vez de recortarlo.
 */
export const { use: usePulso, provider: PulsoProvider } = createSimpleContext({
  name: "Pulso",
  init: () => {
    const renderer = useRenderer()
    const [pulso, setPulso] = createSignal(0)
    let timer: ReturnType<typeof setInterval> | undefined
    let subscribers = 0

    const start = () => {
      if (timer) return
      timer = setInterval(() => {
        setPulso((previous) => previous + 1)
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
      /** Segundos transcurridos desde que el pulso arranco. */
      pulso,
      /**
       * Mantiene el reloj vivo mientras el componente que llama siga montado.
       * Devuelve el mismo contador, por comodidad en el sitio de uso.
       */
      seguir() {
        subscribers++
        start()
        onCleanup(() => {
          subscribers--
          if (subscribers <= 0) stop()
        })
        return pulso
      },
    }
  },
})
