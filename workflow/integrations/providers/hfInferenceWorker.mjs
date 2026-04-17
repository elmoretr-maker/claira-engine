/**
 * Child-process worker: Hugging Face Inference API — CLIP zero-shot (openai/clip-vit-base-patch32).
 * Single JSON line to stdout: { ok: true, result } | { ok: false, reason?, error? }
 * Exit code 0 always; parent treats ok !== true as fallback to heuristic.
 */
import fs from "node:fs";
import path from "node:path";

const CLIP_ENDPOINT =
  process.env.HF_CLIP_ENDPOINT ||
  "https://api-inference.huggingface.co/models/openai/clip-vit-base-patch32";

const CANDIDATE_LABELS = [
  "a natural photograph",
  "a scanned document",
  "a digital screenshot",
  "a business invoice or form",
  "a video game asset",
];

/**
 * @param {unknown} data
 * @returns {Array<{ label: string, score: number }>}
 */
function parseZeroShotResponse(data) {
  if (Array.isArray(data)) {
    return data
      .map((row) => {
        if (row == null || typeof row !== "object" || Array.isArray(row)) return null;
        const o = /** @type {Record<string, unknown>} */ (row);
        const label = typeof o.label === "string" ? o.label : "";
        const score = typeof o.score === "number" && Number.isFinite(o.score) ? o.score : NaN;
        if (!label || Number.isNaN(score)) return null;
        return { label, score };
      })
      .filter((x) => x != null);
  }
  if (data != null && typeof data === "object" && !Array.isArray(data)) {
    const o = /** @type {Record<string, unknown>} */ (data);
    const labels = o.labels;
    const scores = o.scores;
    if (Array.isArray(labels) && Array.isArray(scores) && labels.length === scores.length) {
      /** @type {Array<{ label: string, score: number }>} */
      const out = [];
      for (let i = 0; i < labels.length; i++) {
        const label = String(labels[i] ?? "");
        const score = typeof scores[i] === "number" && Number.isFinite(scores[i]) ? scores[i] : NaN;
        if (label && !Number.isNaN(score)) out.push({ label, score });
      }
      return out;
    }
  }
  return [];
}

/**
 * @param {Array<{ label: string, score: number }>} ranked
 */
function toAnalysisResult(ranked) {
  const sorted = [...ranked].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const category = top.label.slice(0, 240);
  const confidence = Math.min(1, Math.max(0, top.score));
  return {
    category,
    labels: sorted.map((x) => x.label),
    confidence,
    features: {
      provider: "huggingface",
      model: "openai/clip-vit-base-patch32",
      zeroShot: true,
      ranked: sorted.map((x) => ({ label: x.label, score: x.score })),
      candidateLabels: CANDIDATE_LABELS,
    },
    embeddings: null,
    modelSource: "external",
    provider: "huggingface",
  };
}

(async function main() {
  const ref = String(process.env.HF_ASSET_REF ?? "").trim();
  if (process.env.HF_DISABLE === "1" || !ref) {
    console.log(JSON.stringify({ ok: false, reason: "disabled_or_empty" }));
    return;
  }

  const token =
    process.env.HUGGINGFACE_API_TOKEN ||
    process.env.HF_TOKEN ||
    process.env.HUGGING_FACE_HUB_TOKEN ||
    "";

  if (!token) {
    console.log(JSON.stringify({ ok: false, reason: "no_token" }));
    return;
  }

  const timeoutMs = Math.min(
    120_000,
    Math.max(3000, Number(process.env.HF_TIMEOUT_MS || 45_000) || 45_000),
  );

  /** @type {string} */
  let inputs;
  if (/^https?:\/\//i.test(ref)) {
    inputs = ref;
  } else {
    const resolved = path.isAbsolute(ref) ? ref : path.resolve(process.cwd(), ref);
    if (!fs.existsSync(resolved)) {
      console.log(JSON.stringify({ ok: false, reason: "not_found", path: resolved }));
      return;
    }
    inputs = fs.readFileSync(resolved).toString("base64");
  }

  const body = JSON.stringify({
    inputs,
    parameters: {
      candidate_labels: CANDIDATE_LABELS,
    },
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(CLIP_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
      signal: ac.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) {
      console.log(
        JSON.stringify({
          ok: false,
          reason: "api_http",
          status: res.status,
          detail: text.slice(0, 800),
        }),
      );
      return;
    }
    /** @type {unknown} */
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.log(JSON.stringify({ ok: false, reason: "invalid_json", detail: text.slice(0, 200) }));
      return;
    }
    if (data != null && typeof data === "object" && !Array.isArray(data) && "error" in data) {
      console.log(JSON.stringify({ ok: false, reason: "api_error_body", detail: data }));
      return;
    }
    const ranked = parseZeroShotResponse(data);
    if (ranked.length === 0) {
      console.log(JSON.stringify({ ok: false, reason: "empty_scores", detail: data }));
      return;
    }
    console.log(JSON.stringify({ ok: true, result: toAnalysisResult(ranked) }));
  } catch (e) {
    clearTimeout(timer);
    console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  }
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
});
