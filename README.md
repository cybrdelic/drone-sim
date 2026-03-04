<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/adfc3fc8-d747-41d6-923c-e42f8406f36e

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `pnpm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `pnpm dev`

## MCP Live Debug/Control (VS Code)

This repo includes a local MCP server that can attach live to the running browser and:
- read state + flight telemetry
- toggle debug overlays (collider lines, telemetry)
- patch UI/drone params and waypoints

Requirements and philosophy:
- Prefer physics realism over hacks (no per-frame teleporting in physical modes)
- Avoid relying on the browser console; verification is via UI telemetry/overlays

Steps:
1) Start the MCP debug server (optional if you start it via VS Code):
   `pnpm mcp:debug`
2) In VS Code, ensure the workspace MCP config exists at [.vscode/mcp.json](.vscode/mcp.json), then run:
   - `MCP: List Servers` → start `droneSimDebug` (trust prompt on first run)
3) Start the app:
   `pnpm dev`
4) Open the shown localhost URL; the app auto-attaches to `ws://127.0.0.1:8787`.

Agents:
- Physics realism agent: [.github/agents/drone-sim-physics-realism.agent.md](.github/agents/drone-sim-physics-realism.agent.md)
- Debug/control agent: [.github/agents/drone-sim-debug.agent.md](.github/agents/drone-sim-debug.agent.md)
