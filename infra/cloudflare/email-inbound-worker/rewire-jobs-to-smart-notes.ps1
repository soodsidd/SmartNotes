# Finish jobs@ -> Smart Notes Job Inbox cutover.
# Prerequisites: `npx wrangler login` (or CLOUDFLARE_API_TOKEN with
# workers:write + email_routing:write + zone:read).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "== Deploy smart-notes-email-inbound (accepts notes@ + jobs@) =="
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { throw "wrangler deploy failed" }

$zoneName = "lucidrss.com"
$jobsAddr = "jobs@lucidrss.com"
$workerName = "smart-notes-email-inbound"
$token = $env:CLOUDFLARE_API_TOKEN
if (-not $token) {
  $cfg = Get-Content "$env:APPDATA\xdg.config\.wrangler\config\default.toml" -Raw
  if ($cfg -match 'oauth_token\s*=\s*"([^"]+)"') { $token = $Matches[1] }
}
if (-not $token) { throw "No Cloudflare token after deploy. Run: npx wrangler login" }

$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
Write-Host "== Rewire Email Routing $jobsAddr -> $workerName =="
$zones = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones?name=$zoneName" -Headers $headers
if (-not $zones.success -or -not $zones.result[0].id) { throw "Zone $zoneName not found / unauthorized" }
$zoneId = $zones.result[0].id
$rules = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/email/routing/rules" -Headers $headers
$jobs = @($rules.result | Where-Object { ($_.matchers | ForEach-Object { $_.value }) -contains $jobsAddr })
Write-Host ("Found {0} jobs@ rule(s)" -f $jobs.Count)
foreach ($rule in $jobs) {
  $body = @{
    name = if ($rule.name) { $rule.name } else { "Smart Notes Job Inbox (jobs@)" }
    enabled = $true
    matchers = $rule.matchers
    actions = @(@{ type = "worker"; value = @($workerName) })
  } | ConvertTo-Json -Depth 6
  $updated = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/email/routing/rules/$($rule.id)" -Method Put -Headers $headers -Body $body
  if (-not $updated.success) { throw ("Update failed for rule {0}: {1}" -f $rule.id, ($updated | ConvertTo-Json -Depth 6)) }
  Write-Host ("Updated rule {0} -> {1}" -f $rule.id, $workerName)
}
if ($jobs.Count -eq 0) {
  $create = @{
    name = "Smart Notes Job Inbox (jobs@)"
    enabled = $true
    matchers = @(@{ type = "literal"; field = "to"; value = $jobsAddr })
    actions = @(@{ type = "worker"; value = @($workerName) })
  } | ConvertTo-Json -Depth 6
  $created = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/email/routing/rules" -Method Post -Headers $headers -Body $create
  if (-not $created.success) { throw ("Create failed: {0}" -f ($created | ConvertTo-Json -Depth 6)) }
  Write-Host "Created jobs@ rule"
}
Write-Host "Done. Forward a job email to jobs@lucidrss.com and confirm Career Job Inbox."
