/**
 * Industry template: medical / clinical packs.
 * Used by dev/generate_pack_system.mjs (not loaded by core engine).
 */

export const version = 1;

/**
 * @param {string} catKey
 * @param {string} label
 * @returns {string[]}
 */
export function extraKeywordHints(catKey, label) {
  const k = catKey.toLowerCase();
  const base = [
    "encounter",
    "episode of care",
    "attending physician",
    "ordering provider",
    "medical record number",
    "mrn",
    "date of service",
    "dos",
    "icd",
    "cpt",
    "clinical note",
    "progress note",
    "hpi",
    "assessment and plan",
    "medication list",
    "allergy",
    "advance directive",
    "release of information",
    "phi",
    "minimum necessary",
  ];
  if (/lab|path|specimen|culture|cbc|panel|result/.test(k)) {
    base.push("reference range", "abnormal flag", "collection time", "result status", "performing lab");
  }
  if (/prescription|rx|med|pharm|dispens/.test(k)) {
    base.push("sig", "quantity", "refills", "dea number", "pharmacy", "generic substitute");
  }
  if (/radiology|imaging|xray|x-ray|ct|mri|ultrasound/.test(k)) {
    base.push("laterality", "contrast", "dicom", "impression", "indication", "technique");
  }
  if (/appointment|schedul|referral|intake|consent/.test(k)) {
    base.push("appointment type", "reason for visit", "check-in", "copay", "prior authorization");
  }
  if (/insurance|claim|prior auth|eligib|benefit/.test(k)) {
    base.push("member id", "group number", "payer", "claim number", "eob", "denial reason");
  }
  base.push(`${label.toLowerCase()} documentation`, `clinical ${label.toLowerCase()}`);
  return base;
}

/**
 * @param {string} catKey
 * @param {string} label
 * @param {string[]} _keywords
 */
export function patternStructure(catKey, label, _keywords) {
  const k = catKey.toLowerCase();
  const expected = [
    "document type or form title aligned to clinical or administrative workflow",
    "provider, facility, or department identification region",
    "patient or encounter identifiers (handle per policy before sharing)",
  ];
  if (/lab|result|path/.test(k)) {
    expected.push("result values with units and reference intervals");
  } else if (/rx|prescription|med/.test(k)) {
    expected.push("drug name, strength, route, and dosing instructions");
  } else if (/image|radiology|scan/.test(k)) {
    expected.push("study description, body area, and acquisition metadata");
  } else {
    expected.push("dated clinical or administrative narrative blocks");
  }
  const optional = [
    "signature or attestation line",
    "coding or billing adjunct section",
    "routing or fax cover metadata",
  ];
  const visual = [
    "clinical or administrative form layout",
    "mixed typed and handwritten annotations",
    "stamps, barcodes, or facility letterhead",
  ];
  if (/scan|photo|xray|image/.test(k)) {
    visual.push("diagnostic or clinical image conventions (markers, orientation, windowing cues)");
  }
  return { expected_elements: expected, optional_elements: optional, visual_traits: visual };
}

/**
 * @param {string} catKey
 * @param {string} label
 * @param {string} groupId
 * @param {string} packSlug
 */
export function processIntel(catKey, label, groupId, packSlug) {
  const k = catKey.toLowerCase();
  const purpose = `Clinical and administrative workflow for **${label}** in **${packSlug}**: preserve accuracy, privacy, and audit readiness while moving documents through the right queues.`;

  /** @type {string[]} */
  const actions = [
    `Classify **${label}** against the pack taxonomy and confirm the document matches the expected clinical or operational context.`,
    "Apply minimum-necessary and redaction rules before the artifact leaves the trusted environment.",
    "Verify dates, author credentials, and encounter linkage so downstream billing and care coordination stay aligned.",
    "When text is extracted, spot-check diagnoses, medications, and identifiers against source layout to catch OCR swaps.",
    "Escalate to compliance or clinical review for high-risk categories (controlled substances, minors, sensitive imaging).",
  ];

  if (groupId === "financial" || /insurance|claim|bill|invoice|eob/.test(k)) {
    actions.splice(2, 0, "Match payer, member, and authorization fields to eligibility systems before archival.");
  }
  if (groupId === "scheduling" || /appointment|referral|intake/.test(k)) {
    actions.push("Confirm slot, modality, and preparation instructions were communicated to the patient or referrer.");
  }
  if (groupId === "clinical" || /lab|path|result|rx|radiology/.test(k)) {
    actions.push("Validate critical results and time-sensitive values per local escalation policy.");
  }

  return { purpose, actions };
}

export default { extraKeywordHints, patternStructure, processIntel };
