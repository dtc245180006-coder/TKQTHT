param([switch]$Loop)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$outputDirectory = Join-Path $projectRoot 'output/operations'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$observerMutex = New-Object Threading.Mutex($false, 'Local\HotelBookingHostObserver')
if (-not $observerMutex.WaitOne(0)) { exit 0 }
try {
  do {
    try {
      $driveRoot = [IO.Path]::GetPathRoot($projectRoot)
      $drive = New-Object IO.DriveInfo($driveRoot)
      $observation = @{ timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); freeRatio = $drive.AvailableFreeSpace / $drive.TotalSize }
      $temporaryPath = Join-Path $outputDirectory 'host.json.tmp'
      [IO.File]::WriteAllText($temporaryPath, ($observation | ConvertTo-Json -Compress))
      Move-Item -LiteralPath $temporaryPath -Destination (Join-Path $outputDirectory 'host.json') -Force
    } catch { Write-Warning 'Host disk observation failed; stale-observer alert will detect missing updates.' }
    if ($Loop) { Start-Sleep -Seconds 60 }
  } while ($Loop)
} finally { $observerMutex.ReleaseMutex(); $observerMutex.Dispose() }
