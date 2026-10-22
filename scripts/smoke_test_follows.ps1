# scripts/smoke_test_follows.ps1
# Manual smoke test: follows graph end-to-end.
# Uses Invoke-RestMethod (PowerShell-idiomatic, not curl alias).
# Requires API running at http://localhost:8000.

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
Write-Host "=== 1. Register alice + bob ==="

$regA = @{ email = "alice@follow.com"; password = "Str0ng!Passw0rd" } | ConvertTo-Json -Compress
$regB = @{ email = "bob@follow.com";   password = "Str0ng!Passw0rd" } | ConvertTo-Json -Compress

foreach ($pair in @(@{label="alice"; body=$regA}, @{label="bob"; body=$regB})) {
    try {
        Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/register" `
            -Body $pair.body -ContentType "application/json" | Out-Null
        Assert-Ok "$($pair.label) registered"
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -eq 409) {
            Write-Host "[SKIP] $($pair.label) already exists" -ForegroundColor Yellow
        } else {
            throw
        }
    }
}

# ─── 2. Login both ───────────────────────────────────────────────
Write-Host ""
Write-Host "=== 2. Login ==="

$loginA = @{ email = "alice@follow.com"; password = "Str0ng!Passw0rd" } | ConvertTo-Json -Compress
$loginB = @{ email = "bob@follow.com";   password = "Str0ng!Passw0rd" } | ConvertTo-Json -Compress

$alice = Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/login" `
    -Body $loginA -ContentType "application/json"
$bob = Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/login" `
    -Body $loginB -ContentType "application/json"

$aliceId      = $alice.user.id
$aliceToken   = $alice.tokens.access_token
$bobId        = $bob.user.id
$bobToken     = $bob.tokens.access_token

Write-Host "       alice id=$aliceId  token len=$($aliceToken.Length)"
Write-Host "       bob   id=$bobId    token len=$($bobToken.Length)"
Assert-Ok "both logged in"

$ha = @{ Authorization = "Bearer $aliceToken" }
$hb = @{ Authorization = "Bearer $bobToken" }

# ─── 3. Alice follows Bob ────────────────────────────────────────
Write-Host ""
Write-Host "=== 3. Alice follows Bob ==="

Invoke-RestMethod -Method Post -Uri "$base/api/v1/follows/$bobId" -Headers $ha | Out-Null
Assert-Ok "alice -> bob follow (first)"

# Idempotent: follow again should still 204
Invoke-RestMethod -Method Post -Uri "$base/api/v1/follows/$bobId" -Headers $ha | Out-Null
Assert-Ok "alice -> bob follow (idempotent 2nd)"

# ─── 4. Status check ─────────────────────────────────────────────
Write-Host ""
Write-Host "=== 4. Follow status ==="

$status = Invoke-RestMethod -Method Get `
    -Uri "$base/api/v1/users/$bobId/follow-status" -Headers $ha
Write-Host "       is_following=$($status.is_following)  is_followed_by=$($status.is_followed_by)"
if ($status.is_following -eq $true -and $status.is_followed_by -eq $false) {
    Assert-Ok "status: following=true followed_by=false"
} else {
    Assert-Fail "status unexpected"
}

# ─── 5. Bob's followers list ────────────────────────────────────
Write-Host ""
Write-Host "=== 5. Bob's followers ==="

$followers = Invoke-RestMethod -Method Get `
    -Uri "$base/api/v1/users/$bobId/followers" -Headers $hb
Write-Host "       count=$($followers.items.Count)"
if ($followers.items.Count -eq 1 -and [int]$followers.items[0].user_id -eq [int]$aliceId) {
    Assert-Ok "bob's followers list contains alice"
} else {
    Assert-Fail "followers list unexpected: $($followers | ConvertTo-Json -Depth 4)"
}

# ─── 6. Counts ───────────────────────────────────────────────────
Write-Host ""
Write-Host "=== 6. Bob's follow counts ==="

$counts = Invoke-RestMethod -Method Get `
    -Uri "$base/api/v1/users/$bobId/follow-counts" -Headers $hb
Write-Host "       followers=$($counts.followers)  following=$($counts.following)"
if ($counts.followers -eq 1 -and $counts.following -eq 0) {
    Assert-Ok "counts: followers=1 following=0"
} else {
    Assert-Fail "counts unexpected"
}

# ─── 7. Unfollow ─────────────────────────────────────────────────
Write-Host ""
Write-Host "=== 7. Alice unfollows Bob ==="

Invoke-RestMethod -Method Delete -Uri "$base/api/v1/follows/$bobId" -Headers $ha | Out-Null
Assert-Ok "alice -> bob unfollow"

$status2 = Invoke-RestMethod -Method Get `
    -Uri "$base/api/v1/users/$bobId/follow-status" -Headers $ha
if ($status2.is_following -eq $false) {
    Assert-Ok "status after unfollow: is_following=false"
} else {
    Assert-Fail "still following after unfollow"
}

# ─── 8. Block (silently unfollows) ──────────────────────────────
Write-Host ""
Write-Host "=== 8. Block silently unfollows ==="

# Re-follow both ways
Invoke-RestMethod -Method Post -Uri "$base/api/v1/follows/$bobId" -Headers $ha | Out-Null
Invoke-RestMethod -Method Post -Uri "$base/api/v1/follows/$aliceId" -Headers $hb | Out-Null
Assert-Ok "mutual follows re-established"

# Alice blocks Bob
Invoke-RestMethod -Method Post -Uri "$base/api/v1/blocks/$bobId" -Headers $ha | Out-Null
Assert-Ok "alice blocks bob"

$status3 = Invoke-RestMethod -Method Get `
    -Uri "$base/api/v1/users/$bobId/follow-status" -Headers $ha
if ($status3.is_following -eq $false -and $status3.is_blocked_by_me -eq $true) {
    Assert-Ok "post-block: is_following=false is_blocked_by_me=true"
} else {
    Assert-Fail "post-block state unexpected"
}

# Bob tries to follow back -> 403 USER_BLOCKED
try {
    Invoke-RestMethod -Method Post -Uri "$base/api/v1/follows/$aliceId" -Headers $hb | Out-Null
    Assert-Fail "expected 403, got success"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $err = $_.ErrorDetails.Message | ConvertFrom-Json
    if ($code -eq 403 -and $err.error -eq "USER_BLOCKED") {
        Assert-Ok "bob follow alice blocked: 403 USER_BLOCKED"
    } else {
        Assert-Fail "expected 403 USER_BLOCKED, got $code $($err.error)"
    }
}

Write-Host ""
Write-Host "=== Follows smoke test complete ===" -ForegroundColor Cyan
