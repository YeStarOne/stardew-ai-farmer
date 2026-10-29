Add-Type @'
using System;using System.Runtime.InteropServices;
public class A{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);}
'@
[A]::SetProcessDPIAware()|Out-Null
$p=Get-Process StardewModdingAPI|Select-Object -First 1
[A]::ShowWindow($p.MainWindowHandle,9)|Out-Null
[A]::SetForegroundWindow($p.MainWindowHandle)|Out-Null
"activated"
