<#
  Windows-side launcher for the sandcastle AFK run.

  The AFK loop itself lives in WSL (.sandcastle/run-afk.sh) and cannot deflate
  its own VM. This wrapper runs that loop, then `wsl --shutdown` once it's done,
  which instantly hands ALL of the WSL VM's RAM back to Windows -- so you never
  have to reboot to recover memory after a run.

  Usage (from a dedicated PowerShell window -- keep it open for the run):
    .\.sandcastle\run-afk.ps1                 # run, then shut WSL down
    .\.sandcastle\run-afk.ps1 -RestartDocker  # also bounce Docker Desktop after

  Notes:
  - `wsl --shutdown` stops ALL distros + docker-desktop, so the Docker CLI is
    unavailable until Docker Desktop restarts. Use -RestartDocker to auto-bounce
    it, or just relaunch Docker Desktop before the next run.
  - This call is foreground/blocking on purpose: it keeps the wsl.exe process
    (and the run's child processes) alive for the whole run. Do NOT background
    it -- a detached wsl.exe invocation tears its children down on return.
  - Closing this window kills the run, same as any foreground launch.
#>
[CmdletBinding()]
param(
  [switch]$RestartDocker,
  [string]$Distro = 'Ubuntu',
  [string]$WslUser = 'dev'
)

$ErrorActionPreference = 'Stop'

Write-Host "[afk] launching sandcastle loop in WSL ($Distro, user=$WslUser)..." -ForegroundColor Cyan
# Blocking foreground call -- keeps wsl.exe (and the run's children) alive.
wsl.exe -d $Distro -u $WslUser -- bash -lc 'cd ~/nes-tetris-trainer && ./.sandcastle/run-afk.sh'
$rc = $LASTEXITCODE
Write-Host "[afk] run-afk.sh exited rc=$rc" -ForegroundColor Cyan

Write-Host "[afk] shutting down WSL to reclaim all VM memory..." -ForegroundColor Cyan
wsl.exe --shutdown

if ($RestartDocker) {
  $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $dd) {
    Write-Host "[afk] restarting Docker Desktop..." -ForegroundColor Cyan
    Start-Process $dd
  } else {
    Write-Warning "[afk] Docker Desktop not found at $dd -- start it manually before the next run."
  }
} else {
  Write-Host "[afk] WSL is down; Docker CLI is unavailable until Docker Desktop restarts." -ForegroundColor Yellow
}

Write-Host "[afk] done -- memory reclaimed, no reboot needed." -ForegroundColor Green
exit $rc
