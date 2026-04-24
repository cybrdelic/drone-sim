import * as THREE from "three";

export async function exportDroneStl(
  group: THREE.Group | null,
  frameSizeMm: number,
) {
  if (!group) {
    return;
  }

  const mod = await import("three/examples/jsm/exporters/STLExporter.js");
  const exporter = new mod.STLExporter();
  const stlString = exporter.parse(group);
  const blob = new Blob([stlString], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.style.display = "none";
  link.href = url;
  link.download = `aeroforge_production_${frameSizeMm}mm.stl`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
