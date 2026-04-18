/**
 * Central registration — imports all capability modules and registers in build order.
 * Do not register inside individual module files.
 */

import { clearCapabilityRegistry, registerCapability } from "./capabilityRegistry.js";
import { imageDiffModule } from "./imageDiffModule.js";
import { assetDeduplicationModule } from "./assetDeduplicationModule.js";
import { metadataExtractorModule } from "./metadataExtractorModule.js";
import { smartRenameModule } from "./smartRenameModule.js";
import { folderStructureModule } from "./folderStructureModule.js";
import { taggingModule } from "./taggingModule.js";
import { reviewModule } from "./reviewModule.js";
import { batchProcessorModule } from "./batchProcessorModule.js";
import { timerModule } from "./timerModule.js";
import { domainTemplateModule } from "./domainTemplateModule.js";
import { taxDocumentComparisonModule } from "./taxDocumentComparisonModule.js";
import { fitnessImageComparisonModule } from "./fitnessImageComparisonModule.js";
import { contractorCostTrackingModule } from "./contractorCostTrackingModule.js";
import { receiptModule } from "./receiptModule.js";

const ORDERED = [
  imageDiffModule,
  assetDeduplicationModule,
  metadataExtractorModule,
  smartRenameModule,
  folderStructureModule,
  taggingModule,
  reviewModule,
  batchProcessorModule,
  timerModule,
  domainTemplateModule,
  taxDocumentComparisonModule,
  fitnessImageComparisonModule,
  contractorCostTrackingModule,
  receiptModule,
];

/**
 * Idempotent: clears and re-registers in required order.
 */
export function registerAllCapabilities() {
  clearCapabilityRegistry();
  for (const m of ORDERED) {
    registerCapability(m);
  }
}
