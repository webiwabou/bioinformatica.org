# Cómo contribuir a Bioinformática.org

Gracias por el interés. Este documento explica cómo levantar el entorno, cómo verificar un cambio
antes de proponerlo y qué esperamos de un pull request.

Bioinformática.org es un fork de [opencode](https://github.com/anomalyco/opencode) (MIT). Buena
parte del árbol viene de ahí. Lo propio de este proyecto vive sobre todo en
`packages/bioinformatica/src/nfcore/` (nf-core/Nextflow, manifiestos, protocolo, dosier) y en
`packages/bioinformatica/src/bio/` (clientes de bases de datos biológicas).

## Requisitos

- [Bun](https://bun.sh). La versión que fija el repositorio está en el campo `packageManager` de
  `package.json` (hoy `1.3.14`). El hook `pre-push` rechaza el push si tu Bun no satisface
  `^1.3.14`.
- Node 22 o superior en el `PATH`. Algunos scripts de instalación nativa lo necesitan.
- Git.

No hace falta ninguna clave de API para desarrollar ni para ejecutar los tests.

## Levantar el entorno

```bash
bun install
```

`bunfig.toml` fija `minimumReleaseAge` a tres días: una dependencia publicada hace menos de 72 horas
no se instala. Es deliberado, no un fallo.

Para ejecutar el agente desde el código fuente, sin construir el binario:

```bash
bun dev -- --help                # la lista completa de comandos
bun dev                          # TUI sobre packages/bioinformatica
bun dev -- /ruta/a/tu/proyecto   # TUI sobre otro directorio
bun dev -- serve                 # servidor HTTP sin interfaz
bun dev -- verify                # re-comprobar manifiestos, sin modelo y sin red
```

`bun dev` es el equivalente local del binario `bioinformatica` instalado: los mismos comandos y los
mismos flags. El `--` hace falta para que los argumentos lleguen al programa y no a `bun run`.

## Ejecutar los tests

**Los tests no se ejecutan desde la raíz del repositorio.** Están bloqueados ahí a propósito, por
dos vías, y las dos te van a responder con un error:

```bash
bun test      # Failed to scan non-existent root directory for tests: ".../do-not-run-tests-from-root"
bun run test  # do not run tests from root
```

El grueso de la suite (unos 273 ficheros `*.test.ts`) vive en `packages/bioinformatica` y se ejecuta
desde ese directorio:

```bash
cd packages/bioinformatica

bun run test                     # la suite completa del paquete
bun test test/nfcore             # solo un directorio
bun test test/util/glob.test.ts  # solo un fichero
```

`bun run test` añade `--timeout 30000 --only-failures`: eleva el límite por test a 30 s y silencia la
salida de los que pasan. Si invocas `bun test` directamente sobre un subconjunto y algo se te queda
corto de tiempo, pasa `--timeout 30000` a mano.

Para reproducir lo que ejecuta CI, desde la raíz:

```bash
bun turbo test
```

Eso cubre `bioinformatica`, `@bioinformatica/core` y `@bioinformatica/ui`, que son las tres tareas de
test declaradas en `turbo.json`.

Hay paquetes con tests que **no** están declarados en `turbo.json`, así que ni CI ni `bun turbo test`
los alcanzan. Si tocas uno de ellos, ejecútalos a mano desde su directorio:

```bash
cd packages/tui && bun test
# lo mismo para: llm, codemode, http-recorder, effect-drizzle-sqlite
```

### Los tests son herméticos

`packages/bioinformatica/test/preload.ts` aísla la suite antes de importar nada de `src/`: redirige
los directorios XDG a un temporal por PID, usa SQLite en memoria, sirve el catálogo de modelos desde
un fixture y borra del entorno las claves de proveedor (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GOOGLE_API_KEY`, …). Un test que necesite red o una credencial real está mal escrito: escríbelo
contra un fixture o graba el tráfico con `@bioinformatica/http-recorder`.

## Comprobaciones antes de proponer un cambio

```bash
bun typecheck        # tsgo --noEmit en todos los paquetes, vía turbo
bun lint             # oxlint
./script/format.ts   # prettier sobre todo el repositorio
```

`bun typecheck` se ejecuta además solo, en cada `git push`, desde el hook `pre-push` de husky, junto
con la comprobación de la versión de Bun. Un push con errores de tipos no sale de tu máquina.

Sobre el linter, para que no te asustes la primera vez: el árbol heredado del fork arrastra hoy unos
tres mil avisos y cero errores, y no hay una tarea de lint en CI. Lo que se te pide no es dejar el
contador a cero, sino no añadir avisos nuevos en los ficheros que toques. Las dos comprobaciones que
sí bloquean en CI son los tests y el _typecheck_.

Convenciones de formato, ya configuradas: sin punto y coma y ancho de línea 120 (en `package.json`);
UTF-8, indentación de dos espacios, saltos `LF` y salto de línea final (en `.editorconfig`).

## Si tocas la API HTTP o el SDK

`packages/sdk/openapi.json` y el cliente de `packages/sdk/js` son código generado. Después de cambiar
el servidor (`packages/bioinformatica/src/server/` o `packages/server/`), regenéralos e incluye el
resultado en el mismo PR:

```bash
./script/generate.ts
```

## Construir el binario

```bash
cd packages/bioinformatica
bun run build --single
```

Deja un ejecutable en `packages/bioinformatica/dist/bioinformatica-<plataforma>/bin/bioinformatica`,
donde `<plataforma>` es `linux-x64`, `darwin-arm64` y demás. Sin `--single` construye para todas las
plataformas objetivo, que es lo que hace el proceso de release y casi nunca lo que quieres en local.

## Estructura del repositorio

| Paquete                       | Qué contiene                                                           |
| ----------------------------- | ---------------------------------------------------------------------- |
| `packages/bioinformatica`     | CLI, agente, comandos nf-core y artefactos de proveniencia             |
| `packages/core`               | Servicios base: herramientas, proveedores, sesiones, almacenamiento    |
| `packages/tui`                | Interfaz de terminal (opentui + SolidJS)                               |
| `packages/server`             | Servidor HTTP                                                          |
| `packages/protocol`           | Definición de la API que sirve el servidor                             |
| `packages/llm`                | Capa de proveedores de modelos                                         |
| `packages/codemode`           | Ejecución confinada de código sobre herramientas descritas por esquema |
| `packages/plugin`             | API pública de plugins (`@bioinformatica/plugin`)                      |
| `packages/sdk`                | Esquema OpenAPI y cliente TypeScript generados                         |
| `packages/schema`             | Esquemas compartidos                                                   |
| `packages/script`             | Utilidades de build y publicación, incluida la identidad del proyecto  |
| `packages/http-recorder`      | Grabación y reproducción de tráfico HTTP para tests deterministas      |
| `packages/ui`, `packages/cli` | Piezas de interfaz y de CLI heredadas del fork                         |

`packages/script/src/identity.ts` es la fuente única de verdad del nombre, el repositorio, el dominio
y los destinos de publicación. Si necesitas alguno de esos valores, impórtalos de ahí en vez de
escribirlos a mano.

## Depurar

Lo más fiable es lanzar el proceso a mano con el inspector de Bun, sobre el punto de entrada real y
no sobre el script `dev`, y conectar el depurador a esa URL.

La interfaz arranca el servidor en un _worker_, y los breakpoints del código de servidor pueden no
dispararse ahí. Cuando lo que quieres depurar es el servidor, levanta las dos mitades por separado:

```bash
# 1. el servidor, con inspector
bun run --inspect=ws://localhost:6499/ --cwd packages/bioinformatica ./src/index.ts serve --port 4096

# 2. la interfaz, conectada a ese servidor
bun run --cwd packages/bioinformatica --conditions=browser ./src/index.ts attach http://localhost:4096
```

Para depurar la interfaz, el inspector va en el segundo comando en vez de en el primero.

Dos cosas que ahorran tiempo: según tu flujo, `--inspect-wait` o `--inspect-brk` pueden irte mejor
que `--inspect`; y si te cansa repetir el flag, exporta
`BUN_OPTIONS=--inspect=ws://localhost:6499/`.

## Cómo proponer un cambio

1. **Abre primero un issue.** Los issues en blanco están deshabilitados: usa una de las plantillas.
   Un PR sin issue asociado es más difícil de triar y puede cerrarse sin revisión.
2. **Un PR, un cambio.** Pequeño y enfocado. Si no puedes describirlo en un par de frases, casi
   siempre son dos PRs.
3. **Enlaza el issue** con `Closes #123` en la descripción, como pide la plantilla de PR.
4. **Explica cómo lo verificaste**: qué probaste y cómo puede una persona revisora reproducirlo. Para
   cambios de interfaz, adjunta una captura o una grabación del antes y el después.
5. **Escribe la descripción tú.** Los muros de texto generados por un modelo y sin revisar no se
   leen. Es más útil un párrafo corto en tus propias palabras.

Antes de añadir funcionalidad nueva, comprueba que no exista ya en otra parte del árbol: es un fork
grande y hay más de lo que parece.

### Estilo de commits

Los títulos de commit y de PR siguen [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` funcionalidad nueva
- `fix:` corrección de un fallo
- `docs:` documentación
- `refactor:` reorganización sin cambio de comportamiento
- `test:` tests
- `chore:` mantenimiento, dependencias, tareas de infraestructura

El ámbito, entre paréntesis, es opcional y normalmente es el nombre del paquete o del área tocada:

```text
fix(nfcore): no perder muestras sin fichero en el censo
feat(tui): atajo para cambiar de agente
docs: traducir la guía de contribución al español
chore(core): subir drizzle-orm
```

### Estilo de código

Estas convenciones no las impone el linter: son las del código que ya está escrito, y seguirlas
hace que tu cambio se lea como parte del mismo árbol.

- **Funciones:** mantén la lógica en una sola función salvo que separarla dé reutilización real.
- **Desestructuración:** no desestructures por costumbre.
- **Flujo de control:** evita `else`.
- **Errores:** prefiere `.catch(...)` a `try`/`catch` cuando encaje.
- **Tipos:** tipos precisos; nada de `any`.
- **Variables:** patrones inmutables; evita `let`.
- **Nombres:** identificadores cortos mientras sigan siendo descriptivos.
- **APIs de runtime:** usa las de Bun (`Bun.file()`, `Bun.$`) cuando sirvan.

Los comentarios del código están en inglés y se quedan en inglés, aunque la documentación de cara al
usuario esté en español. Los comentarios explican **por qué**, no qué hace la línea de abajo.

## Qué necesita conversación previa

Los arreglos de fallos, la compatibilidad con entornos concretos, las mejoras de documentación y los
tests adicionales pueden ir directos a PR (con su issue).

Para funcionalidad nueva —sobre todo si toca el modelo de permisos, el formato de los artefactos de
proveniencia (manifiesto, protocolo, conteo de intervenciones, dosier) o la interfaz— abre antes un
issue describiendo el problema y espera respuesta. Esos formatos son citables por terceros: cambiar
uno rompe verificaciones hechas fuera de este repositorio, y esa conversación es más barata antes de
escribir el código que después.

## Conducta y seguridad

Participar en este repositorio implica atenerse al [Código de Conducta](./CODE_OF_CONDUCT.md).

Si lo que has encontrado es un problema de seguridad, **no abras un issue público**: sigue lo que
indica [SECURITY.md](./SECURITY.md).

## Licencia

Al contribuir, aceptas que tu aportación se publique bajo la licencia MIT del proyecto (ver
[LICENSE](./LICENSE)), que conserva el aviso de copyright original de opencode.
