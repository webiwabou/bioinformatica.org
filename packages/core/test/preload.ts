import path from "path"

process.env.BIOINFORMATICA_DB = ":memory:"
process.env.BIOINFORMATICA_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.BIOINFORMATICA_DISABLE_MODELS_FETCH = "true"
