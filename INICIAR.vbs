' Abre a Central de Controles sem exibir janela de terminal.
Option Explicit
Dim shell, fs, pasta, cmd
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
pasta = fs.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = pasta
cmd = "pyw -3 " & Chr(34) & pasta & "\painel.py" & Chr(34)
shell.Run cmd, 0, False
