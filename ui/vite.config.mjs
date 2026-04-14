import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import react from "@vitejs/plugin-react";
import { resetTunnelStagingTree } from "../interfaces/tunnelStaging.js";

const uiDir = path.dirname(fileURLToPath(import.meta.url));
const engineRoot = path.resolve(uiDir, "..");
const apiJs = path.join(engineRoot, "interfaces", "api.js");

const CLAIRA_API_PORT = Number(process.env.PORT) || 3000;

/**
 * @param {string} name
 */
function contentTypeForBasename(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

export default {
  root: uiDir,
  server: {
    proxy: {
      "/__claira/tts": {
        target: `http://127.0.0.1:${CLAIRA_API_PORT}`,
        changeOrigin: true,
      },
    },
  },
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
        resetTunnelStagingTree();
        server.middlewares.use(async (req, res, next) => {
          if (req.method === "GET") {
            const pathname = req.url?.split("?")[0];
            if (pathname === "/api/logs") {
              try {
                const logPath = path.join(engineRoot, "logs", "moves.log");
                const body = existsSync(logPath) ? await readFile(logPath, "utf8") : "";
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                res.end(body);
              } catch (e) {
                res.statusCode = 500;
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                res.end(e instanceof Error ? e.message : String(e));
              }
              return;
            }
            if (pathname === "/__claira/pack-asset") {
              try {
                const u = new URL(req.url || "/", "http://claira.local");
                const industry = String(u.searchParams.get("industry") ?? "")
                  .trim()
                  .toLowerCase();
                const category = String(u.searchParams.get("category") ?? "").trim();
                const kindRaw = String(u.searchParams.get("kind") ?? "images").toLowerCase();
                const kind = kindRaw === "documents" ? "documents" : "images";
                const file = String(u.searchParams.get("file") ?? "").trim();
                if (!/^[a-z0-9_-]+$/i.test(industry)) {
                  res.statusCode = 400;
                  res.end("invalid industry");
                  return;
                }
                if (!category || category.includes("..") || /[/\\]/.test(category)) {
                  res.statusCode = 400;
                  res.end("invalid category");
                  return;
                }
                if (!/^[\w.-]+$/i.test(file)) {
                  res.statusCode = 400;
                  res.end("invalid file");
                  return;
                }
                const base = path.resolve(
                  engineRoot,
                  "packs",
                  industry,
                  "reference_assets",
                  kind,
                  category,
                );
                const full = path.resolve(base, file);
                const rel = path.relative(base, full);
                if (rel.startsWith("..") || path.isAbsolute(rel)) {
                  res.statusCode = 403;
                  res.end("forbidden");
                  return;
                }
                if (!existsSync(full)) {
                  res.statusCode = 404;
                  res.end("not found");
                  return;
                }
                const buf = readFileSync(full);
                res.setHeader("Content-Type", contentTypeForBasename(file));
                res.end(buf);
              } catch (e) {
                res.statusCode = 500;
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                res.end(e instanceof Error ? e.message : String(e));
              }
              return;
            }
            if (pathname === "/__claira/tracking-asset") {
              try {
                const u = new URL(req.url || "/", "http://claira.local");
                const entity = String(u.searchParams.get("entity") ?? "")
                  .trim()
                  .toLowerCase();
                const file = String(u.searchParams.get("file") ?? "").trim();
                if (!/^e_[a-z0-9_-]+$/i.test(entity)) {
                  res.statusCode = 400;
                  res.end("invalid entity");
                  return;
                }
                if (!/^[\w.-]+$/i.test(file)) {
                  res.statusCode = 400;
                  res.end("invalid file");
                  return;
                }
                const base = path.resolve(engineRoot, "tracking", "images", entity);
                const full = path.resolve(base, file);
                const rel = path.relative(base, full);
                if (rel.startsWith("..") || path.isAbsolute(rel)) {
                  res.statusCode = 403;
                  res.end("forbidden");
                  return;
                }
                if (!existsSync(full)) {
                  res.statusCode = 404;
                  res.end("not found");
                  return;
                }
                const buf = readFileSync(full);
                res.setHeader("Content-Type", contentTypeForBasename(file));
                res.end(buf);
              } catch (e) {
                res.statusCode = 500;
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                res.end(e instanceof Error ? e.message : String(e));
              }
              return;
            }
          }
          if (req.url !== "/__claira/run" || req.method !== "POST") return next();
          try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            const api = await import(pathToFileURL(apiJs).href);
            let out;
            if (body.kind === "processFolder") {
              const opts = {};
              if (body.cwd) opts.cwd = body.cwd;
              if (body.runtimeContext && typeof body.runtimeContext === "object") {
                opts.runtimeContext = body.runtimeContext;
              }
              out = await api.processFolder(body.folderPath, opts);
            } else if (body.kind === "processData") {
              const opts = {};
              if (body.cwd) opts.cwd = body.cwd;
              if (body.runtimeContext && typeof body.runtimeContext === "object") {
                opts.runtimeContext = body.runtimeContext;
              }
              out = await api.processData(body.items, opts);
            } else if (body.kind === "applyDecision") {
              out = await api.applyDecision({
                predicted_label: body.predicted_label,
                selected_label: body.selected_label,
                confidence: body.confidence,
                filePath: body.filePath,
                file: body.filePath ?? body.file,
                scope: body.scope,
                extractedText: body.extractedText,
                classification: body.classification,
                mismatchSeverity: body.mismatchSeverity,
                mismatchFingerprint: body.mismatchFingerprint,
                mismatchReason: body.mismatchReason,
              });
            } else if (body.kind === "getRiskInsights") {
              out = api.getRiskInsights();
            } else if (body.kind === "ingestData") {
              out = await api.ingestData(body.payload, body.cwd ? { cwd: body.cwd } : {});
            } else if (body.kind === "getRooms") {
              out = api.getRooms();
            } else if (body.kind === "getSuggestions") {
              out = api.getSuggestions();
            } else if (body.kind === "loadIndustryPack") {
              out = await api.loadIndustryPack(body.industry);
            } else if (body.kind === "listIndustryPacks") {
              out = api.listIndustryPacksApi();
            } else if (body.kind === "checkInternetConnection") {
              out = await api.checkInternetConnectionApi();
            } else if (body.kind === "createIndustryFromInput") {
              out = await api.createIndustryFromInputApi({
                industryName: typeof body.industryName === "string" ? body.industryName : "",
              });
            } else if (body.kind === "confirmIndustryPackActivation") {
              out = await api.confirmIndustryPackActivationApi({
                slug: typeof body.slug === "string" ? body.slug : "",
              });
            } else if (body.kind === "getIndustryBuildReport") {
              out = api.getIndustryBuildReportApi({
                slug: typeof body.slug === "string" ? body.slug : "",
              });
            } else if (body.kind === "autoImproveIndustryPack") {
              out = api.autoImproveIndustryPackApi({
                slug: typeof body.slug === "string" ? body.slug : "",
              });
            } else if (body.kind === "getActiveReferenceAssets") {
              out = api.getActiveReferenceAssetsApi(
                typeof body.category === "string" ? body.category : "",
                typeof body.industry === "string" ? body.industry : undefined,
              );
            } else if (body.kind === "getStructureCategories") {
              out = api.getStructureCategories(body.cwd ? { cwd: body.cwd } : {});
            } else if (body.kind === "getPackReference") {
              out = api.getPackReference(body.cwd ? { cwd: body.cwd } : {});
            } else if (body.kind === "getPackProcesses") {
              out = api.getPackProcesses({
                industry: typeof body.industry === "string" ? body.industry : undefined,
                cwd: body.cwd ? body.cwd : undefined,
              });
            } else if (body.kind === "ensureCapabilityOutputFolders") {
              out = api.ensureCapabilityOutputFoldersApi(
                Array.isArray(body.selectedKeys) ? body.selectedKeys : [],
                body.cwd ? { cwd: body.cwd } : {},
              );
            } else if (body.kind === "tunnelUploadStaged") {
              const files = Array.isArray(body.files) ? body.files : [];
              out = api.tunnelUploadStaged(body.category, files, {
                uploadTag: body.uploadTag,
              });
            } else if (body.kind === "getIndustryFeatures") {
              out = api.getIndustryFeaturesApi({
                industry: typeof body.industry === "string" ? body.industry : "",
              });
            } else if (body.kind === "getTrackingConfig") {
              out = api.getTrackingConfigApi({
                industry: typeof body.industry === "string" ? body.industry : "",
              });
            } else if (body.kind === "categoryTrackingSupport") {
              out = api.categoryTrackingSupportApi({
                industry: typeof body.industry === "string" ? body.industry : "",
                categoryKey: typeof body.categoryKey === "string" ? body.categoryKey : "",
              });
            } else if (body.kind === "listTrackingEntities") {
              out = api.listTrackingEntitiesApi({
                industry: typeof body.industry === "string" ? body.industry : "",
              });
            } else if (body.kind === "createTrackingEntity") {
              out = api.createTrackingEntityApi({
                name: typeof body.name === "string" ? body.name : "",
                category: typeof body.category === "string" ? body.category : "",
                industry: typeof body.industry === "string" ? body.industry : "",
              });
            } else if (body.kind === "addTrackingSnapshot") {
              out = await api.addTrackingSnapshotApi({
                entityId: typeof body.entityId === "string" ? body.entityId : "",
                imageBase64: typeof body.imageBase64 === "string" ? body.imageBase64 : "",
                manualMetrics:
                  body.manualMetrics && typeof body.manualMetrics === "object" ? body.manualMetrics : undefined,
                categoryKey: typeof body.categoryKey === "string" ? body.categoryKey : "",
                industrySlug: typeof body.industrySlug === "string" ? body.industrySlug : "",
              });
            } else if (body.kind === "listTrackingSnapshots") {
              out = api.listTrackingSnapshotsApi({
                entityId: typeof body.entityId === "string" ? body.entityId : "",
              });
            } else if (body.kind === "getTrackingProgress") {
              out = api.getTrackingProgressApi({
                entityId: typeof body.entityId === "string" ? body.entityId : "",
              });
            } else if (body.kind === "workspaceScan") {
              out = api.workspaceScanApi({
                accountId: typeof body.accountId === "string" ? body.accountId : undefined,
                mode: typeof body.mode === "string" ? body.mode : undefined,
                industry: typeof body.industry === "string" ? body.industry : "",
              });
            } else if (body.kind === "workspaceSync") {
              out = api.workspaceSyncApi({
                accountId: typeof body.accountId === "string" ? body.accountId : undefined,
                mode: typeof body.mode === "string" ? body.mode : undefined,
                industry: typeof body.industry === "string" ? body.industry : "",
                operations: Array.isArray(body.operations) ? body.operations : [],
              });
            } else if (body.kind === "workspaceSimulationIngest") {
              out = api.workspaceSimulationIngestApi({
                accountId: typeof body.accountId === "string" ? body.accountId : undefined,
                mode: typeof body.mode === "string" ? body.mode : undefined,
                industry: typeof body.industry === "string" ? body.industry : "",
                files: Array.isArray(body.files) ? body.files : [],
              });
            } else if (body.kind === "workspaceGeneratorSnapshot") {
              out = api.workspaceGeneratorSnapshotApi({
                accountId: typeof body.accountId === "string" ? body.accountId : undefined,
                mode: typeof body.mode === "string" ? body.mode : undefined,
                industry: typeof body.industry === "string" ? body.industry : "",
              });
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
