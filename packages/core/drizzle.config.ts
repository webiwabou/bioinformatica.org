import { defineConfig } from "drizzle-kit"
import path from "path"
import { xdgData } from "xdg-basedir"

// drizzle-kit needs a concrete database file to diff the schema against when it
// generates a migration. Resolve it the way the application does at runtime —
// `Global.Path.data` in src/global.ts, i.e. the XDG data directory — rather than
// pinning one developer's home directory into the repository.
//
// `BIOINFORMATICA_DB` overrides it, matching the flag `Database.path()` reads.
const url =
  process.env["BIOINFORMATICA_DB"] ??
  path.join(xdgData ?? path.join(process.cwd(), ".xdg"), "bioinformatica", "bioinformatica.db")

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/**/*.sql.ts", "./src/**/sql.ts"],
  out: "./migration",
  dbCredentials: {
    url,
  },
})
