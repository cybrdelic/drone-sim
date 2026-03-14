import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    esbuild: {
      target: 'es2022',
    },
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
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
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      target: 'es2022',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (/[\\/]node_modules[\\/](react|react-dom)[\\/]/.test(id)) return 'react';
            if (id.includes('three/examples')) return 'three-examples';
            if (id.includes('three-bvh-csg')) return 'csg';
            if (id.includes('@react-three/rapier') || id.includes('@dimforge/rapier')) return 'rapier';
            if (id.includes('@react-three/fiber') || id.includes('@react-three/drei')) return 'react-three';
            if (id.includes('three')) return 'three';
            // Let Rollup decide for the rest to avoid circular chunk graphs.
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
