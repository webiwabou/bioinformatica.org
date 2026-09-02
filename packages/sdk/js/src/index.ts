export * from "./client.js"
export * from "./server.js"

import { createBioinformaticaClient } from "./client.js"
import { createBioinformaticaServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createBioinformatica(options?: ServerOptions) {
  const server = await createBioinformaticaServer({
    ...options,
  })

  const client = createBioinformaticaClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
