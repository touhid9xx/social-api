# Sync backend API contracts and regenerate TypeScript types.
# Usage: pnpm sync-api    (or)   .\scripts\sync-api.ps1 -SkipTypes

[CmdletBinding()]
param(
    [string]$BackendContracts = '',
    [switch]$SkipTypes
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($BackendContracts)) {
    # The frontend lives at <repo>/frontend, so the backend's contracts dir
    # is its parent: <repo>/contracts. (Pass -BackendContracts to override.)
    $BackendContracts = Join-Path $root '..\contracts'
}

if (-not (Test-Path -LiteralPath $BackendContracts)) {
    throw "Backend contracts directory not found: $BackendContracts"
}

$source = (Resolve-Path -LiteralPath $BackendContracts).Path
$target = Join-Path $root 'contracts'
New-Item -ItemType Directory -Force -Path $target | Out-Null

foreach ($name in @('openapi.json', 'api_reference.md', 'types.ts')) {
    $src = Join-Path $source $name
    if (-not (Test-Path -LiteralPath $src)) {
        throw "Missing contract file: $src - run 'python scripts/export_api_contract.py' in social-api first."
    }
    Copy-Item -LiteralPath $src -Destination (Join-Path $target $name) -Force
    Write-Host "synced $name"
}

if ($SkipTypes) {
    Write-Host 'skipped type generation (-SkipTypes)'
    exit 0
}

if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    throw 'node_modules is missing - run pnpm install first.'
}

Push-Location $root
try {
    & pnpm gen-types
    if ($LASTEXITCODE -ne 0) {
        throw "openapi-typescript failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

Write-Host 'generated src/types/api.d.ts'
