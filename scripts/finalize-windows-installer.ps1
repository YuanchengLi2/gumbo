param(
 [Parameter(Mandatory=$true)][string]$BootstrapPath,
 [Parameter(Mandatory=$true)][string]$PackagePath,
 [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
if ([IntPtr]::Size -ne 8) { throw 'Installer resource embedding requires a 64-bit PowerShell process.' }
$dreamRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dreamMakeRoot = [IO.Path]::GetFullPath((Join-Path $dreamRoot 'apps/desktop/out/make'))
foreach ($dreamPath in @($BootstrapPath, $PackagePath, $OutputPath)) {
 $dreamAbsolute = [IO.Path]::GetFullPath($dreamPath)
 if (-not $dreamAbsolute.StartsWith($dreamMakeRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer inputs and output must stay in the make directory.' }
}
$dreamPackage = Get-Item -LiteralPath $PackagePath
$dreamReleasePath = Join-Path $dreamPackage.DirectoryName 'RELEASES'
$dreamRelease = (Get-Content -LiteralPath $dreamReleasePath | Where-Object { $_ -match ([regex]::Escape($dreamPackage.Name) + ' ') } | Select-Object -First 1) -split '\s+'
if ($dreamRelease.Count -ne 3 -or [long]$dreamRelease[2] -ne $dreamPackage.Length -or (Get-FileHash -LiteralPath $PackagePath -Algorithm SHA1).Hash -ne $dreamRelease[0]) { throw 'The release archive does not match RELEASES.' }
$dreamVendor = Join-Path $dreamRoot 'node_modules/electron-winstaller/vendor'
$dreamTemp = Join-Path $dreamPackage.DirectoryName ('payload-' + [guid]::NewGuid().ToString('N') + '.zip')
$dreamPartial = [IO.Path]::GetFullPath($OutputPath) + '.partial.exe'
Add-Type -AssemblyName System.IO.Compression
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class DreamInstallerResource {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr BeginUpdateResource(string path, bool deleteExisting);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool UpdateResource(IntPtr update, string type, IntPtr name, ushort language, IntPtr data, uint length);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool EndUpdateResource(IntPtr update, bool discard);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr LoadLibraryEx(string path, IntPtr file, uint flags);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr FindResourceEx(IntPtr module, string type, IntPtr name, ushort language);
 [DllImport("kernel32.dll", SetLastError=true)] static extern uint SizeofResource(IntPtr module, IntPtr resource);
 [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr module);
 public static void Embed(string setup, string archive) {
  long length=new FileInfo(archive).Length;
  if(length<=0 || length>uint.MaxValue) throw new Exception("Installer payload exceeds the PE resource format limit.");
  using(var map=MemoryMappedFile.CreateFromFile(archive,FileMode.Open,null,0,MemoryMappedFileAccess.Read))
  using(var view=map.CreateViewAccessor(0,0,MemoryMappedFileAccess.Read)) {
   var update=BeginUpdateResource(setup,false);if(update==IntPtr.Zero)throw new Win32Exception();
   bool committed=false;
   try {if(!UpdateResource(update,"DATA",new IntPtr(131),0x0409,view.SafeMemoryMappedViewHandle.DangerousGetHandle(),(uint)length))throw new Win32Exception();if(!EndUpdateResource(update,false))throw new Win32Exception();committed=true;}
   finally {if(!committed)EndUpdateResource(update,true);}
  }
  var module=LoadLibraryEx(setup,IntPtr.Zero,2);if(module==IntPtr.Zero)throw new Win32Exception();
  try {var resource=FindResourceEx(module,"DATA",new IntPtr(131),0x0409);if(resource==IntPtr.Zero||SizeofResource(module,resource)!=(uint)length)throw new Exception("Embedded installer payload verification failed.");}
  finally {FreeLibrary(module);}
 }
}
'@
try {
 $dreamStream = [IO.File]::Open($dreamTemp, [IO.FileMode]::CreateNew)
 $dreamZip = [IO.Compression.ZipArchive]::new($dreamStream, [IO.Compression.ZipArchiveMode]::Create, $false)
 try {
  $dreamInputs = @(
   @{Path=$PackagePath;Name=$dreamPackage.Name},
   @{Path=$dreamReleasePath;Name='RELEASES'},
   @{Path=(Join-Path $dreamVendor 'Squirrel.exe');Name='Update.exe'},
   @{Path=(Join-Path $dreamRoot 'node_modules/electron-winstaller/resources/install-spinner.gif');Name='background.gif'}
  )
  foreach ($dreamInput in $dreamInputs) {
   $dreamEntry = $dreamZip.CreateEntry($dreamInput.Name, [IO.Compression.CompressionLevel]::NoCompression)
   $dreamInputStream = [IO.File]::OpenRead($dreamInput.Path)
   $dreamEntryStream = $dreamEntry.Open()
   try { $dreamInputStream.CopyTo($dreamEntryStream) } finally { $dreamEntryStream.Dispose(); $dreamInputStream.Dispose() }
  }
 } finally { $dreamZip.Dispose(); $dreamStream.Dispose() }
 Copy-Item -LiteralPath $BootstrapPath -Destination $dreamPartial
 [DreamInstallerResource]::Embed($dreamPartial,$dreamTemp)
 & (Join-Path $dreamVendor '7z-x64.exe') t $dreamPartial | Out-Null
 if ($LASTEXITCODE -ne 0) { throw 'The embedded installer archive failed CRC validation.' }
 Move-Item -LiteralPath $dreamPartial -Destination $OutputPath -Force
 Write-Output ('Verified full Windows installer: ' + $OutputPath)
} finally {
 foreach ($dreamOwned in @($dreamTemp,$dreamPartial)) { if (Test-Path -LiteralPath $dreamOwned) { Remove-Item -LiteralPath $dreamOwned } }
}
