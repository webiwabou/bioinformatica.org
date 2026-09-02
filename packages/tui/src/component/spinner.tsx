import { Show, createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import { usePulso } from "../context/pulso"
import { MARK_INNER, MARK_OUTER } from "../logo"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"

/**
 * El anillo: la marca del producto, linealizada, esperando.
 *
 * Seis celdas, un punto lleno viajando entre cinco huecos, dando la vuelta. Un
 * anillo cicla; no rebota, porque un rebote se lee como un escaner y esto no
 * escanea nada. Sustituye a las diez tramas braille a 80 ms, que son el glifo
 * mas reconocible de cualquier CLI generica y eran ademas el unico movimiento
 * de la aplicacion.
 *
 * El ritmo lleva informacion: un paso por segundo el primer minuto, cada dos a
 * partir del minuto, cada cuatro pasada la decena y cada doce pasada la hora.
 * A la hora tres el anillo da una vuelta cada setenta y dos segundos, y la
 * maquina, visiblemente, asienta la respiracion. Sin ese dato el estado de
 * ocupado era identico en el minuto uno y en la hora cuatro.
 *
 * No usa `<spinner>`: el ritmo se consigue contando pulsos del reloj unico de
 * la aplicacion, nunca cambiando un intervalo. `opentui-spinner@0.0.7` lanza
 * `RangeError` con cualquier intervalo fuera de [1000/60, 1000] en lugar de
 * recortarlo, asi que cualquier paso mas lento que un segundo reventaria el
 * componente.
 *
 * Los glifos salen de `logo.ts` a proposito, para que el anillo sea la marca y
 * no una figura parecida. Nota de anchura: `●` es de anchura ambigua en Asia
 * oriental y `◦` es estrecho, asi que bajo una configuracion regional CJK el
 * anillo cambia de ancho al girar. Pasar `MARK_INNER` a `○` (tambien ambiguo)
 * lo elimina por construccion, y es una decision de marca pendiente de firma:
 * al tomarla, esto la hereda sin tocar nada.
 */
export const RING_CELLS = 6

/** Cuantos pulsos consume cada paso, segun la edad del trabajo. */
export function ringStep(ageMs: number): number {
  if (ageMs < 60_000) return 1
  if (ageMs < 600_000) return 2
  if (ageMs < 3_600_000) return 4
  return 12
}

export function ring(position: number): string {
  let out = ""
  for (let cell = 0; cell < RING_CELLS; cell++) out += cell === position ? MARK_OUTER : MARK_INNER
  return out
}

/** El anillo detenido en su primera posicion: nada se mueve, te toca a ti. */
export const RING_STILL = ring(0)

export function Spinner(props: {
  children?: JSX.Element
  color?: RGBA
  /** Marca de tiempo en la que empezo el trabajo, si se conoce, para el ritmo. */
  since?: number
}) {
  const { theme } = useTheme()
  const kv = useKV()
  const pulso = usePulso()
  const color = () => props.color ?? theme.textMuted

  const tick = pulso.seguir()
  const frame = createMemo(() => {
    const age = props.since ? Date.now() - props.since : 0
    return ring(Math.floor(tick() / ringStep(age)) % RING_CELLS)
  })

  return (
    <Show
      when={kv.get("animations_enabled", true)}
      fallback={
        <text fg={color()}>
          {RING_STILL} {props.children}
        </text>
      }
    >
      <box flexDirection="row" gap={1}>
        <text fg={color()}>{frame()}</text>
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
