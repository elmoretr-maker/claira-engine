/**
 * Exemptions — audit log separate from Express Pass. Does not affect routing, decisions,
 * or execution. Behavioral control is {@link ./userControl.js} only.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXEMPTIONS_PATH = join(__dirname, "exemptions.json");

function nowIso() {
  return new Date().toISOString();
}

function loadData() {
  try {
    const raw = readFileSync(EXEMPTIONS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.exemptions)) return parsed;
  } catch {
    /* missing or invalid */
  }
  return { exemptions: [] };
}

function saveData(data) {
  mkdirSync(dirname(EXEMPTIONS_PATH), { recursive: true });
  writeFileSync(EXEMPTIONS_PATH, JSON.stringify(data, null, 2), "utf8");
}

/**
 * @param {string | null | undefined} file — reserved for future audit (not persisted yet)
 * @param {string | null | undefined} predicted_label
 * @param {string | null | undefined} selected_room
 */
export function recordExemption(file, predicted_label, selected_room) {
  void file;
  const predicted = String(predicted_label ?? "").trim();
  const selected = String(selected_room ?? "").trim();
  if (!predicted || !selected) return;

  const data = loadData();
  const exemptions = data.exemptions;
  const ts = nowIso();
  const idx = exemptions.findIndex(
    (e) => e.predicted === predicted && e.selected === selected,
  );
  if (idx >= 0) {
    exemptions[idx].count = Number(exemptions[idx].count ?? 0) + 1;
    exemptions[idx].lastUsed = ts;
  } else {
    exemptions.push({
      predicted,
      selected,
      count: 1,
      lastUsed: ts,
    });
  }
  saveData(data);
}
