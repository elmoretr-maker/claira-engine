/**
 * Claira voice — **single controller**: Edge TTS via `/__claira/tts` only (`provider: edge`).
 * All playback uses one `HTMLAudioElement` slot (`currentAudio`).
 *
 * - **interrupt: true** (default for `speakClaira`) — stop everything, then play.
 * - **interrupt: false** — queue after current clip if one is playing.
 */

/** @type {Set<() => void>} */
const speechCompleteListeners = new Set();

function voiceDbg(...args) {
  if (import.meta.env?.DEV) {
    console.log("[Claira]", ...args);
  }
}

/**
 * When the UI runs on Vite only, `/__claira/tts` is proxied to the Express API (PORT, default 3000).
 * If the API is not running, the proxy often returns 500/502 — not a stack-worthy failure.
 * @param {number} status
 */
function logTtsBackendUnavailableHint(status) {
  if (status === 500 || status === 502 || status === 503) {
    console.warn(
      `[Claira] TTS unavailable (HTTP ${status}). Start API + UI together: npm run dev:full — or run npm run start:server (PORT default 3000) beside npm run dev. Vite proxies /__claira/tts to the API.`,
    );
  }
}

/**
 * @param {string} headerCt
 * @param {string} blobType
 * @param {number} blobSize
 */
function logIfUnexpectedAudioMime(headerCt, blobType, blobSize) {
  if (!blobSize) return;
  const h = (headerCt || "").toLowerCase();
  const b = (blobType || "").toLowerCase();
  const ok =
    h.includes("audio/mpeg") ||
    h.includes("audio/mp3") ||
    h.includes("audio/wav") ||
    h.includes("audio/x-wav") ||
    b.includes("audio/mpeg") ||
    b.includes("audio/mp3") ||
    b.includes("audio/wav") ||
    b.includes("audio/x-wav");
  if (!ok) {
    console.error("[Claira] invalid audio response", {
      contentType: headerCt || "(none)",
      blobType: blobType || "(none)",
      blobSize,
    });
  }
}

/**
 * @param {HTMLMediaElement | null} media
 * @returns {string}
 */
function describeHtmlMediaError(media) {
  const e = media?.error;
  if (!e) return "unknown media error (no MediaError)";
  /** @type {Record<number, string>} */
  const names = {
    1: "MEDIA_ERR_ABORTED",
    2: "MEDIA_ERR_NETWORK",
    3: "MEDIA_ERR_DECODE",
    4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
  };
  const label = names[e.code] ?? `code_${e.code}`;
  return `${label}${e.message ? `: ${e.message}` : ""}`;
}

/**
 * Wait until the element can play through, or error — validates decode for many browsers.
 * @param {HTMLAudioElement} media
 * @param {number} myGen
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
function waitForAudioElementCanPlayThrough(media, myGen, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    if (myGen !== playbackGeneration) {
      resolve();
      return;
    }
    try {
      if (media.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
        resolve();
        return;
      }
    } catch {
      /* continue */
    }
    let to = 0;
    const cleanup = () => {
      if (to) window.clearTimeout(to);
      media.removeEventListener("canplaythrough", onReady);
      media.removeEventListener("error", onErr);
    };
    const onReady = () => {
      if (myGen !== playbackGeneration) {
        cleanup();
        reject(new Error("superseded"));
        return;
      }
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`audio load/decode: ${describeHtmlMediaError(media)}`));
    };
    to = window.setTimeout(() => {
      if (myGen !== playbackGeneration) {
        cleanup();
        reject(new Error("superseded"));
        return;
      }
      cleanup();
      reject(new Error("audio load timeout (canplaythrough)"));
    }, timeoutMs);
    media.addEventListener("canplaythrough", onReady, { once: true });
    media.addEventListener("error", onErr, { once: true });
  });
}

/** Stops Web Audio fallback when {@link cancelClairaSpeech} runs mid-utterance. */
let cancelWebAudioUtterance = null;

/**
 * Decode MP3 (or other supported codec) and play via Web Audio — works when HTMLAudioElement fails (e.g. some embedded webviews).
 * @param {ArrayBuffer} ab
 * @param {number} myGen
 * @returns {Promise<boolean>} true if playback finished
 */
function playArrayBufferWithWebAudio(ab, myGen) {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Web Audio: no window"));
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      reject(new Error("Web Audio API unavailable"));
      return;
    }
    const ctx = new AC();
    let source = /** @type {AudioBufferSourceNode | null} */ (null);
    let iv = /** @type {ReturnType<typeof setInterval> | null} */ (null);

    const teardown = () => {
      if (iv) {
        clearInterval(iv);
        iv = null;
      }
      cancelWebAudioUtterance = null;
      try {
        void ctx.close();
      } catch {
        /* ignore */
      }
    };

    const stopAll = () => {
      try {
        source?.stop(0);
      } catch {
        /* ignore */
      }
      source = null;
      teardown();
    };

    cancelWebAudioUtterance = () => {
      stopAll();
    };

    iv = setInterval(() => {
      if (myGen !== playbackGeneration) {
        stopAll();
        resolve(false);
      }
    }, 80);

    ctx
      .decodeAudioData(ab.slice(0))
      .then((buffer) => {
        if (myGen !== playbackGeneration) {
          stopAll();
          resolve(false);
          return;
        }
        source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => {
          if (iv) {
            clearInterval(iv);
            iv = null;
          }
          cancelWebAudioUtterance = null;
          try {
            void ctx.close();
          } catch {
            /* ignore */
          }
          resolve(true);
        };

        const start = () => {
          if (myGen !== playbackGeneration) {
            stopAll();
            resolve(false);
            return;
          }
          try {
            source?.start(0);
          } catch (e) {
            stopAll();
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        };

        if (ctx.state === "suspended") {
          void ctx.resume().then(start).catch(reject);
        } else {
          start();
        }
      })
      .catch((e) => {
        stopAll();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}

/**
 * @param {HTMLMediaElement} media
 * @param {number} myGen
 * @returns {Promise<void>}
 */
async function playWithAutoplayUnlock(media, myGen) {
  console.log("[Claira] attempting audio.play()");
  const tryOnce = () => media.play();

  try {
    await tryOnce();
    console.log("[Claira] audio playing");
    return;
  } catch (err) {
    console.error("[Claira] play failed:", err);
    const blocked =
      err instanceof DOMException
        ? err.name === "NotAllowedError"
        : typeof err === "object" &&
          err !== null &&
          "name" in err &&
          /** @type {{ name?: string }} */ (err).name === "NotAllowedError";
    if (!blocked) throw err;
    console.error("[Claira] autoplay blocked:", err);

    await new Promise((resolve, reject) => {
      let done = false;
      const teardown = () => {
        document.removeEventListener("pointerdown", onGesture, true);
        document.removeEventListener("keydown", onGesture, true);
      };
      const finish = (/** @type {boolean} */ ok, /** @type {unknown} */ e) => {
        if (done) return;
        done = true;
        teardown();
        if (ok) resolve(undefined);
        else reject(e instanceof Error ? e : new Error(String(e)));
      };
      const onGesture = () => {
        if (myGen !== playbackGeneration) {
          finish(false, new Error("superseded"));
          return;
        }
        void (async () => {
          try {
            console.log("[Claira] retrying audio.play() after user gesture");
            await tryOnce();
            console.log("[Claira] audio playing");
            finish(true, null);
          } catch (retryErr) {
            console.error("[Claira] play failed:", retryErr);
            finish(false, retryErr);
          }
        })();
      };
      document.addEventListener("pointerdown", onGesture, { capture: true, passive: true });
      document.addEventListener("keydown", onGesture, { capture: true });
    });
  }
}

/**
 * @param {() => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeClairaSpeechComplete(listener) {
  speechCompleteListeners.add(listener);
  return () => speechCompleteListeners.delete(listener);
}

function notifyClairaSpeechComplete() {
  voiceDbg("notifyClairaSpeechComplete (utterance ended)");
  for (const fn of [...speechCompleteListeners]) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
  void tryDrainQueuedUtterance();
}

/** @type {number} */
let playbackGeneration = 0;

/** @type {HTMLAudioElement | null} */
let currentAudio = null;

/** @type {string | null} */
let currentObjectUrl = null;

/** Next line when `interrupt: false` while audio is playing (single slot). */
let queuedNonInterruptText = null;

let playbackPrimed = false;

/** @type {string} */
const VOICE_CLIENT_INIT_KEY = "__clairaVoiceClientInitPromise";

/**
 * Idempotent client-side voice warm-up: best-effort `primeClairaVoicePlayback` only.
 * Does not call the API (avoids 500s in the console when only Vite is running without `start:server`).
 * When the API is up, TTS status is still available at GET `/__claira/tts/status` (manual or tooling).
 * Survives Vite HMR by storing the promise on `window`. Never throws to callers.
 * @returns {Promise<void>}
 */
export function initClairaVoiceClient() {
  if (typeof window === "undefined") return Promise.resolve();
  const g = /** @type {Window & { [VOICE_CLIENT_INIT_KEY]?: Promise<void> }} */ (window);
  const existing = g[VOICE_CLIENT_INIT_KEY];
  if (existing) return existing;
  const p = (async () => {
    try {
      await primeClairaVoicePlayback();
    } catch {
      /* autoplay policy — pointer listener still unlocks later */
    }
  })();
  g[VOICE_CLIENT_INIT_KEY] = p;
  return p;
}

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

/**
 * @returns {boolean}
 */
export function isClairaVoicePlaying() {
  try {
    return Boolean(currentAudio && !currentAudio.paused && !currentAudio.ended);
  } catch {
    return false;
  }
}

/** @deprecated Use {@link isClairaVoicePlaying}. */
export const isClairaElevenLabsPlaying = isClairaVoicePlaying;

/**
 * Resolves after the current clip ends, or immediately if idle.
 * @returns {Promise<void>}
 */
export function afterCurrentClairaUtteranceOrNow() {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !isClairaVoicePlaying()) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        unsub();
      } catch {
        /* ignore */
      }
      resolve();
    };
    const unsub = subscribeClairaSpeechComplete(finish);
    window.setTimeout(finish, 30000);
  });
}

async function tryDrainQueuedUtterance() {
  const next = queuedNonInterruptText;
  if (!next) return;
  queuedNonInterruptText = null;
  if (isClairaVoicePlaying()) {
    queuedNonInterruptText = next;
    return;
  }
  voiceDbg("drain queue → speakClairaByMode (non-interrupt)");
  await speakClairaByMode(next, { interrupt: false });
}

/**
 * @returns {Promise<void>}
 */
export async function primeClairaVoicePlayback() {
  voiceDbg("primeClairaVoicePlayback()");
  if (typeof window === "undefined" || playbackPrimed) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const ctx = new AC();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const buffer = ctx.createBuffer(1, 1, 8000);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
      await ctx.close();
    }
  } catch {
    /* continue */
  }
  try {
    const a = new Audio(SILENT_WAV);
    a.volume = 0.01;
    await a.play();
    a.pause();
    playbackPrimed = true;
    voiceDbg("primeClairaVoicePlayback: audio unlock OK");
  } catch (e) {
    voiceDbg("primeClairaVoicePlayback: audio unlock failed (may need user gesture)", e);
  }
}

/**
 * Pause current TTS without destroying the buffer (for UI that pauses video + voice together).
 * @returns {void}
 */
export function pauseClairaSpeechPlayback() {
  if (typeof window === "undefined") return;
  try {
    if (currentAudio && !currentAudio.ended) {
      currentAudio.pause();
    }
  } catch {
    /* ignore */
  }
}

/**
 * Resume TTS after {@link pauseClairaSpeechPlayback} (no-op if nothing paused).
 * @returns {void}
 */
export function resumeClairaSpeechPlayback() {
  if (typeof window === "undefined") return;
  try {
    if (currentAudio && currentAudio.paused && !currentAudio.ended) {
      void currentAudio.play();
    }
  } catch {
    /* ignore */
  }
}

export function cancelClairaSpeech() {
  voiceDbg("cancelClairaSpeech()");
  playbackGeneration += 1;
  queuedNonInterruptText = null;
  if (cancelWebAudioUtterance) {
    try {
      cancelWebAudioUtterance();
    } catch {
      /* ignore */
    }
    cancelWebAudioUtterance = null;
  }
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.removeAttribute("src");
      currentAudio.load();
    } catch {
      /* ignore */
    }
    currentAudio = null;
  }
  if (currentObjectUrl) {
    try {
      URL.revokeObjectURL(currentObjectUrl);
    } catch {
      /* ignore */
    }
    currentObjectUrl = null;
  }
}

/**
 * @param {string} t
 * @param {number} myGen
 * @returns {Promise<boolean>}
 */
/**
 * Edge-only fetch — server must synthesize with Microsoft neural TTS (see lib/clairaEdgeTtsVoice.mjs).
 *
 * @param {string} t
 * @returns {Promise<Response>}
 */
async function fetchClairaEdgeTts(t) {
  if (import.meta.env?.DEV) {
    console.log("[Claira] requesting TTS… (Edge via /__claira/tts)");
  }
  return fetch("/__claira/tts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Claira-TTS-Provider": "edge",
    },
    body: JSON.stringify({ text: t, provider: "edge" }),
  });
}

async function playClairaTtsUtterance(t, myGen) {
  voiceDbg("playClairaTtsUtterance", { gen: myGen, textLen: t.length, preview: t.slice(0, 72) + (t.length > 72 ? "…" : "") });

  let audio = null;
  let url = null;

  const dropLocals = () => {
    if (audio) {
      try {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch {
        /* ignore */
      }
    }
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
    if (currentAudio === audio) currentAudio = null;
    if (currentObjectUrl === url) currentObjectUrl = null;
    audio = null;
    url = null;
  };

  try {
    const res = await fetchClairaEdgeTts(t);

    if (import.meta.env?.DEV) {
      console.log("[Claira] response status:", res.status);
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      logTtsBackendUnavailableHint(res.status);
      if (import.meta.env?.DEV && Object.keys(errBody).length > 0) {
        console.warn("[Claira] TTS error body:", errBody);
      }
      dropLocals();
      if (myGen !== playbackGeneration) return false;
      return false;
    }

    voiceDbg("fetch succeeded", { status: res.status, contentType: res.headers.get("content-type") });

    if (myGen !== playbackGeneration) {
      voiceDbg("aborted: generation changed after fetch");
      return false;
    }

    const ab = await res.arrayBuffer();
    const headerCt = res.headers.get("content-type") || "";
    const mimePart = headerCt.split(";")[0].trim().toLowerCase();
    const blobMime = mimePart.startsWith("audio/") ? mimePart : "audio/mpeg";
    const safeBlob = new Blob([ab], { type: blobMime });

    console.log("[Claira] buffer size:", ab.byteLength);

    logIfUnexpectedAudioMime(headerCt, blobMime, ab.byteLength);

    if (!ab.byteLength || headerCt.includes("application/json")) {
      console.warn(
        "[Claira] TTS response was not audio — check API on PORT and POST /__claira/tts (Edge).",
      );
      dropLocals();
      if (myGen !== playbackGeneration) return false;
      return false;
    }

    if (myGen !== playbackGeneration) {
      voiceDbg("aborted: generation changed after buffer");
      return false;
    }

    url = URL.createObjectURL(safeBlob);
    voiceDbg("object URL created");

    if (myGen !== playbackGeneration) {
      dropLocals();
      return false;
    }

    currentObjectUrl = url;
    audio = new Audio();
    currentAudio = audio;
    try {
      audio.playsInline = true;
      audio.setAttribute("playsInline", "");
    } catch {
      /* ignore */
    }
    audio.preload = "auto";
    audio.src = url;
    audio.load();

    if (myGen !== playbackGeneration) {
      dropLocals();
      return false;
    }

    try {
      await waitForAudioElementCanPlayThrough(audio, myGen);
    } catch (loadErr) {
      const msg = loadErr instanceof Error ? loadErr.message : String(loadErr);
      if (msg === "superseded" || msg.includes("superseded")) {
        dropLocals();
        return false;
      }
      voiceDbg("HTMLAudio load/decode failed; trying Web Audio", loadErr);
      dropLocals();
      if (myGen !== playbackGeneration) return false;
      try {
        const ok = await playArrayBufferWithWebAudio(ab, myGen);
        if (!ok) return false;
        notifyClairaSpeechComplete();
        return true;
      } catch (we) {
        console.error("[Claira] Web Audio fallback failed after load error:", we);
        if (myGen !== playbackGeneration) return false;
        throw we;
      }
    }

    if (myGen !== playbackGeneration) {
      dropLocals();
      return false;
    }

    try {
      await playWithAutoplayUnlock(audio, myGen);
    } catch (playErr) {
      if (myGen !== playbackGeneration) {
        dropLocals();
        return false;
      }
      throw playErr;
    }

    if (myGen !== playbackGeneration) {
      dropLocals();
      return false;
    }

    const wait = await new Promise((resolve) => {
      let iv = setInterval(() => {
        if (myGen !== playbackGeneration) {
          if (iv) clearInterval(iv);
          iv = null;
          try {
            audio?.pause();
          } catch {
            /* ignore */
          }
          resolve(/** @type {const} */ ("superseded"));
        }
      }, 80);

      const stopIv = () => {
        if (iv) clearInterval(iv);
        iv = null;
      };

      audio.onended = () => {
        stopIv();
        voiceDbg("audio element onended (playback success)");
        resolve(/** @type {const} */ ("done"));
      };
      audio.onerror = () => {
        stopIv();
        console.error("[Claira] audio element onerror", describeHtmlMediaError(audio));
        resolve(/** @type {const} */ ("element_failed"));
      };
    });

    if (wait === "superseded") {
      voiceDbg("playback superseded");
      dropLocals();
      return false;
    }

    if (wait === "element_failed") {
      voiceDbg("HTMLAudio playback error; trying Web Audio decode path");
      dropLocals();
      if (myGen !== playbackGeneration) return false;
      try {
        const ok = await playArrayBufferWithWebAudio(ab, myGen);
        if (!ok) return false;
        notifyClairaSpeechComplete();
        return true;
      } catch (we) {
        console.error("[Claira] Web Audio fallback failed after element error:", we);
        if (myGen !== playbackGeneration) return false;
        throw we;
      }
    }

    dropLocals();
    notifyClairaSpeechComplete();
    return true;
  } catch (err) {
    dropLocals();
    if (myGen !== playbackGeneration) return false;
    const msg = err instanceof Error ? err.message : String(err);
    if (import.meta.env?.DEV) {
      console.warn("[Claira] TTS request/playback failed:", msg);
    } else {
      console.warn("[Claira] TTS failed:", msg);
    }
    return false;
  }
}

/**
 * Primary API — all Claira voice should go through this or {@link speakClairaByMode}.
 *
 * @param {string} text
 * @param {{ interrupt?: boolean }} [options] — default `interrupt: true` (hard-stop then speak).
 * @returns {Promise<void>}
 */
export async function speakClaira(text, options = {}) {
  const interrupt = options.interrupt !== false;
  await speakClairaByMode(text, { interrupt });
}

/**
 * @param {string} text
 * @param {{ interrupt?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function speakClairaByMode(text, options = {}) {
  try {
    const interrupt = options.interrupt === true;
    const t = String(text ?? "").trim();
    if (import.meta.env?.DEV) {
      console.log("[Claira] speak called:", t);
    }
    voiceDbg("speakClairaByMode", { interrupt, empty: !t, textLen: t.length });

    if (!t) return;

    if (!interrupt && isClairaVoicePlaying()) {
      voiceDbg("queue non-interrupt line (audio playing)");
      queuedNonInterruptText = t;
      return;
    }

    if (interrupt) {
      queuedNonInterruptText = null;
    }

    cancelClairaSpeech();
    const myGen = playbackGeneration;
    const ok = await playClairaTtsUtterance(t, myGen);
    if (ok) {
      voiceDbg("speakClairaByMode: TTS playback finished OK");
      return;
    }
    if (myGen !== playbackGeneration) {
      voiceDbg("speakClairaByMode: aborted (superseded)");
      return;
    }
    if (import.meta.env?.DEV) {
      console.warn("[Claira] speakClairaByMode: TTS did not complete playback");
    }
  } catch (e) {
    console.warn("[Claira] speakClairaByMode:", e instanceof Error ? e.message : e);
  }
}

/**
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function speakLiveVoice(text) {
  await speakClaira(text, { interrupt: true });
}

/**
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function speakClairaUtterance(text) {
  await speakClaira(text, { interrupt: true });
}
