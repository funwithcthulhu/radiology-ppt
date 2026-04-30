$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Radiopaedia Case PowerPoint Builder.lnk"
$packagedExe = Join-Path $projectRoot "dist\Radiopaedia Case PowerPoint Builder\Radiopaedia Case PowerPoint Builder.exe"

if (Test-Path $packagedExe) {
  $targetPath = $packagedExe
  $arguments = ""
  $workingDirectory = Split-Path -Parent $packagedExe
  $iconLocation = "$packagedExe,0"
} else {
  $pythonwCommand = Get-Command pythonw -ErrorAction SilentlyContinue
  $pythonw = if ($pythonwCommand) { $pythonwCommand.Source } else { $null }
  if (-not $pythonw) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    $pythonw = if ($pythonCommand) { $pythonCommand.Source } else { $null }
  }

  if (-not $pythonw) {
    throw "Python was not found. Install Python or build the packaged app first."
  }

  $targetPath = $pythonw
  $arguments = "`"$projectRoot\gui_app.py`""
  $workingDirectory = $projectRoot
  $iconLocation = "$pythonw,0"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $workingDirectory
$shortcut.IconLocation = $iconLocation
$shortcut.Description = "Launch the Radiopaedia Case PowerPoint Builder desktop GUI."
$shortcut.Save()

Write-Output $shortcutPath
