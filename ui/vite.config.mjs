import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { resetTunnelStagingTree } from "../interfaces/tunnelStaging.js";

const uiDir = path.dirname(fileURLToPath(import.meta.url));
const engineRoot = path.resolve(uiDir, "..");

const CLAIRA_API_PORT = Number(process.env.PORT) || 3000;

/**
 * Returns a Vite proxy `configure` callback that catches connection errors (e.g. Express
 * not running) and responds with a JSON `{ error }` payload instead of letting the request
 * fall through to Vite's own middleware, which would return an unhelpful HTML 404/502 page.
 *
 * @param {string} route - Path prefix, used only in the error message.
 */
function proxyErrorHandler(route) {
  return (proxy) => {
    proxy.on("error", (_err, _req, res) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `API server unavailable on port ${CLAIRA_API_PORT} (${route}). Run \`npm run start:server\` or \`npm run dev:full\`.`,
        }),
      );
    });
  };
}

export default {
  root: uiDir,
  /** Load `VITE_*` from repo root `.env` next to `server/` and `package.json`. */
  envDir: engineRoot,
  /** Workflow modules are imported for module health; stub Node builtins in the browser graph. */
  resolve: {
    alias: [
      { find: "node:fs", replacement: path.join(uiDir, "shims", "node-fs-browser.mjs") },
      /** Bare `fs` (e.g. `interfaces/api.js`) must not hit Node in the browser graph. */
      { find: "fs", replacement: path.join(uiDir, "shims", "node-fs-browser.mjs") },
      { find: "node:path", replacement: path.join(uiDir, "shims", "node-path-browser.mjs") },
    ],
  },
  server: {
    proxy: {
      /**
       * All /__claira/* and /api/* routes are proxied to the Express server.
       * In dev, run `npm run dev:full` (or `npm run start:server` alongside `npm run dev`)
       * so the Express server is available on PORT (default 3000).
       * In production, the static build is served behind the same host as Express.
       *
       * The `configure` callback on each entry handles connection errors — when the
       * Express server is down it returns JSON instead of falling through to Vite's own
       * middleware (which would produce an unhelpful "404 Cannot POST" HTML page).
       */

      /** Core engine API — platform-agnostic execution interface. */
      "/__claira/run": {
        target: `http://127.0.0.1:${CLAIRA_API_PORT}`,
        changeOrigin: true,
        configure: proxyErrorHandler("/__claira/run"),
      },
      /** TTS synthesis + status. */
      "/__claira/tts": {
        target: `http://127.0.0.1:${CLAIRA_API_PORT}`,
        changeOrigin: true,
        configure: proxyErrorHandler("/__claira/tts"),
      },
      /** Pack reference-asset file server. */
      "/__claira/pack-asset": {
        target: `http://127.0.0.1:${CLAIRA_API_PORT}`,
        changeOrigin: true,
        configure: proxyErrorHandler("/__claira/pack-asset"),
      },
      /** Tracking entity snapshot image server. */
      "/__claira/tracking-asset": {
        target: `http://127.0.0.1:${CLAIRA_API_PORT}`,
        changeOrigin: true,
        configure: proxyErrorHandler("/__claira/tracking-asset"),
      },
      /** Capability APIs. */
      "/api/capabilities": {
        target: `http://127.0.0.1:${CLAIRA_API_PORT}`,
        changeOrigin: true,
        configure: proxyErrorHandler("/api/capabilities"),
      },
      /** Shared contractor reports. */
      "/api/reports": {
        target: `http://127.0.0.1:${CLAIRA_API_PORT}`,
        changeOrigin: true,
        configure: proxyErrorHandler("/api/reports"),
      },
      /** Moves log. */
      "/api/logs": {
        target: `http://127.0.0.1:${CLAIRA_API_PORT}`,
        changeOrigin: true,
        configure: proxyErrorHandler("/api/logs"),
      },
      /** External integration API (/api/claira/health, /api/claira/run, etc.). */
      "/api/claira": {
        target: `http://127.0.0.1:${CLAIRA_API_PORT}`,
        changeOrigin: true,
        configure: proxyErrorHandler("/api/claira"),
      },
      /** Integration layer — platform webhook receivers (/api/integrations/wix, etc.). */
      "/api/integrations": {
        target: `http://127.0.0.1:${CLAIRA_API_PORT}`,
        changeOrigin: true,
        configure: proxyErrorHandler("/api/integrations"),
      },
    },
  },
  plugins: [
    {
      name: "claira-api-browser-stub",
      enforce: "pre",
      resolveId(id) {
        const n = String(id).replace(/\\/g, "/").split("?")[0].split("#")[0];
        if (n.endsWith("/interfaces/api.js")) {
          return path.join(uiDir, "clairaApiClient.js");
        }
        return null;
      },
    },
    react(),
    {
      name: "claira-api-run",
      configureServer() {
        /**
         * Reset the tunnel staging tree when the Vite dev server starts or restarts.
         * All API routes (/__claira/run, /api/logs, /__claira/pack-asset,
         * /__claira/tracking-asset) are now handled by the Express server and
         * proxied here via server.proxy — no middleware request handlers needed.
         */
        resetTunnelStagingTree();
      },
    },
  ],
};
