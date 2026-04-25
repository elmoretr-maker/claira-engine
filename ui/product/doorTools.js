/**
 * Builds IndustrySelector `tools` entries for the current vertical (additive; no renames).
 * @typedef {import("./entitlements.js").AppVertical} AppVertical
 */

/**
 * @param {AppVertical | null} vertical
 * @returns {{ sectionLabel: string, sectionIcon: string }}
 */
export function getDoorSectionMeta(vertical) {
  if (vertical === "personal") {
    return {
      sectionLabel: "Your wellness journey",
      sectionIcon: "/assets/tool-thumbnails/business-assets.png",
    };
  }
  if (vertical === "business") {
    return {
      sectionLabel: "How your business is doing",
      sectionIcon: "/assets/tool-thumbnails/business-assets.png",
    };
  }
  if (vertical === "commerce") {
    return {
      sectionLabel: "From photos to products",
      sectionIcon: "/assets/tool-thumbnails/business-assets.png",
    };
  }
  return {
    sectionLabel: "Business Assets",
    sectionIcon: "/assets/tool-thumbnails/business-assets.png",
  };
}

/**
 * @param {{
 *   vertical: AppVertical | null,
 *   canAccess: (feature: "insight" | "photo" | "catalog") => boolean,
 *   setScreen: (s: string) => void,
 *   onLocked: (feature: "insight" | "photo" | "catalog") => void,
 * }} p
 * @returns {Array<{ title: string, description: string, imageSrc?: string, onClick: () => void }>}
 */
export function buildDoorTools(p) {
  const { vertical, canAccess, setScreen, onLocked } = p;
  if (!vertical) return [];

  const go = (/** @type {"insight"|"photo"|"catalog"} */ feature, /** @type {() => void} */ nav) => {
    if (canAccess(feature)) nav();
    else onLocked(feature);
  };

  /** @type {Array<{ title: string, description: string, imageSrc?: string, onClick: () => void }>} */
  const tools = [];

  if (vertical === "personal") {
    tools.push({
      title: "Wellness Insight",
      description: "Know exactly how to reach your goals—and what to change.",
      imageSrc: "/assets/tool-thumbnails/business-analyzer.png",
      onClick: () => go("insight", () => setScreen("business_analyzer")),
    });
  } else if (vertical === "business") {
    tools.push({
      title: "Insight Engine",
      description: "Know what’s happening—and what to do next.",
      imageSrc: "/assets/tool-thumbnails/business-analyzer.png",
      onClick: () => go("insight", () => setScreen("business_analyzer")),
    });
  } else if (vertical === "commerce") {
    tools.push({
      title: "Photo Sorter",
      description: "Turn photos into products and build your catalog faster—start here.",
      imageSrc: "/assets/tool-thumbnails/photo-sorter.png",
      onClick: () => go("photo", () => setScreen("photo_sorter")),
    });
    tools.push({
      title: "Product Catalog Builder",
      description: "Structure your best shots into listing-ready data when you’re ready to sell.",
      imageSrc: "/assets/tool-thumbnails/build-product-catalog.png",
      onClick: () => go("catalog", () => setScreen("catalog_builder")),
    });
  }

  return tools;
}
