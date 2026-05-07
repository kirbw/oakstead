; Oakstead Windows installer script for Inno Setup 6.
; Build after running: npm run prepare:windows

#define AppName "Oakstead"
#ifndef AppVersion
#define AppVersion "0.0.8"
#endif

[Setup]
AppId={{70F3A9AA-2E05-49FA-A321-20F6D1C56D5A}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Oakstead
AppPublisherURL=https://github.com/kirbw/oakstead
AppSupportURL=https://github.com/kirbw/oakstead/issues
AppUpdatesURL=https://github.com/kirbw/oakstead/releases
DefaultDirName={autopf}\Oakstead
DefaultGroupName=Oakstead
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
OutputDir=..\..\dist\windows\installer
OutputBaseFilename=Oakstead-Setup-v{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"
Name: firewall; Description: "Allow Oakstead through Windows Firewall for LAN access on TCP port 3000"; GroupDescription: "Network:"; Flags: checkedonce

[Dirs]
Name: "{commonappdata}\Oakstead"; Permissions: users-modify
Name: "{commonappdata}\Oakstead\backups"; Permissions: users-modify
Name: "{commonappdata}\Oakstead\uploads"; Permissions: users-modify
Name: "{commonappdata}\Oakstead\logs"; Permissions: users-modify

[Files]
Source: "..\..\dist\windows\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\dist\windows\runtime\node\*"; DestDir: "{app}\runtime\node"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\dist\windows\runtime\sqlite\*"; DestDir: "{app}\runtime\sqlite"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\dist\windows\service\Oakstead.Service.exe"; DestDir: "{app}\service"; Flags: ignoreversion
Source: "..\..\dist\windows\service\Oakstead.Service.xml"; DestDir: "{app}\service"; Flags: ignoreversion
Source: "..\..\dist\windows\open-oakstead.cmd"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Oakstead"; Filename: "{app}\open-oakstead.cmd"; WorkingDir: "{app}"
Name: "{commondesktop}\Oakstead"; Filename: "{app}\open-oakstead.cmd"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\service\Oakstead.Service.exe"; Parameters: "install"; WorkingDir: "{app}\service"; Flags: runhidden waituntilterminated
Filename: "{cmd}"; Parameters: "/C netsh advfirewall firewall delete rule name=""Oakstead"""; Flags: runhidden waituntilterminated ignoreerrors; Tasks: firewall
Filename: "{cmd}"; Parameters: "/C netsh advfirewall firewall add rule name=""Oakstead"" dir=in action=allow protocol=TCP localport=3000"; Flags: runhidden waituntilterminated; Tasks: firewall
Filename: "{app}\service\Oakstead.Service.exe"; Parameters: "start"; WorkingDir: "{app}\service"; Flags: runhidden waituntilterminated
Filename: "{app}\open-oakstead.cmd"; Description: "Open Oakstead"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{app}\service\Oakstead.Service.exe"; Parameters: "stop"; WorkingDir: "{app}\service"; Flags: runhidden waituntilterminated ignoreerrors
Filename: "{app}\service\Oakstead.Service.exe"; Parameters: "uninstall"; WorkingDir: "{app}\service"; Flags: runhidden waituntilterminated ignoreerrors
Filename: "{cmd}"; Parameters: "/C netsh advfirewall firewall delete rule name=""Oakstead"""; Flags: runhidden waituntilterminated ignoreerrors

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  ServiceExe: String;
begin
  ServiceExe := ExpandConstant('{app}\service\Oakstead.Service.exe');
  if FileExists(ServiceExe) then
  begin
    Exec(ServiceExe, 'stop', ExpandConstant('{app}\service'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec(ServiceExe, 'uninstall', ExpandConstant('{app}\service'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
  Result := '';
end;
