# SN-356: Companion Computer access — capture the owner's full virtual desktop
# to a PNG and print its absolute path. Only referenced in Companion guidance
# on turns where the owner ticked the "Computer" checkbox.
param([string]$OutPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace SmartNotes -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][SmartNotes.Dpi]::SetProcessDPIAware()
if (-not $OutPath) {
  $OutPath = Join-Path $env:TEMP ("companion-screen-" + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + ".png")
}
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
  $bitmap.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
Write-Output $OutPath
