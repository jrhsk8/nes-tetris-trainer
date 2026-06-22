<#
  ONE-COMMAND sandcastle AFK launcher.

  Does the full preflight the runbook used to require by hand — start Docker
  Desktop + wait, host-RAM check, fix run-afk.sh's exec bit, confirm the WSL
  canonical repo — then hands off to run-afk.ps1 (which runs the WSL loop and
  `wsl --shutdown`s to reclaim RAM at the end).

  Usage (from a dedicated PowerShell window — keep it open for the run):
    .\.sandcastle\start-run.ps1
    .\.sandcastle\start-run.ps1 -RestartDocker   # also bounce Docker Desktop after

  Notes:
  - Foreground/blocking on purpose (same as run-afk.ps1) — closing the window
    kills the run. A completion line prints when the backlog drains.
  - Open issues are a live `gh` query inside the loop, so whatever is OPEN on
    GitHub at launch is the backlog. The 2026-06-22 batch is #68-#73
    (grill-with-docs #6).
#>
[CmdletBinding()]
param(
  [switch]$RestartDocker,
  [string]$Distro  = 'Ubuntu',
  [string]$WslUser = 'dev'
)
$ErrorActionPreference = 'Stop'
$repo = '/home/dev/nes-tetris-trainer'

# 1. Docker Desktop up + wait for the engine (wsl --shutdown from a prior run
#    stops docker-desktop too, so this is needed after every run).
if (-not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue)) {
  $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $dd) { Write-Host '[start] launching Docker Desktop...' -ForegroundColor Cyan; Start-Process $dd }
  else { Write-Warning "[start] Docker Desktop not found at $dd — start it manually." }
}
Write-Host '[start] waiting for docker engine...' -ForegroundColor Cyan
$ver = $null; $end = (Get-Date).AddSeconds(180)
do {
  $ver = wsl -d $Distro -u $WslUser bash -lc 'docker info --format "{{.ServerVersion}}" 2>/dev/null'
  if ($ver) { Write-Host "[start] docker $ver ready" -ForegroundColor Green; break }
  Start-Sleep 6
} while ((Get-Date) -lt $end)
if (-not $ver) { throw '[start] docker engine not ready after 180s — open Docker Desktop and retry.' }

# 2. Host RAM (OOM guard — the original crash was host oversubscription at ~0.1 GB free).
$o = Get-CimInstance Win32_OperatingSystem
$freeGb = [math]::Round($o.FreePhysicalMemory / 1MB, 1)
if ($freeGb -lt 6) { Write-Warning "[start] only $freeGb GB free (<6) — close Firefox / VirtualBox / Cowork VMs or risk OOM." }
else { Write-Host "[start] $freeGb GB host RAM free" -ForegroundColor Green }

# 3. Exec bit on run-afk.sh (committed 644, core.filemode=false → git never restores +x;
#    a missing +x is the one trap that has killed a launch with 'Permission denied').
wsl -d $Distro -u root bash -c "cd $repo && chown dev:docker .sandcastle/run-afk.sh && chmod 755 .sandcastle/run-afk.sh"

# 4. Confirm the WSL canonical repo + that the prompt scope is the #68-#73 batch.
$tip = wsl -d $Distro -u $WslUser bash -lc "cd $repo && git log --oneline -1"
Write-Host "[start] WSL main: $tip" -ForegroundColor Cyan
$scope = wsl -d $Distro -u $WslUser bash -lc "cd $repo && grep -m1 'grill-with-docs #6' .sandcastle/prompt.md"
if (-not $scope) { Write-Warning "[start] prompt.md does not mention the #68-#73 'grill-with-docs #6' scope — WSL repo may be out of date." }
else { Write-Host '[start] prompt scope = #68-#73 grill-with-docs #6 batch' -ForegroundColor Green }

# 5. Hand off to the existing launcher (runs the loop, then reclaims RAM).
Write-Host '[start] preflight clean — launching run-afk.ps1...' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'run-afk.ps1') -RestartDocker:$RestartDocker -Distro $Distro -WslUser $WslUser
exit $LASTEXITCODE
