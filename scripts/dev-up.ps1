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
# Re-running it is safe. A port that is already bound is health-probed first:
# a server that answers is left alone, and one that is listening but not
# answering is stopped and restarted. That matters because `next dev` loses its
# build state if `frontend\.next` changes underneath it, and it never repairs
# itself:
#
#   * delete the directory and every route answers a bare "Internal Server
#     Error" (it lost routes-manifest.json / app-paths-manifest.json);
#   * truncate it and the HTML still 200s but the page's JavaScript chunks 404
#     (`ERR_ABORTED 404 .../_next/static/chunks/app/(auth)/layout.js`), so the
#     page renders a skeleton that never hydrates.
#
# Both are caught: the frontend probe checks the HTML *and* a chunk it
# references (-VerifyAssets), and the restart path clears `frontend\.next`
# *after* the old process is gone, so a fresh build is always written.
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

function Get-PortOwner {
    param([int]$Port)
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $listener) { return $null }
    return [int]$listener.OwningProcess
}

# Killing whatever happens to hold a port is worse than leaving a broken server
# running, so ownership is verified from the command line - the same guard
# dev-down.ps1 uses before it tree-kills a recorded pid.
#
# `next dev` is two processes on Windows: the CLI spawns a child that is the one
# holding the port, so the socket's owning pid (`...\next\dist\server\lib\start-
# server.js`) contains none of the tell-tale words and a single-process check
# reports "does not look like a dev server" for a server this script started
# itself - leaving the broken one unkillable. Two shapes must therefore match,
# and the parent chain is walked:
#   * `node ...\next\dist\bin\next" dev --port 3000` - the CLI is launched with a
#     closing quote after "next", so `next\s+dev` never matches (it is
#     `next" dev`); allow an optional quote between the words.
#   * `...\node_modules\next\...\start-server.js` - the actual listener.
$script:serverSignature = '(?i)(pnpm\s+dev|next["'']?\s+dev|node_modules[\\/]next[\\/].*start-server\.js|uvicorn.*social_api\.main:app)'

function Get-ProcessCommandLine {
    param([int]$ProcessId)
    try {
        return (Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop).CommandLine
    } catch {
        # Access denied / exited between lookups: treat as unknown, not as proof.
        return $null
    }
}

function Test-DevServerProcess {
    param([int]$ProcessId, [int]$AncestorDepth = 3)
    $current = $ProcessId
    for ($i = 0; $i -le $AncestorDepth -and $current -gt 0; $i++) {
        try {
            $info = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction Stop
        } catch {
            return $false
        }
        if (-not $info) { return $false }
        if ($info.CommandLine -and $info.CommandLine -match $script:serverSignature) { return $true }
        # Keep walking up: `start-server.js` -> `next dev` -> the pnpm/cmd wrapper.
        $current = [int]$info.ParentProcessId
    }
    return $false
}

# A dev server can be listening and still be useless: if `frontend\.next` is
# deleted or truncated while `next dev` is running, the process keeps serving
# "Internal Server Error" on every route because its route manifests are gone
# and it never rewrites them. Port-listening alone is therefore not "healthy".
# A page can answer 200 with a perfectly plausible skeleton on screen while the
# JavaScript chunks that hydrate it 404 - e.g. `/_next/static/chunks/app/(auth)/
# layout.js` missing because `.next` was truncated underneath the running server.
# The browser then logs `ERR_ABORTED 404` and the page stays a loading state
# forever. So "the HTML 200s" is not a health verdict: at least one same-origin
# `/_next/static/...` asset referenced by that HTML must serve 200 too.
function Test-AssetReachable {
    param([string]$PageUrl, [string]$Html, [int]$TimeoutSeconds = 10)
    if ([string]::IsNullOrWhiteSpace($Html)) { return $false }
    # Every `/_next/static/**.js` the page references must serve 200. Checking
    # just the first one is not enough: the shell chunks can be intact while the
    # route-group chunk that actually hydrates the page is the missing one, so a
    # subset check would call a broken server healthy.
    $sources = [regex]::Matches($Html, '(?:src|href)="(/_next/static/[^"]+\.js)"') |
        ForEach-Object { $_.Groups[1].Value } |
        Select-Object -Unique
    if (-not $sources) { return $false }
    foreach ($source in $sources) {
        try {
            $assetUrl = (New-Object Uri (New-Object Uri $PageUrl), $source).AbsoluteUri
            $asset = Invoke-WebRequest -Uri $assetUrl -UseBasicParsing -TimeoutSec $TimeoutSeconds -ErrorAction Stop
        } catch {
            return $false
        }
        if ($asset.StatusCode -ne 200 -or $asset.RawContentLength -le 0) { return $false }
    }
    return $true
}

function Test-UrlHealthy {
    param(
        [string]$Url,
        # Only meaningful for HTML routes; the API's /health is JSON.
        [switch]$VerifyAssets,
        [int]$TimeoutSeconds = 10
    )
    if (-not $Url) { return $true }
    try {
        # Generous: a warm dev server answers in ~100ms, but a route that has
        # never been compiled still needs a few seconds on first request.
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds -ErrorAction Stop
    } catch {
        return $false
    }
    if ($response.StatusCode -ne 200) { return $false }
    if (-not $VerifyAssets) { return $true }
    return (Test-AssetReachable -PageUrl $Url -Html $response.Content -TimeoutSeconds $TimeoutSeconds)
}

# The socket owner is the leaf (`start-server.js`), so `taskkill /T` on it kills
# only the child and leaves the `next dev` CLI alive and still watching the
# project - it can then re-bind or interfere with the replacement server. Kill
# from the topmost ancestor that still matches the signature instead, which is
# at worst the `cmd /c pnpm dev` wrapper this script spawned.
function Get-DevServerRoot {
    param([int]$ProcessId, [int]$AncestorDepth = 4)
    $root = $ProcessId
    $current = $ProcessId
    for ($i = 0; $i -lt $AncestorDepth; $i++) {
        try {
            $info = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction Stop
        } catch {
            break
        }
        if (-not $info -or $info.ParentProcessId -eq 0) { break }
        try {
            $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($info.ParentProcessId)" -ErrorAction Stop
        } catch {
            break
        }
        # Stop at the first ancestor that is not part of the dev-server chain.
        if (-not $parent.CommandLine -or $parent.CommandLine -notmatch $script:serverSignature) { break }
        $root = [int]$parent.ProcessId
        $current = $root
    }
    return $root
}

function Stop-PortTree {
    param([int]$Port)
    $owner = Get-PortOwner -Port $Port
    if (-not $owner) { return $true }
    if (-not (Test-DevServerProcess -ProcessId $owner)) {
        Write-Host "   :$Port is held by pid $owner, which does not look like a dev server - not killing it." -ForegroundColor DarkYellow
        return $false
    }
    $root = Get-DevServerRoot -ProcessId $owner
    if ($root -ne $owner) {
        Write-Host "   :$Port is held by pid $owner (child of dev-server pid $root) - killing the tree from $root." -ForegroundColor DarkGray
    }
    & taskkill /T /F /PID $root 2>&1 | Out-Null
    # Windows releases the socket asynchronously; wait for the port to go quiet
    # so the replacement server does not fail to bind.
    for ($i = 0; $i -lt 40; $i++) {
        if (-not (Test-Listening -Port $Port)) { return $true }
        Start-Sleep -Milliseconds 250
    }
    return -not (Test-Listening -Port $Port)
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
        [int]$TimeoutSeconds,
        [switch]$VerifyAssets
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $announced = $false
    while ((Get-Date) -lt $deadline) {
        if (Test-Listening -Port $Port) {
            if (-not $ProbeUrl) { return $true }
            if (Test-UrlHealthy -Url $ProbeUrl -VerifyAssets:$VerifyAssets -TimeoutSeconds 3) { return $true }
            if (-not $announced) {
                Write-Host "   $Name is listening on :$Port, waiting for $ProbeUrl to serve a complete response ..." -ForegroundColor DarkGray
                $announced = $true
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
        [string]$ProbeUrl,
        [switch]$VerifyAssets,
        [scriptblock]$BeforeStart
    )

    if (Test-Listening -Port $Port) {
        if (Test-UrlHealthy -Url $ProbeUrl -VerifyAssets:$VerifyAssets) {
            Write-Host "   $Name already listening on :$Port and answering - leaving it as is." -ForegroundColor DarkYellow
            return
        }
        Write-Host "   $Name is listening on :$Port but failing its health probe - restarting it." -ForegroundColor DarkYellow
        if (-not (Stop-PortTree -Port $Port)) {
            throw "$Name is unhealthy on :$Port and could not be stopped. Free the port (see dev-down.ps1) and re-run."
        }
        Write-Host "   stopped the unhealthy $Name." -ForegroundColor Green
    }

    # Runs only on a real (re)start, and only after the previous server is gone,
    # so cleanup here can never race a live `next dev` writing the same directory.
    if ($BeforeStart) { & $BeforeStart }

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

    if (Wait-Ready -Name $Name -Port $Port -ProbeUrl $ProbeUrl -TimeoutSeconds $ReadyTimeoutSeconds -VerifyAssets:$VerifyAssets) {
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
    $nextDir = Join-Path $frontendDir ".next"
    # Launch through cmd so the pnpm shim (.cmd/.ps1) resolves the same way it
    # does in an interactive shell; Start-Process cannot exec a .ps1 directly.
    #
    # /login is a static route with no data dependency, so it is a valid health
    # probe: it 200s only when the app tree, i18n catalogs and route manifests
    # are all intact. -VerifyAssets adds the second half of the check: the page
    # is only "up" if a JavaScript chunk it references also serves 200. Without
    # that, a frontend whose `.next\static\chunks\app\(auth)\` files have gone
    # missing answers 200 with a skeleton that never hydrates - the browser logs
    # `ERR_ABORTED 404` for `/_next/static/chunks/app/(auth)/layout.js` and the
    # page hangs in its loading state forever.
    Start-DevServer -Name "frontend" -Port $FrontendPort -FilePath "cmd.exe" `
        -Arguments @("/c", "pnpm dev --port $FrontendPort") `
        -WorkingDirectory $frontendDir `
        -ProbeUrl "http://127.0.0.1:$FrontendPort/login" `
        -VerifyAssets `
        -BeforeStart {
            # `next dev` writes its manifests (routes-manifest.json,
            # server\app-paths-manifest.json) once at startup. If `.next` is
            # deleted underneath a running server, that server keeps answering
            # every route with a bare "Internal Server Error" and never repairs
            # itself. Starting from a clean directory is the only reliable fix,
            # and it is safe here because the old server is already dead.
            if (Test-Path $nextDir) {
                Write-Host "   clearing frontend\.next ..." -ForegroundColor DarkGray
                Remove-Item -Recurse -Force $nextDir -ErrorAction SilentlyContinue
            }
        }
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
