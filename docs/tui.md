<!-- Propuesta de diseño de la interfaz de terminal.

Se escribió después de leer la TUI entera contra el código: qué dibuja cada
superficie, qué heredó del fork de opencode, dónde el diseño pelea contra el
producto y qué permite de verdad el motor de render. La lectura encontró el
hecho que ordena todo lo demás: `grep -rn "nf-core\|nextflow\|samplesheet\|
dossier\|provenance" packages/tui/src` devuelve cero, mientras 53 ficheros
tratan diffs de código. Las 24 herramientas del dominio se pintan como una
línea gris con un engranaje.

Es un documento de diseño, no una especificación cerrada: la fuente de verdad
sigue siendo el código. Los hitos de la sección 6 se implementan en ese orden y
cada uno lleva su propio commit. -->

# El Registro

> **Decisiones tomadas sobre esta propuesta (1 sep 2026).**
>
> **La interfaz se queda en inglés.** El vocabulario en pantalla de este documento
> está escrito en español; léase como la lista de conceptos, no como las cadenas.
> En pantalla son: *entry*, *record*, *draft*, *proves / does not prove / check it*,
> *counted from*, *sign*, *dossier*, *plate*. Los identificadores y comentarios del
> código nuevo van en inglés, como el resto de `packages/tui`. Con eso decae la
> tabla bilingüe del hito 1 y su test de paridad, y decae también el primer punto
> de la sección 7. La página, los instaladores y el README siguen en español.
>
> **La marca no se toca.** `MARK_INNER` se queda en `◦`. El cambio a `○` que pedía
> la sección 7 era por anchura, no por estética, y hay una forma mejor de resolverlo
> que no toca la marca: dibujarla sobre celdas de ancho fijo, de modo que la
> anchura del glifo deje de importar. Eso entra en el hito 2 con el resto de la
> rejilla.

Propuesta de diseño para la TUI de Bioinformática.org. Base: la dirección *Asiento*, con injertos de *Bancada*, *Escalera* y *El Anillo* donde los jueces los señalaron, y con las fallas fatales de las cuatro respondidas explícitamente.

---

## 1. La tesis

La transcripción no es una conversación: es un **registro** que se está escribiendo delante de su dueño. Cada turno es un **asiento** numerado y fechado contra un renglón que corre a la izquierda; nada se borra nunca; y una acción con consecuencias no es una alerta sino un **borrador** que sólo entra en el registro cuando el científico lo firma. De ahí se deduce todo lo demás: no hay burbujas ni etiquetas de hablante (el margen dice quién y cuándo), no hay recuadros ni raíles de colores (el renglón es uno solo y nunca cambia de color), un rehúso se tacha en su sitio en vez de desaparecer, el permiso permanente deja de ser un botón y pasa a ser una enmienda firmada al protocolo, y todo lo que el producto mide dice de qué fichero en disco salió. Un registro cuya lectura no se puede alterar desde la interfaz es exactamente la promesa del producto (cuatro artefactos que un tercero comprueba sin agente, sin modelo y sin red) aplicada a la pantalla en la que ocurre.

---

## 2. El sello

Cuatro cosas que ningún otro agente de línea de comandos tiene, y que se reconocen en una captura recortada.

**1. El margen de cinco columnas.** A la izquierda de todo hay una columna de cinco caracteres alineados a la derecha con el número de asiento y, debajo, un reloj: la hora de apertura, o el tiempo transcurrido en vivo (`+3h14`) mientras el asiento sigue abierto. Ningún agente numera ni fecha sus turnos. Es la única parte del diseño presente en absolutamente todas las filas de todas las pantallas, así que el sello no depende de que haya un run en marcha ni de que haya herramientas de dominio en el turno (que es exactamente por lo que *Bancada* y *El Anillo* perdieron identidad en la pantalla más frecuente).

**2. La tríada `prueba / no prueba / compruébalo`.** Tres rúbricas de igual ancho, igual color e igual peso, en filas contiguas, cada vez que el producto afirma algo. La afirmación negativa no es un pie de página ni una banda atenuada: es la gemela estructural de la positiva. Esto corrige la falla que los jueces encontraron en *Asiento* (poner `NO PRUEBA` en `{lápiz}`, el mismo token que un hash y un reloj) y adopta la regla de *Escalera*: **un límite nunca se atenúa**.

**3. La firma es `f`, y Enter no hace nada.** El borrador se escribe *dentro* del registro, en su propio número, con dos filetes rotulados: el de arriba dice `nada se ha ejecutado todavía`, el de abajo dice `firmar no prueba que el resultado sea correcto`. Nada está preseleccionado, el ratón no arma nada, y `Allow always` no existe: el consentimiento permanente es una enmienda con nombre escrita en `amendments.jsonl` y marcada con `§` en el margen de cada asiento que cubre.

**4. `contado desde`.** Cualquier lectura que salga de un fichero en disco lleva debajo, siempre, en `{lápiz}`, la ruta del fichero del que salió. Es la línea más barata y más valiosa de las cuatro propuestas: a la hora tres, con nadie mirando, separa una medición de bytes de una afirmación del modelo.

Y como firma menor pero inconfundible: **la huella**, seis celdas de bloque (`▄▇▁▅▂█`) junto a cada SHA-256, seis porque la marca tiene seis puntos, con su propio límite impreso en la misma pantalla (dieciocho bits detectan un accidente, no un ataque).

---

## 3. El sistema

### 3.1 Estructura

**La página.** Una sola rejilla, sin excepciones dentro del registro:

```
PAGE = { margen: 5, renglon: 1, hueco: 1, cuerpo: 7, medida: 71 }
```

Columnas 0 a 4: el margen, contenido alineado a la derecha con `String.padStart`. Columna 5: el renglón. Columna 6: hueco. Columna 7: empieza el cuerpo, que envuelve a 71 columnas y deja 2 columnas de margen derecho. Dentro del cuerpo:

- **rúbrica**: glifo en la 7, clave en 9 a 21 (13 columnas, alineada a la izquierda), valor en la 23.
- **subfila**: sin glifo, clave en 9 a 21, valor en la 23.
- **desglose** (la descomposición de un borrador): etiqueta alineada a la **derecha** en 9 a 21, valor en la 23. Una etiqueta a la derecha contra una columna de valores es lo que parece una sección de métodos, y es lo contrario de una cadena de shell envuelta.
- **al margen**: la procedencia (hashes, bytes, sellos de versión del origen) va alineada a la derecha en las últimas 14 columnas del cuerpo, con `justifyContent="space-between"`.

Esto sustituye a las tres familias de `paddingLeft={3}` que hoy dejan la prosa en x=5, las etiquetas de herramienta en x=7, el pie del turno en x=8 y una fila pendiente en x=10 que salta a x=7 al resolverse. Con el margen de ancho fijo desde que la fila monta, **el salto de tres columnas desaparece**.

**El renglón, y por qué no es el `┃`.** Un juez señaló, con razón, que un borde vertical continuo con el margen en blanco tiene la misma silueta que el raíl `┃` que estamos borrando. La corrección es de dos partes y es estructural, no cosmética:

1. El renglón es `│` (U+2502, ligero), nunca `┃` (U+2503, pesado), y **nunca se colorea**: siempre `{renglón}`.
2. **El renglón pertenece al asiento, no a la página.** Corre la altura del asiento y se corta en la fila en blanco que separa un asiento del siguiente. La silueta al hacer scroll es una columna de trazos interrumpidos con números a su izquierda, que es un libro rayado, no un raíl.

Implementación: `<box flexDirection="row">` con un hijo `<box width={PAGE.margen} flexShrink={0}>` y un hijo `<box flexGrow={1} border={["left"]} paddingLeft={1} customBorderChars={{...EmptyBorder, vertical: G.renglon}} borderColor={theme.renglon}>`. La fila separadora entre asientos es un `<box height={1}/>` **sin** borde, no un `gap={1}` en el padre.

**Fuera del registro no hay renglón.** La portada (marca, promesa, «lo que ya es comprobable aquí») y el expediente son página sin renglón, contenido en la columna 2. Así el renglón significa exactamente una cosa: esto está en el registro.

**Filetes.** Se dibujan con la característica del motor que este fork nunca ha tocado: `border={["top"]}` con `customBorderChars.horizontal = "─"` más `title` / `titleAlignment="left"` / `titleColor`, que `buffer.drawBox` pinta *dentro* de la corrida del borde. Ya hay precedente en el árbol (la regla de `Compaction` en `routes/session/index.tsx:1394`), así que no es un salto de fe. Un filete de página abarca las 80 columnas; un filete dentro de un cuerpo abarca la medida (71), de la 7 a la 77.

**Lo que se borra de la estructura.** `SplitBorder` y su `┃` en los diez puntos de uso. Todo relleno `backgroundPanel` detrás de un mensaje o de un bloque de herramienta: el registro es papel continuo, no una pila de tarjetas. El `╹` y el zócalo `▀` del prompt (una sombra dibujada, puro skeuomorfismo). La barra lateral de 42 columnas y sus cinco secciones. El prompt deja de tener marco: **es el siguiente asiento**, y su número ya está en el margen.

**Nada de `screenMode: "split-footer"`.** Lo verifiqué en `@opentui/core@0.4.3`, `lib/render-geometry.ts`: con ese modo `renderHeight = effectiveFooterHeight` y `renderOffset = terminalHeight - effectiveFooterHeight`. No es una franja fijada bajo una app completa: **confina toda la aplicación a `footerHeight` filas** y obliga a que la transcripción viva en el scrollback real del terminal vía `writeToScrollback`. El pie de página se construye como un `<box flexShrink={0}>` ordinario en la columna raíz. `split-footer` queda como una posible mejora posterior, atada a `writeToScrollback`, y nunca como requisito de un hito.

### 3.2 Glifos

Ocho glifos más una rampa. El inventario entero, contra los veintitrés actuales con cinco colisiones.

| glifo | punto | significado |
|---|---|---|
| `●` | U+25CF | **asentado**: ocurrió, está, tiene recibo detrás |
| `○` | U+25CB | **pendiente**: propuesto, declarado, debido, aún no |
| `×` | U+00D7 | **falla con nombre**: salida distinta de cero, hash que no cuadra, comprobación fallida |
| `│` | U+2502 | el renglón |
| `─` | U+2500 | filete |
| `§` | U+00A7 | enmienda firmada al protocolo |
| `·` | U+00B7 | el único separador (no hay `—`, ni `|`, ni `/` como puntuación) |
| `▌` | U+258C | el cursor |
| `▁▂▃▄▅▆▇█` | U+2581 a U+2588 | la huella |

**La seguridad de ancho, verificada, no supuesta.** Los tres jueces se contradijeron sobre las clases East-Asian y dos de las cuatro direcciones afirmaron cosas falsas. Lo comprobé con `unicodedata.east_asian_width`:

```
● 25CF A    ○ 25CB A    × 00D7 A    │ 2502 A    ─ 2500 A
· 00B7 A    § 00A7 A    ▌ 258C A    ▁..█ 2581..2588 A
◦ 25E6 N    ◉ 25C9 N    ◌ 25CC N    ◍ 25CD N    ◐ 25D0 A
```

**Todo el alfabeto es East-Asian Ambiguous, sin una sola excepción.** Bajo `widthMethod: "unicode"` cada glifo ocupa 1 columna; bajo `"wcwidth"` con locale CJK cada glifo ocupa 2. Cambia el paso de la rejilla, nunca la alineación. Ésa es la razón por la que quedan fuera `◦`, `◉`, `◌` y `◍`, que son Narrow o Neutral: una fila que los mezcle con `●` se cizalla, que es precisamente el fallo que *Escalera* y *Bancada* declaraban resuelto y no lo tenían.

Consecuencia obligada: **`MARK_INNER` en `logo.ts` pasa de `◦` (Narrow) a `○` (Ambiguous)**. Es un carácter, y con él la marca y el lenguaje de la interfaz pasan a ser el mismo objeto. También se lee mejor: `◦` en gris apagado dice «menor», `○` dice «todavía no», que es la semántica correcta. **Es un cambio de marca y requiere tu visto bueno**: la página de instalación, el README y `packages/ui` llevan el par antiguo.

**La escalera de degradación**, en `packages/tui/src/ui/glifos.ts`, un módulo nuevo que es el único sitio del código que sabe de anchos. Lee `renderer.capabilities.unicode` y `explicit_width` **una vez al arranque** y congela una de dos tablas:

- **EXPRESIVO** (por defecto): la tabla de arriba, `RING.cell = 2` bajo wcwidth, `1` en otro caso.
- **LLANO** (sin capacidad unicode, o `BIOINFORMATICA_ASCII=1`): `*` asentado, `o` pendiente, `x` falla, `|` renglón, `-` filete, `@` enmienda, `.` separador, `_` cursor, `.:-=+*#@` la huella. Todo Narrow, `RING.cell = 1`.

Dos invariantes que se aplican como reglas de código, no como buenas intenciones:

1. **Ningún literal de glifo se escribe en línea.** Todo viene de `G`. Una regla de lint que prohíbe esos puntos de código fuera de `glifos.ts`, más un test que compara los anchos de las dos tablas.
2. **Un glifo Ambiguous se emite siempre solo dentro de una celda de ancho fijo** `<text width={RING.cell}>`. Así, aunque la detección de capacidad falle (y `capabilities` está tipada `TerminalCapabilities | null` y llega de forma asíncrona), la columna ASCII nunca se desplaza. Hay precedente en el árbol: `INLINE_TOOL_ICON_WIDTH = 2`.
3. La prosa queda exenta: puede llevar `«»`, acentos, lo que sea, porque la prosa envuelve y nada se alinea contra ella. La invariante es sólo para las columnas.

**La marca deja de ser una cadena.** `component/logo.tsx` la dibuja como una rejilla de 5 filas por 7 huecos, cada hueco una celda de `RING.cell`, no como cinco literales con espacios. Así no se cizalla bajo ningún método de ancho, y de paso se puede centrar ópticamente el anillo (13 columnas) con independencia del bloque del nombre (43 columnas), que es el desajuste de ~15 columnas que tiene hoy la portada.

**Lo que sustituye a un glifo es una palabra.** `⟳` pasa a ser `2ª vez`. `△` desaparece. `✓`/`✗` pasan a ser `●`/`×`. `⚙` se va con el renderizador genérico. `↳` se va porque una subfila es simplemente una fila del cuerpo en su columna. `⊙ ▼ ▶ ⬖ ✕ ⇆ ~ ▣ ✱ ◈ % $` se borran. Para un lector que no es programador, una palabra es más honesta que un alfabeto privado.

**Regla prohibitiva, tomada de *El Anillo*: ningún punto sin su lectura.** `● ● ○ ○` en el pie va siempre acompañado de `2 de 4`. La placa va siempre acompañada de `12 hasta TRIMGALORE`. Quien ignore por completo el lenguaje de puntos no pierde ni un dato. Esto es lo que evita que la notación sea un acertijo el primer día.

### 3.3 Color

Seis papeles y tres acentos. Cada uno se puede nombrar en una frase, y no pinta nada más. Modo oscuro primero, claro después; el claro está **compuesto, no derivado**, porque una bióloga bajo fluorescentes de laboratorio es la usuaria más probable del mundo y hoy el modo claro falla contraste justo en el botón que autoriza una orden.

| papel | oscuro | claro | qué significa |
|---|---|---|---|
| `página` | `#0a0f0e` | `#ffffff` | el fondo. Nada más es fondo dentro del registro. |
| `hoja` | `#111917` | `#f6faf9` | una superficie **fuera** del registro: el expediente, los diálogos, el autocompletado. |
| `tinta` | `#e6ebe9` | `#132018` | prosa, valores, números de asiento cerrados. |
| `lápiz` | `#8a938f` | `#5f6f6a` | lo que el registro dice **sobre sí mismo**: rúbricas, marginalia, relojes, unidades, conteos. |
| `renglón` | `#465751` | `#a7bcb5` | el renglón y todos los filetes. Nada más. |
| `asentado` | `#2dd4bf` | `#0f766e` | **una sola cosa**: está en el registro y tiene recibo. |

Acentos, tres, cada uno con una frase:

| acento | oscuro | claro | frase |
|---|---|---|---|
| `vivo` | `#5eead4` | `#0d9488` | esto cambió mientras no mirabas (decae a 4 s) |
| `ausencia` | `#c9a227` | `#8a6a12` | **aquí falta algo, y lo decimos**: un artefacto ausente al cierre, una muestra declarada sin tarea, `§` una enmienda, la banda `SIN FIRMA` |
| `falla` | `#e2574f` | `#b3251c` | una falla con nombre: salida distinta de cero, hash que no cuadra, comprobación fallida |

Contrastes, calculados, no estimados. Oscuro sobre `#0a0f0e`: tinta 16,02:1, lápiz 6,12:1, asentado 10,37:1, vivo 13,05:1, ausencia 7,98:1, falla 5,25:1, renglón 2,52:1. Claro sobre `#ffffff`: tinta 16,83:1, lápiz 5,29:1, asentado `#0f766e` **5,47:1** (frente a los 3,74:1 de `#0d9488`, que queda relegado a rellenos y glifos), ausencia 5,06:1, falla 6,57:1, renglón 2,00:1.

**Dos reparaciones concretas.** `darkStep12` pasa de `#eaeaea` (tono 0°, saturación 0%, el único valor de la rampa oscura sin relación con la paleta, y el que cubre más píxeles) a `#e6ebe9`. Y se declara `selectedListItemText` explícitamente (`#0a0f0e` oscuro, `#ffffff` claro), porque hoy `bioinformatica.json` no lo define, `resolveTheme` cae a `background` y produce blanco sobre `#d97706` a 3,19:1 en la etiqueta del control que autoriza una orden.

**Lo que se borra de `theme/assets/bioinformatica.json`, con el motivo.**

- `darkSecondary #38bdf8` (sky-400). Es hoy el elemento coloreado más grande del producto (el raíl del prompt y el del mensaje del usuario), y sólo es alcanzable porque `colors()` en `context/local.tsx:83-91` está ordenado por índice de agente. El array se reduce a `[theme.primary]` y **la identidad del agente deja de ser un color**.
- `darkAccent #a78bfa` (violet-400). `markdownHeading` pasa a tinta más `BOLD`. El prompt de preguntas pasa a `asentado`.
- `darkGreen #4ade80`. **No hay verde de éxito en este producto.** «Funcionó» lo dicen un `●` y un número. Un tick verde es el cliché visual de todas las herramientas de integración continua jamás publicadas, y además es la tranquilidad exacta que el censo existe para desconfiar: un run puede salir con 0 y MultiQC dibujar un informe perfecto de una cohorte más pequeña.
- `darkCyan #22d3ee`, `darkYellow #e5c07b`. Sin significado asignable.
- `darkOrange #fbbf24` como color de aprobación. La aprobación deja de ser un peligro. El ámbar sobrevive re-derivado como `ausencia`.
- Los doce hexes de tokyonight del bloque de diff (`#c53b53`, `#828bb8` ×2, `#b8db87`, `#e26a75`, `#20303b`, `#37222c`, `#1b2b34`, `#2d1f26`). Se re-derivan: añadido = `asentado` sobre `#12211f`, quitado = `falla` sobre `#241a1c`, contexto = `lápiz`. Esto además saca el lavanda de tono 202 a 331 grados de un fondo de tono 160.
- `#fab283` en `component/error-component.tsx:18-41`, el naranja del donante bajo un comentario que afirma reflejar la marca, en la única pantalla que está garantizado que renderice.
- `syntaxVariable` deja de ser rojo. Los 35 tokens de sintaxis y markdown colapsan a la rampa de tres valores `tinta / lápiz / asentado`: el único código que aquí lee una bióloga es una línea de orden y un fichero de configuración, y el color debe significar «este es el valor que decide el resultado», no «esto es una palabra clave».

**Cómo no romper el arranque.** Es el único cambio de esta propuesta capaz de tumbar la app al iniciar: los 33 temas empaquetados comparten el tipo `Theme` y `resolveTheme` lanza `Color reference not found` por un token que un tema siga referenciando. Los tokens nuevos se añaden **opcionales con derivación documentada**, copiando el patrón que `resolveTheme` ya usa para `backgroundMenu` y `thinkingOpacity`, y antes de borrar un token se hace `grep -rn 'theme\.\(secondary\|accent\|warning\|success\|info\)' packages/tui/src` (son del orden de cuarenta puntos de uso y son justamente el objeto del ejercicio).

**Lo que se decidió y qué perdió.** *Bancada* proponía que **todo numeral medido** brillara en `primary-bright` con las unidades en `lápiz`. Pierde: `#2dd4bf` y `#5eead4` están a 1,36:1 entre sí, así que la distinción no es fiable en un monitor de poco contraste, y la fila `contado desde` ya declara que **todo el bloque** es una medición, lo que hace redundante marcar numeral a numeral. `vivo` se reserva para una sola cosa: lo que cambió mientras no mirabas.

### 3.4 Movimiento

Cuatro cosas se mueven. Nada más. Durante un run de seis horas la pantalla está prácticamente quieta, que es el punto: un laboratorio, no un panel de control.

**1. El anillo.** Las diez tramas braille `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` a 80 ms se borran, y con ellas las 350 líneas de maquinaria Knight Rider de `ui/spinner.ts` (con su estilo `"diamonds"` sin uso y su paleta roja fija). En su lugar, la marca linealizada: seis celdas, un `●` viajando entre cinco `○`, con vuelta (un anillo cicla, no rebota; un rebote se lee como un escáner). `○ ○ ● ○ ○ ○`.

**El ritmo va atado a la edad del trabajo**, que es el injerto de *Bancada*: 1 s por paso durante el primer minuto, 4 s pasados los diez minutos, 12 s pasada la hora. A la hora tres el anillo da una vuelta cada 72 segundos y la máquina, visiblemente, asienta la respiración.

Ahora la corrección técnica que *Bancada* no tenía. En `opentui-spinner@0.0.7`, `dist/src-DjeqLSfu.mjs`, los límites son `const i=1e3/60, a=1e3` y un intervalo fuera de rango **lanza `RangeError`, no se recorta**. 2000 y 4000 ms revientan el componente. Por eso el anillo no usa `<spinner>` en absoluto: lo mueve **un único tic de la aplicación**, en `packages/tui/src/context/pulso.tsx`, un `setInterval` `unref`'d que llama a `requestRender()`. Un solo reloj en todo el producto. Se borran `ui/spinner.ts` y `component/register-spinner.ts`, y `opentui-spinner` sale de `packages/tui/package.json`.

**2. El reloj del margen.** Un asiento abierto cuenta en su segunda fila de margen. Por debajo de una hora tictaquea cada segundo (`+04:11`); por encima, cada minuto (`+3h04`), lo que reduce por sesenta los despertares del renderizador justo en el caso que más dura. No es decoración: hoy `formatDuration` se importa una sola vez en toda la app, para una cuenta atrás de reintento, y **no hay tiempo transcurrido en ninguna parte**; el estado ocupado es idéntico en el minuto uno y en la hora cuatro.

**3. La caída.** Cuando llega una pulsación tras más de 60 s sin entrada, todo campo que haya cambiado en el intervalo se pinta en `vivo` y decae a su color normal en 4 s. No un destello: una caída, para que se lea como calor que se va y no como una alarma. Vuelves del almuerzo y lo que se movió mientras no estabas es lo que está brillante, apagándose. Cuesta una marca de tiempo por campo.

**4. La quietud en la firma.** Mientras hay un borrador sin firmar, el anillo se para en seco en `● ○ ○ ○ ○ ○` y el cursor deja de latir. La quietud significa «te toca a ti». Es el único estado que la interfaz actual no puede expresar en absoluto, porque el mismo escáner barre tanto si el agente trabaja como si está bloqueado esperándote.

Se borran además: el desvanecido de 160 ms de `createFadeIn` en la fila meta del prompt y el `tint(border, highlight(), agentMetaAlpha())` del raíl (un registro no se desvanece al entrar), el parpadeo de 5 s encendido y 10 s apagado de «Get started /connect», y el salto de tres columnas de cada llamada al resolverse (que hoy es el movimiento dominante en pantalla a lo largo de una campaña, y que muere con el margen de ancho fijo). `TextAttributes.BLINK` no se usa jamás.

**INVERSE para «ahora mismo».** Una etapa en curso o un asiento abierto se marca con su `●` en vídeo inverso, no con un tercer glifo ni con un color más. Es el injerto de *El Anillo*: sobrevive a una captura de pantalla, a un terminal de 16 colores y a un lector daltónico, y no hace crecer el alfabeto. Riesgo declarado: el inverso varía entre terminales y puede leerse como un artefacto de selección; si falla en la práctica, la alternativa es `vivo` frente a `asentado`, que es una distinción real aunque más débil, y en ambos casos la palabra al lado (`en curso`, `asiento abierto`) lleva el dato.

### 3.5 Ritmo

**Horizontal.** margen 5 · renglón 1 · hueco 1, cuerpo en la columna 7, en todo ancho y en toda superficie. Medida 71. Rúbrica: glifo en 7, clave en 9 a 21, valor en 23. Desglose: etiqueta a la derecha en 9 a 21, valor en 23. Marginalia a la derecha en las últimas 14 columnas. **Un solo nivel de anidamiento**: el contenido dentro de un asiento sangra dos columnas desde el cuerpo, una vez y nunca dos; lo que pida un tercer nivel se convierte en su propio asiento.

**Vertical.** Exactamente una fila en blanco entre asientos, nunca dos, nunca cero, y el renglón se corta en ella. Dentro de un asiento, exactamente una fila en blanco antes de la tríada `prueba / no prueba / compruébalo`. Esto sustituye a `setPreLayoutSiblingMargin`, que hoy calcula el ritmo a partir de si el hermano anterior medía más de una línea, de manera que el ritmo vertical del producto es una propiedad emergente de la salida de las herramientas en lugar de una decisión.

**El margen.** Fila 1 del asiento: el número. Fila 2: el reloj. Resto: vacío. `"  014"` un asiento cerrado, `"(018)"` un borrador (los paréntesis caben exactos en cinco columnas y significan «escrito pero todavía no forma parte del registro»), `"16:41"` la hora de apertura, `"+3h04"` el transcurrido en vivo, `"    §"` un asiento cubierto por una enmienda firmada.

**Lo que cuesta la rejilla, dicho honestamente.** Siete columnas de cada línea. A 80 columnas el cuerpo es 71. Una orden `nextflow run` no cabe en 71 y no debe envolverse hasta hacer sopa, que es exactamente por lo que el borrador la **descompone** en filas rotuladas en vez de imprimirla. La rejilla fuerza el diseño correcto. Por debajo de 60 columnas el margen colapsa a 3 y se pierde la fila del reloj, lo que se declara como pérdida en el punto 7.

### 3.6 Las palabras

**Cromo en español, sustantivos de dominio en inglés, y las palabras del propio registro reproducidas literalmente.** Ésta es la regla, y tiene un motivo que no es de gusto: la interfaz nunca parafrasea un registro. `dossier.ts` nombra los cuatro artefactos como `"manifest" | "protocol" | "handcount" | "methods"`, `bioinformatica verify` los imprime así, y un revisor abre esos ficheros. Traducirlos a `manifiesto / protocolo / recuento / métodos` haría que la pantalla y el fichero discreparan, que es la incoherencia que este producto menos se puede permitir. Igual con `samplesheet`, `nf-core`, `FASTQ`, `pipeline`, `profile`, `outdir`, `resume`, `work/`, `census`, y con las citas verbatim de `refusals.jsonl` y de los `Limit.statement` de `dossier.ts`.

**El vocabulario, y por qué cada palabra le ganó a la obvia.**

- **asiento**. Un apunte de libro. Elegida sobre `entrada` porque el verbo es `asentar`. Así la acción de firmar, la línea de cierre y el sustantivo son la misma palabra, y «firmar y asentar» dice el mecanismo entero en tres sílabas.
- **el registro**. La transcripción. Nunca `sesión`, nunca `chat`, nunca `conversación`.
- **borrador**. Un asiento escrito y todavía fuera del registro.
- **firmar · firma · sin firmar**. Nunca `permitir`, nunca `aprobar`. A un cuaderno no se le da permiso; se le firma. `sin firmar` sustituye a `Permission required`.
- **sin firma**. La banda persistente cuando la auto-aprobación está encendida, hoy cuatro caracteres grises que dicen `auto`.
- **rehusar · rehusado · rehúso**. Coincide exactamente con `refusals.jsonl` en `protocol.ts`.
- **motivo**. `m rehusar con motivo`, disponible en toda petición y no sólo en sesiones de subagente como hoy.
- **enmienda · enmendar · § · firmada por**. Sustituye a `Allow always`. El consentimiento permanente no es un botón al lado de `once`: es una enmienda al protocolo, exige un nombre escrito, va a `amendments.jsonl` (`protocol.ts` ya rechaza una enmienda sin firma) y marca con `§` el margen de cada asiento que cubre durante la vida del proyecto.
- **vinculante · consultivo**. Los dos valores de `Protocol.Posture`. Sustituyen a `Build` y `Plan` como el único modo visible del producto. Un cuaderno no tiene personajes; tiene postura.
- **prueba · no prueba · compruébalo**. La tríada, siempre en ese orden, siempre del mismo ancho.
- **ausente · haría falta · produce**. `ausente no es cero`. Y debajo, la orden literal que lo produciría (injerto de *El Anillo*): decirle a alguien cómo cerrar el hueco es más útil que nombrarlo.
- **contado desde**. La fila de procedencia.
- **la placa**. La cohorte dibujada como una placa de laboratorio.
- **la huella**. Las seis celdas junto al digest.
- **el expediente**. Los cuatro artefactos como una cosa que se le entrega a alguien.
- **verificado en frío · sin modelo, sin red**.
- **visto**. `v dar por visto`, que sustituye a `mark reviewed` y su `✓`.

**El riesgo del español, y la mitigación real.** *El Anillo* proponía glosar cada sustantivo español en inglés en la misma fila. Pierde: la rejilla cuesta siete columnas y no le sobran 20 más para una columna paralela en cada línea, y una glosa permanente convierte el idioma en señalización en vez de en voz. La mitigación es un **fichero de cadenas bilingüe desde el hito 1**, `packages/tui/src/ui/texto.ts`, con las tablas `es` y `en` y **un test que falla si una clave existe en una tabla y no en la otra**. Ninguna cadena se escribe en línea. El idioma se elige con una clave `locale` en `tui.json`. Esto es comprobable; una promesa de fichero de idiomas «más adelante» no lo es.

**Copia que se borra, por nombre.** `"Fix a TODO in the codebase"` / `"What is the tech stack of this project?"` / `"Fix broken tests"` y el juego de shell `ls -la` / `git status` / `pwd`: la primera frase que dice el producto, idéntica byte a byte a la del donante. `"Run /connect to add an AI provider and start coding"`, dos filas debajo de «bioinformatics co-scientist». Las ~99 propinas sobre LSP, formateadores, pull requests de GitHub, ficheros `.ts` de herramientas y `AGENTS.md`. `"Shell command"` como título de toda orden. `"Session done"` como notificación tras seis horas, que pasa a `rnaseq · asiento 018 cerrado · 12 de 16 atribuidas`. `"esc dismiss"` sobre un control atado a `reject()`. `"gemini is way too hot right now"`. `OC | ` en el título del terminal. `"Loading plugins…"` como primera frase del producto.

---

## 4. Las pantallas

Cinco maquetas a 80 columnas exactas, con la misma rejilla, los mismos glifos y el mismo vocabulario. Verifiqué la longitud de cada línea.

### 4.1 La portada

```
        ●
  ●    ○ ○    ●   Bioinformática.org
      ○   ○       co-científico de bioinformática
  ●    ○ ○    ●
        ●

  Ninguna orden se ejecuta sin tu firma. Cada campaña deja cuatro artefactos
  que un tercero comprueba sin el agente, sin modelo y sin red.

── lo que ya es comprobable aquí ─────────────────────── ~/lab/rnaseq-hipoxia ──

  ● manifest      3 corpus · 1 402 filas · 214 MB · rehash 3 de 3
    huella        ▄▇▁▅▂█ 3f9a…c1 · 31 ago 17:04 · sin modelo, sin red
  ○ census        no tomado: no hay execution_trace.txt en results/
    haría falta   un run terminado, o -with-trace en el próximo
  ○ protocol      sin objetivo declarado: no se rehúsa nada aún

── el registro ─────────────────────────────────────────────────────────────────

  013│ ● ejecución     nf-core/rnaseq 3.14.0 · docker · +3h14 · 41/96
+3h14│                 asiento abierto

  014│ ▌describe la pregunta en tus palabras

────────────────────────────────────────────────────────────────────────────────
  rnaseq-hipoxia · 013 abierta +3h14 · docker    ● ○ ○ ○  1 de 4   ^p órdenes
```

**Color.** Marca: `●` en `{asentado}`, `○` en `{lápiz}`, el nombre en `{tinta}` `BOLD`, la coletilla en `{lápiz}` **sin negrita** (hoy ambas son negrita y la coletilla compite con el nombre). La promesa en `{lápiz}` con `sin tu firma` y `cuatro artefactos` en `{tinta}`. Filetes en `{renglón}` con los rótulos en `{tinta}`. `●` en `{asentado}`, `○` en `{ausencia}` cuando falta algo que ya debería estar y en `{lápiz}` cuando simplemente no toca todavía: aquí `census` y `protocol` van en `{lápiz}` porque aún no hay run. Números de asiento en `{tinta}`; el `014`, el que estás a punto de escribir, en `{lápiz}` hasta que teclees un carácter. Celdas de la huella en `{asentado}`, hex en `{lápiz}`.

**Lo que el dibujo no puede mostrar.** El bloque «lo que ya es comprobable aquí» **se lee del sistema de ficheros antes de que el usuario escriba nada** (injerto de *Escalera*): abrir la herramienta en una carpeta y que diga de inmediato qué es y qué no es comprobable en ella, incluidas dos filas `○` por cosas que nadie ha hecho, es el argumento entero del producto hecho en el primer contacto. Y el prompt **es** el asiento 014: no hay caja, ni raíl, ni losa `{surface2}`, ni `╹`, ni zócalo `▀`. Es el prompt más distintivo de cualquier agente de línea de comandos precisamente porque ahí no hay nada.

**Movimiento.** El reloj del margen, una vez por minuto. Nada más.

**Estados.** Directorio vacío: el bloque comprobable se reduce a una fila `○ este directorio  nada registrado todavía`, y el pie dice `sin campaña · ○ ○ ○ ○  0 de 4`. Si un run terminó con la app cerrada, el 013 lee `● ejecución · … · cerrada 20:41 · salida 0`. Por debajo de 30 filas, la promesa se colapsa a una línea.

**Ficheros.** `routes/home.tsx` (marcadores en `:17-20`, el hueco muerto `height={4}` en `:74`, la columna centrada en `:70`), `component/logo.tsx`, `logo.ts`, `component/prompt/index.tsx` (marco borrado, margen añadido), `feature-plugins/home/footer.tsx`, `feature-plugins/home/tips.tsx` y `tips-view.tsx` (borrados), `ui/pagina.tsx`, `ui/glifos.ts`.

### 4.2 Un asiento con herramientas de dominio

```
  015│ ¿Cuáles de mis 16 muestras llegaron de verdad al final del run?
16:41│
     │
  016│ Leí la traza de ejecución y atribuí cada identificador que
16:41│ declara la samplesheet.
     │
     │ ● census        12 de 16 muestras llegaron a SALMON_QUANT
     │
     │   placa         A ● ● ● ● ● ● ● ● ● ● ● ●   12 hasta el final
     │                 B ○ ○ ○ ○                    4 sin contar
     │
     │   sin contar    SRR9640057  ninguna tarea lleva su identificador
     │                 SRR9640058  ninguna tarea lleva su identificador
     │                 SRR9640061  falló en STAR_ALIGN, salida 137
     │                 SRR9640062  falló en STAR_ALIGN, salida 137
     │
     │   contado desde results/pipeline_info/
     │                 execution_trace_2026-08-31_04-12-09.txt
     │
     │   prueba        que ninguna tarea de esa traza lleva esos cuatro
     │                 nombres, y en qué etapa se los dejó de ver.
     │   no prueba     que fallaran, ni que sean malas muestras.
     │   compruébalo   la traza es texto plano: la ruta está arriba.
     │
     │ El join de Nextflow descarta claves sin pareja sin fallar. El run
     │ salió con 0 y MultiQC dibujó un informe perfecto de doce.
     │
16:43│ asentado · 1m 52s · claude-opus-4
```

**Color.** El `●` de la rúbrica en `{asentado}`; la clave `census` en `{lápiz}`; el titular en `{tinta}`. Placa: los `●` en `{asentado}`, los `○` en `{ausencia}` (declaradas y sin contar, que es exactamente «falta algo y lo decimos»), las letras de fila `A`/`B` en `{lápiz}`. `sin contar` en `{ausencia}`; los identificadores en `{tinta}`. `contado desde` y la ruta en `{lápiz}`. **`prueba`, `no prueba` y `compruébalo` llevan la rúbrica en `{lápiz}` y el texto en `{tinta}` a peso completo**: es la regla prohibitiva, un límite no se atenúa nunca. El cierre en `{lápiz}`. El renglón en `{renglón}`, cortado en la fila en blanco entre 015 y 016.

**Lo que el dibujo no puede mostrar.** El titular es `state.title` literal. `nfcore_census` ya compone «12/16 samples — 4 unaccounted for» y «16 declared — attrition not measurable from this trace», redactados deliberadamente para no inventar números, y hoy la TUI lee `state.title` en exactamente dos sitios, ambos dentro de la línea de resumen de subagente, y renderiza esta llamada como `⚙ nfcore_census [trace=…]` en gris con su salida oculta por defecto. Aquí no hay copia inventada: la placa y la lista salen de `metadata.report`, que ya trae `declared`, `observed`, `measurable`, `deepestStage`, `attrition[]` y `unexpected`.

**La placa, y por qué le gana a la tira.** Doce puntos por fila con letra de fila, como una placa de laboratorio, que es el objeto que un laboratorio húmedo ya sabe leer sin instrucciones. *Asiento* proponía una tira lineal de una celda por muestra; pierde por su propio riesgo declarado: deja de ser contable por encima de unas sesenta muestras a 80 columnas, y envolverla destruye la justificación entera del dispositivo. La placa envuelve por construcción. Techo declarado: unos 240 puntos (20 filas); por encima colapsa a un resumen más la lista de `sin contar`, que es la parte que importa.

**Estados.** `measurable: false`: el asiento pasa a `○ census  16 declaradas: atribución no medible desde esta traza` más `porque  ningún proceso nombra sus tareas por muestra`. Ejecutándose: la rúbrica lleva el anillo en la posición del glifo. Fallo del propio tool: `×` en `{falla}` más el mensaje a peso completo de `{tinta}`.

**Ficheros.** `routes/session/index.tsx` (`toolDisplays` en `:2582`, el `<Switch>` de `ToolPart` en `:1663`, `GenericTool` borrado), `routes/session/tools/census.tsx` (nuevo), `util/tool-display.ts` (`toolDisplayMetadata()`, hoy con cero puntos de uso), `packages/bioinformatica/src/nfcore/census.ts`.

### 4.3 La firma

```
  017│ Lánzalo. Es el perfil real, no el de prueba.
16:44│
     │
(018)│ ── nada se ha ejecutado todavía ───────────────────────────────────────
16:44│ ○ borrador      ejecutar un pipeline            sin firmar
     │
     │        pipeline nf-core/rnaseq
     │         versión 3.14.0            fijada, no «latest»
     │          perfil docker            DATOS REALES, no -profile test
     │         entrada data/samples.csv  12 muestras · 24 fastq · 71 GB
     │          salida results/          vacío, nada que sobrescribir
     │           techo 16 cpu · 64 GB    conf/limits.config
     │         máquina 16 cpu · 62 GB    cabe
     │        reanudar -resume           41 tareas en caché del 22 ago
     │
     │   prueba        qué orden exacta se ejecutó, con qué versiones y
     │                 sobre qué ficheros, y lo asienta en el libro.
     │   no prueba     que nf-core/rnaseq responda a tu pregunta, ni que
     │                 el genoma declarado sea el de estas muestras.
     │
     │ ── firmar no prueba que el resultado sea correcto ─────────────────────
     │ f firmar y asentar    m rehusar con motivo    e enmendar
     │ enter no hace nada, asentar exige firma
```

**Color.** Los dos filetes rotulados en `{renglón}` con sus rótulos en `{tinta}`: son la afirmación negativa dibujada **dentro de la corrida del borde**, con `title` y `titleColor` nativos (injerto de *Escalera*). `(018)` y `16:44` en `{lápiz}`, entre paréntesis porque el asiento aún no está en el registro. Etiquetas del desglose en `{lápiz}`, valores en `{tinta}`. **Una sola línea es teal**: `perfil docker · DATOS REALES, no -profile test`, íntegra en `{asentado}` (injerto de *Bancada*). Con `-profile test` esa misma línea se pinta entera en `{lápiz}` y la glosa pasa a `perfil de prueba`. Así **la pantalla cambia de color según el único hecho que cuesta ocho horas equivocar**, y una bióloga aprende ese color en una sesión. La fila `máquina` compara el techo con el informe real de `environment`; si el techo excede la máquina, va en `{falla}` y `f` no se ofrece hasta reconocerlo. `f` en `{asentado}`, su palabra en `{tinta}`; `m` y `e` en `{lápiz}`; la línea de `enter` en `{lápiz}`.

**Nada de ámbar, nada de `△`, nada de scrim, nada de fila de fichas.** Hoy esto son nueve filas tras un `┃` ámbar que leen `△ Permission required` / `# Shell command` / una sola línea `$ …` plana y envuelta, con `Allow once` preseleccionado de forma que Enter aprueba y un ratón a la deriva puede rearmar Enter sobre `Allow always`. Mostrarle a una científica lo que vas a ejecutar es una cortesía, no un peligro; el ámbar y el triángulo son la gramática visual del riesgo, tomada prestada de la confirmación de `bash` de un agente de programación.

**Por qué no es una caja.** *Escalera* proponía la única caja cerrada del producto. Pierde: encerrar el borrador lo saca de la página, y la tesis entera es que está **en** la página, en su número, y que si se rehúsa se queda ahí tachado. Lo que sí se toma de *Escalera* es lo mejor que tenía, los dos rótulos en los bordes, que aquí van en dos filetes dentro del cuerpo. Se gana el efecto sin romper el registro.

**Lo que el dibujo no puede mostrar.** Firmarlo hace caer los paréntesis, añade el reloj de firma al margen y lo convierte en el asiento 018. Rehusarlo lo deja exactamente donde está, tachado de punta a punta con `TextAttributes.STRIKETHROUGH` (que ya existe en el árbol, aplicado hoy a llamadas denegadas, así que no es una apuesta), con el motivo como fila del cuerpo y la referencia a `refusals.jsonl` al margen. **Las palabras citadas de la científica se reproducen en `{tinta}`, nunca en `{falla}`**: un rehúso bajo el protocolo es el sistema funcionando, y colorear su frase como un error le dice que hizo algo mal cuando no lo hizo. `e` abre la enmienda: exige un nombre escrito, va a `amendments.jsonl`, y cada asiento futuro que cubra lleva `§` en `{ausencia}` en su margen durante la vida del proyecto.

**Estados.** Cola: el pie dice `3 borradores sin firmar` y el siguiente monta en el 019 debajo de éste; la cola se ve porque **es** el registro, no una insignia. Auto-aprobación encendida: este asiento no aparece nunca y el pie se convierte en una banda INVERSE de ancho completo en `{ausencia}`: `SIN FIRMA · las órdenes se ejecutan sin asentarse · /firma para restablecerlo`. `report_save` obtiene su propia forma de borrador y renderiza `metadata.preview` como markdown con las etiquetas `[computed]` / `[cited]` / `[model-inferred]` en `{asentado}` / `{tinta}` / `{lápiz}`; hoy renderiza literalmente «No diff provided», porque `EditBody` lee `metadata.diff` y `report.ts` pasa `preview`.

**Ficheros.** `routes/session/permission.tsx` (`info()` en `:195-381` gana la rama nf-core; se borran `borderColor` en `:635`, `maxHeight:15` en `:642`, `selected: keys[0]` en `:538`, `onMouseOver` en `:683`, la puerta `parentID` en `:414` y la etapa `always` en `:138-176`), `routes/session/question.tsx`, `routes/session/index.tsx:207` (el prompt deja de desmontarse), `component/prompt/index.tsx:1447` (la banda `auto`), `packages/bioinformatica/src/nfcore/command.ts` (que `NfcoreCommand` llegue estructurado a `metadata` en vez de aplanarse a cadena), `packages/bioinformatica/src/tool/report.ts`.

### 4.4 El asiento abierto

```
  018│ ● ejecución     nf-core/rnaseq 3.14.0 · docker · firmada 09:41
+3h14│                 asiento abierto · firmada por E.S.
     │
     │   placa         A ● ● ● ● ● ● ● ● ● ● ● ●   12 hasta TRIMGALORE
     │                 B ● ● ○ ○                    2 aún no · 0 perdidas
     │
     │   etapas        ● CAT_FASTQ      16/16  cerrada 09:58
     │                 ● FASTQC         16/16  cerrada 10:31
     │                 ● TRIMGALORE     16/16  cerrada 11:44
     │                 ● STAR_ALIGN     10/16  22m en esta etapa · 2ª vez
     │                 ○ SALMON_QUANT    0/16
     │                 ○ 7 procesos más
     │
     │   cola          [8c/1f2a03] STAR_ALIGN (SRR9640049) 36 GB en curso
     │                 [3f/9a2c11] STAR_ALIGN (SRR9640051) 36 GB reintento
     │
     │   contado desde results/pipeline_info/
     │                 execution_trace_2026-09-01_09-41-22.txt
     │
     │                 ○ ○ ● ○ ○ ○   trabajando
     │
  019│ ▌pregunta algo mientras corre

────────────────────────────────────────────────────────────────────────────────
  rnaseq-hipoxia · 018 abierta +3h14 · docker · 16 cpu 64 GB   ● ● ○ ○  2 de 4
```

**Color.** El `●` de `STAR_ALIGN` va en `{asentado}` **INVERSE**: es la etapa en curso, y eso el dibujo no lo puede representar. Los `●` cerrados en `{asentado}`, los `○` en `{lápiz}` (todavía no toca, no falta). En la placa, los `●` en `{asentado}` y los `○` en `{lápiz}`; una muestra atribuida como perdida pasa a `×` en `{falla}` y gana una fila con su nombre y su `AttritionReason` (`never_entered`, `failed`, `dropped_after`, `in_flight`), porque un número que encoge en silencio es exactamente lo que el censo existe para impedir. Nombres de proceso y conteos en `{tinta}`; horas, hashes de `work/` y `2ª vez` en `{lápiz}`. `22m en esta etapa` en `{tinta}`: **es el número que revela un atasco, y el transcurrido total no puede revelarlo nunca** (injerto de *Bancada*). `contado desde` y su ruta en `{lápiz}`, siempre presente, nunca omitida.

**Lo que el dibujo no puede mostrar, y aquí es lo que más importa.** Hoy esto es una losa clavada a las **primeras** diez líneas de la salida (`collapseToolOutput` hace `lines.slice(0, maxLines)`), de manera que durante seis horas la bióloga mira el banner ASCII de nf-core mientras la tabla del ejecutor pasa invisible bajo el pliegue, después de que `stripAnsi` haya convertido la pantalla redibujada por cursor de Nextflow en N bloques casi idénticos. Esta vista está **parseada**, no seguida: la placa y la tabla de etapas salen de `Census.parseTrace` sobre el fichero de traza del propio run, y `cola` son las dos últimas tareas vivas. El prompt sigue montado y usable durante el run.

**La escalera de degradación del vigía de trazas** (injerto de *Bancada*, verbatim, porque es la fontanería mejor especificada de las cuatro propuestas): `pipeline_info/` no existe hasta que Nextflow lo escribe; un run reanudado deja los `execution_trace_*.txt` viejos en su sitio, y censar el equivocado reporta una atrición que un run posterior ya arregló (`census.ts` avisa de esto en sus propios comentarios); `trace.fields` es configurable por el usuario, así que la columna `name` puede faltar. El bloque degrada a `contado desde  aún no hay traza` y a `atribución no medible desde esta traza`, **nunca a una cohorte de cero**. Se reutiliza la vía `ParseProblem` que `Census.parseTrace` ya tiene; no se escribe un segundo parser.

**Nada de porcentajes ni de estimaciones.** Nextflow no conoce su denominador hasta que el DAG se resuelve, y un run reanudado no es estimable en absoluto. Toda cantidad es una fracción de algo contado (`10/16`, `12 hasta TRIMGALORE`). Un porcentaje aquí sería la especie exacta de error confiado que los cuatro artefactos existen para rechazar.

**Estado de fallo, que engancha en vez de limpiar** (injerto de *Bancada*). Al recibir una salida distinta de cero, **todas las lecturas se congelan en el valor que tenían**. La rúbrica pasa a `× ejecución  parada en 41m · salida 137` en `{falla}`; la celda de la placa donde cayó el fallo se marca `×` en su sitio; aparece una fila `techo 24 GB` justo al lado de `máquina 62 GB`, que son los dos números que hay que comparar en el momento en que hay que compararlos; se muestra la **cola** de `.command.err`, nunca la cabeza; y `work/a3/9f21c4e8b0d5f7a2` va como `<a href>` OSC-8 (el motor emite el hipervínculo real cuando el terminal reporta `hyperlinks`). El anillo se para en la posición de las seis en punto y se queda ahí en vez de desaparecer: un anillo parado en una posición conocida es cómo sabes que la máquina corrió y se detuvo, frente a no haber arrancado nunca. Se ofrecen exactamente tres acciones, porque en el minuto 41 hay exactamente una decisión.

**Otras cosas.** El pie pasa a `018 cerrada 3h54m · salida 0`. La notificación del sistema operativo lee `rnaseq · asiento 018 cerrado · 12 de 16 atribuidas`, no `Session done`. La interrupción son dos escapes, el segundo diciendo `detener la ejecución, los resultados parciales quedan en work/`, con la ventana de intención subida de 5000 ms (una guarda pensada para un turno de chat) a la vida del asiento.

**Ficheros.** `routes/session/index.tsx` (`Shell` en `:1990-2046`), `routes/session/tools/run.tsx` (nuevo), `feature-plugins/run/traza.ts` (nuevo, sondea cada 10 s con `Census.pickLatestTrace` y `Census.parseTrace`), `context/pulso.tsx`, `routes/session/footer.tsx` (borrado y sustituido por el pie de página), `util/collapse-tool-output.ts`, `component/prompt/index.tsx:407-416`, `feature-plugins/system/notifications.ts:38,52,77`, `packages/bioinformatica/src/nfcore/census.ts` y `failure.ts`, `packages/bioinformatica/src/tool/shell.ts` (que ya emite `metadata.exit`, `metadata.truncated` y `metadata.outputPath`, y la TUI hoy no lee ninguno de los tres).

### 4.5 El expediente

```
── el expediente ──────────────────────────────────── esc  volver al registro ──

  rnaseq-hipoxia · ensamblado 2026-09-01 14:22 · bioinformatica-dossier v1

  ● manifest      4 corpus · 118 402 filas · 2,1 GB · huellas ok
    huella        ▄▇▁▅▂█ 3f9a…c1 · ENA · portal API · «PRJEB44444»
    prueba        que los ficheros vienen de donde dice, sin cambios
    no prueba     que la consulta que los trajo fuera la correcta

  ● protocol      vinculante · 4 restricciones · 1 rehúso
    §             1 enmienda firmada por E. Sanz · 31 ago · «waive C2»
    libro         28 ago 14:02 «usa hg19 para que cuadre» contra C1
    no prueba     que esas restricciones fueran suficientes

  ○ handcount     ausente
    haría falta   una traza de sesión guardada; esta no la tiene
    produce       bioinformatica handcount --since <primer-asiento>
    ojo           ausente no es cero, y «other» es «sin indicio»

  ○ methods       ausente
    haría falta   manifest y handcount; falta el handcount

────────────────────────────────────────────────────────────────────────────────
  verificado en frío · sin modelo, sin red      1 402 comprobaciones · 0 ×
    compruébalo   bioinformatica verify ./        c copia la orden

  v dar por visto     c copiar la orden     esc volver     ● ● ○ ○  2 de 4
```

**Color.** Los cuatro artefactos siempre, en el orden fijo que declara `dossier.ts`, estén o no. `●` en `{asentado}`; el `○` de `handcount` y `methods` y la palabra `ausente` en `{ausencia}`, **nunca en `{falla}`**: la ausencia es un hallazgo, no un fallo, y `dossier.ts` lo dice con esas palabras en sus propios comentarios («a dossier that silently omits an artefact reads exactly like a campaign that never produced one»). Claves en `{lápiz}`, hechos en `{tinta}`. `§` en `{ausencia}`. La cita de `refusals.jsonl` reproducida en `{tinta}`. `prueba` / `no prueba` en filas contiguas del mismo ancho, mismo color y **mismo peso**, en cada entrada, sin excepción: nada de esto se atenúa. `verificado en frío · sin modelo, sin red` con la frase en `{asentado}` y los conteos en `{tinta}`; si alguna comprobación hubiera fallado leería `1 402 comprobaciones · 3 ×` con el `3 ×` en `{falla}` y **las tres comprobaciones fallidas impresas literalmente debajo**, porque `verification.ok` no se puede dar por bueno de palabra y el propio `Index` guarda `failures[]` exactamente para eso.

**La huella y su propio límite.** Seis celdas de bloque, tres bits cada una de los seis primeros bytes del digest, junto a ocho dígitos hexadecimales. Dos expedientes uno al lado del otro se comparan como seis alturas de barra en una sacada. Y la pantalla imprime, permanentemente, que son dieciocho bits y que detectan un accidente, no un ataque. **La huella no se renderiza nunca en una vista que no renderice también su límite**, y eso se impone en el componente: `huella()` exige un `contexto` que sólo el expediente y la entrada de manifiesto proporcionan. Es la disciplina del `no prueba` aplicada al propio mobiliario de la interfaz.

**Lo que el dibujo no puede mostrar.** Esto sustituye al visor de diffs a `zIndex 2500`, hoy la pantalla a medida más grande del producto: un IDE de dos paneles con un árbol de ficheros de 32 columnas, letras de estado `M`/`A`/`D`/`?`, fuentes llamadas «working tree» / «main branch» / «last turn», `client.vcs.diff` y una categoría de paleta literalmente llamada «VCS». Un directorio de campaña no es un repositorio git y sus artefactos no tienen conteos de `+`/`-`. Lo que sobrevive es el chasis (`PanelGroup` / `Panel` / `Separator` de `diff-viewer-ui.tsx`) y el gesto: `mark reviewed` pasa a `v dar por visto`, y un artefacto visto conserva su contenido y baja a `{lápiz}` entero, tal como el visor ya re-renderiza los ficheros revisados. `c` copia la orden literal `bioinformatica verify ./` para que el lector haga él mismo la comprobación en frío, que es la única acción para la que existe esta pantalla. `produce` (la orden que cerraría el hueco) es el injerto de *El Anillo*, y es lo que convierte un hallazgo en una acción. Los `no prueba` salen de `Index.limits[]`, que ya es un array estructurado con `statement`, `evidence` (una ruta `path:line` que un test obliga a que exista) y `retiredBy`, así que **no se puede mostrar un límite sin código detrás**.

**Movimiento.** Ninguno, salvo `v`: al re-verificar, cada artefacto pasa de `○` a `●` o a `×` según le llegan los digests, y tarda lo que tarde el hashing de verdad.

**Ficheros.** `feature-plugins/system/expediente.tsx` (nuevo) sustituyendo a `diff-viewer.tsx` y `diff-viewer-file-tree.tsx`, reutilizando `diff-viewer-ui.tsx`; `config/keybind.ts` (`diff.open`, hoy atado a `none`, pasa a `expediente.open` en `ctrl+e`); `packages/bioinformatica/src/nfcore/dossier.ts` y `verify.ts`.

---

## 5. Lo que se tira

Cada borrado, con por qué es seguro.

**`SplitBorder` y su `┃` (U+2503), en los diez puntos de uso.** `ui/border.ts` son 21 líneas y ese único glifo es lo que hace que una captura se lea como opencode. Seguro porque todos los usos se sustituyen: el registro pasa al renglón, los filetes a `border={["top"]}` con título, y los avisos y el autocompletado dejan de tener borde (estar fuera de la página es lo que dice que no forman parte del registro).

**`ui/spinner.ts` entero (350 líneas), `component/register-spinner.ts`, y la dependencia `opentui-spinner`.** Es una referencia a una serie de televisión de 1982 con paleta roja por defecto y un estilo `"diamonds"` sin usar. Seguro porque el anillo y el reloj los mueve `context/pulso.tsx`, un solo `setInterval` `unref`'d más `requestRender()`, que además esquiva el `RangeError` del componente por encima de 1000 ms.

**La barra lateral de 42 columnas y sus cinco secciones** (`routes/session/sidebar.tsx`, `feature-plugins/sidebar/{context,mcp,lsp,todo,files,footer}.tsx`). LSP se renderiza hoy sin guarda alguna, así que una bióloga que nunca abre código fuente ve un panel permanente que dice «LSPs will activate as files are read». «Modified Files» con `+12`/`-3` es una barra de diff de git. «Context» pone tokens, porcentaje y dólares en el orden 100, encima de todo, en un producto cuya tesis es que el resultado se verifica **sin** modelo. Seguro porque el pie de página de dos filas los sustituye con lo que sí importa (campaña, asiento abierto, reloj, backend, techo, los cuatro puntos) y el coste se va detrás de `/gasto`.

**`routes/session/footer.tsx`.** No lo importa nadie (grep: cero referencias) y sigue dibujando `△ N Permissions`, `• N LSP`, `⊙ N MCP`, `/status` y un anuncio parpadeante de `/connect`.

**`go` y `marks` de `logo.ts` y su uso en `packages/bioinformatica/src/cli/cmd/run/splash.ts:184,212`.** Es el logotipo de bloques del donante, estampado hoy en el scrollback inmutable de cada run. Se redibuja el splash desde la marca.

**Las ~99 propinas de opencode y el plugin entero** (`feature-plugins/home/tips.tsx`, `tips-view.tsx`). Hablan de LSP, formateadores, pull requests de GitHub, ficheros `.ts` de herramientas y `AGENTS.md`; `NO_MODELS_TIP` termina en «start coding»; y `● Tip` roba el glifo de la marca en un tercer color no relacionado, cinco filas debajo de la propia marca. Seguro porque el hueco lo ocupa la promesa, que es copia fija, no un sorteo.

**El visor de diffs** (`diff-viewer.tsx`, `diff-viewer-file-tree.tsx`). Requiere un repositorio git. Seguro porque `diff-viewer-ui.tsx` sobrevive como chasis del expediente.

**Los 33 temas empaquetados**, podados a la casa más un conjunto pequeño y curado. Hoy incluyen `orng` y `lucent-orng` (los temas propios del donante) y `vercel`, `cursor` y `github` (marcas de otras tres empresas). Seguro con un aviso al arrancar si el usuario tenía uno puesto, que cae al tema de la casa.

**`Build` y `Plan`** (`packages/bioinformatica/src/agent/agent.ts:141,157`). «Build» es la palabra de agente de programación más ruidosa del producto y hoy aparece bajo el input en la portada y tras cada turno del asistente. Pasan a la postura del protocolo, `vinculante` / `consultivo`.

**`OC | ` en `app.tsx:469,474`**, `#fab283` en `component/error-component.tsx:18-41`, `#5f87ff` y `#ffd75f` en el `skin()` de `which-key.tsx`. Marcas ajenas literales, incluida la pantalla de error, que es la única que está garantizado que renderice.

**La capacidad de borrar del registro.** `tool_details_visibility`, al apagarse, hoy elimina toda llamada completada de la transcripción. Deja de poder hacerlo: ningún interruptor de esta interfaz puede hacer que el registro diga algo distinto de lo que pasó. Un rehúso se tacha, no se quita; una samplesheet corregida produce un asiento nuevo, no reescribe el viejo.

**El truncado por la cabeza.** `collapseToolOutput` pasa de `lines.slice(0, maxLines)` a cola, con deduplicación de los redibujados por cursor de Nextflow. Nunca más seis horas de banner.

---

## 6. Los hitos

Seis, ordenados. El primero es pequeño, **no toca `routes/session/index.tsx`**, y ya cambia el aspecto por completo. Ese orden es una corrección deliberada: la crítica más dura que recibió *Asiento* fue meter en el primer hito una reescritura del fichero de 2662 líneas que el usuario mira durante horas, junto con un problema de corrección sin resolver.

### Hito 1 · El alfabeto y la tinta

**Riesgo: bajo, salvo por el tema.**

**Qué cambia.** `ui/glifos.ts` (nuevo): el alfabeto de una sola clase de ancho, el resolutor de nivel que lee `renderer.capabilities.unicode` una vez al arranque, `RING.cell`, la tabla LLANO, y `huella()`. `ui/texto.ts` (nuevo): las tablas `es` y `en` con el test de paridad de claves. `context/pulso.tsx` (nuevo): el único tic de la aplicación. `component/spinner.tsx`: el anillo movido por `pulso`, `<spinner>` deja de usarse. Se borran `ui/spinner.ts` y `component/register-spinner.ts` y se quita `opentui-spinner` de `packages/tui/package.json`. Se reescribe `theme/assets/bioinformatica.json` a los seis papeles más tres acentos, con `selectedListItemText` declarado, `darkStep12` retintado, `borderActive` apuntando a la marca y los doce hexes de diff re-derivados. `theme/index.ts`: tokens nuevos opcionales con derivación documentada (y el grep previo de los ~40 puntos de uso de `secondary|accent|warning|success|info`). `context/local.tsx:83-91`: `colors()` se reduce a `[theme.primary]`. `component/error-component.tsx:18-41`. `app.tsx:469,474`. `logo.ts`: `MARK_INNER` de `◦` a `○`, borrado de `go` y `marks`; `component/logo.tsx` dibuja la marca por celdas. `packages/bioinformatica/src/cli/cmd/run/splash.ts`.

**Qué ve el usuario después de este hito solo.** Desaparecen del producto el azul cielo, el violeta, el cian y el verde en un solo commit: el raíl del prompt, el raíl del mensaje del usuario, la firma del turno y el indicador de ocupado pasan al teal de la marca. El ciclo braille se sustituye por el anillo del propio producto, girando una vez cada seis segundos y frenando conforme envejece el trabajo. El foco deja de ser gris. La marca deja de cizallarse. La pantalla de error y el título de la ventana dejan de anunciar al donante. Nada se ha reestructurado todavía; la app simplemente deja de parecer un fork de tokyonight.

### Hito 2 · La página

**Riesgo: el más alto de los seis. Es el fichero que el usuario mira durante horas.**

**Qué cambia.** `ui/pagina.tsx` (nuevo): las constantes `PAGE`, el componente `<Asiento>` con su ranura de margen y su cuerpo, `<Renglon>`, `<Rubrica>`, `<Subfila>`, `<Desglose>`, `<AlMargen>` y `<Filete>`. `ui/border.ts` se reduce y `SplitBorder` se borra en sus diez puntos de uso. `routes/session/index.tsx`: mensaje de usuario, prosa del asistente, fila de herramienta en línea, bloque de herramienta y pie de turno pierden sus paddings, raíles y rellenos propios y se convierten en asientos con número y reloj. `component/prompt/index.tsx`: se borran el marco, el `╹` y el zócalo `▀`, y el prompt gana margen.

**La numeración, que es el punto de corrección de todo el diseño.** El número se deriva del índice del mensaje en el orden que devuelve el servidor, **se calcula una vez al montar y se memoiza por id de mensaje**, nunca se recalcula. Y la regla honesta, en el espíritu del producto: **un número que no se puede derivar no se inventa**; el margen muestra sólo el reloj. Tras una compactación, que reescribe el historial, los asientos previos no se renumeran: la línea de compactación se dibuja como un filete rotulado `el registro continúa desde la compactación` y la numeración arranca ahí. Un test de instantánea sobre resumir, compactar y una escritura de subagente en el mismo registro. Si los números se mueven bajo el lector, la tesis está muerta, y eso es peor que no tener números; por eso este hito lleva su propio test y no comparte commit con nada más.

**Qué ve el usuario.** La transcripción deja de ser un chat y pasa a ser un registro numerado y fechado contra un renglón. Toda captura a partir de aquí es inconfundible. Desaparece el salto de tres columnas de cada llamada al resolverse.

### Hito 3 · Las rúbricas

**Riesgo: medio. Muchos renderizadores, poco riesgo estructural.**

**Qué cambia.** `toolDisplays` en `:2582` y el `<Switch>` de `ToolPart` en `:1663` ganan las 24 herramientas de dominio. `state.title` pasa a ser el titular del asiento (hoy se compone para humanos en cada herramienta nfcore y se lee en exactamente dos sitios, ambos dentro del resumen de subagente). Se leen los metadatos que hoy se tiran: `report` del censo, `validation` de la samplesheet, `claims` del informe, `file` del manifiesto, `exit`/`truncated`/`outputPath` del shell. Se borra `GenericTool` con sus títulos de almohadilla markdown y su raíl invisible pintado en `theme.background`. `component/register-components.ts` (nuevo) registra `TextTableRenderable` con `extend()` para que una samplesheet se dibuje como tabla con las celdas cambiadas marcadas y no como un diff sin resaltar de sopa de comas. `util/filetype.ts` aprende `.csv .tsv .nf .config .fa .fastq` (hoy `filetype("samples.csv")` es `undefined`). `generic_tool_output_visibility` pasa a `true`.

**Qué ve el usuario.** Lanzar un run de ocho horas y consultar un gen dejan de ser tipográficamente idénticos. Cada herramienta de dominio dice su propio titular en lugar de `⚙ nfcore_census [outdir=results]` en gris con el resultado escondido tras un interruptor. La interfaz adquiere un vocabulario que nunca ha tenido: hoy `grep -rn pipeline packages/tui/src` devuelve cero.

### Hito 4 · La firma

**Riesgo: medio. Depende de que `argv` estructurado llegue a `metadata`, y eso hay que verificarlo antes de diseñar las filas alrededor.**

**Qué cambia.** `permission.tsx` reescrito como borrador dentro del registro: margen entre paréntesis, dos filetes rotulados, desglose en filas con etiqueta a la derecha, `-profile` como única línea coloreada, la tríada, y la leyenda de tres teclas con Enter inerte. `info()` aprende `nextflow run` llevando la forma estructurada de `NfcoreCommand` en `metadata` en lugar de aplanarla a cadena aguas arriba. Se borran la puerta `parentID` (para que se pueda rehusar con motivo en cualquier petición), la preselección, `onMouseOver` y la etapa `always`. `report_save` deja de aprobarse sobre las palabras «No diff provided». El prompt deja de desmontarse. La banda `SIN FIRMA`.

**Qué ve el usuario.** La pantalla para la que existe el producto deja de ser lo menos diseñado del repositorio. Una bióloga ve de un vistazo si esto es `-profile test` o sus datos reales, y no puede aprobarlo por reflejo. Rehusar con motivo funciona en todas partes, y el consentimiento permanente cuesta una firma y una línea de libro.

### Hito 5 · El asiento abierto

**Riesgo: alto en fontanería, bajo en interfaz.**

**Primer paso, explícito y antes que nada:** añadir `"bioinformatica": "workspace:*"` a `packages/tui/package.json`, que hoy sólo depende de `@bioinformatica/{core,plugin,sdk,ui}`, y comprobar que los exports puros de `census.ts` (`parseTrace`, `pickLatestTrace`, `census`, `succeeded`, `inFlight`) se importan sin arrastrar la capa de servicios de Effect (`serviceUse`, `LayerNode`) a la TUI. Ninguna de las cuatro direcciones lo vio, y **todas las superficies de censo y expediente de todas ellas están bloqueadas por esta línea**.

**Qué cambia.** `feature-plugins/run/traza.ts` (nuevo): sondeo cada 10 s con la escalera de degradación completa. `routes/session/tools/run.tsx`: placa, tabla de etapas con transcurrido por etapa, cola, `contado desde`, y el estado enganchado de fallo. El reloj del margen. El pie de página de dos filas en la pila `flexShrink={0}` existente. `notifications.ts:38,52,77`. La ventana de interrupción.

**Qué ve el usuario.** La primera versión en la que irse y volver funciona. El tiempo transcurrido existe en el producto por primera vez. Un run que muere en el minuto 41 lo dice con su código de salida, su techo al lado de la máquina y la ruta a su log. Y la placa hace visible el fallo que el censo se escribió para cazar: un run que sale con 0 habiendo perdido muestras en silencio.

### Hito 6 · El expediente y la portada

**Riesgo: bajo, dado el hito 5.**

**Qué cambia.** `feature-plugins/system/expediente.tsx` (nuevo) sustituyendo al visor de diffs, con los cuatro artefactos siempre en el orden de `dossier.ts`, `haría falta` y `produce` en los ausentes, `limits[]` como los `no prueba`, la verificación en frío con sus fallos literales, la huella, `v` y `c`. Se borran la barra lateral y sus cinco plugins. `routes/home.tsx`: la lectura del directorio antes de escribir, la promesa en el hueco muerto `height={4}`, el índice del registro, el prompt como siguiente asiento. `which-key` encendido en modo dock con su piel repintada. Poda de temas y `theme.json`, el esquema que los 33 ficheros declaran y que no existe en el repositorio. Poda de `parsers-config.ts` de 34 gramáticas a las que un usuario de pipelines encuentra, más Groovy.

**Qué ve el usuario.** La segunda promesa, la más profunda, por fin tiene pantalla: los cuatro artefactos, incluido el que falta nombrado como falta y con la orden que lo produciría, se le pueden entregar a un tercero desde dentro de la app. Y abrir la herramienta en una carpeta responde «qué es comprobable aquí» antes de escribir una palabra.

---

## 7. Lo que esta propuesta no resuelve

Dicho en voz alta, que es la disciplina de la casa.

**El español es una apuesta y no la puedo cubrir del todo.** Es la señal de identidad más barata y más fuerte disponible, encaja con el dueño, con el nombre del producto y con sus primeras usuarias probables, y a una bióloga anglófona le va a parecer un muro. La mitigación (tabla bilingüe desde el hito 1, con un test de paridad de claves, y ninguna cadena escrita en línea) es real y comprobable, pero sólo funciona mientras la disciplina se mantenga. Si se relaja, la segunda tabla no se publica nunca. Y hay un coste que la tabla no cubre: la pantalla mezclará cromo español con citas literales en inglés de los artefactos, que es la decisión correcta y va a parecer descuidada hasta que alguien entienda por qué.

**La numeración de asientos puede fallar de una forma que mata la tesis.** He dado una regla concreta (derivar del orden del servidor, memoizar por id de mensaje, no inventar un número que no se puede derivar, no renumerar tras una compactación) y un test. No he verificado qué hace exactamente el servidor con los ids en un `--continue` de una sesión que ya se compactó dos veces, ni qué pasa cuando dos subagentes escriben concurrentemente en el mismo registro. Si los números bailan bajo el lector, hay que quitarlos y quedarse con el reloj, y el diseño pierde su mejor firma.

**`f` en vez de Enter va a molestar a quien firme cuarenta veces en una sesión**, y la presión para añadir una opción de configuración que restaure Enter va a ser inmediata y sonará razonable. Mantener el valor por defecto es la propuesta. Si se mueve, la afirmación central del diseño (que miraste antes de que se ejecutara) revierte a lo que el mapa ya encontró: que la entrada más barata posible es la que aprueba. Una opción es `Allow always` con sombrero.

**El INVERSE para «ahora mismo» no está probado.** Es la única forma segura ante capturas y ante daltonismo de distinguir «en curso» de «hecho» sin un tercer glifo ni un color más, pero el renderizado inverso varía entre terminales y puede leerse como un artefacto de selección. Hay que verlo en Alacritty, kitty, WezTerm, iTerm2, Windows Terminal y una consola Linux desnuda antes del hito 3.

**Siete columnas de cada línea son del margen y el renglón.** A 80 columnas el cuerpo son 71, y todo el diseño se apoya en que eso basta. Fuerza buenas decisiones (el borrador descompone una orden en vez de envolverla) y va a doler en un panel dividido de 60 columnas, donde el repliegue honesto (margen a 3, sin fila de reloj) pierde la lectura de tiempo transcurrido justo en el terminal estrecho donde es más probable que un run largo esté corriendo sin nadie delante.

**La placa se rompe por encima de unas 240 muestras.** Por encima de ese techo colapsa a un resumen más la lista de `sin contar`, y con ello pierde la contabilidad de un vistazo que es su justificación entera. El dispositivo está diseñado para los tamaños de cohorte que este producto ve de verdad, y eso es una suposición sobre el uso, no un hecho medido.

**Cambiar `MARK_INNER` de `◦` a `○` altera la marca publicada.** Es la decisión de ingeniería correcta (una sola clase de ancho, imposible cizallar) y también un cambio de marca que tienes que firmar tú, con la página de instalación, el README y `packages/ui` detrás.

**Dos temporizadores por segundo durante horas, con un proceso de Nextflow corriendo en un portátil, es una afirmación de batería que nadie ha medido.** El mecanismo está probado (el planificador del spinner ya hace exactamente esto y está `unref`'d) y pasar a cadencia por minuto tras la primera hora ayuda mucho, pero no elimina el riesgo de que la pantalla que menos se mueve de la categoría sea también la que mantiene un ventilador encendido.

**Y lo que el expediente no resuelve, que es lo que el propio expediente dice.** `Index.limits[]` ya lleva escritos seis límites con su `evidence` apuntando a código: que esto no demuestra corrección, que los registros de run son la versión del modelo y no la del sustrato, que los libros son append-only por convención y no por cadena de hashes, que la verificación en frío cubre corpus y no ejecución, que el clasificador de intervención humana sólo tiene pistas en inglés y por tanto una campaña en español cae entera en `other`, y que la procedencia viaja en un formato propio que ninguna herramienta de terceros lee. **Esta interfaz los muestra mejor; no retira ni uno.** El último es especialmente incómodo para el diseño que acabo de describir: una pantalla bonita alrededor de un formato que sólo nosotros leemos sigue siendo un formato que sólo nosotros leemos.