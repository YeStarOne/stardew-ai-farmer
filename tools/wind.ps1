Add-Type @'
using System;using System.Runtime.InteropServices;
public class W2{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);
[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);
[DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);
public struct RECT{public int L,T,R,B;}}
'@
[W2]::SetProcessDPIAware()|Out-Null
$p=Get-Process StardewModdingAPI|Select-Object -First 1
$h=$p.MainWindowHandle
"minimized: $([W2]::IsIconic($h))"
$r=New-Object W2+RECT;[W2]::GetWindowRect($h,[ref]$r)|Out-Null
"rect: $($r.L),$($r.T) - $($r.R),$($r.B)"
if ([W2]::IsIconic($h)) { [W2]::ShowWindow($h,9)|Out-Null; "restored" }
