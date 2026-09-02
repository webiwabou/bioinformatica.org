// Where this project publishes itself — the single source of truth.
//
// Every publish target (GitHub releases, npm, the container registry, the AUR
// package, the Homebrew formula) derives from the values below rather than being
// hardcoded at each call site, so moving the project is one edit here instead of
// thirty across four scripts and the installer.
//
// `assertPublishable()` runs at the top of every publish path and refuses while
// any of it is unresolved. A release that pushes to a namespace nobody owns is
// not reversible: a registry name, a container tag and a DOI are immutable in
// practice.

/** The GitHub repository, as `owner/name`. CI supplies its own. */
const REPOSITORY = process.env["GITHUB_REPOSITORY"] ?? "webiwabou/bioinformatica.org"

/**
 * The distribution name: the binary, the npm package, the container image, the
 * AUR package and the Homebrew formula all derive from it.
 *
 * ASCII and lowercase by necessity. The product is called Bioinformática.org,
 * which is a brand and not an identifier: it carries an accent and a dot, and
 * neither survives a package registry, a shell command or an environment
 * variable prefix.
 */
const DISTRIBUTION_NAME: string | undefined = "bioinformatica"

/**
 * Where this project publishes its own pages: the install script that the
 * landing page tells people to pipe into a shell, and any docs link that is not
 * the repository itself.
 *
 * It is deliberately not `https://bioinformatica.org`. That domain resolves —
 * to somebody else's server — and this project does not own it, so every URL
 * built from it was either dead or, worse, live and outside our hands: the curl
 * upgrade path fetched `/install` from it and piped the response into a shell.
 * Until a domain is actually owned, the GitHub Pages site published by
 * `.github/workflows/pages.yml` is the real one. The product keeps its name;
 * a name is not an address.
 */
const HOMEPAGE: string | undefined = "https://webiwabou.github.io/bioinformatica.org"

/** The name as written for a human: in the TUI, the docs, and any citation. */
export const BRAND = "Bioinformática.org"

const [owner, repo] = REPOSITORY.split("/")

export const Identity = {
  get owner() {
    return owner
  },
  get repo() {
    return repo
  },
  /** `owner/name`, the form `gh --repo` and the GitHub API take. */
  get repository() {
    return REPOSITORY
  },
  get repositoryUrl() {
    return `https://github.com/${REPOSITORY}`
  },
  get releasesUrl() {
    return `https://github.com/${REPOSITORY}/releases`
  },
  releaseDownloadUrl(tag: string, asset: string) {
    return `https://github.com/${REPOSITORY}/releases/download/${tag}/${asset}`
  },
  get name() {
    return DISTRIBUTION_NAME
  },
  get brand() {
    return BRAND
  },
  get homepage() {
    return HOMEPAGE
  },
  /**
   * The install script, served beside the landing page by the pages workflow —
   * which copies the repository's own `install` rather than keeping a second
   * copy. Both the first install (`curl ... | bash`) and every self-upgrade
   * afterwards read this one URL.
   */
  get installScriptUrl() {
    return HOMEPAGE ? `${HOMEPAGE}/install` : undefined
  },
  get containerImage() {
    return DISTRIBUTION_NAME ? `ghcr.io/${owner}/${DISTRIBUTION_NAME}` : undefined
  },
  get homebrewTap() {
    return DISTRIBUTION_NAME ? `https://github.com/${owner}/homebrew-tap.git` : undefined
  },
  get aurPackage() {
    return DISTRIBUTION_NAME ? `${DISTRIBUTION_NAME}-bin` : undefined
  },

  /**
   * Refuse to publish while any target is unresolved.
   *
   * The failure is loud and names what is missing, instead of a push to a
   * non-existent namespace failing halfway through a release with half the
   * artefacts already uploaded.
   */
  assertPublishable() {
    const missing: string[] = []
    if (!DISTRIBUTION_NAME) missing.push("DISTRIBUTION_NAME")
    if (!HOMEPAGE) missing.push("HOMEPAGE")
    if (missing.length === 0) return
    throw new Error(
      [
        "refusing to publish: this project's identity is not settled yet.",
        "",
        ...missing.map((m) => `  - ${m}`),
        "",
        "Fill these in at packages/script/src/identity.ts.",
      ].join("\n"),
    )
  },
} as const
