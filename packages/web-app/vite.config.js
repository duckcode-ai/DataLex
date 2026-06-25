import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative base so the build works both standalone and when embedded under
  // /embed/datalex/ in the cloud shell. Safe because the app is hash-routed.
  base: "./",
  server: {
    proxy: {
      "/api": "http://localhost:3006"
    }
  }
});
