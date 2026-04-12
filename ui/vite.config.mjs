import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import react from "@vitejs/plugin-react";

const uiDir = path.dirname(fileURLToPath(import.meta.url));
const engineRoot = path.resolve(uiDir, "..");
const apiJs = path.join(engineRoot, "interfaces", "api.js");

export default {
  root: uiDir,
  plugins: [
    {
      name: "claira-api-browser-stub",
      enforce: "pre",
      resolveId(id) {
        const n = id.replace(/\\/g, "/");
        if (n.endsWith("/interfaces/api.js")) {
          return path.join(uiDir, "clairaApiClient.js");
        }
        return null;
      },
    },
    react(),
    {
      name: "claira-api-run",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== "/__claira/run" || req.method !== "POST") return next();
          try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            const api = await import(pathToFileURL(apiJs).href);
            let out;
            if (body.kind === "processFolder") {
              out = await api.processFolder(body.folderPath, body.cwd ? { cwd: body.cwd } : {});
            } else if (body.kind === "processData") {
              out = await api.processData(body.items, body.cwd ? { cwd: body.cwd } : {});
            } else if (body.kind === "ingestData") {
              out = await api.ingestData(body.payload, body.cwd ? { cwd: body.cwd } : {});
            } else if (body.kind === "getRooms") {
              out = api.getRooms();
            } else if (body.kind === "getSuggestions") {
              out = api.getSuggestions();
            } else {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "unknown kind" }));
              return;
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(out));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: e instanceof Error ? e.message : String(e),
              }),
            );
          }
        });
      },
    },
  ],
};
