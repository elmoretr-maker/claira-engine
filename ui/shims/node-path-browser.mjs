/**
 * Minimal path helpers for the Vite client graph (replaces externalized `node:path`).
 */

function normalizeSlashes(p) {
  return String(p ?? "").replace(/\\/g, "/");
}

export function basename(p) {
  const s = normalizeSlashes(p);
  const parts = s.split("/").filter((x) => x.length > 0);
  return parts.length ? parts[parts.length - 1] : s;
}

export function dirname(p) {
  const s = normalizeSlashes(p).replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return s.slice(0, i) || ".";
}

export function join(...parts) {
  const segs = [];
  for (const part of parts) {
    if (part == null || part === "") continue;
    for (const seg of normalizeSlashes(part).split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        segs.pop();
        continue;
      }
      segs.push(seg);
    }
  }
  return segs.join("/") || ".";
}

export function isAbsolute(p) {
  const s = String(p ?? "");
  return /^[A-Za-z]:[\\/]/.test(s) || normalizeSlashes(s).startsWith("/");
}

export function resolve(...parts) {
  let acc = "";
  for (const part of parts) {
    if (part == null || part === "") continue;
    const p = normalizeSlashes(part);
    if (isAbsolute(part)) acc = p;
    else acc = acc ? `${acc.replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}` : p;
  }
  return acc || ".";
}

export function relative(from, to) {
  const a = normalizeSlashes(from).replace(/\/+$/, "").split("/").filter(Boolean);
  const b = normalizeSlashes(to).replace(/\/+$/, "").split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.length - i;
  const down = b.slice(i);
  const prefix = Array(up).fill("..").join("/");
  const tail = down.join("/");
  if (!prefix) return tail || ".";
  return tail ? `${prefix}/${tail}` : prefix;
}

export function extname(p) {
  const base = basename(p);
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i);
}

const path = { basename, dirname, join, isAbsolute, resolve, relative, extname };

export default path;
