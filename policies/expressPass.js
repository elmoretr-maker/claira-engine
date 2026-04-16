/**
 * Express Pass — audit log of manual corrections (predicted → selected) with counts.
 * Does not affect classification, decisions, or execution. For behavioral rules use
 * {@link ./userControl.js} (force_review / bypass_review).
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPRESS_PASS_PATH = join(__dirname, "expressPass.json");

function loadData() {
  try {
    const raw = readFileSync(EXPRESS_PASS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.rules)) return parsed;
  } catch {
    /* missing or invalid */
  }
  return { rules: [] };
}

function saveData(data) {
  mkdirSync(dirname(EXPRESS_PASS_PATH), { recursive: true });
  writeFileSync(EXPRESS_PASS_PATH, JSON.stringify(data, null, 2), "utf8");
}

/**
 * @param {string | null | undefined} file — logical path (reserved for future audit; not written to JSON yet)
 * @param {string | null | undefined} predicted_label
 * @param {string | null | undefined} selected_room — target room key / label the user chose
 */
export function recordExpressPass(file, predicted_label, selected_room) {
  void file;
  const predicted = String(predicted_label ?? "").trim();
  const selected = String(selected_room ?? "").trim();
  if (!predicted || !selected) return;

  const data = loadData();
  const rules = data.rules;
  const idx = rules.findIndex(
    (r) => r.predicted === predicted && r.selected === selected,
  );
  if (idx >= 0) {
    rules[idx].count = Number(rules[idx].count ?? 0) + 1;
  } else {
    rules.push({ predicted, selected, count: 1 });
  }
  saveData(data);
}
