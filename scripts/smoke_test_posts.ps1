# ═══════════════════════════════════════════════════════════════════
# Manual smoke test: posts + comments + likes
# Uses Invoke-RestMethod (PowerShell-idiomatic, not curl alias).
# Requires API running at http://localhost:8000.
# ═══════════════════════════════════════════════════════════════════

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

# ─── 1. Register writer ──────────────────────────────────────────
Write-Host ""
Write-Host "=== 1. Register writer ==="

$regBody = @{ email = "writer@example.com"; password = "Str0ng!Passw0rd" } | ConvertTo-Json -Compress

try {
    Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/register" `
        -Body $regBody -ContentType "application/json" | Out-Null
    Assert-Ok "writer registered"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 409) {
        Write-Host "[SKIP] writer already exists" -ForegroundColor Yellow
    } else {
        throw
    }
}

# ─── 2. Login writer ─────────────────────────────────────────────
Write-Host ""
Write-Host "=== 2. Login writer ==="

$loginBody = @{ email = "writer@example.com"; password = "Str0ng!Passw0rd" } | ConvertTo-Json -Compress
$loginResp = Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/login" `
    -Body $loginBody -ContentType "application/json"

$token   = $loginResp.tokens.access_token
$userId  = $loginResp.user.id

Write-Host "       writer id=$userId  token len=$($token.Length)"

$h = @{ Authorization = "Bearer $token" }

# ─── 3. Create post ──────────────────────────────────────────────
Write-Host ""
Write-Host "=== 3. Create post ==="

$postBody = @{ body = "Hello social!" } | ConvertTo-Json -Compress
$post = Invoke-RestMethod -Method Post -Uri "$base/api/v1/posts" `
    -Headers $h -Body $postBody -ContentType "application/json"

$postId = $post.id
Write-Host "       post id=$postId  body=$($post.body)  visibility=$($post.visibility)"
Assert-Ok "post created"

# ─── 4. List by author ───────────────────────────────────────────
Write-Host ""
Write-Host "=== 4. List by author ==="

$list = Invoke-RestMethod -Method Get `
    -Uri "$base/api/v1/posts/by-author/$userId`?limit=10" -Headers $h
Write-Host "       count=$($list.items.Count)  next_cursor=$($list.next_cursor)"
Assert-Ok "list by author"

# ─── 5. Comment ──────────────────────────────────────────────────
Write-Host ""
Write-Host "=== 5. Create comment ==="

$commentBody = @{ body = "first!" } | ConvertTo-Json -Compress
$comment = Invoke-RestMethod -Method Post `
    -Uri "$base/api/v1/posts/$postId/comments" `
    -Headers $h -Body $commentBody -ContentType "application/json"

Write-Host "       comment id=$($comment.id)  depth=$($comment.depth)  body=$($comment.body)"
Assert-Ok "comment created"

# ─── 6. List comments ────────────────────────────────────────────
Write-Host ""
Write-Host "=== 6. List comments ==="

$comments = Invoke-RestMethod -Method Get `
    -Uri "$base/api/v1/posts/$postId/comments`?limit=10" -Headers $h
Write-Host "       comment count=$($comments.items.Count)"
Assert-Ok "comments listed"

# ─── 7. Like the post ────────────────────────────────────────────
Write-Host ""
Write-Host "=== 7. Like the post ==="

Invoke-RestMethod -Method Post -Uri "$base/api/v1/likes/post/$postId" `
    -Headers $h | Out-Null
Assert-Ok "post liked"

# Idempotent double-like
Invoke-RestMethod -Method Post -Uri "$base/api/v1/likes/post/$postId" `
    -Headers $h | Out-Null
Assert-Ok "post liked again (idempotent)"

# ─── 8. Verify counters ──────────────────────────────────────────
Write-Host ""
Write-Host "=== 8. Verify counters ==="

$postAfter = Invoke-RestMethod -Method Get `
    -Uri "$base/api/v1/posts/$postId" -Headers $h
Write-Host "       like_count=$($postAfter.like_count)  comment_count=$($postAfter.comment_count)  is_liked_by_me=$($postAfter.is_liked_by_me)"

if ($postAfter.like_count -eq 1 -and $postAfter.comment_count -eq 1 -and $postAfter.is_liked_by_me -eq $true) {
    Assert-Ok "counters correct (1 like, 1 comment, liked_by_me=True)"
} else {
    Assert-Fail "counters unexpected: like_count=$($postAfter.like_count) comment_count=$($postAfter.comment_count) is_liked=$($postAfter.is_liked_by_me)"
}

# ─── 9. Unlike ───────────────────────────────────────────────────
Write-Host ""
Write-Host "=== 9. Unlike ==="

Invoke-RestMethod -Method Delete -Uri "$base/api/v1/likes/post/$postId" `
    -Headers $h | Out-Null
Assert-Ok "post unliked"

$postAfter2 = Invoke-RestMethod -Method Get `
    -Uri "$base/api/v1/posts/$postId" -Headers $h
Write-Host "       like_count=$($postAfter2.like_count)"

if ($postAfter2.like_count -eq 0) {
    Assert-Ok "like_count back to 0"
} else {
    Assert-Fail "like_count unexpected: $($postAfter2.like_count)"
}

Write-Host ""
Write-Host "=== Posts + comments + likes smoke test complete ===" -ForegroundColor Cyan
