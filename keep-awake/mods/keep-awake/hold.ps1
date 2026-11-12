# Keeps Windows from sleeping while this process lives (the display may still turn off).
# Run by the keep-awake mod; -Stop only ends the helpers already running.
param([switch]$Stop)

# One helper at a time: a reloaded mod or a second start replaces the old one.
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*-File*keep-awake*hold.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if ($Stop) { exit 0 }

Add-Type -Namespace Herdr -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED: held until this process exits.
[void][Herdr.Power]::SetThreadExecutionState([uint32]2147483649)

# The mod starts a new helper when this one ends, so the PC is never held long
# after Herdr is gone: 9 minutes at most (under exec's 10-minute cap), 5 seconds if it quit.
$end = (Get-Date).AddMinutes(9)
while ((Get-Date) -lt $end) {
  Start-Sleep -Seconds 5
  if (-not (Get-Process -Name herdr-app -ErrorAction SilentlyContinue)) { break }
}
