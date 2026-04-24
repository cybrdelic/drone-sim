import * as THREE from "three";

type WireframeCapableMaterial = THREE.Material & {
  wireframe?: boolean;
};

export function applyWireframeToScene(root: THREE.Object3D, enabled: boolean) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!material) return;

    const apply = (currentMaterial: THREE.Material) => {
      const materialWithWireframe = currentMaterial as WireframeCapableMaterial;
      if (typeof materialWithWireframe.wireframe === "boolean") {
        materialWithWireframe.wireframe = enabled;
        currentMaterial.needsUpdate = true;
      }
    };

    if (Array.isArray(material)) {
      material.forEach(apply);
      return;
    }

    apply(material);
  });
}
