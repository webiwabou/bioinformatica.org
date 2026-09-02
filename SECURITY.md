# Seguridad

## Cómo reportar una vulnerabilidad

Usa el formulario privado de GitHub, **no** un issue público:

<https://github.com/webiwabou/bioinformatica.org/security/advisories/new>

Incluye, si puedes: la versión que usabas, el sistema operativo, los pasos para reproducirlo y qué
consigue quien lo explote. Un ejemplo mínimo vale más que una descripción larga.

Qué puedes esperar: te responderemos cuando hayamos leído el informe y te iremos contando cómo va la
corrección. Este es un proyecto pequeño y no prometemos un plazo que no podamos cumplir. No hay
programa de recompensas.

Qué no leeremos: informes que sean la salida de un modelo de lenguaje pegada sin revisar. Si no has
comprobado tú que el fallo existe, no lo envíes; se cerrará sin respuesta.

## Versiones soportadas

Solo la última versión publicada. Las correcciones se aplican sobre la rama principal y salen en la
siguiente versión; no se mantienen ramas de versiones anteriores.

## Qué hace este agente, y qué implica

Esta sección no es un descargo de responsabilidad: es la parte del modelo de amenazas que tienes que
conocer antes de ejecutar el programa, porque describe comportamiento normal y deliberado, no fallos.

### Ejecuta comandos en tu máquina

El agente ejecuta comandos de shell, lee y escribe ficheros, y lanza pipelines de Nextflow. Lo hace
con tus privilegios y en tu sesión: tu sistema de ficheros, tus claves SSH, tus credenciales del
clúster, tus perfiles de nube. Todo lo que tú puedes hacer desde esa terminal, lo puede hacer él.

**No hay sandbox.** El sistema de permisos (`ask` / `allow` / `deny`) existe para que sepas lo que va
a ocurrir antes de que ocurra, no para contenerlo: es una salvaguarda de atención, no un límite de
seguridad. Si configuras una regla en `allow`, esa clase de acción se ejecuta sin preguntarte.

Si necesitas aislamiento real, ejecuta el agente dentro de un contenedor o una máquina virtual, con
solo los datos que la tarea necesite montados. El repositorio incluye un `Dockerfile` en
`packages/bioinformatica/Dockerfile`.

### Todo lo que el agente lee es entrada no confiable

El agente actúa sobre texto: ficheros del repositorio, el README de un pipeline de terceros, los logs
de una ejecución, una página descargada con `webfetch`, la respuesta de un servidor MCP que hayas
configurado. Cualquiera de esas fuentes puede contener instrucciones dirigidas al modelo, y el modelo
no distingue de forma fiable entre lo que le pides tú y lo que le dice un fichero.

La consecuencia práctica: dar a leer al agente un pipeline o un repositorio de origen desconocido se
parece más a ejecutar un script ajeno que a abrir un documento. Léelo tú antes, o hazlo en un
contenedor sin nada que perder.

### Envía contexto a proveedores de modelos de terceros

Para responder, el agente envía al proveedor de modelos que hayas configurado el contenido de lo que
lee y lo que ocurre en la sesión: fragmentos de ficheros, rutas, nombres de muestra, samplesheets,
mensajes de error, salida de comandos, tu propia pregunta. Eso sale de tu máquina y de tu red hacia
un servicio externo.

Lo que ese proveedor hace después con esos datos —si los conserva, durante cuánto tiempo, si los usa
para entrenar— lo rigen sus términos de servicio, no los nuestros. Configurar un proveedor es aceptar
los suyos.

En bioinformática esto tiene una consecuencia concreta que conviene decir sin rodeos: si trabajas con
datos de pacientes, con datos genómicos identificables, o con material bajo acuerdo de acceso
controlado (dbGaP, EGA) o bajo el RGPD o HIPAA, enviar rutas, cabeceras de ficheros, identificadores
de muestra o logs a un proveedor externo puede incumplir ese acuerdo o esa normativa. El agente no
puede tomar esa decisión por ti y no te lo impide. Consúltalo con quien responda de los datos antes
de apuntar el agente a un directorio con material sensible, y considera un proveedor autoalojado o
dentro de tu propia infraestructura si la respuesta es que no puede salir.

Para inspeccionar qué contenía una sesión, `bioinformatica export <sessionID>` la vuelca como JSON.

Los comandos de verificación en frío (`bioinformatica verify`, `dossier`, `handcount`, `census`) no
usan modelo ni red: trabajan solo sobre los ficheros del directorio. Esa parte del sistema no envía
nada a ninguna parte, y ese es justamente el motivo de que exista.

### Dónde quedan tus credenciales y tus datos

Las credenciales de proveedor se guardan en `auth.json`, dentro del directorio de datos XDG
(normalmente `~/.local/share/bioinformatica/`), con permisos `0600`. Están **en claro**: no hay
cifrado en reposo, así que cualquiera que pueda leer los ficheros de tu cuenta puede leer esas
claves. Las sesiones, los logs y la base de datos local viven en los directorios XDG de datos, estado
y caché del mismo nombre.

### El modo servidor

`bioinformatica serve` es opcional y hay que pedirlo explícitamente. Por defecto escucha en
`127.0.0.1`, solo accesible desde tu propia máquina.

Sin la variable `BIOINFORMATICA_SERVER_PASSWORD`, el servidor funciona **sin autenticación** y lo
avisa al arrancar. Con ella, exige HTTP Basic.

Presta atención a los flags que cambian dónde escucha: `--hostname` lo expone donde le digas, y
`--mdns` cambia el host por defecto a `0.0.0.0`, es decir, a todas las interfaces. Un servidor sin
contraseña escuchando en `0.0.0.0` es ejecución remota de comandos en tu máquina para cualquiera que
comparta esa red. Asegurar el servidor es responsabilidad de quien lo levanta; el acceso a un
servidor que tú has expuesto no es una vulnerabilidad de este proyecto.

## Fuera de alcance

| Caso                                             | Por qué                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Escapar del sistema de permisos                  | No es un sandbox: no promete contención, así que no hay nada de lo que escapar |
| Acceso a un servidor que tú has expuesto         | Si activas el modo servidor, el acceso a su API es el comportamiento esperado  |
| Tratamiento de datos por el proveedor de modelos | Lo rigen los términos del proveedor que has configurado                        |
| Comportamiento de servidores MCP externos        | Los servidores MCP que añades quedan fuera de nuestra frontera de confianza    |
| Configuración maliciosa                          | La configuración es tuya; modificarla requiere ya acceso a tu cuenta           |
| Pipelines o plugins de terceros                  | Ejecutar código de terceros hace lo que ese código diga; revísalo antes        |

Que algo esté fuera de alcance no significa que no nos interese. Si encuentras una forma de convertir
uno de esos casos en algo peor de lo descrito aquí —por ejemplo, exfiltrar credenciales sin que
aparezca ninguna petición de permiso—, eso sí es un fallo y queremos saberlo.
