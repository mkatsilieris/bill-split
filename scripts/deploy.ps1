# Deploys the last commit to the Raspberry Pi.
#   .\scripts\deploy.ps1
# Needs the "billsplit-pi" host in ~/.ssh/config (see README, section "Αυτόματο deploy").
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (git status --porcelain) {
  Write-Warning 'Υπάρχουν αλλαγές χωρίς commit. Ανεβαίνει μόνο το τελευταίο commit.'
}

$tmp = Join-Path $env:TEMP 'billsplit-deploy.tar.gz'
git archive --format=tar.gz -o $tmp HEAD
# Windows PowerShell corrupts binary data in native pipes, so feed the archive through cmd.
cmd /c "ssh billsplit-pi deploy < `"$tmp`""
$code = $LASTEXITCODE
Remove-Item $tmp -ErrorAction SilentlyContinue
if ($code -eq 0) { Write-Host 'Deploy OK: http://ninblack-pi.local:8080' -ForegroundColor Green }
exit $code
