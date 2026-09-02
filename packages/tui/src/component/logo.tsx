import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "../context/theme"
import { home } from "../logo"

export function Logo() {
  const { theme } = useTheme()

  return (
    <box>
      <For each={home.word}>
        {(line) => (
          <text fg={theme.text} attributes={TextAttributes.BOLD} selectable={false}>
            {line}
          </text>
        )}
      </For>
    </box>
  )
}
