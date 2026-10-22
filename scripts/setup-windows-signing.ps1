# Installs what apps/desktop/sign-windows.ts signs with, per user and without admin, into DREAM_SIGN_TOOLS
# (default %LOCALAPPDATA%\GumboSigning): Microsoft's Artifact Signing client (signtool's /dlib), the .NET 8 runtime it
# needs, and a portable Azure CLI it signs in through. Then `az login` to the signing account's tenant: the account
# signing in needs the "Artifact Signing Certificate Profile Signer" role on gumbo-signing. Run again to sign in again.
#   powershell -ExecutionPolicy Bypass -File scripts/setup-windows-signing.ps1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$tools = if ($env:DREAM_SIGN_TOOLS) { $env:DREAM_SIGN_TOOLS } else { Join-Path $env:LOCALAPPDATA 'GumboSigning' }
$tenant = 'aixueliugmail.onmicrosoft.com'
New-Item -ItemType Directory -Force $tools | Out-Null

if (-not (Test-Path (Join-Path $tools 'client\bin\x64\Azure.CodeSigning.Dlib.dll'))) {
 $version = '1.0.146'
 Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.artifactsigning.client/$version/microsoft.artifactsigning.client.$version.nupkg" -OutFile (Join-Path $tools 'client.zip')
 Expand-Archive (Join-Path $tools 'client.zip') (Join-Path $tools 'client') -Force
}
if (-not (Test-Path (Join-Path $tools 'dotnet\shared\Microsoft.NETCore.App'))) {
 Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile (Join-Path $tools 'dotnet-install.ps1')
 & (Join-Path $tools 'dotnet-install.ps1') -Channel 8.0 -Runtime dotnet -InstallDir (Join-Path $tools 'dotnet') -NoPath
}
$az = Join-Path $tools 'az\bin\az.cmd'
# python.exe, not az.cmd: an unzip stopped partway leaves the launcher without the Python it runs.
if (-not (Test-Path (Join-Path $tools 'az\python.exe'))) {
 Invoke-WebRequest 'https://aka.ms/installazurecliwindowszipx64' -OutFile (Join-Path $tools 'azcli.zip')
 Expand-Archive (Join-Path $tools 'azcli.zip') (Join-Path $tools 'az') -Force
}
Write-Output 'Sign in with the Microsoft account that owns gumbo-signing (a browser window opens).'
& $az login --tenant $tenant --allow-no-subscriptions
& $az account show --query user.name -o tsv
