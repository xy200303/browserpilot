# The browser you are already signed in to

BrowserPilot is a local browser for agents. You sign in once inside an isolated environment; your agent drives that same window over a local MCP endpoint — no second browser, no second login. You can take over whenever you want.

[Download](https://github.com/xy200303/browserpilot/releases/latest){ .vp-button .vp-button-brand }
[Getting started](/en/guide/quickstart){ .vp-button .vp-button-alt }

## What it does

- **One window, two drivers.** You sign in and solve captchas; the agent clicks, fills, waits and extracts. An overlay marks who is in control.
- **Isolated environments.** Each environment has its own window and its own login store. Closing the window keeps the logins.
- **Local MCP.** The agent connects to `127.0.0.1` with a token that never leaves the machine. No cloud relay.
- **Workflows.** A run that worked once becomes a node graph, replayed by name with parameters.
- **Screenshots with a grid.** Coordinates come from the image itself, so the agent does not guess.
- **Everything else you expect.** History, bookmarks, password autofill, downloads with resume, HAR capture, window recording.

## Screenshots and the workflow editor

The app ships with a workflow editor, a downloads manager, per-environment history and bookmarks, and a composited window preview used by GUI automation. See the Chinese home page for the full visual tour: [browser.xyun.dev](https://browser.xyun.dev/).

## Requirements

Windows 10+, macOS 12+ (Apple Silicon) or a modern Linux desktop. No external browser required; BrowserPilot embeds Electron.

## Install

```bash
# Windows: run the installer, or use the zip
# macOS:   mount the dmg (unsigned: xattr -cr /Applications/BrowserPilot.app)
# Linux:   chmod +x BrowserPilot-*.AppImage && ./BrowserPilot-*.AppImage
```

Full details: [Downloads](/en/download).
