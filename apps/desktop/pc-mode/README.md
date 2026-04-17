# PC Mode

This folder adds a Windows `.csproj` desktop wrapper for `GSMEDIACUT`.

## Goal

Show the same GSMEDIACUT web editor style inside a native Windows app window.

## Files

- `GSMEDIACUT.PC.csproj`: WPF project file
- `App.xaml`: WPF application entry
- `MainWindow.xaml`: desktop shell UI
- `MainWindow.xaml.cs`: WebView2 host logic

## Open in Visual Studio

Open one of these in Visual Studio:

- `apps/desktop/pc-mode/GSMEDIACUT.PC.csproj`
- `apps/desktop/GSMEDIACUT.Windows.sln`

## How it works

- The app opens a native desktop window.
- Inside that window, `WebView2` loads `http://localhost:3000`.
- That means the PC app uses your web editor UI instead of a different native layout.

## Current behavior

- If `apps/web` is already running, the desktop wrapper loads it directly.
- If not, the wrapper shows a fallback screen and can start `apps/web`.
- On startup, the wrapper creates two visible folders in the current Windows user profile:
  - `C:\Users\<you>\GSMEDIACUT`
    App shell data, including the WebView2 browser profile used by the editor.
  - `C:\Users\<you>\GSMEDIACUT Drafts`
    Visible draft workspace with `Projects`, `Media`, `Exports`, and `Temp` subfolders.
- The desktop window exposes quick buttons to open both folders.

## Important

This matches your web style much better than the old WinForms launcher, but it is not yet a final Microsoft Store package by itself.
For Store submission, the next step is the Windows packaging project in `apps/desktop/pc-store`.

## Output Types

### EXE

Build the desktop wrapper project:

```powershell
dotnet publish .\apps\desktop\pc-mode\GSMEDIACUT.PC.csproj -c Release
```

Expected output:

- `apps/desktop/pc-mode/bin/Release/net8.0-windows/win-x64/publish/GSMEDIACUT.PC.exe`

### Microsoft Store / MSIX

Use the packaging project:

- `apps/desktop/pc-store/GSMEDIACUT.Store.wapproj`

That project wraps the desktop app for MSIX packaging.

## Files Added For Store Mode

- `apps/desktop/GSMEDIACUT.Windows.sln`
- `apps/desktop/pc-store/GSMEDIACUT.Store.wapproj`
- `apps/desktop/pc-store/Package.appxmanifest`
- `apps/desktop/pc-store/Assets/*`

## Build Notes

- The `.exe` can be built with .NET SDK.
- The `.msix` packaging project normally requires full Visual Studio packaging tools/Desktop Bridge support on Windows.
- The current package identity and publisher are placeholders. Before Store submission, replace them with your real Microsoft Partner Center values.
