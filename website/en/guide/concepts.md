# Core concepts

Four objects explain almost everything in BrowserPilot. The rest of the docs assume them.

## Environment

An environment is one isolated browser identity: its own window, its own cookies, its own storage, its own settings for permissions.

- Many environments can run in one process; each has one window.
- Closing a window keeps the environment's logins. Deleting the environment wipes them.
- The default environment is created on first launch and cannot be deleted.

Environments are how "log in once, let the agent work" stays safe: the agent only ever sees the environment you point it at.

## Tab

A tab is a page inside an environment window. Tabs have globally unique ids; tools accept either `env` (act on the active page of that environment) or a precise `tabId`.

Every tab has a control state:

| State | Meaning |
| ----- | ------- |
| `user` | The human is driving; the agent's input is not applied |
| `agent` | The agent is driving; an overlay covers the page |
| `shared` | Both may act; used after a handoff |

`page_handoff` releases control to the human, `page_unlock` removes the overlay without pausing the task, `page_lock` takes control back.

## Run

A run is one execution of a workflow. It records the start time, whether it succeeded, the node that failed, the error message, declared outputs and a failure screenshot.

Runs are listed in the in-app Runs page; agents read them through the `workflow` tools.

## Step

A step is a node inside a workflow graph. Node types cover navigation, clicking, typing, keys, scrolling, selecting, uploads, canvas strokes, waiting, branching, loops, page scripts, main-process code, raw CDP, HTTP requests, extraction and CSV export.

Edges connect steps. A condition node exposes one output per branch; a loop node contains its own subgraph.

## How a task flows

```text
you describe / a workflow is chosen
        ↓
agent picks tools (MCP) or workflow_run
        ↓
steps execute in one tab, with waits and retries
        ↓
outputs, files and a run record
```

## Where things are stored

Everything lives in the app data directory: settings, environments, workflows, sessions and the MCP token. Cookies sit inside each environment's session partition. Nothing is uploaded anywhere; the app only downloads.

## Next

- [Quickstart](/en/guide/quickstart)
- [Downloads](/en/download)
