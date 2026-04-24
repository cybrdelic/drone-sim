import * as THREE from "three";
import { AgXToneMapping, SRGBColorSpace, WebGPURenderer } from "three/webgpu";

export type RendererBackend = "webgpu" | "webgl2" | "unknown";

type RendererBackendProbe = {
  backend?: {
    isWebGPUBackend?: boolean;
    isWebGLBackend?: boolean;
    constructor?: { name?: string };
  };
};

function detectRendererBackend(renderer: object): RendererBackend {
  const backend = (renderer as RendererBackendProbe).backend;
  const backendName = String(backend?.constructor?.name || "").toLowerCase();
  if (backend?.isWebGPUBackend || backendName.includes("webgpu")) {
    return "webgpu";
  }
  if (backend?.isWebGLBackend || backendName.includes("webgl")) {
    return "webgl2";
  }
  return "unknown";
}

export async function createConfiguredWebgpuRenderer(
  props: { canvas: HTMLCanvasElement | OffscreenCanvas },
  onBackendDetected: (backend: RendererBackend) => void,
) {
  const renderer = new WebGPURenderer({
    canvas: props.canvas as HTMLCanvasElement,
    antialias: true,
    alpha: true,
    logarithmicDepthBuffer: true,
  });

  await renderer.init();
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  onBackendDetected(detectRendererBackend(renderer));
  return renderer;
}
