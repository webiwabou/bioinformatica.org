# Bioinformática.org

Un agente de terminal para bioinformática: ejecuta pipelines de
[nf-core](https://nf-co.re)/[Nextflow](https://www.nextflow.io) a partir de una pregunta
formulada en lenguaje natural, y emite sobre cada ejecución los artefactos que el propio
agente no puede escribir acerca de sí mismo.

## El problema

Hay dos distancias entre una pregunta biológica y una respuesta defendible, y las
herramientas actuales sólo cubren una.

**La primera es operativa.** Quien tiene la pregunta —"¿qué genes se expresan de forma
diferencial entre estos dos grupos?"— no tiene por qué hablar el vocabulario de la
herramienta: no tiene por qué saber que eso es `nf-core/rnaseq`, ni qué release fijar, ni
qué columnas lleva su samplesheet, ni cómo se le dice a Nextflow que esta máquina tiene 16
GB y no 200. Bioinformática.org hace ese trabajo: traduce la pregunta a un pipeline y una
versión concretos, construye la samplesheet a partir de una descripción en prosa de los
datos, comprueba el entorno, arma el comando exacto, lo **enseña**, pide aprobación, y sólo
entonces lo ejecuta. El científico no escribe un comando de pipeline a mano en ningún
momento; tampoco cede ninguna decisión científica.

**La segunda es probatoria**, y es la que motiva el resto del proyecto. Un resultado
producido por un agente tiene que poder defenderse ante alguien que no estuvo en la sala:
un director de tesis, un revisor, un tribunal, uno mismo dieciocho meses después. Y ahí el
relato del propio agente no vale nada. Que un modelo afirme que trabajó de forma autónoma,
que respetó el protocolo o que los datos no cambiaron es exactamente lo que no se puede
comprobar. Por eso Bioinformática.org emite, sobre cada campaña, cuatro artefactos
diseñados para que **los verifique un tercero sin ejecutar el agente, sin modelo y sin
red** — y para que digan en voz alta lo que *no* demuestran.

## Requisitos

Para ejecutar pipelines hacen falta las herramientas del ecosistema; el agente las
comprueba pero no las sustituye:

- **Nextflow** y un **Java** compatible
- un backend de contenedores: **Docker** (preferido) o **conda/mamba**
- opcionalmente **nf-core tools**, para lint y contribución
- credenciales de algún proveedor de modelos (ver [Modelos](#modelos))

`bioinformatica debug env` inspecciona la máquina y devuelve, para cada dependencia que
falte, si se puede instalar sin root y el comando exacto. Es de sólo lectura: recomienda,
nunca instala.

Para compilar desde el código fuente hace falta además **[Bun](https://bun.sh) 1.3.x**.

## Instalación

Todavía no hay releases publicadas, así que la vía real hoy es compilar desde el código:

```bash
git clone https://github.com/webiwabou/bioinformatica.org.git
cd bioinformatica
bun install

cd packages/bioinformatica
bun run build --single    # deja un binario `bioinformatica` en dist/
```

El lanzador `packages/bioinformatica/bin/bioinformatica` puede enlazarse en el `PATH` para
invocar el binario recién compilado como `bioinformatica`.

Para trabajar sobre el código sin compilar:

```bash
bun dev -- --help              # el CLI desde las fuentes
bun dev -- /ruta/al/proyecto   # la TUI interactiva en ese directorio
```

El script `./install` de la raíz descarga un binario desde GitHub Releases; servirá cuando
haya releases publicadas (el repositorio de origen se puede fijar con
`BIOINFORMATICA_INSTALL_REPO`).

## Primeros pasos

Sitúate en el directorio del análisis y arranca la interfaz interactiva:

```bash
cd ~/analisis-rnaseq
bioinformatica
```

Y describe lo que quieres en tus propias palabras:

> Tengo 12 FASTQ pareados de RNA-seq de hígado de ratón en `./datos`, seis controles y
> seis tratados. Quiero cuantificar expresión génica.

El agente busca el pipeline y la release, comprueba el entorno, propone una samplesheet,
enseña el comando, ejecuta primero el perfil de prueba y luego los datos reales — pidiendo
aprobación antes de cada ejecución.

También se puede lanzar sin interfaz, con la pregunta en la línea de comandos:

```bash
bioinformatica run "tengo 12 FASTQ pareados de RNA-seq de ratón en ./datos; quiero cuantificar expresión génica"
```

Los mismos pasos están disponibles como comandos sueltos, todos de sólo lectura, por si
quieres ver el razonamiento pieza a pieza antes de dejar que el agente lo encadene:

```bash
bioinformatica debug env                      # ¿está lista esta máquina?
bioinformatica debug pipelines rnaseq         # buscar en el registro de nf-core
bioinformatica debug samplesheet rnaseq       # columnas exigidas por el esquema del pipeline
bioinformatica debug params rnaseq aligner    # qué significa un parámetro y cuál es su defecto
bioinformatica debug resources                # techo de recursos recomendado para esta máquina
bioinformatica debug run-command rnaseq --mode test --outdir resultados
bioinformatica debug diagnose ./ruta/del/run  # clasificar el fallo de una ejecución
```

`run-command` construye el comando y lo imprime; **no ejecuta nada**. La ejecución pasa
siempre por la herramienta de shell, que muestra el comando y pide aprobación.

## Los cuatro artefactos

Se recogen en un solo directorio con:

```bash
bioinformatica dossier              # escribe ./dossier
```

El dossier lleva un `index.json` con el digest SHA-256 de cada fichero, y un `verify.sh`
que sólo necesita `/bin/sh` y `sha256sum` (o `shasum`). Quien lo reciba comprueba el
paquete entero sin instalar nada:

```bash
cd dossier && sh verify.sh
```

Un dossier **nombra lo que falta** en lugar de omitirlo: si una campaña no produjo alguno
de los cuatro artefactos, el índice lo dice y explica qué lo habría generado. Una ausencia
silenciosa se lee igual que un artefacto que nunca existió, y esa es precisamente la
diferencia que el lector necesita.

### 1. Manifiesto verificable en frío

Todo corpus descargado se escribe una sola vez, en la carpeta visible `corpus/` del
proyecto, junto a un manifiesto que registra la fuente, el endpoint exacto, la consulta, el
**sello de versión que publica el origen** (p. ej. `PDB: 33.26 | UniProt: 2026.03`), el
número de filas, los bytes y el SHA-256.

```bash
bioinformatica verify        # re-hashea cada fichero contra su manifiesto
```

Este comando no usa modelo ni red: lee ficheros, recalcula digests y compara números. Esa
es la inversión de confianza que lo hace útil — el manifiesto lo escribió el agente, así
que el agente reafirmando que está bien no prueba nada; recalcular los bytes sí. Distingue
además dos casos que confundirlos arruina una revisión: un proyecto sin manifiestos no
tiene nada que verificar (correcto, salida 0), mientras que un manifiesto cuyo dato falta,
no se puede leer o ha cambiado es un **fallo**. No existe un "no se pudo determinar" que se
lea como éxito.

### 2. Protocolo, enmiendas y rechazos

Al empezar la campaña el científico compromete un protocolo: el objetivo más las
restricciones a las que quiere quedar sujeto. A partir de ahí, una petición que viola una
restricción se rechaza, el intento se escribe con marca de tiempo y texto literal en un
registro que sólo crece, y seguir adelante exige una **enmienda firmada**.

```bash
bioinformatica protocol commit "caracterizar repeticiones estructurales en el proteoma X" \
  --constraint "sin-sustitucion=ninguna sustitución de herramienta sin calibrar contra ground truth" \
  --constraint "figuras=las figuras salen sólo de datos con manifiesto" \
  --by "A. Investigadora"

bioinformatica protocol list            # el protocolo en vigor, con las enmiendas plegadas
bioinformatica protocol check "..."     # probar una petición sin registrar nada
bioinformatica protocol refuse "..."    # comprobar y anotar el intento en el registro
bioinformatica protocol amend sin-sustitucion --action waive --reason "..." --sign "..."
bioinformatica protocol ledger          # todo el historial: enmiendas y rechazos
```

La asimetría es deliberada. Comprometerse es fácil y se hace una vez, en frío.
Saltárselo es más costoso y siempre deja marca, porque ese es el momento en que uno está en
caliente: a mitad de campaña, con una fecha encima y ganas de que salga. Una restricción de
la que se puede convencer a alguien en una conversación no es una restricción.

**Nada vincula hasta que se compromete un protocolo.** En un proyecto nuevo no hay fichero
de protocolo y no se rechaza nada. Existe también `--advisory` para quien quiera el registro
sin el bloqueo: sigue anotando cada violación, simplemente no detiene el trabajo. En ninguno
de los dos casos el cambio es silencioso.

Los ficheros viven en `.bioinformatica/protocol/`: el compromiso como JSON, los dos
registros como JSON por líneas. Los tres se leen sin este programa.

### 3. Conteo de intervenciones humanas

Un ledger de dónde intervino la persona en una campaña llevada por el agente, y el párrafo
de Métodos que lo dice en voz alta.

```bash
bioinformatica handcount --session <id> --write
```

La clasificación es una función **pura y determinista** sobre el texto del turno —mismo
texto, misma clase, siempre— contra una taxonomía congelada de seis categorías (corrección
factual, redirección, aprobación, rechazo, desambiguación, otros), y registra las pistas
que dispararon cada etiqueta para que cualquiera vea por qué se clasificó así. No lo decide
un modelo: pedirle a un modelo que puntúe cuántas veces hubo que corregirlo es exactamente
la peor forma de obtener ese número.

El coste de esa decisión se declara en lugar de esconderse. Las pistas de superficie no
leen intenciones: un turno que interviene sin ninguna de las formulaciones reconocidas cae
en `otros`, y `otros` significa **"no se encontró evidencia"**, no "no hubo intervención".
El párrafo de Métodos lo dice con esas palabras.

### 4. Métodos con versiones fijadas

Al terminar una ejecución se construye un manifiesto de reproducibilidad en
`.bioinformatica/manifests/`:

```bash
bioinformatica debug manifest ./resultados
```

No reinventa formatos de proveniencia: **referencia los del propio ecosistema** —el
`pipeline_info/` de nf-core (versiones de software, parámetros resueltos, informe, timeline
y trace de ejecución) y, si la ejecución usó el plugin `nf-prov`, sus ficheros BCO y
RO-Crate— y añade encima la capa que esos artefactos no capturan: el registro de
aprobaciones humanas de la sesión y su resumen.

### Y además: censo de muestras

No es uno de los cuatro, pero cubre un fallo que ninguno de ellos ve:

```bash
bioinformatica census samplesheet.csv --outdir ./resultados
```

El operador `join` de Nextflow descarta claves sin pareja en silencio salvo que el pipeline
pase `failOnMismatch`/`remainder`. Una muestra cuya clave no casa en un lado simplemente
deja de existir en ese canal: nada da error, la ejecución sale con código 0, y MultiQC
dibuja un informe impecable **de una cohorte más pequeña**. El científico lee un estudio de
38 muestras creyendo que cubre 40. Un recuento no basta —el recuento es justo lo que ya
enseña MultiQC y es justo lo que parece correcto—; hace falta atribución. Por eso cada id
declarado se sigue individualmente y cada muestra que no llegó al final se nombra junto al
último proceso que la vio.

## Bases de datos biológicas

Clientes de sólo lectura, sin credenciales, que devuelven el dato **con su cita**, para que
cualquier afirmación apoyada en ellos lleve su fuente:

| Fuente | Para qué |
| --- | --- |
| Ensembl | identidad, biotipo y localización genómica de un gen |
| UniProt | identidad y función de una proteína |
| RCSB PDB | estructuras resueltas: método experimental, resolución, fecha |
| KEGG | rutas biológicas por palabra clave |
| PubMed (Entrez) | literatura con citas |
| RepeatsDB | el conjunto ya anotado de repeticiones estructurales |
| SIFTS | el mapeo PDB↔UniProt a nivel de residuo, con el sello de release de EBI |

```bash
bioinformatica debug gene BRCA1
bioinformatica debug protein "gene:BRCA1 AND organism_id:9606 AND reviewed:true"
bioinformatica debug structure 1VJE
bioinformatica debug pathway glycolysis
bioinformatica debug pubmed "structural repeats prediction"
```

Los corpus se descargan **una vez** a `corpus/` con su manifiesto —`bioinformatica debug
corpus <nombre> --uniprot "..."`, `--repeatsdb`, `--pdb-holdings`— y a partir de ahí se
trabaja sobre lo escrito. Volver a consultar en vivo a mitad de campaña deja que dos etapas
discrepen sobre qué era el corpus, y nada te dirá cuál de los dos resultados es el bueno.

`bioinformatica debug glue` lista tres scripts de Python (requieren Biopython), y
`bioinformatica debug glue ./scripts` los escribe en disco. Cubren la contabilidad de
coordenadas entre una llamada a nivel de secuencia y un fragmento 3D:
mapeo SEQRES↔ATOM, corte de fragmentos y propagación de representantes a los miembros de
su clúster. Son *glue*, no ciencia: llaman a implementaciones de Biopython y hacen la
contabilidad alrededor. Van como scripts probados porque sus tres modos de fallo son
**silenciosos** — cada uno produce un fichero plausible con contenido mal, y ninguno lanza
excepción.

## Modelos

Bioinformática.org no trae modelo propio. El catálogo se obtiene de
[models.dev](https://models.dev) y las credenciales se configuran localmente:

```bash
bioinformatica providers login  # dar de alta un proveedor y sus credenciales
bioinformatica providers list   # qué credenciales y variables de entorno hay activas
bioinformatica models           # listar todo lo disponible
bioinformatica run --model <proveedor>/<modelo> "..."
```

Funciona con cualquier proveedor del catálogo de models.dev: Anthropic, OpenAI, Google
(Gemini y Vertex), Amazon Bedrock, Azure, GitHub Copilot, OpenRouter, DeepSeek, Qwen (vía
Alibaba/DashScope) y cualquier endpoint compatible con la API de OpenAI —incluido un modelo
que sirvas tú en local con Ollama, LM Studio o vLLM.

Las recetas concretas —DeepSeek, Qwen, un modelo local y cómo fijar el modelo por
defecto— están en [docs/modelos.md](./docs/modelos.md).

En la práctica esto pide un modelo **fuerte en uso de herramientas y de contexto largo**.
El agente encadena decenas de llamadas a herramientas por campaña y tiene que sostener el
protocolo, el objetivo y el estado del corpus a lo largo de la sesión; un modelo pequeño
degrada de la peor forma posible aquí, que es plausiblemente. Nada en el código impide
usarlo, pero conviene saberlo.

## Configuración

- Configuración global: `~/.config/bioinformatica/bioinformatica.json`
- Configuración por proyecto: `bioinformatica.json` o `.bioinformatica/` en la raíz
- Variables de entorno con prefijo `BIOINFORMATICA_` (p. ej. `BIOINFORMATICA_CONFIG`,
  `BIOINFORMATICA_DISABLE_PROJECT_CONFIG`, `BIOINFORMATICA_SERVER_PASSWORD`)

Estado por proyecto, todo en texto plano y legible sin este programa:

```
corpus/                             los datos descargados y sus manifiestos (carpeta visible: es contenido del científico)
.bioinformatica/
  objective.json                    el objetivo permanente de la campaña
  protocol/protocol.json            el compromiso, escrito una vez
  protocol/amendments.jsonl         cada cambio firmado del compromiso
  protocol/refusals.jsonl           cada intento rechazado
  approvals.jsonl                   cada aprobación o denegación humana
  runs/                             un registro por ejecución
  manifests/                        los manifiestos de reproducibilidad
  handcount.json                    el conteo de intervenciones, turno a turno
```

En la TUI se cambia de agente con `Tab`: **build** (acceso completo, el de trabajo) y
**plan** (sólo lectura, para análisis y exploración). El subagente **general** se invoca
con `@general` en un mensaje.

## Estado del proyecto

Esto es **software de investigación en desarrollo**, versión 0.1.0, sin releases
publicadas y sin API estable. Se construye por hitos y las capacidades se añaden de una en
una. Merece la pena leer lo siguiente antes de apoyar nada importante en él.

### Lo que los artefactos no demuestran

El propio código declara sus límites, y el dossier los lleva dentro de `index.json` en
lugar de en un README que nadie lee. Los que importan a quien vaya a usar esto:

- **Un dossier muestra que el trabajo registrado no se reportó mal. No muestra que el
  resultado sea correcto.** Los instrumentos de la corrección —modelos nulos, controles con
  respuesta conocida, calibración de detectores— no están construidos y no están aquí. Es
  lo más caro que este proyecto puede decir sobre sí mismo, y va primero a propósito.
- **Los registros de ejecución son el relato del modelo, no del sustrato.** Todos sus
  campos, incluido `status`, son parámetros libres de una herramienta; por eso cada
  registro lleva `reportedBy`. Sólo los manifiestos del corpus son independientes del
  agente.
- **Los ledgers son *append-only* por convención de escritura, no por cadena de hashes.**
  Una línea borrada de un registro de rechazos o de aprobaciones no es detectable desde el
  dossier.
- **La verificación en frío cubre los snapshots del corpus, no las ejecuciones.** El
  manifiesto de ejecución no encaja en el patrón que busca el verificador y no lleva digest
  por artefacto: lo que hoy es verificable es una descarga de datos, no una corrida.
- **El clasificador del conteo de manos sólo reconoce pistas en inglés.** Una campaña
  conducida en castellano cae entera en `otros` y el párrafo de Métodos sub-reporta las
  intervenciones. Es la limitación más incómoda dado que el producto es hispanohablante, y
  está declarada porque ocultarla convertiría un artefacto en un adorno.
- **La proveniencia viaja en un formato de listado propio**, que ninguna herramienta de
  terceros lee. El objetivo es sustituirlo por un Workflow Run RO-Crate conforme —un perfil
  comunitario publicado, con validadores que un revisor ya tiene— en lugar de defender un
  formato inventado aquí.

### Lo que no es

No hay detectores de repeticiones integrados. No hay alineadores estructurales. No hay
descarga de estructuras. Los clientes de bases de datos consultan metadatos y devuelven
citas; no son un motor de análisis. Bioinformática.org **orquesta** herramientas validadas
del ecosistema —los CLIs oficiales `nextflow` y `nf-core`, y en general lo que el campo ya
usa y cita— y hace la contabilidad alrededor; no reimplementa sus algoritmos.

### Sobre seguridad

El agente **no está en un sandbox**. El sistema de permisos existe para que sepas qué está
pasando —enseña cada comando y pide confirmación—, no para aislarte de él. Si necesitas
aislamiento real, ejecuta esto dentro de un contenedor o una VM. Ver [SECURITY.md](./SECURITY.md).

### Diferencias con el proyecto del que deriva

- El compartir sesiones, la auto-actualización y el login a la consola alojada están
  desactivados: dependían de servicios que esta build no incluye.
- El catálogo de modelos se obtiene de models.dev; las credenciales se configuran en local.

## Estructura del repositorio

El núcleo de dominio —lo que este fork añade— vive todo en `packages/bioinformatica/src/`:

| Ruta | Qué hay |
| --- | --- |
| `src/nfcore/` | registro de pipelines, samplesheets, construcción del comando, recursos, diagnóstico de fallos, manifiesto, censo de muestras, verificación en frío, protocolo, conteo de manos, dossier |
| `src/nfcore/skill/` | los procedimientos que el agente carga según la tarea (ejecución, samplesheets, fallos, campañas de descubrimiento, crítica de resultados, evidencia estructural…) |
| `src/bio/` | clientes de RepeatsDB, SIFTS, PDB, UniProt, Ensembl, KEGG y Entrez, más los snapshots de corpus |
| `src/tool/` | las herramientas que el modelo puede invocar |
| `src/cli/cmd/` | los comandos de la línea de órdenes |

El resto del monorepo es el núcleo de agente heredado del fork: `packages/core` (servicios,
proveedores, sesiones), `packages/tui` (interfaz de terminal), `packages/server` (API HTTP),
`packages/plugin`, `packages/sdk` y `packages/schema`.

## Contribuir

Ver [CONTRIBUTING.md](./CONTRIBUTING.md). Los informes de seguridad, en
[SECURITY.md](./SECURITY.md) — y no se aceptan informes de seguridad generados por IA.

## Cómo citar

Ver [CITATION.cff](./CITATION.cff).

## Licencia

MIT — ver [LICENSE](./LICENSE).

Bioinformática.org es un fork de [opencode](https://github.com/anomalyco/opencode) (MIT),
del que conserva el núcleo de agente CLI/TUI. El aviso de copyright original se mantiene
íntegro en `LICENSE`.
