' Central de Controles: abre SOMENTE o painel web, sem prompt de comando.
Option Explicit
Dim shell, fs, folder, panelFile, panelUrl, healthy, i, http, cmd, q
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
folder = fs.GetParentFolderName(WScript.ScriptFullName)
panelFile = folder & "\controller\server.py"
panelUrl = "http://127.0.0.1:18764/"
q = Chr(34)
If Not fs.FileExists(panelFile) Then
    MsgBox "Painel web nao encontrado. Atualize o repositorio meus-controles.", 48, "Central de Controles"
    WScript.Quit 1
End If
shell.CurrentDirectory = folder

Function PainelCorreto()
    Dim req
    PainelCorreto = False
    On Error Resume Next
    Set req = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    req.setTimeouts 650, 650, 650, 650
    req.open "GET", "http://127.0.0.1:18764/api/health", False
    req.send
    If Err.Number = 0 Then
        If req.Status = 200 Then
            If InStr(1, req.responseText, "br.com.layon.meus-controles.panel", 1) > 0 Then
                PainelCorreto = True
            End If
        End If
    End If
    Err.Clear
    On Error GoTo 0
End Function

healthy = PainelCorreto()
If Not healthy Then
    cmd = "pyw -3 " & q & panelFile & q & " --no-browser"
    On Error Resume Next
    shell.Run cmd, 0, False
    If Err.Number <> 0 Then
        Err.Clear
        shell.Run "pythonw " & q & panelFile & q & " --no-browser", 0, False
    End If
    On Error GoTo 0
    For i = 1 To 35
        WScript.Sleep 300
        healthy = PainelCorreto()
        If healthy Then Exit For
    Next
End If

If healthy Then
    shell.Run panelUrl, 1, False
Else
    MsgBox "Nao foi possivel iniciar o painel web da Central de Controles." & vbCrLf & _
           "A porta 18764 pode estar ocupada ou o Python nao foi encontrado." & vbCrLf & _
           "Nenhum outro aplicativo sera aberto no lugar.", 48, "Central de Controles"
End If
