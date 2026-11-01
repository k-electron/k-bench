import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The server `pnpm dev` runs; the Dev instance listens on 7690 unless overridden.
const serverTarget = `http://127.0.0.1:${process.env.K_BENCH_PORT ?? 7690}`;
const login = process.env.K_BENCH_ALLOWED_LOGIN;

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve("web/src") } },
  // The app is one chunk served from the Host over the tailnet; xterm.js alone is ~300 kB.
  build: { outDir: "../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: {
    proxy: {
      // The API and the terminal WebSockets. Behind `tailscale serve` the login header is
      // added for us; in plain dev the proxy stands in for it.
      "/api": {
        target: serverTarget,
        ws: true,
        headers: login ? { "Tailscale-User-Login": login } : undefined,
      },
    },
  },
});
