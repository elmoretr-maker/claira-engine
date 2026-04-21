/**
 * Claira Desktop — Electron main process (CommonJS).
 *
 * This file is intentionally .cjs so it loads as CommonJS even though the
 * root package.json declares "type": "module". Electron's main process is
 * a Node environment and works cleanly with CommonJS.
 *
 * Startup sequence:
 *   1. Spawn the Express server (server/index.js) as a child process.
 *   2. Watch server stdout for "CLAIRA_SERVER_READY:<port>" — no HTTP polling.
 *   3. Parse the actual port (handles auto-selection when 3000 is taken).
 *   4. Open a BrowserWindow at the correct URL.
 *   5. Kill the server process tree when all windows close.
 */

"use strict";

const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "..");
const ICON_PATH = path.join(REPO_ROOT, "ui", "public", "icons", "icon-512.png");
const SERVER_ENTRY = path.join(REPO_ROOT, "server", "index.js");
const ENV_FILE = path.join(REPO_ROOT, ".env");

// Preferred port — may differ from the actual port if this one is occupied.
const PREFERRED_PORT = Number(process.env.PORT) || 3000;

// ---------------------------------------------------------------------------
// Server child process
// ---------------------------------------------------------------------------

/** @type {import("child_process").ChildProcess | null} */
let serverProcess = null;

/**
 * Spawn the Express server and return a Promise that resolves with the actual
 * port number once the server emits "CLAIRA_SERVER_READY:<port>" on stdout.
 *
 * Rejects if:
 *   - The server process emits an error before the ready signal.
 *   - The server process exits (non-zero) before the ready signal.
 *   - `timeoutMs` elapses without a ready signal.
 *
 * @param {number} timeoutMs
 * @returns {Promise<number>} Resolved port number.
 */
function startServer(timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const args = [];

    // --env-file flag requires Node 20+
    const [majorVer] = process.versions.node.split(".").map(Number);
    if (majorVer >= 20) {
      args.push(`--env-file=${ENV_FILE}`);
    }
    args.push(SERVER_ENTRY);

    serverProcess = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      // Pipe stdout/stderr so we can watch for the ready signal and forward logs.
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: String(PREFERRED_PORT) },
      // Windows: create a new process group so we can kill the entire tree.
      detached: false,
    });

    let settled = false;
    let stdoutBuffer = "";

    function settle(fn) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    }

    // ── Timeout ──────────────────────────────────────────────────────────────
    const timer = setTimeout(() => {
      settle(() =>
        reject(new Error(`[Claira] Server did not become ready within ${timeoutMs / 1000}s`))
      );
    }, timeoutMs);

    // ── stdout: watch for ready signal, forward everything else ──────────────
    serverProcess.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text); // forward so developers can see server logs

      stdoutBuffer += text;

      // The server emits exactly one line: "CLAIRA_SERVER_READY:<port>"
      const match = stdoutBuffer.match(/CLAIRA_SERVER_READY:(\d+)/);
      if (match) {
        const port = parseInt(match[1], 10);
        settle(() => resolve(port));
      }
    });

    // ── stderr: always forward, never suppress ───────────────────────────────
    serverProcess.stderr.on("data", (chunk) => {
      process.stderr.write(chunk); // forward verbatim
    });

    // ── Process error (e.g. executable not found) ────────────────────────────
    serverProcess.on("error", (err) => {
      console.error("[Claira] Failed to start Express server:", err.message);
      settle(() => reject(err));
    });

    // ── Unexpected exit before ready ─────────────────────────────────────────
    serverProcess.on("exit", (code, signal) => {
      if (code !== 0 || signal) {
        const reason = signal ? `signal ${signal}` : `exit code ${code}`;
        const msg = `[Claira] Express server exited (${reason}) before becoming ready`;
        console.error(msg);
        settle(() => reject(new Error(msg)));
      }
      // code === 0 means intentional clean exit — nothing to reject.
      serverProcess = null;
    });
  });
}

/**
 * Terminate the server process. On Windows, sends SIGTERM; the process tree
 * is cleaned up because we did NOT use `detached: true`.
 */
function stopServer() {
  if (!serverProcess) return;

  try {
    // On Windows, process.kill(pid) is the most reliable way to terminate.
    if (process.platform === "win32" && serverProcess.pid) {
      const { execSync } = require("child_process");
      try {
        execSync(`taskkill /F /T /PID ${serverProcess.pid}`, { stdio: "ignore" });
      } catch {
        serverProcess.kill();
      }
    } else {
      serverProcess.kill("SIGTERM");
    }
  } catch (err) {
    console.warn("[Claira] Could not terminate server process:", err.message);
  }

  serverProcess = null;
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

/** @type {BrowserWindow | null} */
let mainWindow = null;

/**
 * @param {number} port - Resolved port the Express server is listening on.
 */
function createWindow(port) {
  const appUrl = `http://127.0.0.1:${port}`;

  mainWindow = new BrowserWindow({
    title: "Claira",
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    icon: ICON_PATH,
    autoHideMenuBar: true,
    backgroundColor: "#0b0f14", // prevents white flash before content paints
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Disable DevTools in packaged builds; keep available in dev.
      devTools: !app.isPackaged,
    },
    show: false, // reveal only after content is painted — no blank flash
  });

  mainWindow.loadURL(appUrl);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Open external links in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Prevent navigation away from the app URL (safety guard).
  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    if (!navigationUrl.startsWith(appUrl)) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  let port;

  try {
    console.log("[Claira] Starting Express server…");
    port = await startServer();
    console.log(`[Claira] Server ready on port ${port}`);
  } catch (err) {
    console.error("[Claira] Cannot start — server failed:", err.message);
    stopServer();
    app.quit();
    return;
  }

  createWindow(port);

  // macOS: re-open window when dock icon is clicked and all windows are closed.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(port);
    }
  });
});

// Quit when all windows are closed (except macOS).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopServer();
    app.quit();
  }
});

// Last-chance cleanup — fires before Electron fully exits.
app.on("will-quit", () => {
  stopServer();
});
