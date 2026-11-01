# Replaces the e-mail allowlist of the Cloudflare Access policy that protects Bill Split.
#   $env:CLOUDFLARE_API_TOKEN = "..."     (token with "Access: Apps and Policies: Edit")
#   scripts/access-allowlist.ps1 -Emails a@example.com, b@example.com
# Works with Windows PowerShell 5.1: keep this file ASCII-only.
param(
    [Parameter(Mandatory = $true)][string[]]$Emails,
    [string]$AccountId = "bbc0910c94d3beefe9e168b4c8279fd7",
    [string]$Hostname = "bills.ninblack.com",
    [string]$PolicyName = "Family"
)
$ErrorActionPreference = "Stop"
if (-not $env:CLOUDFLARE_API_TOKEN) { throw "Set CLOUDFLARE_API_TOKEN first" }
$base = "https://api.cloudflare.com/client/v4/accounts/$AccountId/access"
$headers = @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN"; "Content-Type" = "application/json" }

$apps = (Invoke-RestMethod -Uri "$base/apps" -Headers $headers).result
$app = $apps | Where-Object { $_.domain -eq $Hostname } | Select-Object -First 1
if (-not $app) { throw "No Access application found for $Hostname" }

$policies = (Invoke-RestMethod -Uri "$base/apps/$($app.id)/policies" -Headers $headers).result
$policy = $policies | Where-Object { $_.name -eq $PolicyName } | Select-Object -First 1
if (-not $policy) { throw "No policy named '$PolicyName' on application '$($app.name)'" }

$include = @()
foreach ($e in $Emails) { $include += @{ email = @{ email = $e.Trim().ToLower() } } }
$body = @{ name = $policy.name; decision = "allow"; include = $include; exclude = @(); require = @() } | ConvertTo-Json -Depth 6
$r = Invoke-RestMethod -Method Put -Uri "$base/apps/$($app.id)/policies/$($policy.id)" -Headers $headers -Body $body
Write-Host ("Allowlist of '{0}' is now: {1}" -f $PolicyName, (($r.result.include | ForEach-Object { $_.email.email }) -join ", "))
