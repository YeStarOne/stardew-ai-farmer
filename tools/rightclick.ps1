param([int]$ax = 1148, [int]$ay = 488)
Add-Type @'
using System;using System.Runtime.InteropServices;
public class W{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);}
'@
[W]::SetProcessDPIAware() | Out-Null
$p = Get-Process StardewModdingAPI | Select-Object -First 1
[W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 500
[W]::SetCursorPos($ax, $ay) | Out-Null
Start-Sleep -Milliseconds 200
# right down=0x08, right up=0x10
[W]::mouse_event(0x08,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[W]::mouse_event(0x10,0,0,0,[UIntPtr]::Zero)
Write-Host "right-clicked at $ax,$ay"
