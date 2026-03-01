import React, { useState, useRef, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  Grid,
  ContactShadows,
  Line,
} from "@react-three/drei";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { Sidebar } from "./components/Sidebar";
import { DroneModel } from "./components/DroneModel";
import { DroneParams } from "./types";

const defaultParams: DroneParams = {
  frameSize: 210, // 5-inch standard
  plateThickness: 5,
  topPlateThickness: 2,
  standoffHeight: 25,
  armWidth: 14,
  fcMounting: 30.5,
  motorMountPattern: 16,
  motorCenterHole: 6,
  weightReduction: 40,
  propSize: 5.1,
  showTPU: true,
  tpuColor: "#0ea5e9",
  viewMode: "assembled",
};

export default function App() {
  const [params, setParams] = useState<DroneParams>(defaultParams);
  const groupRef = useRef<THREE.Group>(null);
  const [waypoints, setWaypoints] = useState<THREE.Vector3[]>([]);
  const [isFlyingPath, setIsFlyingPath] = useState(false);

  const handleExport = () => {
    if (!groupRef.current) return;
    const exporter = new STLExporter();
    const stlString = exporter.parse(groupRef.current);
    const blob = new Blob([stlString], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.style.display = "none";
    link.href = url;
    link.download = `aeroforge_production_${params.frameSize}mm.stl`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Rigorous Engineering & Kinematics Calculations
  const engData = useMemo(() => {
    // 1. Frame Volume & Weight (Heuristic based on CSG operations)
    const centerRadius = params.fcMounting / 2 + 10;
    const armLength = params.frameSize / 2;

    const centerVol =
      Math.PI * Math.pow(centerRadius, 2) * params.plateThickness;
    const armVol = 4 * (armLength * params.armWidth * params.plateThickness);
    const topPlateVol =
      (params.fcMounting + 12) *
      (params.fcMounting + 30) *
      params.topPlateThickness;

    // Subtractions
    const cutoutVol =
      4 *
      (armLength *
        0.5 *
        (params.armWidth * (params.weightReduction / 100) * 0.7) *
        params.plateThickness);
    const motorHoleVol =
      4 *
      (Math.PI *
        Math.pow(params.motorCenterHole / 2, 2) *
        params.plateThickness);

    const totalCarbonVol_mm3 =
      centerVol + armVol + topPlateVol - cutoutVol - motorHoleVol;
    const carbonDensity_g_mm3 = 0.0016; // 1.6 g/cm3 for Toray T700 3K Carbon Fiber
    const frameWeight_g = totalCarbonVol_mm3 * carbonDensity_g_mm3;

    // 2. Hardware Weights (Estimated based on prop/frame class)
    const motorWeight =
      params.propSize >= 7 ? 45 : params.propSize >= 5 ? 32 : 12;
    const batteryWeight =
      params.propSize >= 7 ? 250 : params.propSize >= 5 ? 180 : 65;
    const stackWeight = 18;
    const propWeight = params.propSize * 0.8;

    const auw_g =
      frameWeight_g +
      motorWeight * 4 +
      batteryWeight +
      stackWeight +
      propWeight * 4 +
      20; // +20g for wires/screws

    // 3. Thrust & Lift (Empirical approximation)
    const thrustPerMotor_g = Math.pow(params.propSize, 2.8) * 12;
    const totalThrust_g = thrustPerMotor_g * 4;
    const twRatio = totalThrust_g / auw_g;
    const hoverThrottle = (auw_g / totalThrust_g) * 100;

    // 4. Stress & Tension (Arm Root Bending Moment)
    const force_N = (thrustPerMotor_g / 1000) * 9.81; // Max thrust force per arm
    const moment_Nmm = force_N * armLength;
    // Section modulus for rectangular cross section: (b * h^2) / 6
    const sectionModulus_mm3 =
      (params.armWidth * Math.pow(params.plateThickness, 2)) / 6;
    const maxStress_MPa = moment_Nmm / sectionModulus_mm3;

    const cfYieldStrength_MPa = 600; // Standard 3K carbon fiber tensile yield
    const safetyFactor = cfYieldStrength_MPa / maxStress_MPa;

    return {
      frameWeight_g,
      auw_g,
      totalThrust_g,
      twRatio,
      hoverThrottle,
      maxStress_MPa,
      safetyFactor,
    };
  }, [params]);

  return (
    <div className="flex h-screen w-full bg-[#0a0a0a] overflow-hidden font-sans text-neutral-200">
      <Sidebar params={params} onChange={setParams} onExport={handleExport} />

      <main className="flex-1 relative cursor-move">
        {/* Frame Specs Panel (Top Left) */}
        <div className="absolute top-4 left-4 z-10 pointer-events-none">
          <div className="bg-[#111]/90 backdrop-blur border border-neutral-800 p-4 rounded-lg shadow-2xl">
            <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-100 mb-3">
              Frame Specifications
            </h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-[11px] font-mono text-neutral-400">
              <div>CLASS</div>
              <div className="text-emerald-400 text-right">
                {params.frameSize >= 250
                  ? "7-INCH"
                  : params.frameSize >= 200
                    ? "5-INCH"
                    : "3-INCH"}
              </div>

              <div>DIAGONAL</div>
              <div className="text-neutral-200 text-right">
                {params.frameSize.toFixed(1)} mm
              </div>

              <div>STACK</div>
              <div className="text-neutral-200 text-right">
                {params.fcMounting}x{params.fcMounting} mm
              </div>

              <div>MOTORS</div>
              <div className="text-neutral-200 text-right">
                {params.motorMountPattern}x{params.motorMountPattern} mm
              </div>

              <div>Z-HEIGHT</div>
              <div className="text-neutral-200 text-right">
                {(
                  params.plateThickness +
                  params.standoffHeight +
                  params.topPlateThickness
                ).toFixed(1)}{" "}
                mm
              </div>
            </div>
          </div>
        </div>

        {/* Engineering Telemetry Panel (Top Right) */}
        <div className="absolute top-4 right-4 z-10 pointer-events-none w-80">
          <div className="bg-[#111]/90 backdrop-blur border border-neutral-800 p-4 rounded-lg shadow-2xl">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-4 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Engineering & Kinematics
            </h2>

            <div className="space-y-4">
              {/* Materials & Tolerances */}
              <div>
                <div className="text-[9px] text-neutral-500 mb-1.5 uppercase tracking-wider">
                  Material Specs
                </div>
                <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                  <div className="text-neutral-400">COMPOSITE</div>
                  <div className="text-neutral-200 text-right">
                    Toray T700 3K
                  </div>
                  <div className="text-neutral-400">DENSITY</div>
                  <div className="text-neutral-200 text-right">1.60 g/cm³</div>
                  <div className="text-neutral-400">TOLERANCE</div>
                  <div className="text-neutral-200 text-right">±0.05 mm</div>
                </div>
              </div>

              {/* Mass Analysis */}
              <div>
                <div className="text-[9px] text-neutral-500 mb-1.5 uppercase tracking-wider">
                  Mass Analysis
                </div>
                <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                  <div className="text-neutral-400">DRY FRAME</div>
                  <div className="text-neutral-200 text-right">
                    {engData.frameWeight_g.toFixed(1)} g
                  </div>
                  <div className="text-neutral-400">EST. AUW</div>
                  <div className="text-neutral-200 text-right">
                    {engData.auw_g.toFixed(1)} g
                  </div>
                </div>
              </div>

              {/* Aerodynamics */}
              <div>
                <div className="text-[9px] text-neutral-500 mb-1.5 uppercase tracking-wider">
                  Aerodynamics (Max)
                </div>
                <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                  <div className="text-neutral-400">TOTAL LIFT</div>
                  <div className="text-neutral-200 text-right">
                    {engData.totalThrust_g.toFixed(0)} g
                  </div>
                  <div className="text-neutral-400">T/W RATIO</div>
                  <div className="text-emerald-400 text-right">
                    {engData.twRatio.toFixed(2)} : 1
                  </div>
                  <div className="text-neutral-400">HOVER THR.</div>
                  <div className="text-neutral-200 text-right">
                    {engData.hoverThrottle.toFixed(1)} %
                  </div>
                </div>
              </div>

              {/* Structural Integrity */}
              <div>
                <div className="text-[9px] text-neutral-500 mb-1.5 uppercase tracking-wider">
                  Structural Integrity
                </div>
                <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                  <div className="text-neutral-400">ARM TENSION</div>
                  <div className="text-neutral-200 text-right">
                    {engData.maxStress_MPa.toFixed(1)} MPa
                  </div>
                  <div className="text-neutral-400">YIELD STRENGTH</div>
                  <div className="text-neutral-200 text-right">600.0 MPa</div>
                  <div className="text-neutral-400">SAFETY FACTOR</div>
                  <div
                    className={`text-right font-bold ${engData.safetyFactor < 1.5 ? "text-rose-500" : engData.safetyFactor < 3 ? "text-yellow-500" : "text-emerald-500"}`}
                  >
                    {engData.safetyFactor.toFixed(2)}x
                  </div>
                </div>
                {/* Stress Bar */}
                <div className="mt-2 h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${engData.safetyFactor < 1.5 ? "bg-rose-500" : engData.safetyFactor < 3 ? "bg-yellow-500" : "bg-emerald-500"}`}
                    style={{
                      width: `${Math.min((600 / engData.maxStress_MPa) * 20, 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Flight Sim Controls Overlay */}
        {params.viewMode === "flight_sim" && (
          <>
            <div className="absolute top-24 left-1/2 -translate-x-1/2 z-10 flex gap-4 pointer-events-auto">
              <button
                className="bg-neutral-800 border border-neutral-700 text-white px-4 py-2 rounded text-xs hover:bg-neutral-700 transition-colors"
                onClick={() => setWaypoints([])}
                disabled={isFlyingPath}
              >
                Clear Path
              </button>
              <button
                className="bg-emerald-600 border border-emerald-500 text-white px-4 py-2 rounded text-xs hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setIsFlyingPath(true)}
                disabled={waypoints.length < 2 || isFlyingPath}
              >
                {isFlyingPath ? "Flying..." : "Fly Path"}
              </button>
              <div className="bg-neutral-900/80 text-neutral-400 px-4 py-2 rounded text-xs border border-neutral-800 backdrop-blur flex items-center">
                Click on the grid to add waypoints
              </div>
            </div>
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
              <div className="bg-[#111]/90 backdrop-blur border border-emerald-500/30 p-4 rounded-lg shadow-[0_0_30px_rgba(16,185,129,0.1)] flex items-center gap-8">
                <div className="text-center">
                  <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest mb-2">
                    Throttle / Yaw
                  </div>
                <div className="grid grid-cols-3 gap-1">
                  <div />
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-mono text-neutral-400">
                    W
                  </div>
                  <div />
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-mono text-neutral-400">
                    A
                  </div>
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-mono text-neutral-400">
                    S
                  </div>
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-mono text-neutral-400">
                    D
                  </div>
                </div>
              </div>
              <div className="w-[1px] h-16 bg-neutral-800" />
              <div className="text-center">
                <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest mb-2">
                  Altitude / Rotation
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-mono text-neutral-400">
                    Q
                  </div>
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-emerald-500/50 flex items-center justify-center text-xs font-mono text-emerald-400">
                    SPC
                  </div>
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-mono text-neutral-400">
                    E
                  </div>
                  <div />
                  <div className="w-8 h-8 rounded bg-neutral-800 border border-emerald-500/50 flex items-center justify-center text-xs font-mono text-emerald-400">
                    SHF
                  </div>
                  <div />
                </div>
              </div>
            </div>
          </div>
          </>
        )}

        <Canvas camera={{ position: [120, 100, 120], fov: 45 }} shadows>
          <color attach="background" args={["#0a0a0a"]} />
          <ambientLight intensity={0.4} />
          <directionalLight
            position={[50, 100, 50]}
            intensity={1.5}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0001}
          />
          <Environment preset="studio" />

          <DroneModel
            params={params}
            groupRef={groupRef}
            waypoints={waypoints}
            isFlyingPath={isFlyingPath}
            onFlightComplete={() => setIsFlyingPath(false)}
          />

          {params.viewMode === "flight_sim" && (
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0, 0]}
              args={[2000, 2000]}
              visible={false}
              onPointerDown={(e) => {
                if (!isFlyingPath) {
                  setWaypoints([...waypoints, e.point]);
                }
              }}
            >
              <planeGeometry args={[2000, 2000]} />
              <meshBasicMaterial />
            </mesh>
          )}

          {waypoints.length > 0 && params.viewMode === "flight_sim" && (
            <group>
              {waypoints.length > 1 && (
                <Line
                  points={waypoints.map((p) => [
                    p.x,
                    Math.max(p.y + 20, 20),
                    p.z,
                  ])}
                  color="#10b981"
                  lineWidth={3}
                  dashed={false}
                />
              )}
              {waypoints.map((wp, i) => (
                <mesh
                  key={i}
                  position={[wp.x, Math.max(wp.y + 20, 20), wp.z]}
                >
                  <sphereGeometry args={[3, 16, 16]} />
                  <meshStandardMaterial
                    color={i === 0 ? "#ffffff" : "#10b981"}
                  />
                </mesh>
              ))}
            </group>
          )}

          <ContactShadows
            position={[0, -0.1, 0]}
            opacity={0.4}
            scale={300}
            blur={2}
            far={50}
          />

          <Grid
            infiniteGrid
            fadeDistance={400}
            sectionColor="#333"
            cellColor="#1a1a1a"
            position={[0, -0.2, 0]}
          />
          <OrbitControls
            makeDefault
            minPolarAngle={0}
            maxPolarAngle={Math.PI / 2 + 0.1}
            target={[0, 10, 0]}
          />
        </Canvas>
      </main>
    </div>
  );
}
