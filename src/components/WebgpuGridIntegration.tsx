import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { createWebgpuGridEnvironment, createWebgpuGridPostProcessing } from "webgpu-grid";

/**
 * Mounts the webgpu-grid environment (fog + 4-point rig + etched floor) into the
 * existing R3F scene, and replaces the default render with the webgpu-grid
 * RenderPipeline post-processing.
 *
 * Drone-sim world units are millimeters, while webgpu-grid defaults are meters,
 * so we scale by 1000.
 */
export function WebgpuGridIntegration({ unitScale = 1000 }: { unitScale?: number }) {
  const { gl, scene, camera } = useThree();

  const stateOverrides = useMemo(
    () => ({
      qualityPreset: "balanced" as const,
      // Drone-sim uses millimeter world units, so the etched showroom floor becomes
      // excessively dense and shimmers under motion if we keep the package defaults.
      useGridEtching: false,
      aoEnabled: false,
    }),
    [],
  );

  const integration = useMemo(() => {
    // NOTE: gl is a Three WebGPURenderer (with WebGL2 fallback backend).
    const env = createWebgpuGridEnvironment({
      renderer: gl as any,
      scene: scene as any,
      unitScale,
      stateOverrides,
    });

    const pp = createWebgpuGridPostProcessing({
      renderer: gl as any,
      scene: scene as any,
      camera: camera as any,
      stateOverrides,
    });

    return { env, pp };
  }, [gl, scene, camera, unitScale, stateOverrides]);

  useEffect(() => {
    return () => {
      integration.pp.dispose();
      integration.env.dispose();
    };
  }, [integration]);

  // Taking over render by using a positive priority disables R3F's internal render.
  useFrame(() => {
    integration.pp.render();
  }, 1);

  return null;
}
