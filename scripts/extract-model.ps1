param([switch]$Check)
$ErrorActionPreference = 'Stop'
# Keep the existing maintenance command compatible with the current schema.
$generator = Join-Path $PSScriptRoot 'generate-model.mjs'
if ($Check) { & node $generator --check } else { & node $generator }
if ($LASTEXITCODE -ne 0) { throw 'Model generation or verification failed.' }
