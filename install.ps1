#!/usr/bin/env pwsh
#
# Instalador de Bioinformatica.org para Windows.
#
#   irm https://webiwabou.github.io/bioinformatica.org/install.ps1 | iex
#
# Nextflow no corre nativamente en Windows: necesita un entorno POSIX. En vez de
# un agente nativo que hable con Linux a traves de un puente -con la traduccion
# de rutas C:\datos <-> /mnt/c/datos en cada samplesheet, y con los datos en el
# sistema de ficheros lento- este script instala el agente *dentro* de WSL,
# donde el pipeline va a correr de todas formas, y deja en Windows un lanzador
# de una linea. Asi solo hay un camino de codigo: el de Linux.
#
# Lo que hace, en orden:
#
#   1. Comprueba si hay WSL con alguna distribucion de usuario instalada.
#   2. Si no la hay, ensena `wsl --install` y ofrece lanzarlo con permisos de
#      administrador. Nunca eleva nada sin preguntar: el dialogo de UAC es la
#      aprobacion, igual que el agente ensena cada comando antes de ejecutarlo.
#   3. Instala el binario de Linux dentro de la distribucion, con el mismo
#      script `install` que usan macOS y Linux.
#   4. Deja `bioinformatica.cmd` en el PATH de Windows, apuntando al binario de
#      dentro de WSL y llevandose el directorio actual.
#
# Opciones (desde un fichero, o con
# `&([scriptblock]::Create((irm <url>))) -Version 0.1.0`):
#
#   -Version <v>     instala una version concreta en vez de la ultima
#   -Distro <nombre> usa esa distribucion en vez de la predeterminada
#   -NoModifyPath    no toca el PATH de usuario
#   -Yes             no pregunta nada (uso desatendido)
#
# NOTA SOBRE LA CODIFICACION: este fichero es ASCII puro, sin una sola tilde,
# incluidos los comentarios. Se descarga con `irm` desde un servidor que no
# declara charset, y Windows PowerShell 5.1 decide entonces por su cuenta como
# decodificarlo; en ASCII todas esas decisiones dan el mismo resultado. Es la
# misma razon por la que el nombre distribuible es `bioinformatica` y no
# `Bioinformatica.org` (ver packages/script/src/identity.ts): el acento no
# sobrevive a ciertos canales, y este es uno.

[CmdletBinding()]
param(
    [string]$Version = "",
    [string]$Distro = "",
    [switch]$NoModifyPath,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

# El script de instalacion de Linux, servido por la misma pagina que este
# fichero. Se descarga dentro de WSL, no aqui: lo que se instala es un binario
# de Linux.
$InstallUrl = "https://webiwabou.github.io/bioinformatica.org/install"
$ShimDir = Join-Path $env:LOCALAPPDATA "bioinformatica\bin"
$ShimPath = Join-Path $ShimDir "bioinformatica.cmd"

# Docker Desktop y Rancher Desktop registran sus propias distribuciones de WSL.
# Son maquinas de servicio, no sitios donde instalar nada: sin este filtro, la
# primera de la lista en un equipo con Docker Desktop es `docker-desktop`.
$ServiceDistros = @("docker-desktop", "docker-desktop-data", "rancher-desktop", "rancher-desktop-data")

# WSL escribe su salida en UTF-16 salvo que se le pida lo contrario, y sin esto
# PowerShell la lee con un byte nulo entre cada letra. WSL_UTF8 lo arregla en
# versiones recientes; para las viejas se limpian los nulos al leer.
$env:WSL_UTF8 = "1"

function Write-Title($text) { Write-Host "`n$text" -ForegroundColor Cyan }
function Write-Muted($text) { Write-Host $text -ForegroundColor DarkGray }
function Write-Fail($text) { Write-Host $text -ForegroundColor Red }

function Confirm-Step($question) {
    if ($Yes) { return $true }
    $answer = Read-Host "$question [s/N]"
    return ($answer -eq "s" -or $answer -eq "S" -or $answer -eq "y" -or $answer -eq "Y")
}

# Ejecuta wsl.exe y devuelve su salida como lineas limpias.
#
# Hay que limpiar tres cosas, y la tercera es la que muerde. WSL escribe en
# UTF-16 salvo que WSL_UTF8 se lo impida, asi que al leerlo como texto llega un
# byte nulo entre cada letra y una marca de orden de bytes delante de todo; y en
# un sistema que decodifica esos bytes como UTF-8, la marca se convierte en un
# caracter de reemplazo. Si no se quitan los tres, el nombre de la primera
# distribucion arrastra basura invisible delante, y entonces ni se puede
# comparar con la lista de distribuciones de servicio ni se puede pasar a
# `wsl -d`.
#
# El ErrorActionPreference local tapa el suyo del ambito exterior: con "Stop",
# redirigir el stderr de un ejecutable nativo hace que PowerShell 5.1 lance
# NativeCommandError aunque el comando haya ido bien.
# La limpieza es una sola expresion regular a proposito. Un bucle sobre una
# lista de caracteres a quitar parece mas legible y esconde una trampa: los
# bloques de ForEach-Object no abren un ambito propio, y los nombres de variable
# de PowerShell no distinguen mayusculas, asi que un `foreach ($x in $X)` ahi
# dentro destruye la lista que esta recorriendo en cuanto termina la primera
# linea. El resultado era que la primera distribucion salia limpia y las demas
# no, que es exactamente el fallo mas dificil de ver.
$WSL_NOISE = "[\u0000\uFEFF\uFFFD]"

function Get-WslOutput([string[]]$WslArgs) {
    $ErrorActionPreference = "SilentlyContinue"
    $raw = & wsl.exe @WslArgs 2>$null
    if ($null -eq $raw) { return @() }
    return @($raw | ForEach-Object { [regex]::Replace([string]$_, $WSL_NOISE, "").Trim() } |
        Where-Object { $_ -ne "" })
}

# Ejecuta wsl.exe descartando su salida y devuelve solo el codigo de salida.
# Mismo cuidado con el ErrorActionPreference que Get-WslOutput, y por lo mismo.
function Invoke-WslQuiet([string[]]$WslArgs) {
    $ErrorActionPreference = "SilentlyContinue"
    & wsl.exe @WslArgs 2>$null | Out-Null
    return $LASTEXITCODE
}

# Las distribuciones en las que tiene sentido instalar algo.
#
# Quien llame a esto tiene que envolverlo en @(). PowerShell deshace un array de
# un solo elemento al devolverlo de una funcion, asi que con una unica
# distribucion instalada -el caso normal- lo que llega es la cadena "Ubuntu" y
# no una lista, y entonces [0] devuelve "U". Con dos distribuciones funciona,
# que es justo lo que hace que el fallo no se vea.
function Get-UserDistros() {
    return @(Get-WslOutput @("-l", "-q") | Where-Object { $ServiceDistros -notcontains $_ })
}

# La distribucion predeterminada, leida del registro y no de la salida de
# `wsl -l`, donde viene marcada con un "(Default)" que esta traducido a la
# lengua de cada Windows y no se puede buscar de forma fiable.
function Get-DefaultDistro() {
    $lxss = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss"
    try {
        $guid = (Get-ItemProperty -Path $lxss -Name "DefaultDistribution" -ErrorAction Stop).DefaultDistribution
        return (Get-ItemProperty -Path "$lxss\$guid" -Name "DistributionName" -ErrorAction Stop).DistributionName
    } catch {
        return ""
    }
}

# Todo el flujo vive dentro de una funcion por una razon concreta: este script
# se ejecuta normalmente como `irm ... | iex`, es decir, dentro de la sesion de
# PowerShell del usuario. Un `exit` ahi no termina el script, cierra la ventana
# -y con ella las instrucciones que se acaban de imprimir. Dentro de una funcion,
# `return` devuelve y ya.
function Invoke-BioinformaticaInstall {

    Write-Host ""
    Write-Host "Bioinformatica.org" -ForegroundColor Cyan
    Write-Muted "instalador para Windows"

    # 1. Hay WSL? ---------------------------------------------------------------
    #
    # wsl.exe viene con Windows aunque el subsistema no este instalado, asi que su
    # presencia no prueba nada: lo que decide es si hay alguna distribucion.

    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
        Write-Fail "`nEste Windows no trae wsl.exe."
        Write-Muted "Hace falta Windows 10 version 2004 o superior, o Windows 11."
        Write-Muted "Comprueba tu version con: winver"
        return 1
    }

    $distros = @(Get-UserDistros)

    if ($distros.Count -eq 0) {
        Write-Title "Falta WSL"
        Write-Host "Nextflow necesita Linux, y en Windows eso significa WSL: el subsistema"
        Write-Host "de Linux que ya trae el propio Windows. Todavia no hay ninguna"
        Write-Host "distribucion instalada."
        Write-Host ""
        Write-Host "El comando que lo instala es:"
        Write-Host ""
        Write-Host "    wsl --install" -ForegroundColor Cyan
        Write-Host ""
        Write-Muted "Necesita permisos de administrador y, casi siempre, reiniciar el equipo."
        Write-Muted "Se abrira una ventana nueva pidiendo esos permisos."
        Write-Host ""

        $launched = $false
        if (Confirm-Step "Lo lanzo ahora?") {
            try {
                Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList @(
                    "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-Command",
                    "Write-Host 'Instalando WSL. Al terminar, reinicia el equipo.' -ForegroundColor Cyan; wsl.exe --install"
                )
                $launched = $true
            } catch {
                Write-Muted "`nNo se concedieron los permisos de administrador."
            }
        }

        Write-Host ""
        if ($launched) {
            Write-Host "Instalando WSL en la ventana nueva. Cuando termine:"
        } else {
            Write-Host "Abre PowerShell como administrador, ejecuta ese comando, y luego:"
        }
        Write-Host ""
        Write-Host "  1. Reinicia el equipo."
        Write-Host "  2. Abre Ubuntu desde el menu de inicio y crea tu usuario de Linux."
        Write-Muted "     Te pedira un nombre y una contrasena; no tienen que coincidir con"
        Write-Muted "     los de Windows, y la contrasena no se ve al escribirla."
        Write-Host "  3. Vuelve a pegar esta misma linea en PowerShell."
        Write-Host ""
        return 0
    }

    # 2. Elegir distribucion ----------------------------------------------------

    if ($Distro -eq "") {
        $preferred = Get-DefaultDistro
        if ($preferred -ne "" -and $distros -contains $preferred) {
            $Distro = $preferred
        } else {
            # La predeterminada del sistema puede ser una de servicio (Docker
            # Desktop se pone como predeterminada al instalarse en algunas
            # versiones); en ese caso vale la primera de usuario.
            $Distro = $distros[0]
        }
    }

    if ($distros -notcontains $Distro) {
        Write-Fail "`nNo hay ninguna distribucion de usuario llamada '$Distro'."
        Write-Muted ("Instaladas: " + ($distros -join ", "))
        return 1
    }

    Write-Title "Usando la distribucion: $Distro"

    # WSL 1 no vale del todo: no tiene un kernel real, y ni la integracion de Docker
    # Desktop ni buena parte de lo que un pipeline monta encima se comportan igual.
    # Se avisa y se sigue, porque convertirla tarda y es decision del usuario.
    $versions = @(Get-WslOutput @("-l", "-v"))
    $line = @($versions | Where-Object { ($_ -replace "^\*\s*", "") -match "^$([regex]::Escape($Distro))\s" })[0]
    if ($line -and ($line -match "\s1\s*$")) {
        Write-Muted "Aviso: '$Distro' corre en WSL 1. Para pasarla a WSL 2:"
        Write-Muted "  wsl --set-version $Distro 2"
    }

    # `--cd` es como el lanzador situa al agente en la carpeta donde estas. Existe
    # desde WSL 0.51; si falta, la solucion es actualizar WSL y no un apano fragil.
    # Se prueba con una ruta absoluta de Linux para no pasar por el quoting de rutas
    # de Windows, donde una barra final antes de la comilla se come la comilla.
    if ((Invoke-WslQuiet @("-d", $Distro, "--cd", "/", "--", "true")) -ne 0) {
        Write-Fail "`nEsta version de WSL no admite --cd."
        Write-Muted "Actualizala con:  wsl --update"
        return 1
    }

    # 3. Instalar el agente dentro de WSL ---------------------------------------

    $downloader = ""
    foreach ($candidate in @("curl", "wget")) {
        if ((Invoke-WslQuiet @("-d", $Distro, "--", "sh", "-c", "command -v $candidate")) -eq 0) {
            $downloader = $candidate
            break
        }
    }

    if ($downloader -eq "") {
        Write-Fail "`nDentro de $Distro no hay ni curl ni wget."
        Write-Muted "Abre $Distro y ejecuta:  sudo apt update && sudo apt install -y curl"
        return 1
    }

    if ($downloader -eq "curl") { $fetch = "curl -fsSL '$InstallUrl'" } else { $fetch = "wget -qO- '$InstallUrl'" }
    if ($Version -ne "") { $pin = "VERSION='$Version' " } else { $pin = "" }

    Write-Title "Instalando el agente dentro de $Distro"
    & wsl.exe -d $Distro -- bash -lc "$fetch | $pin bash" | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "`nLa instalacion dentro de $Distro fallo."
        return 1
    }

    # La ruta absoluta del binario, preguntada a la propia distribucion.
    #
    # El lanzador no puede invocar `bioinformatica` a secas: `wsl -- <comando>` no
    # pasa por un shell de login, asi que el PATH que el instalador acaba de anadir
    # a .bashrc no existe ahi. Con la ruta absoluta el problema desaparece, y de
    # paso el lanzador deja de depender del PATH de Linux.
    $binary = @(Get-WslOutput @("-d", $Distro, "--", "bash", "-lc", "command -v bioinformatica"))[0]
    if (-not $binary) {
        Write-Fail "`nEl binario se instalo pero no aparece en el PATH de $Distro."
        return 1
    }

    # 4. El lanzador en Windows -------------------------------------------------

    New-Item -ItemType Directory -Force -Path $ShimDir | Out-Null

    # El here-string va sin indentar a proposito: PowerShell exige el terminador
    # en la columna 0, y su contenido entra literal en el fichero .cmd.
    $shim = @"
@echo off
rem Lanzador generado por el instalador de Bioinformatica.org.
rem El agente vive dentro de WSL ($Distro); esto solo lo llama, situandolo en la
rem carpeta desde la que has escrito el comando.
wsl.exe -d $Distro --cd "%CD%" -- $binary %*
"@

    Set-Content -Path $ShimPath -Value $shim -Encoding ASCII
    Write-Muted "Lanzador escrito en $ShimPath"

    if (-not $NoModifyPath) {
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($null -eq $userPath) { $userPath = "" }
        if (($userPath -split ";") -notcontains $ShimDir) {
            if ($userPath.TrimEnd(";") -eq "") { $updated = $ShimDir } else { $updated = $userPath.TrimEnd(";") + ";" + $ShimDir }
            [Environment]::SetEnvironmentVariable("Path", $updated, "User")
            Write-Muted "Anadido $ShimDir al PATH de usuario"
        }
        # Tambien en esta sesion, para no obligar a reabrir la terminal ahora mismo.
        if (($env:Path -split ";") -notcontains $ShimDir) { $env:Path = $env:Path + ";" + $ShimDir }
    } else {
        Write-Muted "PATH sin tocar. Anade a mano: $ShimDir"
    }

    # 5. Listo ------------------------------------------------------------------
    #
    # La marca son dos anillos de seis puntos. Aqui van en ASCII por la misma razon
    # que el resto del fichero; en la terminal de Linux, donde el agente vive de
    # verdad, se dibuja con los glifos buenos.

    Write-Host ""
    Write-Host "      *      " -ForegroundColor Cyan
    Write-Host "*    " -ForegroundColor Cyan -NoNewline
    Write-Host "o o" -ForegroundColor DarkGray -NoNewline
    Write-Host "    *" -ForegroundColor Cyan -NoNewline
    Write-Host "   Bioinformatica.org"
    Write-Host "    o   o    " -ForegroundColor DarkGray
    Write-Host "*    " -ForegroundColor Cyan -NoNewline
    Write-Host "o o" -ForegroundColor DarkGray -NoNewline
    Write-Host "    *" -ForegroundColor Cyan -NoNewline
    Write-Host "   bioinformatics co-scientist" -ForegroundColor DarkGray
    Write-Host "      *      " -ForegroundColor Cyan
    Write-Host ""
    Write-Muted "Configura un proveedor de modelos y abre un proyecto:"
    Write-Host ""
    Write-Host "bioinformatica providers login" -NoNewline
    Write-Muted "  # conectar un proveedor"
    Write-Host "cd <carpeta-del-analisis>     " -NoNewline
    Write-Muted "  # tu directorio de trabajo"
    Write-Host "bioinformatica                " -NoNewline
    Write-Muted "  # abrir la interfaz"
    Write-Host ""
    Write-Muted "Si el comando no se reconoce, cierra esta ventana y abre otra."
    Write-Host ""

    return 0
}

$code = Invoke-BioinformaticaInstall

# Desde un fichero si conviene propagar el codigo de salida; por `irm | iex`,
# $PSCommandPath esta vacio y no hay nada de lo que salir.
if ($PSCommandPath) { exit $code }
