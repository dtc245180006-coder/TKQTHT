$ErrorActionPreference = 'Stop'
$scriptPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'observe-host.ps1'))
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw 'Observer script missing' }
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $scriptPath + '" -Loop'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$username = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $username
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'HotelBookingHostObserver' -Action $action -Trigger $trigger -Settings $settings -User $username -RunLevel Limited -Force | Out-Null
Start-ScheduledTask -TaskName 'HotelBookingHostObserver'
Write-Output 'Host disk observer registered at current-user logon and started; no password stored.'
