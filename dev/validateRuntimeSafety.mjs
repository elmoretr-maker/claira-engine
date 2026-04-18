/**
 * Smoke-check shared API payload guards and a few happy paths (no network).
 */
import assert from "node:assert/strict";
import {
  assertFitnessImagePairsArray,
  assertTaxPathsEntries,
  assertTaxUploadsEntries,
  optionalTrimmedString,
  orderedStagesAsStrings,
  pathsByStageAsStrings,
  taxSelectedFieldsAsStrings,
} from "../workflow/modules/capabilities/apiPayloadGuards.js";

assert.throws(() => optionalTrimmedString("x", 1), TypeError);
assert.equal(optionalTrimmedString("x", undefined), "");

assert.throws(() => orderedStagesAsStrings(null), TypeError);
assert.deepEqual(orderedStagesAsStrings([" a ", "b"]), ["a", "b"]);

assert.deepEqual(pathsByStageAsStrings({ front: "a.png" }), { front: "a.png" });
assert.throws(() => pathsByStageAsStrings({ front: 1 }), TypeError);

const pairs = assertFitnessImagePairsArray([{ pathA: "a.jpg", pathB: "b.jpg", stageA: "A" }]);
assert.equal(pairs.length, 1);
assert.equal(pairs[0].pathA, "a.jpg");
assert.throws(() => assertFitnessImagePairsArray([{ pathA: "a" }]), TypeError);

assertTaxPathsEntries(["a.pdf", null]);
assert.throws(() => assertTaxPathsEntries(["a", 2]), TypeError);

assertTaxUploadsEntries([{ name: "x.pdf", dataBase64: "QQ==" }]);
assert.throws(() => assertTaxUploadsEntries([null]), TypeError);
assert.throws(() => assertTaxUploadsEntries([{ name: 1 }]), TypeError);

assert.equal(taxSelectedFieldsAsStrings(undefined), undefined);
assert.deepEqual(taxSelectedFieldsAsStrings(["a", "b"]), ["a", "b"]);
assert.throws(() => taxSelectedFieldsAsStrings("x"), TypeError);

console.log("validateRuntimeSafety: ok");
