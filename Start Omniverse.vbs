' Starts the Omniverse in the system tray, with no console window.
' The server keeps running until you choose Exit in the tray menu.
' "/nobrowser" (used by Start with Windows) starts it without opening the city.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
extra = ""
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "/nobrowser" Then extra = " -NoBrowser"
End If
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\tray\omniverse-tray.ps1""" & extra, 0, False
