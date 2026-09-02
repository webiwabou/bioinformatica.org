export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@bioinformatica/schema/event"
import { EventManifest } from "@bioinformatica/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
