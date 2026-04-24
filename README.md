# Drone Sim

Drone Sim is a browser-based engineering lab for quadcopter frame design and
flight testing. It combines:

- parametric frame and print-layout views
- assembly fit and structural checks
- live flight telemetry, debug overlays, and replay inspection
- a local MCP debug sidecar for live state reads and patches

## Run locally

Prerequisites:

- Node.js 20+
- `pnpm`

Install and start the app:

```bash
pnpm install
pnpm dev
```

The Vite app runs on `http://localhost:3000`.

## Scripts

- `pnpm dev` - start the app
- `pnpm build` - production build
- `pnpm preview` - preview the production build
- `pnpm lint` - TypeScript typecheck
- `pnpm mcp:debug` - start the local debug MCP bridge

## Local MCP debug bridge

The repo includes a local MCP server in
[`tools/drone-sim-debug-mcp`](./tools/drone-sim-debug-mcp) that can attach to
the running browser session and:

- fetch UI + telemetry state
- patch params, sim settings, view settings, and debug settings
- set waypoints and toggle autopilot

VS Code can start the sidecar from
[`\.vscode/mcp.json`](./.vscode/mcp.json).

Typical loop:

1. Run `pnpm mcp:debug`
2. Run `pnpm dev`
3. Open the app in the browser
4. Connect through the MCP server or the included agent docs in `.github/agents`

Local debug bridge scratch files live under `.drone-sim-debug/` and are ignored
by git.

## Project layout

- `src/App.tsx` - app shell and scene composition
- `src/components/` - viewport UI, inspectors, overlays, and controls
- `src/sim/` - shared simulation config and engineering/flight domain logic
- `tools/drone-sim-debug-mcp/` - local MCP sidecar for live inspection/control

## Physics direction

This repo treats the sim as an engineering instrument, not just a visual toy:

- prefer physically plausible forces over teleports or visual hacks
- keep verification visible in-app through telemetry and overlays
- gate unrealistic assemblies before flight mode accepts them
