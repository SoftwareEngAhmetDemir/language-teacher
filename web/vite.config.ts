import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, forward API calls (including the voice WebSocket) to the Node service so the browser sees one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": { target: process.env.API_URL ?? "http://localhost:3000", ws: true } },
  },
});
