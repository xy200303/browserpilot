---
title: Download and install
description: Download BrowserPilot for Windows x64, macOS Apple Silicon and Linux x64, with notes on unsigned builds, system requirements, the local MCP endpoint and where your data lives.
---

# Download and install

The latest build is on [GitHub Releases](https://github.com/xy200303/browserpilot/releases/latest).

| Platform | Files |
| -------- | ----- |
| Windows x64 | `BrowserPilot.Setup.<version>.exe`, `BrowserPilot-<version>-win.zip` |
| macOS (Apple Silicon) | `BrowserPilot-<version>-arm64.dmg`, `BrowserPilot-<version>-arm64-mac.zip` |
| Linux x64 | `BrowserPilot-<version>.AppImage`, `browserpilot_<version>_amd64.deb` |

Only Windows x64, Linux x64 and macOS arm64 are published. There is no 32-bit build and no Intel Mac build. CI packages all three platforms; day-to-day testing happens on Windows.

## Windows

Run the installer and follow the wizard; the install directory can be changed. The installer is roughly 123 MB and the installed directory around 460 MB, because Electron and Chromium are bundled.

::: warning SmartScreen
Builds are not code-signed. Windows may show "Windows protected your PC": choose **More info** → **Run anyway**.
:::

The CLI ships inside the install directory:

```text
%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe
```

It is not on PATH by default. Add that directory to PATH, or call the full path.

## macOS

Open the dmg and drag the app to Applications, or unzip the archive. If macOS says the app is damaged or cannot be verified, run:

```bash
xattr -cr /Applications/BrowserPilot.app
```

## Linux

AppImage:

```bash
chmod +x BrowserPilot-<version>.AppImage
./BrowserPilot-<version>.AppImage
```

Debian and Ubuntu:

```bash
sudo dpkg -i browserpilot_<version>_amd64.deb
```

Headless Linux hosts need a virtual display (Xvfb) if you want screenshots; the app can also run environments headless, but window previews and window recording require a headed window.

## Where your data lives

| What | Where |
| ---- | ----- |
| Settings, environments, workflows | `%APPDATA%\BrowserPilot` (Windows), `~/Library/Application Support/BrowserPilot` (macOS), `~/.config/BrowserPilot` (Linux) |
| MCP endpoint and token | `mcp.json` in the same directory |
| Cookies and logins | inside each environment's session partition, under the same directory |
| Downloads | your system download folder by default, changeable in Settings → General or with the `download` tool |

Back up the app data directory to keep environments and logins; delete an environment from Settings to remove its logins.

## System requirements

- Windows 10 or newer, x64
- macOS 12 or newer, Apple Silicon
- A modern Linux desktop with glibc 2.31 or newer

No external browser is required.
