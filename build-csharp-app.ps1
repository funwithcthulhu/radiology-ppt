$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectFile = Join-Path $projectRoot "csharp\RadiologyPpt.App\RadiologyPpt.App.csproj"
$publishDir = Join-Path $projectRoot "dist\Radiopaedia Case PowerPoint Builder"

if (-not (Test-Path $projectFile)) {
  throw "C# project file not found: $projectFile"
}

$resolvedProjectRoot = (Resolve-Path $projectRoot).Path
$resolvedDistRoot = Join-Path $resolvedProjectRoot "dist"
$resolvedPublishDir = [System.IO.Path]::GetFullPath($publishDir)

if (-not $resolvedPublishDir.StartsWith($resolvedDistRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to clean unexpected publish directory: $resolvedPublishDir"
}

if (Test-Path $resolvedPublishDir) {
  Remove-Item -LiteralPath $resolvedPublishDir -Recurse -Force
}

dotnet publish $projectFile `
  --configuration Release `
  --runtime win-x64 `
  --self-contained false `
  --output $resolvedPublishDir

$exePath = Join-Path $resolvedPublishDir "Radiopaedia Case PowerPoint Builder.exe"
if (-not (Test-Path $exePath)) {
  throw "Publish completed but the executable was not found: $exePath"
}

Write-Output $exePath
