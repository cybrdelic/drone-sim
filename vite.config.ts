import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    esbuild: {
      target: 'es2022',
    },
    resolve: {
      preserveSymlinks: true,
      dedupe: ['three'],
      alias: [
        // Ensure a single Three.js instance even when consuming linked local packages
        // that have their own dev-only node_modules/three (prevents TSL name/stack issues).
        {
          find: 'three/addons',
          replacement: path.resolve(__dirname, 'node_modules/three/examples/jsm'),
        },
        {
          find: /^three\/tsl$/,
          replacement: path.resolve(__dirname, 'node_modules/three/build/three.tsl.js'),
        },
        {
          find: /^three\/webgpu$/,
          replacement: path.resolve(__dirname, 'node_modules/three/build/three.webgpu.js'),
        },
        {
          find: /^three$/,
          replacement: path.resolve(__dirname, 'node_modules/three/build/three.module.js'),
        },
        {
          find: '@',
          replacement: path.resolve(__dirname, '.'),
        },
      ],
    },
    server: {
      // Keep HMR opt-out available for heavy in-browser editing sessions.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 2400,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom)[\\/]/.test(id)) return 'react';
            if (id.includes('three/examples')) return 'three-examples';
            if (id.includes('three-bvh-csg')) return 'csg';
            if (id.includes('@react-three/rapier') || id.includes('@dimforge/rapier')) return 'rapier';
            if (id.includes('@react-three/fiber') || id.includes('@react-three/drei')) return 'react-three';
            if (id.includes('three')) return 'three';
            // Let Rollup decide for the rest to avoid circular chunk graphs.
            return undefined;
          },
        },
      },
    },
    optimizeDeps: {
      include: ['three/webgpu', '@react-three/fiber', '@react-three/drei', 'three-bvh-csg'],
      esbuildOptions: {
        target: 'es2022',
      },
    },
  };
});
