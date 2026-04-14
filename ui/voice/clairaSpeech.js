/**
 * Claira speech: ElevenLabs via `/__claira/tts` only.
 *
 * - **interrupt: true** — cancel current audio, then play.
 * - **interrupt: false** — queue after current clip if playing.
 */

/** @type {Set<() => void>} */
const speechCompleteListeners = new Set();

function voiceDbg(...args) {
  if (import.meta.env?.DEV) {
    console.log("[Claira]", ...args);
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

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

/**
 * @returns {boolean}
 */
export function isClairaElevenLabsPlaying() {
  try {
    return Boolean(currentAudio && !currentAudio.paused && !currentAudio.ended);
  } catch {
    return false;
  }
}

/**
 * Resolves after the current ElevenLabs clip ends, or immediately if idle.
 * @returns {Promise<void>}
 */
export function afterCurrentClairaUtteranceOrNow() {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !isClairaElevenLabsPlaying()) {
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
  if (isClairaElevenLabsPlaying()) {
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

export function cancelClairaSpeech() {
  voiceDbg("cancelClairaSpeech()");
  playbackGeneration += 1;
  queuedNonInterruptText = null;
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
async function playElevenLabsUtterance(t, myGen) {
  voiceDbg("playElevenLabsUtterance called", { gen: myGen, textLen: t.length, preview: t.slice(0, 72) + (t.length > 72 ? "…" : "") });

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
    console.log("[Claira] requesting ElevenLabs...");
    const res = await fetch("/__claira/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: t }),
    });

    console.log("[Claira] response status:", res.status);

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = typeof errBody?.error === "string" ? errBody.error : `HTTP ${res.status}`;
      console.error("[Claira] ElevenLabs failed:", res.status, res.statusText, import.meta.env?.DEV ? errBody : "");
      throw new Error(msg);
    }

    voiceDbg("fetch succeeded", { status: res.status, contentType: res.headers.get("content-type") });

    if (myGen !== playbackGeneration) {
      voiceDbg("aborted: generation changed after fetch");
      return false;
    }

    const blob = await res.blob();
    const headerCt = res.headers.get("content-type") || "";
    console.log("[Claira] blob size:", blob.size);

    logIfUnexpectedAudioMime(headerCt, blob.type, blob.size);

    if (!blob.size || blob.type.includes("json") || headerCt.includes("application/json")) {
      throw new Error("TTS response was not audio — check dev server / .env (ELEVENLABS_API_KEY).");
    }

    if (myGen !== playbackGeneration) {
      voiceDbg("aborted: generation changed after blob");
      return false;
    }

    url = URL.createObjectURL(blob);
    voiceDbg("object URL created");

    if (myGen !== playbackGeneration) {
      dropLocals();
      return false;
    }

    currentObjectUrl = url;
    audio = new Audio();
    currentAudio = audio;
    audio.preload = "auto";
    audio.src = url;
    audio.load();

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

    const wait = await new Promise((resolve, reject) => {
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
        console.error("[Claira] audio element onerror");
        reject(new Error("audio playback failed"));
      };
    });

    if (wait === "superseded") {
      voiceDbg("playback superseded");
      dropLocals();
      return false;
    }

    dropLocals();
    notifyClairaSpeechComplete();
    return true;
  } catch (err) {
    dropLocals();
    if (myGen !== playbackGeneration) return false;
    if (import.meta.env?.DEV) {
      console.error("[Claira] playElevenLabsUtterance error (full):", err);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Claira] playElevenLabsUtterance error:", msg);
    }
    return false;
  }
}

/**
 * @param {string} text
 * @param {{ interrupt?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function speakClairaByMode(text, options = {}) {
  const interrupt = options.interrupt === true;
  const t = String(text ?? "").trim();
  console.log("[Claira] speak called:", t);
  voiceDbg("speakClairaByMode", { interrupt, empty: !t, textLen: t.length });

  if (!t) return;

  if (!interrupt && isClairaElevenLabsPlaying()) {
    voiceDbg("queue non-interrupt line (audio playing)");
    queuedNonInterruptText = t;
    return;
  }

  if (interrupt) {
    queuedNonInterruptText = null;
  }

  cancelClairaSpeech();
  const myGen = playbackGeneration;
  const ok = await playElevenLabsUtterance(t, myGen);
  if (ok) {
    voiceDbg("speakClairaByMode: ElevenLabs path finished OK");
    return;
  }
  if (myGen !== playbackGeneration) {
    voiceDbg("speakClairaByMode: aborted (superseded)");
    return;
  }
  if (import.meta.env?.DEV) {
    console.warn("[Claira] speakClairaByMode: ElevenLabs did not complete playback");
  }
}

/**
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function speakLiveVoice(text) {
  await speakClairaByMode(text, { interrupt: true });
}

/**
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function speakClairaUtterance(text) {
  await speakClairaByMode(text, { interrupt: true });
}
