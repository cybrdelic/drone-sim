import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  createFlightPathLine,
  createFlightPathPoints,
  createFlightPathPresets,
  disposeFlightPathLine,
  FlightPathPresetId,
} from "../sim/flightPath";

interface UseFlightPathOptions {
  frameSize: number;
}

export function useFlightPath({ frameSize }: UseFlightPathOptions) {
  const [presetId, setPresetId] = useState<FlightPathPresetId>("oval");
  const [waypoints, setWaypoints] = useState<THREE.Vector3[]>([]);
  const [isFlyingPath, setIsFlyingPath] = useState(false);
  const [flightResetToken, setFlightResetToken] = useState(0);
  const waypointsRef = useRef(waypoints);
  const isFlyingPathRef = useRef(isFlyingPath);

  useEffect(() => {
    waypointsRef.current = waypoints;
  }, [waypoints]);

  useEffect(() => {
    isFlyingPathRef.current = isFlyingPath;
  }, [isFlyingPath]);

  const presetWaypoints = useMemo(
    () => createFlightPathPresets(frameSize),
    [frameSize],
  );
  const flightPathPoints = useMemo(
    () => createFlightPathPoints(waypoints),
    [waypoints],
  );
  const flightPathLine = useMemo(
    () => createFlightPathLine(flightPathPoints),
    [flightPathPoints],
  );

  useEffect(() => {
    return () => {
      disposeFlightPathLine(flightPathLine);
    };
  }, [flightPathLine]);

  const appendWaypoint = useCallback((point: THREE.Vector3) => {
    setWaypoints((current) => [...current, point.clone()]);
  }, []);

  const clearWaypoints = useCallback(() => {
    setWaypoints([]);
  }, []);

  const loadPresetWaypoints = useCallback(() => {
    setWaypoints(presetWaypoints[presetId].map((point) => point.clone()));
  }, [presetId, presetWaypoints]);

  const startFlightPath = useCallback(() => {
    setIsFlyingPath(true);
  }, []);

  const stopFlightPath = useCallback(() => {
    setIsFlyingPath(false);
  }, []);

  const resetFlightPath = useCallback(() => {
    setIsFlyingPath(false);
    setWaypoints([]);
    setFlightResetToken((current) => current + 1);
  }, []);

  return {
    appendWaypoint,
    clearWaypoints,
    flightPathLine,
    flightResetToken,
    isFlyingPath,
    isFlyingPathRef,
    loadPresetWaypoints,
    presetId,
    resetFlightPath,
    setIsFlyingPath,
    setPresetId,
    setWaypoints,
    startFlightPath,
    stopFlightPath,
    waypoints,
    waypointsRef,
  };
}
