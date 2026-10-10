import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, forward API calls (including the voice WebSocket) to the Node service so the browser sees one origin.
export default defineConfig({
  plugins: [react()],
  build: {
    // The 3D teacher (three.js) is a separate chunk that loads on demand, so its size is expected.
    chunkSizeWarningLimit: 900,
  },
  server: {
    proxy: { "/api": { target: process.env.API_URL ?? "http://localhost:3000", ws: true } },
  },
});
