import { defineConfig } from 'vite';

// The app is published as a GitHub Pages *project* site at
// https://<user>.github.io/trip_planner/, so all asset URLs must be
// prefixed with the repository name.
export default defineConfig({
  base: '/trip_planner/',
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
