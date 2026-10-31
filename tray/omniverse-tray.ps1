# Omniverse tray (Windows): starts the server in the background with no
# console window, puts the diamond in the system tray, and keeps the server
# running - restarting it if it crashes - until you choose Exit in the tray
# menu. Closing the browser does not stop it.
#
#   Start:  double-click "Start Omniverse.vbs" in the app folder, or: npm run tray
#   Menu:   right-click the diamond. Left-click opens the city.
#
# The server log goes to data\server.log. Plain ASCII on purpose: Windows
# PowerShell 5 reads scripts without a BOM as the local code page.
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$Root = Split-Path -Parent $PSScriptRoot
$Site = 'https://omniverse.globalwarningnetworks.com'
$Log = Join-Path $Root 'data\server.log'
$IconFile = Join-Path $Root 'public\favicon.ico'
$Launcher = Join-Path $Root 'Start Omniverse.vbs'
$Paused = Join-Path $Root 'data\paused.flag'
$StartupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'Omniverse.lnk'

# The port: OMNIVERSE_PORT from .env, else 4777.
$Port = 4777
$EnvFile = Join-Path $Root '.env'
if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile) { if ($line -match '^\s*OMNIVERSE_PORT\s*=\s*["'']?(\d+)') { $Port = [int]$Matches[1] } }
}
$Url = "http://localhost:$Port"

# One tray per user: launching again just opens the city.
$first = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\OmniverseTray', [ref]$first)
if (-not $first) { Start-Process $Url; exit }

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) {
  [System.Windows.Forms.MessageBox]::Show("The Omniverse needs Node.js 20 or newer.`nGet it from https://nodejs.org and start it again.", 'Omniverse') | Out-Null
  exit 1
}

# A random secret only this tray and the server it starts know: the server
# accepts "stop" (to save and exit cleanly) only with it.
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$Token = -join ($bytes | ForEach-Object { $_.ToString('x2') })

$script:proc = $null      # the server we started (cmd.exe wrapping node)
$script:own = $false      # false when a server was already running before the tray
$script:exiting = $false
$script:crashes = @()     # when it crashed lately, to give up on a crash loop
$script:opened = $NoBrowser.IsPresent

function Test-Up {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $ok = $c.BeginConnect('127.0.0.1', $Port, $null, $null).AsyncWaitHandle.WaitOne(300) -and $c.Connected
    $c.Close()
    return $ok
  } catch { return $false }
}

function Start-Server {
  New-Item -ItemType Directory -Force (Split-Path $Log) | Out-Null
  # Keep the log small: one previous copy.
  if ((Test-Path $Log) -and (Get-Item $Log).Length -gt 5MB) { Move-Item -Force $Log ($Log -replace '\.log$', '.old.log') }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = "/d /c `"`"$Node`" server\server.mjs >> `"$Log`" 2>&1`""
  $psi.WorkingDirectory = $Root
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['OMNIVERSE_CONTROL_TOKEN'] = $Token
  $psi.EnvironmentVariables['OMNIVERSE_PORT'] = "$Port"
  $script:proc = [System.Diagnostics.Process]::Start($psi)
  $script:own = $true
}

function Stop-Server {
  if (-not $script:own -or -not $script:proc) { return }
  $p = $script:proc
  $script:proc = $null
  # Ask nicely first, so the economy and work system save; force it after 8 s.
  try { Invoke-RestMethod -Method Post -Uri "$Url/api/control/shutdown" -Headers @{ 'x-omniverse-control' = $Token } -TimeoutSec 5 | Out-Null } catch { }
  if (-not $p.WaitForExit(8000)) { & taskkill.exe /PID $p.Id /T /F 2>$null | Out-Null }
}

# --- the tray icon and its menu ---------------------------------------------
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = New-Object System.Drawing.Icon($IconFile, [System.Windows.Forms.SystemInformation]::SmallIconSize)
$tray.Text = 'Omniverse - starting'
$menu = New-Object System.Windows.Forms.ContextMenuStrip

function Add-Item($text, $action) {
  $item = New-Object System.Windows.Forms.ToolStripMenuItem($text)
  $item.add_Click($action)
  [void]$menu.Items.Add($item)
  return $item
}

$openItem = Add-Item 'Open Omniverse' { Start-Process $Url }
$openItem.Font = New-Object System.Drawing.Font($openItem.Font, [System.Drawing.FontStyle]::Bold)
[void](Add-Item 'Open the website' { Start-Process $Site })
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$pauseItem = Add-Item 'Pause the simulation' {
  $pause = -not (Test-Path $Paused)
  try {
    Invoke-RestMethod -Method Post -Uri "$Url/api/life/pause" -ContentType 'application/json' -Body (@{ paused = $pause } | ConvertTo-Json) -TimeoutSec 5 | Out-Null
  } catch { $tray.ShowBalloonTip(3000, 'Omniverse', 'The server is not answering yet.', 'Warning') }
}
[void](Add-Item 'Restart the server' {
  if (-not $script:own) { $tray.ShowBalloonTip(4000, 'Omniverse', 'This server was started outside the tray; restart it there.', 'Info'); return }
  $script:exiting = $true
  Stop-Server
  $script:exiting = $false
  Start-Server
  $tray.ShowBalloonTip(2000, 'Omniverse', 'Server restarted.', 'Info')
})
[void](Add-Item 'Show the server log' { if (Test-Path $Log) { Start-Process notepad.exe $Log } })
[void](Add-Item 'Open the app folder' { Start-Process explorer.exe $Root })
$bootItem = Add-Item 'Start with Windows' {
  if (Test-Path $StartupLink) { Remove-Item $StartupLink -Force }
  else {
    $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($StartupLink)
    $lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
    $lnk.Arguments = "`"$Launcher`" /nobrowser"
    $lnk.WorkingDirectory = $Root
    $lnk.IconLocation = $IconFile
    $lnk.Description = 'Start the Omniverse in the system tray'
    $lnk.Save()
  }
}
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void](Add-Item 'Exit Omniverse' {
  $script:exiting = $true
  $tray.Text = 'Omniverse - stopping'
  Stop-Server
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

# Labels that depend on state are refreshed each time the menu opens.
$menu.add_Opening({
  $pauseItem.Text = if (Test-Path $Paused) { 'Resume the simulation' } else { 'Pause the simulation' }
  $bootItem.Checked = Test-Path $StartupLink
})
$tray.ContextMenuStrip = $menu
$tray.add_MouseClick({ if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Start-Process $Url } })
$tray.Visible = $true

# --- start, then watch ---------------------------------------------------------
if (Test-Up) {
  $tray.ShowBalloonTip(4000, 'Omniverse', "Already running on port $Port (started outside the tray). The tray can open it but won't stop it.", 'Info')
} else {
  Start-Server
  $tray.ShowBalloonTip(3000, 'Omniverse', 'Running in the tray. Right-click the diamond for the menu; Exit stops it.', 'Info')
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.add_Tick({
  if ($script:exiting) { return }
  $up = Test-Up
  if ($up -and -not $script:opened) { $script:opened = $true; Start-Process $Url }
  if ($script:own -and $script:proc -and $script:proc.HasExited) {
    # Crashed: start it again, unless it keeps crashing.
    $now = Get-Date
    $script:crashes = @($script:crashes | Where-Object { ($now - $_).TotalMinutes -lt 2 }) + $now
    if ($script:crashes.Count -le 3) {
      Start-Server
      $tray.ShowBalloonTip(3000, 'Omniverse', 'The server stopped unexpectedly and was restarted.', 'Warning')
    } else {
      $script:proc = $null
      $tray.ShowBalloonTip(6000, 'Omniverse', 'The server keeps crashing. See "Show the server log", then use "Restart the server".', 'Error')
    }
  }
  $state = if ($up) { "running on :$Port" } elseif ($script:proc) { 'starting' } else { 'stopped' }
  if (Test-Path $Paused) { $state += ', paused' }
  $tray.Text = "Omniverse - $state"
})
$timer.Start()

# Signing out of Windows or shutting down: stop the server cleanly too.
[System.Windows.Forms.Application]::add_ApplicationExit({ if (-not $script:exiting) { $script:exiting = $true; Stop-Server } })

[System.Windows.Forms.Application]::Run((New-Object System.Windows.Forms.ApplicationContext))
$timer.Stop()
$tray.Dispose()
$mutex.ReleaseMutex()
