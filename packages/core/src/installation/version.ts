declare global {
  const BIOINFORMATICA_VERSION: string
  const BIOINFORMATICA_CHANNEL: string
}

export const InstallationVersion = typeof BIOINFORMATICA_VERSION === "string" ? BIOINFORMATICA_VERSION : "local"
export const InstallationChannel = typeof BIOINFORMATICA_CHANNEL === "string" ? BIOINFORMATICA_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
