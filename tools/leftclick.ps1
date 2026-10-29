# DPI感知物理左键单击: powershell -File leftclick.ps1 -ax <物理X> -ay <物理Y>
param([int]$ax = 640, [int]$ay = 360)
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
[W]::mouse_event(0x02,0,0,0,[UIntPtr]::Zero)   # left down
Start-Sleep -Milliseconds 80
[W]::mouse_event(0x04,0,0,0,[UIntPtr]::Zero)   # left up
