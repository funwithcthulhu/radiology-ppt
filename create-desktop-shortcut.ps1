$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Radiopaedia Case PowerPoint Builder.lnk"
$csharpExe = Join-Path $projectRoot "dist\Radiopaedia Case PowerPoint Builder\Radiopaedia Case PowerPoint Builder.exe"

if (-not (Test-Path $csharpExe)) {
  throw "Packaged C# app was not found. Run build-csharp-app.ps1 first: $csharpExe"
}

$targetPath = $csharpExe
$arguments = ""
$workingDirectory = Split-Path -Parent $csharpExe
$iconLocation = "$csharpExe,0"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $workingDirectory
$shortcut.IconLocation = $iconLocation
$shortcut.Description = "Launch the Radiopaedia Case PowerPoint Builder desktop GUI."
$shortcut.Save()

Write-Output $shortcutPath
