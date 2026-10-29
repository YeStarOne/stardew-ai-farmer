# 输出当前前台窗口的进程名 (供物理点击前互锁检查)
Add-Type @'
using System;using System.Runtime.InteropServices;
public class FG{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);}
'@
$h = [FG]::GetForegroundWindow()
$p = 0
[FG]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
try { (Get-Process -Id $p).ProcessName } catch { Write-Output 'Unknown' }
