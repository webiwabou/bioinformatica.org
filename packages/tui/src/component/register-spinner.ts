import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerBioinformaticaSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
