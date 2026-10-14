# Register this checkout on the user's PATH; no app copy or admin rights needed.
$ErrorActionPreference = 'Stop'
$bishopDirectory = $PSScriptRoot
$bishopUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$bishopEntries = @($bishopUserPath -split ';' | Where-Object { $_ })
if (-not ($bishopEntries | Where-Object { $_.TrimEnd('\') -ieq $bishopDirectory.TrimEnd('\') })) {
    $bishopNewPath = (@($bishopEntries) + $bishopDirectory) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $bishopNewPath, 'User')
}
if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $bishopDirectory.TrimEnd('\') })) {
    $env:Path += ";$bishopDirectory"
}
Write-Host 'Bishop registered. Run bishop chat. Existing terminals may need to be reopened.'
