# scripts/smoke_test_auth_profile.ps1
# Manual smoke test: auth + profile flows.
# Requires API running at http://localhost:8000.
# ASCII-only, no fancy quotes, no here-strings for safety.

$ErrorActionPreference = "Stop"
$base = "http://localhost:8000"

function Assert-Ok {
    param([string]$Label)
    Write-Host "[PASS] $Label" -ForegroundColor Green
}

function Assert-Fail {
    param([string]$Label)
    Write-Host "[FAIL] $Label" -ForegroundColor Red
}

# ─── 1. Register two users ───────────────────────────────────────
Write-Host ""
Write-Host "=== 1. Register ==="

$reg1 = @{ email = "alice@example.com"; password = "Str0ng!Passw0rd" } | ConvertTo-Json -Compress
$reg2 = @{ email = "bob@example.com";   password = "Str0ng!Passw0rd" } | ConvertTo-Json -Compress

try {
    Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/register" -Body $reg1 -ContentType "application/json" | Out-Null
    Assert-Ok "alice registered"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 409) { Write-Host "[SKIP] alice already exists" -ForegroundColor Yellow }
    else { throw }
}

try {
    Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/register" -Body $reg2 -ContentType "application/json" | Out-Null
    Assert-Ok "bob registered"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 409) { Write-Host "[SKIP] bob already exists" -ForegroundColor Yellow }
    else { throw }
}

# ─── 2. Login alice ─────────────────────────────────────────────
Write-Host ""
Write-Host "=== 2. Login alice ==="

$loginBody = @{ email = "alice@example.com"; password = "Str0ng!Passw0rd" } | ConvertTo-Json -Compress
$loginResp = Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/login" -Body $loginBody -ContentType "application/json"

$aliceToken   = $loginResp.tokens.access_token
$aliceRefresh = $loginResp.tokens.refresh_token
$aliceId      = $loginResp.user.id

Assert-Ok "alice logged in (id=$aliceId)"
Write-Host "       access token length: $($aliceToken.Length)"
Write-Host "       refresh token length: $($aliceRefresh.Length)"

$headers = @{ Authorization = "Bearer $aliceToken" }

# ─── 3. GET /users/me ────────────────────────────────────────────
Write-Host ""
Write-Host "=== 3. GET /users/me ==="

$me = Invoke-RestMethod -Method Get -Uri "$base/api/v1/users/me" -Headers $headers
Write-Host "       user_id=$($me.user_id) version=$($me.version) display_name=$($me.display_name)"
Assert-Ok "GET /users/me"

# ─── 4. PATCH /users/me (profile update) ─────────────────────────
Write-Host ""
Write-Host "=== 4. PATCH /users/me ==="

$patch = @{
    version      = 1
    display_name = "Alice"
    dob          = "1990-05-15"
    phone        = "+8801700000000"
} | ConvertTo-Json -Compress

$patchResp = Invoke-RestMethod -Method Patch -Uri "$base/api/v1/users/me" -Headers $headers -Body $patch -ContentType "application/json"

Write-Host "       new version=$($patchResp.version) display_name=$($patchResp.display_name)"
Write-Host "       dob=$($patchResp.dob) phone=$($patchResp.phone)"
Assert-Ok "PATCH /users/me"

# ─── 5. Optimistic lock conflict (stale version) ─────────────────
Write-Host ""
Write-Host "=== 5. Optimistic lock conflict ==="

$stale = @{ version = 1; display_name = "Stale" } | ConvertTo-Json -Compress
try {
    Invoke-RestMethod -Method Patch -Uri "$base/api/v1/users/me" -Headers $headers -Body $stale -ContentType "application/json" | Out-Null
    Assert-Fail "expected 409, got success"
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    $body = $_.ErrorDetails.Message | ConvertFrom-Json
    if ($status -eq 409 -and $body.error -eq "VERSION_CONFLICT") {
        Write-Host "       current_version=$($body.detail.current_version)"
        Assert-Ok "stale update -> 409 VERSION_CONFLICT"
    } else {
        Assert-Fail "expected 409 VERSION_CONFLICT, got $status $($body.error)"
    }
}

# ─── 6. Bob views alice's public profile ─────────────────────────
Write-Host ""
Write-Host "=== 6. Bob views alice's public profile ==="

$loginBob = @{ email = "bob@example.com"; password = "Str0ng!Passw0rd" } | ConvertTo-Json -Compress
$bobResp  = Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/login" -Body $loginBob -ContentType "application/json"
$bobToken = $bobResp.tokens.access_token

$alicePublic = Invoke-RestMethod -Method Get -Uri "$base/api/v1/users/$aliceId" -Headers @{ Authorization = "Bearer $bobToken" }
Write-Host "       display_name=$($alicePublic.display_name) visibility=$($alicePublic.visibility)"

$piiLeaked = @()
foreach ($f in @("dob", "phone", "address", "version")) {
    if ($alicePublic.PSObject.Properties.Name -contains $f) { $piiLeaked += $f }
}
if ($piiLeaked.Count -eq 0) {
    Assert-Ok "PII hidden from public profile"
} else {
    Assert-Fail "PII leaked: $($piiLeaked -join ', ')"
}

# ─── 7. Consent grant / list / revoke ────────────────────────────
Write-Host ""
Write-Host "=== 7. Consent grant / list / revoke ==="

$consentBody = @{ channel = "email_marketing" } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "$base/api/v1/users/me/consent" -Headers $headers -Body $consentBody -ContentType "application/json" | Out-Null
Assert-Ok "consent granted: email_marketing"

$list = Invoke-RestMethod -Method Get -Uri "$base/api/v1/users/me/consent" -Headers $headers
Write-Host "       consents count: $($list.consents.Count)"
Assert-Ok "consent list"

Invoke-RestMethod -Method Delete -Uri "$base/api/v1/users/me/consent/email_marketing" -Headers $headers | Out-Null
Assert-Ok "consent revoked"

# ─── 8. Logout ───────────────────────────────────────────────────
Write-Host ""
Write-Host "=== 8. Logout ==="

Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/logout" -Headers $headers | Out-Null
Assert-Ok "logged out"

# ─── 9. /me after logout -> 401 ──────────────────────────────────
Write-Host ""
Write-Host "=== 9. Post-logout /me -> 401 ==="

try {
    Invoke-RestMethod -Method Get -Uri "$base/api/v1/users/me" -Headers $headers | Out-Null
    Assert-Fail "expected 401 after logout"
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 401) { Assert-Ok "post-logout /me -> 401" }
    else { Assert-Fail "expected 401, got $status" }
}

Write-Host ""
Write-Host "=== Smoke test complete ===" -ForegroundColor Cyan
