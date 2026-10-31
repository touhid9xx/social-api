# Bring up the dev stack. Docker services always; the app servers on request.
#
#   .\scripts\dev-up.ps1                          # Docker services only
#   .\scripts\dev-up.ps1 -WithApi                 # + uvicorn on :8000
#   .\scripts\dev-up.ps1 -WithFrontend            # + Next.js on :3000
#   .\scripts\dev-up.ps1 -WithApi -WithFrontend   # both
#
# The app servers are started detached and log to logs\api.log and
# logs\frontend.log, so this script can return while they keep serving.
# Stop them with .\scripts\dev-down.ps1, which force-stops the whole process
# tree (uvicorn --reload and `next dev` both spawn children that would
# otherwise keep holding their port).
#
# NOTE: save this file as UTF-8 with BOM (Windows PowerShell 5.1 defaults to
# CP1252 without a BOM and mangles UTF-8 chars like em-dash and arrows).
param(
    [switch]$WithApi,
    [switch]$WithFrontend,
    [int]$ApiPort = 8000,
    [int]$FrontendPort = 3000,
    [int]$ReadyTimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
# Invoke-WebRequest's progress bar is written to the host stream and scribbles
# over this script's output on Windows PowerShell 5.1.
$ProgressPreference = "SilentlyContinue"

$repo = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $repo ".dev-servers.json"
$logDir = Join-Path $repo "logs"

function Test-Listening {
    param([int]$Port)
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return [bool]$listener
}

function Read-ServerState {
    $state = @{}
    if (-not (Test-Path $statePath)) { return $state }
    try {
        $raw = Get-Content $statePath -Raw -ErrorAction Stop
        if (-not [string]::IsNullOrWhiteSpace($raw)) {
            ($raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object {
                $state[$_.Name] = [int]$_.Value
            }
        }
    } catch {
        Write-Host "   (ignoring unreadable state file $statePath)" -ForegroundColor DarkYellow
    }
    return $state
}

function Write-ServerState {
    param([hashtable]$State)
    if ($State.Count -eq 0) {
        if (Test-Path $statePath) { Remove-Item $statePath -Force }
        return
    }
    $State | ConvertTo-Json | Set-Content -Path $statePath -Encoding UTF8
}

function Write-LogTail {
    param([string]$Name)
    foreach ($suffix in @("log", "err.log")) {
        $path = Join-Path $logDir "$Name.$suffix"
        if (-not (Test-Path $path)) { continue }
        $tail = Get-Content $path -Tail 15 -ErrorAction SilentlyContinue
        if ($tail) {
            Write-Host "   --- $path (last lines) ---" -ForegroundColor DarkGray
            $tail | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkGray }
        }
    }
}

function Wait-Ready {
    param(
        [string]$Name,
        [int]$Port,
        [string]$ProbeUrl,
        [int]$TimeoutSeconds
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $announced = $false
    while ((Get-Date) -lt $deadline) {
        if (Test-Listening -Port $Port) {
            if (-not $ProbeUrl) { return $true }
            try {
                $response = Invoke-WebRequest -Uri $ProbeUrl -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
                if ($response.StatusCode -eq 200) { return $true }
            } catch {
                if (-not $announced) {
                    Write-Host "   $Name is listening on :$Port, waiting for $ProbeUrl ..." -ForegroundColor DarkGray
                    $announced = $true
                }
            }
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Start-DevServer {
    param(
        [string]$Name,
        [int]$Port,
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [string]$ProbeUrl
    )

    if (Test-Listening -Port $Port) {
        Write-Host "   $Name already listening on :$Port - leaving it as is." -ForegroundColor DarkYellow
        return
    }

    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    $stdout = Join-Path $logDir "$Name.log"
    $stderr = Join-Path $logDir "$Name.err.log"

    Write-Host "   starting $Name ..." -ForegroundColor Cyan
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory -WindowStyle Hidden `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

    $script:state[$Name] = $process.Id
    Write-ServerState -State $script:state

    if (Wait-Ready -Name $Name -Port $Port -ProbeUrl $ProbeUrl -TimeoutSeconds $ReadyTimeoutSeconds) {
        return
    }

    Write-Host "   $Name did not become ready within ${ReadyTimeoutSeconds}s." -ForegroundColor Red
    Write-LogTail -Name $Name
    throw "$Name failed to start - see $stdout"
}

$script:state = Read-ServerState

Write-Host ">> Starting Docker services..." -ForegroundColor Cyan
docker compose up -d

Write-Host ">> Waiting for MySQL to be healthy..." -ForegroundColor Cyan
$maxAttempts = 30
for ($i = 0; $i -lt $maxAttempts; $i++) {
    $status = docker inspect --format='{{.State.Health.Status}}' social-mysql 2>$null
    if ($status -eq "healthy") {
        Write-Host "   MySQL is healthy." -ForegroundColor Green
        break
    }
    Start-Sleep -Seconds 2
}

if ($WithApi) {
    Write-Host ">> Starting API on :$ApiPort ..." -ForegroundColor Cyan
    $venvPython = Join-Path $repo "venv\Scripts\python.exe"
    # Fall back to python on PATH so a differently-named venv still works.
    $python = if (Test-Path $venvPython) { $venvPython } else { "python" }
    Start-DevServer -Name "api" -Port $ApiPort -FilePath $python `
        -Arguments @("-m", "uvicorn", "social_api.main:app", "--reload", "--port", $ApiPort) `
        -WorkingDirectory $repo `
        -ProbeUrl "http://127.0.0.1:$ApiPort/health"
    Write-Host "   API ready: http://localhost:$ApiPort/health" -ForegroundColor Green
}

if ($WithFrontend) {
    $frontendDir = Join-Path $repo "frontend"
    if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
        throw "frontend\node_modules is missing - run 'cd frontend; pnpm install' first."
    }
    if (-not (Test-Path (Join-Path $frontendDir ".env.local"))) {
        Write-Host "   WARNING: frontend\.env.local is missing (git-ignored). It must set" -ForegroundColor DarkYellow
        Write-Host "            NEXT_PUBLIC_API_URL=http://localhost:$ApiPort or every request fails." -ForegroundColor DarkYellow
    }

    Write-Host ">> Starting frontend on :$FrontendPort ..." -ForegroundColor Cyan
    # Launch through cmd so the pnpm shim (.cmd/.ps1) resolves the same way it
    # does in an interactive shell; Start-Process cannot exec a .ps1 directly.
    Start-DevServer -Name "frontend" -Port $FrontendPort -FilePath "cmd.exe" `
        -Arguments @("/c", "pnpm dev --port $FrontendPort") `
        -WorkingDirectory $frontendDir `
        -ProbeUrl $null
    Write-Host "   Frontend ready: http://localhost:$FrontendPort" -ForegroundColor Green
}

Write-Host ""
Write-Host "Services:" -ForegroundColor Cyan
Write-Host "  MySQL      : 127.0.0.1:3307"
Write-Host "  Redis      : 127.0.0.1:6379"
Write-Host "  Jaeger UI  : http://localhost:16686"
Write-Host "  Prometheus : http://localhost:9090"
Write-Host "  Grafana    : http://localhost:3030 (admin/admin)"

if ($WithApi) {
    Write-Host "  API        : http://localhost:$ApiPort (docs at /docs, log: logs\api.log)"
} else {
    Write-Host "  API        : not started (uvicorn social_api.main:app --reload, or -WithApi)"
}

if ($WithFrontend) {
    Write-Host "  Frontend   : http://localhost:$FrontendPort (log: logs\frontend.log)"
} else {
    Write-Host "  Frontend   : not started (cd frontend; pnpm dev, or -WithFrontend)"
}

if ($WithApi -or $WithFrontend) {
    Write-Host ""
    Write-Host "Stop the app servers with .\scripts\dev-down.ps1" -ForegroundColor DarkGray
}
