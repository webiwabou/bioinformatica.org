import { createContext, type JSX, useContext } from "solid-js"
import { read, write, type ClipboardResult } from "../clipboard"

export type { ClipboardResult }

export type ClipboardContent = Readonly<{ data: string; mime: string }>
export type ClipboardService = Readonly<{
  read?(): Promise<ClipboardContent | undefined>
  write?(text: string): Promise<ClipboardResult>
}>

type ClipboardToast = {
  show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) => void
}

// Turn a clipboard result into an honest toast: a confirmed copy shows the success message;
// an OSC-52-only attempt is flagged as unverifiable with a fix hint; a hard failure surfaces
// an error — instead of the old behaviour of always reporting success.
export function notifyCopy(toast: ClipboardToast, result: ClipboardResult, success: string) {
  if (result === "copied") return toast.show({ message: success, variant: "success" })
  if (result === "osc52-only")
    return toast.show({
      message: `${success} — sent via OSC 52; if your terminal blocks it, install wl-clipboard, xclip, or xsel`,
      variant: "info",
    })
  return toast.show({
    message: "Couldn't copy — no clipboard tool found. Install wl-clipboard, xclip, or xsel.",
    variant: "error",
  })
}
const clipboard = { read, write }
const ClipboardContext = createContext<ClipboardService>(clipboard)

export function ClipboardProvider(props: { value?: ClipboardService; children: JSX.Element }) {
  return <ClipboardContext.Provider value={props.value ?? clipboard}>{props.children}</ClipboardContext.Provider>
}

export function useClipboard() {
  return useContext(ClipboardContext)
}
