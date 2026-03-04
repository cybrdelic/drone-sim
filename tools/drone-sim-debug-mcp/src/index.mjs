import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { z } from "zod";

const PORT = Number.parseInt(process.env.DRONE_SIM_DEBUG_PORT ?? "8787", 10);
const HOST = process.env.DRONE_SIM_DEBUG_HOST ?? "127.0.0.1";

const wss = new WebSocketServer({ port: PORT, host: HOST });

/** @type {import('ws').WebSocket | null} */
let client = null;
let clientHello = null;
let lastSeenMs = 0;

let nextId = 1;
const pending = new Map();

function now() {
  return Date.now();
}

function isClientConnected() {
  return !!client && client.readyState === 1; // OPEN
}

function safeJsonParse(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function sendJson(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function requestClient(payload, timeoutMs = 1500) {
  if (!isClientConnected()) {
    throw new Error(
      `No drone-sim client connected. Open the app; it auto-attaches to ws://${HOST}:${PORT}.`,
    );
  }

  const id = String(nextId++);
  const msg = { id, ...payload };

  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for client response (${timeoutMs}ms)`));
    }, timeoutMs);

    pending.set(id, {
      resolve: (v) => {
        clearTimeout(t);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(t);
        reject(e);
      },
    });

    sendJson(client, msg);
  });
}

wss.on("connection", (ws) => {
  client = ws;
  clientHello = null;
  lastSeenMs = now();

  ws.on("message", (data) => {
    lastSeenMs = now();
    const msg = safeJsonParse(data.toString());
    if (!msg) return;

    if (msg.type === "hello") {
      clientHello = msg;
      return;
    }

    if (typeof msg.id === "string" && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      p.resolve(msg);
    }
  });

  ws.on("close", () => {
    if (client === ws) client = null;
  });

  ws.on("error", () => {
    if (client === ws) client = null;
  });
});

const server = new McpServer({ name: "drone-sim-debug", version: "0.0.1" });

function unwrapToolArgs(args) {
  if (!args || typeof args !== "object") return args;
  // Some runners wrap tool args under `signal` or `input` and attach metadata fields.
  const signal = args.signal && typeof args.signal === "object" ? args.signal : null;
  if (signal) return signal;
  const input = args.input && typeof args.input === "object" ? args.input : null;
  if (input) return input;
  return args;
}

function getWorkspaceRoot() {
  // This file lives at: <workspace>/tools/drone-sim-debug-mcp/src/index.mjs
  // Walk up 3 levels to reach workspace root.
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "..", "..", "..");
}

function tryReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

const StatusSchema = z
  .object({
    signal: z.any().optional(),
    input: z.any().optional(),
    _meta: z.any().optional(),
  })
  .passthrough()
  .optional()
  .default({});

server.tool(
  "drone_sim_debug_status",
  "Get status of the debug bridge and whether a drone-sim client is connected.",
  StatusSchema,
  async () => {
    const workspaceRoot = getWorkspaceRoot();
    const patchFile = path.join(workspaceRoot, ".drone-sim-debug", "set_state.patch.json");
    const commandFile = path.join(workspaceRoot, ".drone-sim-debug", "send.command.json");

    const status = {
      ws: { host: HOST, port: PORT },
      connected: isClientConnected(),
      lastSeenMs,
      clientHello,
      workspace: {
        root: workspaceRoot,
        patchFile,
        patchFileExists: fs.existsSync(patchFile),
        commandFile,
        commandFileExists: fs.existsSync(commandFile),
      },
    };

    return {
      content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
      structuredContent: status,
    };
  },
);

server.tool(
  "drone_sim_debug_get_state",
  "Fetch current app state and telemetry from the connected drone-sim client.",
  StatusSchema,
  async () => {
    const res = await requestClient({ type: "get_state" }, 2000);
    if (!res.ok) {
      throw new Error(res.error || "Unknown client error");
    }

    return {
      content: [{ type: "text", text: JSON.stringify(res.state, null, 2) }],
      structuredContent: res.state,
    };
  },
);

const SetStateSchema = z
  .object({
    signal: z.any().optional(),
    input: z.any().optional(),
    _meta: z.any().optional(),
    params: z.record(z.any()).optional(),
    viewSettings: z.record(z.any()).optional(),
    simSettings: z.record(z.any()).optional(),
    debugSettings: z.record(z.any()).optional(),
    waypoints: z
      .array(
        z.object({
          x: z.number(),
          y: z.number(),
          z: z.number(),
        }),
      )
      .optional(),
    isFlyingPath: z.boolean().optional(),
  })
  .passthrough();

server.tool(
  "drone_sim_debug_set_state",
  "Update drone-sim UI/drone state (params, viewSettings, simSettings, debugSettings, waypoints, isFlyingPath).",
  SetStateSchema,
  async (args) => {
    const unwrapped = unwrapToolArgs(args);
    // In some VS Code tool runners, MCP tool arguments are not forwarded (only metadata is).
    // When args are empty, apply a useful default patch so the tool remains functional.
    const hasUserKeys =
      unwrapped &&
      (unwrapped.params ||
        unwrapped.viewSettings ||
        unwrapped.simSettings ||
        unwrapped.debugSettings ||
        unwrapped.waypoints ||
        typeof unwrapped.isFlyingPath === "boolean");

    const workspaceRoot = getWorkspaceRoot();
    const patchFile = path.join(workspaceRoot, ".drone-sim-debug", "set_state.patch.json");
    const patchFromFile = tryReadJson(patchFile);

    const patch = hasUserKeys
      ? unwrapped
      : (patchFromFile ?? {
          params: { viewMode: "flight_sim" },
          debugSettings: { physicsLines: true, flightTelemetry: true },
        });

    const res = await requestClient({ type: "set_state", patch }, 2500);
    if (!res.ok) throw new Error(res.error || "Unknown client error");

    // Newer clients reply with { ok:true, state:{...} }. If not, fall back to get_state.
    let state = res.state;
    if (!state) {
      const follow = await requestClient({ type: "get_state" }, 2500);
      if (!follow.ok) throw new Error(follow.error || "Unknown client error");
      state = follow.state;
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true, state }, null, 2) }],
      structuredContent: { ok: true, state },
    };
  },
);

const SendSchema = z
  .object({
    signal: z.any().optional(),
    input: z.any().optional(),
    _meta: z.any().optional(),
    command: z.record(z.any()).optional(),
    timeoutMs: z.number().optional(),
  })
  .passthrough();

server.tool(
  "drone_sim_debug_send",
  "Send a raw command object to the connected client and return the response.",
  SendSchema,
  async (args) => {
    const unwrapped = unwrapToolArgs(args);
    const timeoutMs = unwrapped?.timeoutMs;
    const workspaceRoot = getWorkspaceRoot();
    const commandFile = path.join(workspaceRoot, ".drone-sim-debug", "send.command.json");
    const commandFromFile = tryReadJson(commandFile);

    const payload = unwrapped?.command ?? unwrapped ?? commandFromFile ?? { type: "get_state" };
    const res = await requestClient(payload, timeoutMs ?? 2000);
    return {
      content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      structuredContent: res,
    };
  },
);

await server.connect(new StdioServerTransport());

// Keep process alive
process.stdin.resume();
