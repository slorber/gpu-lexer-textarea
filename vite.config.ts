import { defineConfig } from 'vite';

export default defineConfig({
  // Relative URLs let dist/ work at a domain root or under a subdirectory.
  base: './',
  build: { target: 'chrome152' },
});
