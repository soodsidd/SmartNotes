# SN-407: interactive-session Caps Lock bridge. The low-level hook suppresses
# Caps Lock only for an armed, foreground Smart Notes Chrome/Edge window.
# stdin: ARM<TAB>socket-id, DISARM<TAB>socket-id, QUIT
# stdout: READY, DOWN<TAB>socket-id, UP<TAB>socket-id
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class SmartNotesCapsBridge {
  private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
  private static HookProc callback = HandleKey;
  private static IntPtr hook;
  private static readonly object gate = new object();
  private static IntPtr armedWindow;
  private static string armedSocket;
  private static long heartbeat;
  private static bool held;
  private static string heldSocket;

  [StructLayout(LayoutKind.Sequential)] private struct Kbd { public uint vkCode, scanCode, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] private struct Msg { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x, y; public uint privateField; }
  [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint thread);
  [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr handle);
  [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr handle, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern int GetMessage(out Msg msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Msg msg);
  [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Msg msg);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

  private static bool SmartNotesWindow(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return false;
    var title = new StringBuilder(512);
    GetWindowText(hwnd, title, title.Capacity);
    if (title.ToString().IndexOf("Smart Notes", StringComparison.OrdinalIgnoreCase) < 0) return false;
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    try {
      string name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant();
      return name == "chrome" || name == "msedge";
    } catch { return false; }
  }

  private static void Emit(string type, string socket) {
    if (socket != null) { Console.WriteLine(type + "\t" + socket); Console.Out.Flush(); }
  }

  private static IntPtr HandleKey(int code, IntPtr wParam, IntPtr lParam) {
    if (code < 0) return CallNextHookEx(hook, code, wParam, lParam);
    var key = (Kbd)Marshal.PtrToStructure(lParam, typeof(Kbd));
    if (key.vkCode != 0x14) return CallNextHookEx(hook, code, wParam, lParam);
    int message = wParam.ToInt32();
    bool down = message == 0x100 || message == 0x104;
    bool up = message == 0x101 || message == 0x105;
    lock (gate) {
      if (up && held) {
        held = false;
        Emit("UP", heldSocket);
        heldSocket = null;
        return (IntPtr)1;
      }
      if (down && held) return (IntPtr)1; // typematic repeat
      if (down && armedSocket != null && armedWindow == GetForegroundWindow()
          && DateTime.UtcNow.Ticks - heartbeat < TimeSpan.TicksPerMillisecond * 1500 && SmartNotesWindow(armedWindow)) {
        held = true;
        heldSocket = armedSocket;
        Emit("DOWN", heldSocket);
        return (IntPtr)1;
      }
    }
    return CallNextHookEx(hook, code, wParam, lParam);
  }

  private static void Input() {
    string line;
    while ((line = Console.ReadLine()) != null) {
      var parts = line.Split('\t');
      lock (gate) {
        if (parts[0] == "ARM" && parts.Length == 2 && SmartNotesWindow(GetForegroundWindow())) {
          armedWindow = GetForegroundWindow();
          armedSocket = parts[1];
          heartbeat = DateTime.UtcNow.Ticks;
        } else if (parts[0] == "DISARM" && parts.Length == 2 && armedSocket == parts[1]) {
          armedWindow = IntPtr.Zero;
          armedSocket = null;
          if (held && heldSocket == parts[1]) { held = false; Emit("UP", heldSocket); heldSocket = null; }
        } else if (parts[0] == "QUIT") {
          armedSocket = null;
          return;
        }
      }
    }
    lock (gate) { armedSocket = null; }
    Environment.Exit(0);
  }

  public static void Run() {
    hook = SetWindowsHookEx(13, callback, IntPtr.Zero, 0);
    if (hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    AppDomain.CurrentDomain.ProcessExit += (sender, args) => UnhookWindowsHookEx(hook);
    var reader = new Thread(Input); reader.IsBackground = true; reader.Start();
    Console.WriteLine("READY"); Console.Out.Flush();
    Msg msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
    UnhookWindowsHookEx(hook);
  }
}
'@
[SmartNotesCapsBridge]::Run()
