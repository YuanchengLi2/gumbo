$dreamRoot = Split-Path -Parent $PSScriptRoot
$dreamManifest = Get-Content -LiteralPath (Join-Path $dreamRoot 'apps/desktop/resources/models-manifest.json') -Raw | ConvertFrom-Json
$dreamRuntime = $dreamManifest.runtime.'win32-x64'
$dreamDestination = Join-Path $dreamRoot 'apps/desktop/resources/staged/whisper'
$dreamArchive = Join-Path $dreamRoot 'artifacts/whisper-b5130.zip'
New-Item -ItemType Directory -Force -Path $dreamDestination | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri $dreamRuntime.url -OutFile $dreamArchive
if ((Get-FileHash -LiteralPath $dreamArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $dreamRuntime.sha256) { throw 'Whisper runtime checksum mismatch.' }
Expand-Archive -LiteralPath $dreamArchive -DestinationPath $dreamDestination -Force
Write-Output 'Pinned Whisper CPU runtime staged.'
