# Stop the dev stack: the app servers started by dev-up.ps1, then Docker.
#
#   .\scripts\dev-down.ps1            # app servers + docker compose down
#   .\scripts\dev-down.ps1 -KeepDocker # app servers only
#
# `uvicorn --reload` and `next dev` both spawn child processes that inherit the
# listening socket, so a plain Stop-Process on the parent leaves the port bound.
# taskkill /T kills the whole tree, which is why the PIDs are recorded by
# dev-up.ps1 in .dev-servers.json.
#
# NOTE: save this file as UTF-8 with BOM (Windows PowerShell 5.1 defaults to
# CP1252 without a BOM and mangles non-ASCII chars).
param(
    [switch]$KeepDocker
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $repo ".dev-servers.json"

# PIDs are recycled by Windows. A recorded PID whose process is no longer one of
# these (because the server already exited and something else took the slot) must
# not be tree-killed.
$script:expectedNames = @("python", "python3", "python3.12", "py", "cmd", "node", "pnpm")

# The process *name* alone is not proof of ownership. A recycled slot very often
# holds another `node` or `python` - a test runner, an editor extension host, a
# different project's dev server - and `taskkill /T` would take out that whole
# tree. Require the command line to still look like one of the two servers
# dev-up.ps1 starts: `python -m uvicorn social_api.main:app ...` or
# `cmd /c pnpm dev --port N` (whose child is `node ... next dev --port N`).
$script:serverSignature = '(?i)(pnpm\s+dev|next\s+dev|uvicorn.*social_api\.main:app)'

function Get-CommandLine {
    param([int]$ProcessId)
    try {
        return (Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop).CommandLine
    } catch {
        # Access denied / process exited between the two lookups: treat as unknown.
        return $null
    }
}

function Test-DevServer {
    param([int]$ProcessId)
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $process) { return $false }
    if ($script:expectedNames -notcontains $process.ProcessName.ToLowerInvariant()) { return $false }
    $commandLine = Get-CommandLine -ProcessId $ProcessId
    return [bool]($commandLine -and $commandLine -match $script:serverSignature)
}

function Stop-ProcessTree {
    param([int]$ProcessId)
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return $false }
    if (-not (Test-DevServer -ProcessId $ProcessId)) {
        Write-Host "   pid $ProcessId no longer looks like a dev server - not killing it." -ForegroundColor DarkYellow
        return $false
    }
    & taskkill /T /F /PID $ProcessId 2>&1 | Out-Null
    return $true
}

function Test-Listening {
    param([int]$Port)
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return [bool]$listener
}

if (Test-Path $statePath) {
    Write-Host ">> Stopping app servers..." -ForegroundColor Cyan
    try {
        $state = Get-Content $statePath -Raw | ConvertFrom-Json
        foreach ($entry in $state.PSObject.Properties) {
            $name = $entry.Name
            $processId = [int]$entry.Value
            if (Stop-ProcessTree -ProcessId $processId) {
                Write-Host "   stopped $name (pid $processId)" -ForegroundColor Green
            } else {
                Write-Host "   $name (pid $processId) was not running" -ForegroundColor DarkYellow
            }
        }
    } catch {
        Write-Host "   could not read $statePath - $_" -ForegroundColor DarkYellow
    }
    Remove-Item $statePath -Force -ErrorAction SilentlyContinue
} else {
    Write-Host ">> No app servers recorded (run dev-up.ps1 -WithApi / -WithFrontend to start them)." -ForegroundColor DarkGray
}

# A server that outlived its recorded PID (or was started by hand) would keep
# the port bound and make the next dev-up silently reuse a stale process.
foreach ($port in @(8000, 3000)) {
    if (-not (Test-Listening -Port $port)) { continue }
    $owner = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1).OwningProcess
    if (-not $owner) { continue }
    Write-Host "   :$port is still bound by pid $owner (not started by dev-up) - leaving it alone." -ForegroundColor DarkYellow
    $ownerName = (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName
    Write-Host "   stop it with: taskkill /T /F /PID $owner  ($ownerName)" -ForegroundColor DarkGray
}

if (-not $KeepDocker) {
    Write-Host ">> Stopping Docker services..." -ForegroundColor Cyan
    docker compose down
}
