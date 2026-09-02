# Modelos y proveedores

Bioinformática.org no trae modelo propio ni pasarela propia. El catálogo de proveedores y
modelos se descarga de [models.dev](https://models.dev) y las credenciales se configuran en
local: la clave nunca sale de tu máquina hacia este proyecto.

Este documento cubre las recetas concretas para **DeepSeek**, para **Qwen** (vía
Alibaba/DashScope y vía pasarela) y para un **modelo local** (Ollama, LM Studio, vLLM), más
cómo fijar el modelo por defecto.

## Cómo se resuelve un proveedor

Merece la pena entenderlo una vez, porque explica por qué la mayoría de proveedores no
necesitan ningún código específico:

1. El catálogo se descarga de `https://models.dev/api.json` y se cachea en
   `~/.cache/bioinformatica/models.json`. Cada proveedor declara ahí su `api` (la URL base),
   su `env` (los nombres de variable de entorno que sirven de credencial) y su `npm` (el SDK
   con el que se habla con él).
2. Un proveedor se **activa** cuando aparece una credencial suya: una variable de entorno de
   su lista `env`, una entrada en `auth.json`, o una entrada `provider.<id>` en tu
   configuración.
3. Para hablar con él se carga el SDK que declara `npm`. Los SDK más comunes van compilados
   dentro del binario; el resto se instala desde npm la primera vez que se usan.

DeepSeek y Alibaba (Qwen) declaran ambos `npm: "@ai-sdk/openai-compatible"`, que **va
compilado dentro**. Por eso los dos funcionan sin instalar nada, sin plugin propio y sin
tocar el código: basta la credencial.

### Dónde vive cada cosa

| Qué | Dónde |
| --- | --- |
| Credenciales guardadas por `providers login` | `~/.local/share/bioinformatica/auth.json` (permisos `0600`) |
| Configuración global | `~/.config/bioinformatica/bioinformatica.json` |
| Configuración por proyecto | `bioinformatica.json` en la raíz del proyecto |
| Caché del catálogo | `~/.cache/bioinformatica/models.json` |

### Precedencia de la clave

Si defines la misma credencial por varias vías, el orden efectivo es, de menor a mayor:

1. variable de entorno (`DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY`, …)
2. `auth.json`, es decir lo que guardó `bioinformatica providers login`
3. `provider.<id>.options.apiKey` en la configuración

La última gana. Si algo no se comporta como esperas, mira primero si hay una clave vieja en
`auth.json`: `bioinformatica providers list` enseña las credenciales guardadas **y** las
variables de entorno activas.

## Dar de alta una credencial

Tres formas, equivalentes. Elige una.

**Interactiva** (la guarda en `auth.json`, no queda en el historial del shell):

```bash
bioinformatica providers login --provider deepseek
bioinformatica providers login --provider alibaba

bioinformatica providers list          # qué hay dado de alta y qué variables están activas
bioinformatica providers logout deepseek
```

**Por variable de entorno** (cómoda en CI y en contenedores):

```bash
export DEEPSEEK_API_KEY=sk-...
export DASHSCOPE_API_KEY=sk-...
```

**En la configuración**, sin escribir la clave en el fichero — la configuración admite la
sustitución `{env:VAR}` (y `{file:ruta}`):

```json
{
  "provider": {
    "deepseek": {
      "options": { "apiKey": "{env:DEEPSEEK_API_KEY}" }
    }
  }
}
```

Comprueba siempre con:

```bash
bioinformatica models deepseek    # lista los modelos de ese proveedor, o falla si no está activo
```

## Receta: DeepSeek

DeepSeek es un proveedor nativo del catálogo. Endpoint `https://api.deepseek.com`, variable
`DEEPSEEK_API_KEY`.

```bash
export DEEPSEEK_API_KEY=sk-...          # o: bioinformatica providers login --provider deepseek
bioinformatica models deepseek
```

Modelos tal y como aparecen hoy en models.dev:

| id | contexto | herramientas | razonamiento |
| --- | --- | --- | --- |
| `deepseek/deepseek-v4-pro` | 1 000 000 | sí | sí |
| `deepseek/deepseek-v4-flash` | 1 000 000 | sí | sí |
| `deepseek/deepseek-v4-flash-vision-exp` | 1 000 000 | sí | sí |

```bash
bioinformatica run --model deepseek/deepseek-v4-pro "..."
```

El razonamiento de DeepSeek viaja en el campo `reasoning_content` de la API, no en el formato
estándar. El catálogo lo declara y el código lo reenvía en cada turno posterior; no hay que
configurar nada. Es la razón por la que conviene no inventarse el `npm` de este proveedor en
la configuración: cambiarlo a otro SDK rompe ese reenvío.

Si necesitas un modelo de DeepSeek que no esté en el catálogo, decláralo tú (ver
[Modelos que no están en el catálogo](#modelos-que-no-están-en-el-catálogo)).

## Receta: Qwen

Qwen se sirve desde Alibaba (DashScope) y desde casi todas las pasarelas. Las dos vías
funcionan; cambia quién te factura y qué ids escribes.

### Vía A — Alibaba / DashScope (nativo)

Una sola variable, `DASHSCOPE_API_KEY`, activa **dos** proveedores del catálogo:

- `alibaba` — endpoint internacional, `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`
- `alibaba-cn` — endpoint de China, `https://dashscope.aliyuncs.com/compatible-mode/v1`

Son catálogos distintos: `alibaba-cn` incluye además los DeepSeek, GLM y Kimi que sirve
DashScope en China. Usa el prefijo que corresponda a la región donde creaste la clave.

```bash
export DASHSCOPE_API_KEY=sk-...         # o: bioinformatica providers login --provider alibaba
bioinformatica models alibaba
bioinformatica models alibaba-cn
```

Algunos ids útiles del proveedor `alibaba`, tal y como aparecen en models.dev:

| id | contexto | notas |
| --- | --- | --- |
| `alibaba/qwen3-coder-plus` | 1 048 576 | orientado a código y uso de herramientas |
| `alibaba/qwen3-max` | 262 144 | generalista grande |
| `alibaba/qwen3.5-plus` | 1 000 000 | con razonamiento |
| `alibaba/qwen3-coder-480b-a35b-instruct` | 262 144 | pesos abiertos: el mismo modelo se puede servir en local |
| `alibaba/qwen-flash` | 1 000 000 | barato, para tareas cortas |

```bash
bioinformatica run --model alibaba/qwen3-coder-plus "..."
```

Alibaba publica además planes de suscripción con endpoints propios, también en el catálogo:
`alibaba-coding-plan` / `alibaba-coding-plan-cn` (variable `ALIBABA_CODING_PLAN_API_KEY`) y
`alibaba-token-plan` / `alibaba-token-plan-cn` (variable `ALIBABA_TOKEN_PLAN_API_KEY`).

### Vía B — una pasarela

Sirve para tener Qwen y DeepSeek bajo una sola factura y una sola clave. En una pasarela el
id del modelo lleva el fabricante dentro, y eso es normal: todo lo que va después del primer
`/` es el id del modelo.

```bash
export OPENROUTER_API_KEY=sk-or-...
bioinformatica models openrouter | grep -E '^openrouter/(qwen|deepseek)/'

bioinformatica run --model openrouter/qwen/qwen3-coder-plus "..."
bioinformatica run --model openrouter/deepseek/deepseek-v4-pro "..."
```

Otras pasarelas del catálogo que sirven ambas familias, con su variable de entorno:

| Proveedor | Variable | Qwen | DeepSeek |
| --- | --- | --- | --- |
| `openrouter` | `OPENROUTER_API_KEY` | sí | sí |
| `vercel` (AI Gateway) | `AI_GATEWAY_API_KEY` | sí | sí |
| `deepinfra` | `DEEPINFRA_API_KEY` | sí | sí |
| `togetherai` | `TOGETHER_API_KEY` | sí | sí |
| `siliconflow` | `SILICONFLOW_API_KEY` | sí | sí |
| `novita-ai` | `NOVITA_API_KEY` | sí | sí |
| `nvidia` | `NVIDIA_API_KEY` | sí | sí |
| `huggingface` | `HF_TOKEN` | sí | sí |
| `groq` | `GROQ_API_KEY` | sí (pocos) | no |
| `cerebras` | `CEREBRAS_API_KEY` | no | no |

Esa tabla dice qué proveedor sirve qué familia; deliberadamente no lleva ids. Los ids de
las pasarelas cambian y se retiran a menudo, así que sácalos siempre de
`bioinformatica models <proveedor>` en lugar de copiarlos de aquí.

## Receta: un modelo local

Cualquier servidor que hable la API de OpenAI vale: **Ollama**, **LM Studio**, **vLLM**,
**llama.cpp**, **SGLang**. Se alcanzan por `baseURL`. La clave es opcional: si no declaras
`apiKey`, no se manda cabecera `Authorization`, que es justo lo que quiere un servidor local
sin autenticación.

### LM Studio

Ya está en el catálogo, con `http://127.0.0.1:1234/v1` como URL base. Basta con definir su
variable —cualquier valor sirve, es lo que lo activa— y tener LM Studio escuchando:

```bash
export LMSTUDIO_API_KEY=lm-studio
bioinformatica models lmstudio
```

### Ollama, vLLM y cualquier otro endpoint

Se declaran como proveedor propio en la configuración. Un proveedor declarado así se activa
sin credencial ninguna, y si no dices otra cosa se habla con él por la vía
`@ai-sdk/openai-compatible`:

```json
{
  "provider": {
    "ollama": {
      "name": "Ollama (local)",
      "options": { "baseURL": "http://127.0.0.1:11434/v1" },
      "models": {
        "qwen3-coder:30b": { "name": "Qwen3 Coder 30B (local)" },
        "deepseek-r1:32b": { "name": "DeepSeek R1 32B (local)" }
      }
    },
    "vllm": {
      "name": "vLLM",
      "options": { "baseURL": "http://127.0.0.1:8000/v1" },
      "models": {
        "Qwen/Qwen3-32B": { "name": "Qwen3 32B (vLLM)" }
      }
    }
  }
}
```

Las claves de `models` son los ids que escribirás y que se mandan al servidor: en Ollama, los
que devuelve `ollama list`; en vLLM, el que pasaste a `--model` al arrancarlo.

```bash
bioinformatica models ollama
bioinformatica run --model ollama/qwen3-coder:30b "..."
```

La `baseURL` admite `${VARIABLE}`, que se sustituye con el entorno en el momento de la
llamada — útil para un puerto o un host que cambian entre máquinas:

```json
{ "provider": { "vllm": { "options": { "baseURL": "http://${VLLM_HOST}/v1" } } } }
```

Sobre lo que un modelo local le hace a este agente en concreto, lee la advertencia del final.

## Fijar el modelo por defecto

En la configuración, con el formato `proveedor/modelo`:

```json
{
  "model": "deepseek/deepseek-v4-pro",
  "small_model": "alibaba/qwen-flash"
}
```

- `model` — el modelo de trabajo.
- `small_model` — el que se usa para tareas auxiliares (títulos de sesión y similares).
  Poner aquí uno barato y rápido ahorra dinero sin tocar la calidad del trabajo.

Se puede fijar por agente, lo que permite un modelo grande para **build** y uno más barato
para **plan**:

```json
{
  "model": "deepseek/deepseek-v4-pro",
  "agent": {
    "plan": { "model": "alibaba/qwen3-coder-plus" }
  }
}
```

Y se puede cambiar puntualmente:

```bash
bioinformatica run --model alibaba/qwen3-max "..."     # sólo esa ejecución
```

En la TUI, `ctrl+x` seguido de `m` abre la lista de modelos (`ctrl+x` es la tecla *leader*
por defecto y se puede reasignar).

## Modelos que no están en el catálogo

models.dev va por detrás de los proveedores, y a veces un modelo recién publicado todavía no
está. Se declara a mano bajo el mismo `provider.<id>` sin perder nada de lo que ya trae el
catálogo — lo declarado se fusiona con lo conocido:

```json
{
  "provider": {
    "deepseek": {
      "models": {
        "deepseek-chat": {
          "name": "DeepSeek Chat",
          "tool_call": true,
          "limit": { "context": 131072, "output": 8192 }
        }
      }
    }
  }
}
```

El id es la clave del objeto y es lo que se manda a la API. `limit.context` no es decorativo:
es lo que usa el agente para decidir cuándo compactar la conversación.

## Catálogo: refresco, réplica y trabajo sin red

```bash
bioinformatica models --refresh        # fuerza la recarga desde models.dev
```

La caché se refresca sola cada cinco minutos como mucho. Para entornos sin salida a internet
o con una réplica interna:

| Variable | Efecto |
| --- | --- |
| `BIOINFORMATICA_MODELS_URL` | Origen alternativo del catálogo; se le pide `/api.json` |
| `BIOINFORMATICA_MODELS_PATH` | Ruta a un `api.json` local; se lee ese fichero y no se sale a la red |
| `BIOINFORMATICA_DISABLE_MODELS_FETCH` | Prohíbe la descarga: si no hay caché, el catálogo queda vacío |

```bash
curl -o /opt/catalogo/api.json https://models.dev/api.json
export BIOINFORMATICA_MODELS_PATH=/opt/catalogo/api.json
```

## Qué le pide este agente a un modelo

Repetido aquí porque es donde se decide: el agente encadena decenas de llamadas a
herramientas por campaña y tiene que sostener el protocolo, el objetivo y el estado del
corpus a lo largo de toda la sesión. Eso pide un modelo **fuerte en uso de herramientas y de
contexto largo**. Un modelo pequeño —local o no— degrada aquí de la peor forma posible, que
es plausiblemente: sigue produciendo comandos con buena pinta.

Nada en el código lo impide, y para explorar en local es perfectamente razonable. Pero un
dossier producido con un modelo que no sostiene el contexto no es más defendible por venir
con dossier.

## Nota sobre los ids

Los ids de modelo de este documento se comprobaron el **2026-09-01** contra
`https://models.dev/api.json`. El catálogo cambia sin avisar y los proveedores retiran
modelos. La lista viva es siempre:

```bash
bioinformatica models              # todo lo disponible con tus credenciales
bioinformatica models deepseek     # sólo un proveedor
```
