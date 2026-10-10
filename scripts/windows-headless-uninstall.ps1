[CmdletBinding()] param([switch]$PurgeData)
$ErrorActionPreference='Stop'; $name='OscarNextHeadless'; $dir="$env:ProgramData\OSCAR Next Headless"; $s=Get-Service $name -ErrorAction SilentlyContinue
if($s){ if($s.Status -ne 'Stopped'){Stop-Service $name -Force}; & sc.exe delete $name | Out-Null }
Get-NetFirewallRule -DisplayName 'OSCAR Next Headless TCP *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
if($PurgeData){Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue; Write-Host 'Service and data removed.' -ForegroundColor Green} else { Write-Host "Service removed. Data retained at $dir" -ForegroundColor Green }
