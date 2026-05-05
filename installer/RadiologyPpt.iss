#define AppName "Radiopaedia Case PowerPoint Builder"
#ifndef AppVersion
#define AppVersion "0.2.2"
#endif
#ifndef SourceDir
#define SourceDir "..\dist\installer-package"
#endif
#ifndef OutputDir
#define OutputDir "..\dist\installer"
#endif

[Setup]
AppId={{4A0FD422-8C72-43F1-AB1C-56AC8549A8BD}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=funwithcthulhu/radiology-ppt
AppPublisherURL=https://github.com/funwithcthulhu/radiology-ppt
AppSupportURL=https://github.com/funwithcthulhu/radiology-ppt/issues
AppUpdatesURL=https://github.com/funwithcthulhu/radiology-ppt/releases
DefaultDirName={localappdata}\Programs\Radiopaedia Case PowerPoint Builder
DefaultGroupName=Radiopaedia Case PowerPoint Builder
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
OutputDir={#OutputDir}
OutputBaseFilename=Radiopaedia-Case-PowerPoint-Builder-Setup-v{#AppVersion}
SetupIconFile={#SourceDir}\app-icon.ico
UninstallDisplayIcon={app}\app-icon.ico
LicenseFile={#SourceDir}\LICENSE
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Radiopaedia Case PowerPoint Builder"; Filename: "{app}\Radiopaedia Case PowerPoint Builder.exe"; WorkingDir: "{app}"; IconFilename: "{app}\app-icon.ico"
Name: "{autodesktop}\Radiopaedia Case PowerPoint Builder"; Filename: "{app}\Radiopaedia Case PowerPoint Builder.exe"; WorkingDir: "{app}"; IconFilename: "{app}\app-icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\Radiopaedia Case PowerPoint Builder.exe"; Description: "Launch Radiopaedia Case PowerPoint Builder"; Flags: nowait postinstall skipifsilent
