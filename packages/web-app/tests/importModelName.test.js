import test from "node:test";
import assert from "node:assert/strict";
import { normalizeImportedModelFileName } from "../src/lib/importModelName.js";

test("normalizeImportedModelFileName normalizes standard YAML extensions", () => {
  assert.equal(normalizeImportedModelFileName("raw.yaml"), "raw.model.yaml");
  assert.equal(normalizeImportedModelFileName("raw.yml"), "raw.model.yaml");
  assert.equal(normalizeImportedModelFileName("RAW.YAML"), "RAW.model.yaml");
});

test("normalizeImportedModelFileName preserves existing model suffix", () => {
  assert.equal(normalizeImportedModelFileName("orders.model.yaml"), "orders.model.yaml");
  assert.equal(normalizeImportedModelFileName("orders.model.yml"), "orders.model.yml");
});

test("normalizeImportedModelFileName converts spaces and bare names", () => {
  assert.equal(normalizeImportedModelFileName("my file.yaml"), "my_file.model.yaml");
  assert.equal(normalizeImportedModelFileName("warehouse_model"), "warehouse_model.model.yaml");
});

test("normalizeImportedModelFileName handles empty input", () => {
  const out = normalizeImportedModelFileName("");
  assert.match(out, /^imported_\d+\.model\.yaml$/);
});
