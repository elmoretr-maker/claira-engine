/**
 * Client-facing PDF for contractor project reports (PDFKit).
 * Receipt samples use base64 embedded in the report payload — no disk reads for thumbnails.
 */

import { writeFileSync } from "fs";
import PDFDocument from "pdfkit";

/**
 * @param {Record<string, unknown>} report from buildContractorProjectReportData
 * @returns {Promise<Buffer>}
 */
export function generateContractorReportPdfBuffer(report) {
  return new Promise((resolvePromise, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    const doc = new PDFDocument({ size: "LETTER", margin: 50, info: { Title: "Contractor report" } });
    doc.on("data", (c) => chunks.push(c));
    doc.on("error", reject);
    doc.on("end", () => resolvePromise(Buffer.concat(chunks)));

    const project = /** @type {{ name?: string }} */ (report.project ?? {});
    const title = String(project.name ?? "Project");
    doc.fontSize(18).fillColor("#111827").text(`Contractor report: ${title}`, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#6b7280").text(`Generated ${String(report.generatedAt ?? "")}`, { align: "center" });
    const ver = report.version != null ? String(report.version) : "";
    if (ver) {
      doc.fontSize(8).fillColor("#9ca3af").text(`Report schema v${ver}`, { align: "center" });
    }
    doc.moveDown(1.2);

    const src = report.source && typeof report.source === "object" ? /** @type {Record<string, unknown>} */ (report.source) : null;
    if (src) {
      doc.fontSize(11).fillColor("#111827").text("Source snapshot", { underline: true });
      doc.moveDown(0.25);
      doc.fontSize(9).fillColor("#4b5563");
      if (src.receiptCount != null) doc.text(`Receipt rows: ${Number(src.receiptCount)}`);
      if (src.receiptImageCount != null) doc.text(`Receipt images on disk (at export): ${Number(src.receiptImageCount)}`);
      if (src.timelineImageCount != null) doc.text(`Timeline progress images (scan): ${Number(src.timelineImageCount)}`);
      if (src.embeddedReceiptSampleCount != null) doc.text(`Receipt samples embedded in this file: ${Number(src.embeddedReceiptSampleCount)}`);
      doc.moveDown(0.8);
    }

    const bv = report.budgetVsActual;
    if (bv && typeof bv === "object") {
      doc.fontSize(12).fillColor("#111827").text("Budget vs actual", { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor("#374151");
      const rec = /** @type {{ receiptTotal?: number, manualSpendSupplement?: number, currentSpend?: number, initialBudget?: number | null, deltaVsBudget?: number }} */ (
        bv
      );
      if (rec.initialBudget != null) doc.text(`Initial budget: $${Number(rec.initialBudget).toFixed(2)}`);
      doc.text(`Receipt total: $${Number(rec.receiptTotal ?? 0).toFixed(2)}`);
      doc.text(`Other costs (non-receipt): $${Number(rec.manualSpendSupplement ?? 0).toFixed(2)}`);
      doc.text(`Current spend: $${Number(rec.currentSpend ?? 0).toFixed(2)}`);
      if (rec.deltaVsBudget != null) doc.text(`Delta vs budget: $${Number(rec.deltaVsBudget).toFixed(2)}`);
      doc.moveDown(1);
    }

    doc.fontSize(12).fillColor("#111827").text("Summary", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor("#374151").text(`Total cost (receipts): $${Number(report.totalCost ?? 0).toFixed(2)}`);
    doc.text(`Receipt count: ${Number(report.receiptCount ?? 0)}`);
    doc.moveDown(0.8);

    const sec = report.sectionBreakdown;
    if (sec && typeof sec === "object") {
      doc.fontSize(12).fillColor("#111827").text("Section breakdown", { underline: true });
      doc.moveDown(0.35);
      doc.fontSize(10);
      for (const [k, v] of Object.entries(sec).sort((a, b) => a[0].localeCompare(b[0]))) {
        doc.fillColor("#374151").text(`${k}: $${Number(v).toFixed(2)}`);
      }
      doc.moveDown(0.8);
    }

    const pa = report.perAssignee;
    if (pa && typeof pa === "object") {
      doc.fontSize(12).fillColor("#111827").text("Per assignee", { underline: true });
      doc.moveDown(0.35);
      doc.fontSize(10);
      for (const assignee of Object.keys(pa).sort()) {
        const row = /** @type {{ total?: number, sections?: Record<string, number> }} */ (pa[assignee]);
        doc.fillColor("#111827").text(`${assignee}: $${Number(row.total ?? 0).toFixed(2)}`, { continued: false });
        const subs = row.sections && typeof row.sections === "object" ? row.sections : {};
        for (const [sk, sv] of Object.entries(subs).sort((a, b) => a[0].localeCompare(b[0]))) {
          doc.fillColor("#6b7280").text(`    · ${sk}: $${Number(sv).toFixed(2)}`, { indent: 12 });
        }
      }
      doc.moveDown(0.8);
    }

    const alerts = Array.isArray(report.alerts) ? report.alerts : [];
    doc.fontSize(12).fillColor("#111827").text("Alerts", { underline: true });
    doc.moveDown(0.35);
    if (alerts.length === 0) {
      doc.fontSize(10).fillColor("#6b7280").text("No alerts.");
    } else {
      for (const a of alerts) {
        const ar = /** @type {{ type?: string, assignee?: string, section?: string, message?: string }} */ (a);
        const ty = String(ar.type ?? "warning");
        const fill =
          ty === "problem" ? "#b91c1c" : ty === "good" ? "#15803d" : "#a16207";
        doc.fontSize(10).fillColor(fill).text(`[${ty.toUpperCase()}] ${ar.assignee ?? ""} · ${ar.section ?? ""}`, {
          continued: false,
        });
        doc.fillColor("#374151").text(`  ${String(ar.message ?? "")}`, { indent: 8 });
        doc.moveDown(0.25);
      }
    }
    doc.moveDown(0.8);

    const thumbs = Array.isArray(report.receiptThumbnails) ? report.receiptThumbnails : [];
    if (thumbs.length > 0) {
      doc.fontSize(12).fillColor("#111827").text("Receipt thumbnails (sample)", { underline: true });
      doc.moveDown(0.4);
      for (const t of thumbs) {
        const tr = /** @type {{ sectionLabel?: string, embeddedImages?: unknown, imagePaths?: string[] }} */ (t);
        const label = String(tr.sectionLabel ?? "");
        const embedded = Array.isArray(tr.embeddedImages) ? tr.embeddedImages : [];
        doc.fontSize(10).fillColor("#374151").text(label);
        let shown = 0;
        for (const im of embedded.slice(0, 2)) {
          const ir = im && typeof im === "object" && !Array.isArray(im) ? /** @type {{ dataBase64?: string, mimeType?: string }} */ (im) : null;
          const b64 = ir && typeof ir.dataBase64 === "string" ? ir.dataBase64 : "";
          if (!b64) continue;
          try {
            const buf = Buffer.from(b64, "base64");
            if (buf.length === 0) continue;
            doc.image(buf, { fit: [220, 160], align: "center" });
            doc.moveDown(0.3);
            shown += 1;
          } catch {
            doc.fillColor("#9ca3af").text("  (could not decode embedded image)");
          }
        }
        if (shown === 0 && Array.isArray(tr.imagePaths) && tr.imagePaths.length > 0) {
          doc
            .fontSize(9)
            .fillColor("#9ca3af")
            .text("  (legacy report: re-export to embed receipt images in the PDF.)");
        }
        doc.moveDown(0.5);
      }
    }

    doc.end();
  });
}

/**
 * @param {string} outAbs absolute path for .pdf file
 * @param {Record<string, unknown>} report
 */
export async function writeContractorReportPdfFile(outAbs, report) {
  const buf = await generateContractorReportPdfBuffer(report);
  writeFileSync(outAbs, buf);
}
