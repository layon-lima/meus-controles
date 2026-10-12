' Instala o atalho deste clone Git na area de trabalho do usuario.
' Sem privilegios de administrador, sem terminal e sem alterar dados.
Option Explicit
Dim shell, fs, folder, desktop, target, launcher, ico, shortcut
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
folder = fs.GetParentFolderName(WScript.ScriptFullName)
launcher = folder & "\INICIAR_APP.vbs"
ico = folder & "\assets\CENTRAL_DE_CONTROLES.ico"
If Not fs.FileExists(launcher) Or Not fs.FileExists(ico) Then
    WScript.Quit 2
End If
desktop = shell.SpecialFolders("Desktop")
target = desktop & "\Central de Controles.lnk"
Set shortcut = shell.CreateShortcut(target)
shortcut.TargetPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"
shortcut.Arguments = Chr(34) & launcher & Chr(34)
shortcut.WorkingDirectory = folder
shortcut.IconLocation = ico & ",0"
shortcut.Description = "Central de Controles - abrir aplicativo"
shortcut.WindowStyle = 1
shortcut.Save
