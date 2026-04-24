import { Dispatch, MutableRefObject, SetStateAction, useEffect } from "react";
import * as THREE from "three";
import {
  DEBUG_BRIDGE_ENABLED,
  DEBUG_BRIDGE_TOKEN,
  DEBUG_BRIDGE_URL,
  isPlainObject,
  resolvePatchPayload,
} from "../debug/debugBridgeProtocol";
import {
  applyDebugBridgePatch,
  createDebugBridgeSnapshot,
  type DebugBridgePatchStats,
  type DebugBridgeRefs,
  type DebugBridgeSetters,
} from "../debug/debugBridgeState";
import {
  DebugSettings,
  DroneParams,
  FlightTelemetry,
  SimSettings,
  ViewSettings,
} from "../types";

interface UseDroneDebugBridgeOptions {
  applyValidatedAssemblyState: (
    nextParams: DroneParams,
    nextSimSettings: SimSettings,
    source: string,
  ) => boolean;
  debugSettingsRef: MutableRefObject<DebugSettings>;
  flightTelemetryRef: MutableRefObject<FlightTelemetry>;
  isFlyingPathRef: MutableRefObject<boolean>;
  paramsRef: MutableRefObject<DroneParams>;
  setDebugSettings: Dispatch<SetStateAction<DebugSettings>>;
  setIsFlyingPath: Dispatch<SetStateAction<boolean>>;
  setViewSettings: Dispatch<SetStateAction<ViewSettings>>;
  setWaypoints: Dispatch<SetStateAction<THREE.Vector3[]>>;
  simSettingsRef: MutableRefObject<SimSettings>;
  viewSettingsRef: MutableRefObject<ViewSettings>;
  waypointsRef: MutableRefObject<THREE.Vector3[]>;
}

export function useDroneDebugBridge({
  applyValidatedAssemblyState,
  debugSettingsRef,
  flightTelemetryRef,
  isFlyingPathRef,
  paramsRef,
  setDebugSettings,
  setIsFlyingPath,
  setViewSettings,
  setWaypoints,
  simSettingsRef,
  viewSettingsRef,
  waypointsRef,
}: UseDroneDebugBridgeOptions) {
  useEffect(() => {
    if (!DEBUG_BRIDGE_ENABLED || !DEBUG_BRIDGE_URL) {
      return;
    }

    let socket: WebSocket | null = null;
    let stopped = false;
    let reconnectTimeoutId: number | null = null;
    let retry = 0;
    const patchStats: DebugBridgePatchStats = {
      lastPatchAppliedMs: 0,
      lastPatchKeys: [],
      lastPatchSummary: "",
      lastPatchMetaSummary: "",
    };
    const bridgeRefs: DebugBridgeRefs = {
      debugSettingsRef,
      flightTelemetryRef,
      isFlyingPathRef,
      paramsRef,
      simSettingsRef,
      viewSettingsRef,
      waypointsRef,
    };
    const bridgeSetters: DebugBridgeSetters = {
      setDebugSettings,
      setIsFlyingPath,
      setViewSettings,
      setWaypoints,
    };

    const clearReconnectTimeout = () => {
      if (reconnectTimeoutId !== null) {
        window.clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
      }
    };

    const scheduleReconnect = (delay: number) => {
      if (stopped) {
        return;
      }
      clearReconnectTimeout();
      reconnectTimeoutId = window.setTimeout(() => {
        reconnectTimeoutId = null;
        connect();
      }, delay);
    };

    const respond = (id: string, payload: Record<string, unknown>) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(JSON.stringify({ id, ...payload }));
    };

    const snapshot = () => createDebugBridgeSnapshot(bridgeRefs, patchStats);

    const applyPatch = (rawPatch: unknown) => {
      applyDebugBridgePatch({
        applyValidatedAssemblyState,
        patchStats,
        rawPatch,
        refs: bridgeRefs,
        setters: bridgeSetters,
      });
    };

    const connect = () => {
      if (stopped) {
        return;
      }

      const delay = Math.min(2000, 150 * Math.pow(1.6, retry++));

      try {
        socket = new WebSocket(DEBUG_BRIDGE_URL);
      } catch (error) {
        console.warn("Failed to open the debug bridge socket.", error);
        scheduleReconnect(delay);
        return;
      }

      socket.onopen = () => {
        retry = 0;
        clearReconnectTimeout();
        socket?.send(
          JSON.stringify({
            type: "hello",
            client: "drone-sim",
            ts: Date.now(),
            href:
              typeof window !== "undefined" ? window.location.href : undefined,
            token: DEBUG_BRIDGE_TOKEN || undefined,
          }),
        );
      };

      socket.onmessage = (event) => {
        const raw = typeof event.data === "string" ? event.data : "";
        let message: unknown;
        try {
          message = JSON.parse(raw);
        } catch {
          return;
        }

        if (!isPlainObject(message)) {
          return;
        }

        const id = typeof message.id === "string" ? message.id : null;
        if (!id) {
          return;
        }

        const command = isPlainObject(message.command)
          ? message.command
          : message;
        const type = command.type;
        const providedToken =
          typeof command.token === "string"
            ? command.token
            : typeof message.token === "string"
              ? message.token
              : null;
        const requireToken = DEBUG_BRIDGE_TOKEN.length > 0;
        const isStateRequest =
          type === "get_state" ||
          (!type &&
            Object.keys(message).every((key) =>
              key === "id" || key === "token",
            ));

        if (isStateRequest) {
          if (requireToken && providedToken !== DEBUG_BRIDGE_TOKEN) {
            respond(id, {
              ok: false,
              error: "Unauthorized debug bridge command.",
            });
            return;
          }

          respond(id, { ok: true, state: snapshot() });
          return;
        }

        if (type === "set_state") {
          if (!DEBUG_BRIDGE_TOKEN) {
            respond(id, {
              ok: false,
              error:
                "set_state is disabled until VITE_DRONE_SIM_DEBUG_TOKEN is configured.",
            });
            return;
          }
          if (providedToken !== DEBUG_BRIDGE_TOKEN) {
            respond(id, {
              ok: false,
              error: "Unauthorized debug bridge command.",
            });
            return;
          }

          try {
            applyPatch(resolvePatchPayload(command));
            respond(id, { ok: true, state: snapshot() });
          } catch (error) {
            respond(id, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }

        respond(id, {
          ok: false,
          error: `Unknown command (type=${String(type)})`,
          received: {
            commandKeys: Object.keys(command),
            topLevelKeys: Object.keys(message),
          },
        });
      };

      socket.onclose = () => {
        socket = null;
        if (!stopped) {
          scheduleReconnect(delay);
        }
      };

      socket.onerror = () => {
        try {
          socket?.close();
        } catch (error) {
          console.warn("Failed to close the debug bridge socket cleanly.", error);
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      clearReconnectTimeout();
      try {
        socket?.close();
      } catch (error) {
        console.warn("Failed to close the debug bridge socket during cleanup.", error);
      }
    };
  }, [
    applyValidatedAssemblyState,
    debugSettingsRef,
    flightTelemetryRef,
    isFlyingPathRef,
    paramsRef,
    setDebugSettings,
    setIsFlyingPath,
    setViewSettings,
    setWaypoints,
    simSettingsRef,
    viewSettingsRef,
    waypointsRef,
  ]);
}
