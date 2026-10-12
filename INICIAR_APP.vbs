' Abre a Central de Controles DIRETAMENTE, sem exibir terminal.
' Se necessario inicia o painel local, que inicia o aplicativo.
Option Explicit
Dim shell, fs, folder, panelFile, panelURL, appURL, q, cmd, i, req, panelOk, appOk
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
folder = fs.GetParentFolderName(WScript.ScriptFullName)
panelFile = folder & "\controller\server.py"
panelURL = "http://127.0.0.1:18764"
appURL = "http://127.0.0.1:18765"
q = Chr(34)
If Not fs.FileExists(panelFile) Then
    MsgBox "O painel da Central de Controles nao foi encontrado.", 48, "Central de Controles"
    WScript.Quit 1
End If
shell.CurrentDirectory = folder

Function ServicoCorreto(url, id)
    Dim req
    ServicoCorreto = False
    On Error Resume Next
    Set req = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    req.setTimeouts 800, 800, 800, 800
    req.open "GET", url & "/api/health", False
    req.send
    If Err.Number = 0 Then
        If req.Status = 200 Then
            If InStr(1, req.responseText, Chr(34) & id & Chr(34), vbTextCompare) > 0 Then
                ServicoCorreto = True
            End If
        End If
    End If
    Err.Clear
    On Error GoTo 0
End Function

appOk = ServicoCorreto(appURL, "br.com.layon.meus-controles")
If Not appOk Then
    panelOk = ServicoCorreto(panelURL, "br.com.layon.meus-controles.panel")
    If Not panelOk Then
        cmd = "pyw -3 " & q & panelFile & q & " --no-browser"
        On Error Resume Next
        shell.Run cmd, 0, False
        If Err.Number <> 0 Then
            Err.Clear
            shell.Run "pythonw " & q & panelFile & q & " --no-browser", 0, False
        End If
        On Error GoTo 0
        For i = 1 To 40
            WScript.Sleep 300
            panelOk = ServicoCorreto(panelURL, "br.com.layon.meus-controles.panel")
            If panelOk Then Exit For
        Next
    End If
    If panelOk Then
        appOk = ServicoCorreto(appURL, "br.com.layon.meus-controles")
        If Not appOk Then
            On Error Resume Next
            Set req = CreateObject("MSXML2.ServerXMLHTTP.6.0")
            req.setTimeouts 1000, 1000, 3000, 3000
            req.open "POST", panelURL & "/api/start", False
            req.setRequestHeader "X-Central-Panel", "1"
            req.setRequestHeader "Content-Type", "application/json"
            req.send "{}"
            Err.Clear
            On Error GoTo 0
        End If
        For i = 1 To 40
            WScript.Sleep 300
            appOk = ServicoCorreto(appURL, "br.com.layon.meus-controles")
            If appOk Then Exit For
        Next
    End If
End If

If appOk Then
    shell.Run appURL & "/", 1, False
Else
    MsgBox "Nao foi possivel abrir a Central de Controles. Verifique se o Python esta instalado e se as portas 18764 e 18765 estao livres.", 48, "Central de Controles"
End If
