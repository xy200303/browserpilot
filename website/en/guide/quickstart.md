# Getting started

BrowserPilot is a local browser for agents. You sign in once in an isolated environment; your agent then drives that same window over a local MCP endpoint, and you can take over whenever you want.

This page takes you from a fresh install to a finished first task.

## 1. Install

Download from [Releases](https://github.com/xy200303/browserpilot/releases/latest). Builds are not code-signed yet.

| Platform | Files |
| -------- | ----- |
| Windows x64 | `BrowserPilot.Setup.<version>.exe`, `BrowserPilot-<version>-win.zip` |
| macOS (Apple Silicon) | `BrowserPilot-<version>-arm64.dmg`, `BrowserPilot-<version>-arm64-mac.zip` |
| Linux x64 | `BrowserPilot-<version>.AppImage`, `browserpilot_<version>_amd64.deb` |

> **Windows**: if SmartScreen reports an unknown publisher, choose More info → Run anyway.
> **macOS**: if macOS says the app is damaged, run `xattr -cr /Applications/BrowserPilot.app`.

On first launch you get a default environment: one window, one isolated login store.

## 2. Check that MCP is running

Open Settings → General. The MCP switch should be on; the port and address are shown next to it. The connection token is written to `mcp.json` in the app data directory (on Windows: `%APPDATA%\BrowserPilot\mcp.json`). It never leaves your machine.

## 3. Hand the browser to your agent

The shortest path: Settings → General → **Connect an agent** → **Copy prompt**. Paste it into Claude Code, Kimi Code, Codex, Cursor, WorkBuddy or CodeBuddy. The prompt contains the MCP address, the token, the skill URL and CLI usage, so the agent can register the server and install the skill itself.

If you prefer doing it by hand, the essential parts are:

```text
MCP server:      http://127.0.0.1:<port>/mcp   (Streamable HTTP)
Authorization:   Bearer <token from mcp.json>
Skill:           https://raw.githubusercontent.com/xy200303/browserpilot/main/skills/browserpilot/SKILL.md
```

## 4. Run a first task

Keep the BrowserPilot window open and ask your agent something concrete:

```text
Open https://example.com, tell me the heading, and take a screenshot.
```

The agent calls `env_list` to confirm the connection, then `page_navigate`, `page_screenshot` and `page_script`. While it works an overlay covers the page; press **Take over** at any time and the agent stops receiving input until you hand it back.

## 5. What you should see

- Tabs open inside the BrowserPilot window, not a second browser
- The overlay says the agent is operating, with a take-over button
- Screenshots come back with a coordinate grid, so click coordinates come from the image itself

## Command line, if you need it

```bash
browserpilot tools                 # list every tool
browserpilot search screenshot     # search by keyword
browserpilot schema page_click     # show parameters
browserpilot call page_navigate --json-file nav.json
```

## Next

- [Core concepts](/en/guide/concepts) — environments, tabs, runs and steps
- [Downloads](/en/download) — packages, what to do about unsigned builds, where data lives
