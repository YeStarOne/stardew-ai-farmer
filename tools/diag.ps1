Add-Type @'
using System;using System.Runtime.InteropServices;
public class D{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")]public static extern int GetSystemMetrics(int n);
[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);
[DllImport("user32.dll")]public static extern bool GetClientRect(IntPtr h,out RECT r);
[DllImport("user32.dll")]public static extern bool ClientToScreen(IntPtr h,ref POINT p);
public struct RECT{public int L,T,R,B;}public struct POINT{public int X,Y;}}
'@
[D]::SetProcessDPIAware()|Out-Null
"physical screen: $([D]::GetSystemMetrics(0)) x $([D]::GetSystemMetrics(1))"
$p=Get-Process StardewModdingAPI|Select-Object -First 1
$h=$p.MainWindowHandle
$r=New-Object D+RECT;[D]::GetWindowRect($h,[ref]$r)|Out-Null
"window rect: L=$($r.L) T=$($r.T) R=$($r.R) B=$($r.B)"
$c=New-Object D+RECT;[D]::GetClientRect($h,[ref]$c)|Out-Null
"client size: $($c.R) x $($c.B)"
$pt=New-Object D+POINT;[D]::ClientToScreen($h,[ref]$pt)|Out-Null
"client origin on screen: $($pt.X),$($pt.Y)"
