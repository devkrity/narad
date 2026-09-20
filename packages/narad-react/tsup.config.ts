import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: {
    compilerOptions: {
      // tsup DTS still runs TypeScript 6, which flags the baseUrl it injects.
      ignoreDeprecations: '6.0',
    },
  },
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['react', 'react-dom', 'react/jsx-runtime', '@devkrity/narad'],
});
