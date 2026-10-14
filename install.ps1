# Install Bishop in this folder. Prerequisites remain managed by their owners.
[CmdletBinding()]
param([switch]$NoPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

try {
    if ($env:OS -ne 'Windows_NT') { throw 'This installer supports Windows. See INSTALLATION.md.' }
    foreach ($bishopFile in @('package.json', 'package-lock.json', 'app/cli.ts', 'app/providers/codex-path.ts', 'app/providers/codex-login.ts', 'config/bishop.toml', 'bishop.cmd', 'start.ps1', 'install-command.ps1')) {
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $bishopFile) -PathType Leaf)) {
            throw "Missing $bishopFile. Extract the complete Bishop download before running this installer."
        }
    }

    Write-Host 'Checking Node.js and npm...'
    $bishopNode = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    if (-not $bishopNode) { throw 'Install Node.js 24 or newer, including npm, from https://nodejs.org/en/download. Reopen your terminal and rerun the installer.' }
    $bishopVersion = & $bishopNode.Source --version
    if ($LASTEXITCODE -ne 0 -or "$bishopVersion" -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) {
        throw 'Bishop requires Node.js 24 or newer. Update Node.js, reopen your terminal, and rerun the installer.'
    }
    $bishopNpm = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue
    if (-not $bishopNpm) { throw 'npm was not found. Install Node.js with npm enabled, reopen your terminal, and rerun the installer.' }

    Push-Location -LiteralPath $PSScriptRoot
    try {
        Write-Host 'Checking the existing Codex ChatGPT login...'
        $bishopLoginCheck = @'
import { findCodex } from './app/providers/codex-path.ts';
import { requireChatGPTLogin } from './app/providers/codex-login.ts';
try {
  await requireChatGPTLogin(findCodex());
  console.log('Codex ChatGPT login is ready.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
'@
        & $bishopNode.Source --input-type=module --eval $bishopLoginCheck
        if ($LASTEXITCODE -ne 0) { throw 'The Codex prerequisite check failed. Resolve the message above, then rerun the installer.' }

        Write-Host 'Installing Bishop dependencies...'
        & $bishopNpm.Source ci --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your internet connection and npm output, then rerun the installer.' }

        if (-not $NoPath) { & (Join-Path $PSScriptRoot 'install-command.ps1') }
    } finally { Pop-Location }

    Write-Host ''
    Write-Host 'Bishop installation complete.'
    if ($NoPath) { Write-Host 'Start from this folder with: .\bishop.cmd chat' }
    else { Write-Host 'Open a new terminal and run: bishop chat' }
    Write-Host 'First launch begins personal onboarding. Existing settings and memories are preserved.'
} catch {
    Write-Host ("Installation stopped: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
