/**
 * Industry template: ecommerce / retail packs.
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
    "sku",
    "variant",
    "size chart",
    "material",
    "colorway",
    "msrp",
    "compare at price",
    "inventory",
    "barcode",
    "upc",
    "ean",
    "fulfillment",
    "ship date",
    "tracking number",
    "return policy",
    "warranty",
    "product detail page",
    "listing photo",
    "lifestyle shot",
    "flat lay",
    "white background",
  ];
  if (/shoe|sneaker|boot|heel|sandal|footwear/.test(k)) {
    base.push("outsole", "midsole", "insole", "width", "eu size", "us size", "uk size", "cm size");
  }
  if (/top|shirt|blouse|hoodie|sweater|dress|apparel|bottom|pant|skirt|jacket|coat|outerwear/.test(k)) {
    base.push("fit type", "inseam", "rise", "chest measurement", "care label", "fabric content");
  }
  if (/bag|purse|tote|backpack|luggage/.test(k)) {
    base.push("dimensions", "strap drop", "liter capacity", "compartments", "hardware finish");
  }
  if (/accessory|jewelry|watch|belt|hat|scarf/.test(k)) {
    base.push("clasp type", "metal type", "stone type", "water resistance");
  }
  if (/invoice|receipt|order|packing|return|refund|chargeback/.test(k)) {
    base.push("order id", "line item", "subtotal", "tax", "shipping", "discount code", "payment method");
  }
  base.push(label.toLowerCase(), `${label.toLowerCase()} listing`, `${label.toLowerCase()} on model`);
  return base;
}

/**
 * @param {string} catKey
 * @param {string} label
 * @param {string[]} keywords
 */
export function patternStructure(catKey, _label, _keywords) {
  const k = catKey.toLowerCase();
  const expected = [
    "primary product or document title",
    "structured fields (price, sku, size, or order metadata)",
    "clear hero region or dominant subject",
  ];
  if (/invoice|receipt|order|return|refund|packing/.test(k)) {
    expected.splice(1, 1, "merchant or store header with order or transaction identifiers");
    expected.push("totals, tax, shipping block, or payment summary row");
  } else {
    expected.push("variant or attribute callouts (size, color, material)");
  }
  const optional = [
    "thumbnail strip or secondary gallery cues",
    "promotional badge or sale callout",
    "trust or compliance footer (returns, terms)",
  ];
  const visual = [
    "catalog or PDP-style layout",
    "consistent lighting for product accuracy",
    "legible small type for sku and pricing",
  ];
  if (/photo|image|listing|lifestyle|flat/.test(k)) {
    visual.push("ecommerce photography conventions (angles, shadows, background)");
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
  const purpose = `Operational handling for **${label}** in the **${packSlug}** catalog: keep listings, media, and transactional docs consistent with storefront and fulfillment rules.`;

  /** @type {string[]} */
  const actions = [
    `Confirm the asset or document maps to the correct **${label}** category and variant attributes.`,
    "Validate that SKUs, prices, and inventory cues align with the active catalog (no stale MSRP or discontinued variants).",
    "For imagery: check background, cropping, and color accuracy so customers see a faithful representation.",
    "If OCR or text is present, cross-check size, material, and policy blocks against the merchant’s standard templates.",
    "Route to merchandising or ops queues when brand, compliance, or return-window rules require human approval.",
  ];

  if (/invoice|receipt|order|return|refund|tax|billing|payment/.test(k) || groupId === "financial") {
    actions.splice(1, 0, "Reconcile line items, tax, shipping, and discounts against the order system before archiving.");
    actions.push("Flag chargebacks, partial refunds, or mismatched totals for finance review.");
  }
  if (groupId === "visual" || /photo|image|render|sprite|texture/.test(k)) {
    actions.push("Ensure image dimensions and aspect ratio meet channel requirements (web, marketplace, print).");
  }

  return { purpose, actions };
}

export default { extraKeywordHints, patternStructure, processIntel };
