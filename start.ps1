# Convenience launcher for this Windows workspace. No installs or configuration changes.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$BishopArguments)
$ErrorActionPreference = 'Stop'
$bishopNode = Get-Command node -ErrorAction SilentlyContinue
if ($bishopNode) { $bishopNodePath = $bishopNode.Source }
else {
    $bishopNodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (-not (Test-Path -LiteralPath $bishopNodePath)) { throw 'Install Node.js 24 or later, then run npm start.' }
}
& $bishopNodePath (Join-Path $PSScriptRoot 'app\cli.ts') @BishopArguments
exit $LASTEXITCODE
