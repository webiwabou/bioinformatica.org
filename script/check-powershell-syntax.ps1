#!/usr/bin/env pwsh
#
# Comprueba que un script de PowerShell analiza sin errores de sintaxis.
#
# Existe porque `install.ps1` no se puede ejecutar en ningún runner del que este
# proyecto disponga —haría falta un Windows con WSL— y sin esto un paréntesis
# suelto viajaría hasta la primera persona que pegase la línea de instalación.
# Analizar no prueba que funcione; prueba que es PowerShell.

param([Parameter(Mandatory = $true)][string]$Path)

$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path $Path).Path, [ref]$null, [ref]$errors) | Out-Null

if ($errors -and $errors.Count -gt 0) {
    foreach ($e in $errors) { Write-Host $e.ToString() }
    exit 1
}

Write-Host "$Path analiza sin errores de sintaxis"
