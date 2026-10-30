# Stage, safety-check, commit and push the current milestone.
#
# Reuses scripts/check_all.ps1 as the pre-commit gate so what gets pushed is
# exactly what CI will see. Refuses to commit if a secret or a generated
# artifact would be tracked (.env, *.pem, venv/, celerybeat state, GDPR export).
#
#   .\scripts\commit.ps1                  # gate + commit + push
#   .\scripts\commit.ps1 -SkipGate        # commit + push only
#   .\scripts\commit.ps1 -SkipPush        # gate + commit, no push
#   .\scripts\commit.ps1 -WithAlembic     # also run the alembic round-trip
#   .\scripts\commit.ps1 -Message "..."   # custom subject line
#
# NOTE: keep this file ASCII-only, or save it as UTF-8 *with BOM*
# (Windows PowerShell 5.1 defaults to CP1252 without a BOM and mangles
# non-ASCII characters - same caveat as scripts/check_all.ps1).
param(
    [switch]$SkipGate,
    [switch]$SkipPush,
    [switch]$WithAlembic,
    [string]$Remote = "origin",
    [string]$Branch = "",
    [string]$Message = "email/sms channel: verification + password reset flows, templates, textbee stub"
)

$ErrorActionPreference = "Stop"

# Always operate on the repo root, no matter where the script is invoked from.
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    # git must never spawn a pager: a stranded `less` is what wedged the
    # IDE terminal in the first place.
    $env:GIT_PAGER = "cat"
    $env:PAGER = "cat"
    git config core.pager cat | Out-Null

    if (-not $Branch) {
        $Branch = (git rev-parse --abbrev-ref HEAD).Trim()
    }

    function Abort {
        param([string]$Reason)
        Write-Host ""
        Write-Host "ABORT: $Reason" -ForegroundColor Red
        exit 1
    }

    # ------------------------------------------------------------- 1. gate
    Write-Host ""
    Write-Host "== 1/3 pre-commit gate (mirror of CI) ==" -ForegroundColor Cyan
    if ($SkipGate) {
        Write-Host "   skipped (-SkipGate)" -ForegroundColor DarkYellow
    } else {
        $gateArgs = @()
        if (-not $WithAlembic) { $gateArgs += "-SkipAlembic" }
        powershell -ExecutionPolicy Bypass -File scripts/check_all.ps1 @gateArgs
        if ($LASTEXITCODE -ne 0) {
            Abort "check_all.ps1 failed - nothing staged, nothing committed"
        }
    }

    # ----------------------------------------------------------- 2. stage
    Write-Host ""
    Write-Host "== 2/3 stage + safety check ==" -ForegroundColor Cyan
    git add -A
    if ($LASTEXITCODE -ne 0) { Abort "git add failed" }

    $staged = @(git diff --cached --name-only)
    if ($staged.Count -eq 0) { Abort "nothing to commit - working tree is clean" }

    $forbidden = @(
        '^\.env$',
        '^\.env\.prod$',
        '\.pem$',
        '\.key$',
        '^venv/',
        '^secrets/',
        '^celerybeat-schedule',
        '^gdpr-export.*\.json$',
        '^er\.name$',
        '^bitnitenPmd$',
        '^seed\.log$',
        '^coverage\.xml$'
    )

    $offenders = @()
    foreach ($file in $staged) {
        foreach ($pattern in $forbidden) {
            if ($file -match $pattern) { $offenders += $file; break }
        }
    }

    if ($offenders.Count -gt 0) {
        Write-Host "   Refusing to commit - these must never be tracked:" -ForegroundColor Red
        $offenders | ForEach-Object { Write-Host "     $_" -ForegroundColor Red }
        Write-Host "   Fix: git rm --cached <file>, then make sure .gitignore covers it." -ForegroundColor Yellow
        Abort "secrets or generated artifacts staged"
    }

    Write-Host ("   {0} files staged, none forbidden" -f $staged.Count) -ForegroundColor Green
    $staged | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }

    # ------------------------------------------------- 3. commit + push
    Write-Host ""
    Write-Host "== 3/3 commit + push ==" -ForegroundColor Cyan
    $body = @(
        $Message,
        "",
        "core/security: verify + reset token types, password_fingerprint (pwh) for stateless single-use reset",
        "email/: sender (aiosmtplib + smtp_breaker), sms (textbee + sms_breaker), plain-text templates en/bn",
        "auth: POST /verify-email, /forgot-password, /reset-password @3/hour; verification email on register",
        "workers: email.send celery task (3 retries, 60s backoff)",
        "contracts regenerated; no alembic migration (self-contained JWTs)",
        "tests: 38 unit + 11 integration",
        "chore: ignore runtime artifacts (celerybeat state, gdpr export, scratch files)"
    )
    $msgFile = Join-Path ([System.IO.Path]::GetTempPath()) "social-api-commit-msg.txt"
    Set-Content -LiteralPath $msgFile -Value $body -Encoding UTF8

    git commit -F $msgFile
    if ($LASTEXITCODE -ne 0) { Abort "git commit failed" }

    if ($SkipPush) {
        Write-Host "   push skipped (-SkipPush)" -ForegroundColor DarkYellow
    } else {
        git push -u $Remote $Branch
        if ($LASTEXITCODE -ne 0) {
            Abort "git push failed - for an HTTPS remote, use a GitHub PAT as the password"
        }
    }

    Write-Host ""
    git --no-pager log --oneline -1
    Write-Host ""
    Write-Host ("DONE - committed on '{0}'" -f $Branch) -ForegroundColor Green
}
finally {
    Pop-Location
}
