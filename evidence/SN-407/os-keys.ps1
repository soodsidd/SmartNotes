# SN-407 evidence helper: real OS-level key input (keybd_event) + the real
# Windows Caps Lock toggle state. Refuses to send anything unless the
# foreground window belongs to Playwright's Chromium, so keystrokes can never
# land in another app.
# Plan steps (';'-separated): d:VK:SCAN  u:VK:SCAN  s:MS  r:VK:SCAN:COUNT:INTERVALMS (repeat keydowns)
param([string]$Plan = "")

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SnKeys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern short GetKeyState(int vk);
}
"@

function CapsOn { return ([SnKeys]::GetKeyState(0x14) -band 1) -eq 1 }

$fgPid = 0
[void][SnKeys]::GetWindowThreadProcessId([SnKeys]::GetForegroundWindow(), [ref]$fgPid)
$fgPath = $null
try { $fgPath = (Get-Process -Id $fgPid -ErrorAction Stop).Path } catch {}
$fgOk = [bool]($fgPath -and $fgPath -match "ms-playwright")
$before = CapsOn

if ($fgOk -and $Plan) {
  foreach ($step in $Plan.Split(";")) {
    $p = $step.Split(":")
    switch ($p[0]) {
      "d" { [SnKeys]::keybd_event([byte][Convert]::ToInt32($p[1], 16), [byte][Convert]::ToInt32($p[2], 16), 0, [UIntPtr]::Zero) }
      "u" { [SnKeys]::keybd_event([byte][Convert]::ToInt32($p[1], 16), [byte][Convert]::ToInt32($p[2], 16), 2, [UIntPtr]::Zero) }
      "s" { Start-Sleep -Milliseconds ([int]$p[1]) }
      "r" {
        for ($i = 0; $i -lt [int]$p[3]; $i++) {
          [SnKeys]::keybd_event([byte][Convert]::ToInt32($p[1], 16), [byte][Convert]::ToInt32($p[2], 16), 0, [UIntPtr]::Zero)
          Start-Sleep -Milliseconds ([int]$p[4])
        }
      }
    }
  }
  Start-Sleep -Milliseconds 150
}

[pscustomobject]@{ foregroundOk = $fgOk; foregroundPath = $fgPath; capsBefore = $before; capsAfter = (CapsOn) } | ConvertTo-Json -Compress
