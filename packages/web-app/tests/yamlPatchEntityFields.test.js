import test from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import {
  setEntityOwner,
  setEntityDomain,
  setEntitySubjectArea,
  setEntityTags,
  setEntityTerms,
  setEntityVisibility,
} from "../src/design/yamlPatch.js";

const BASE_YAML = `model:
  name: sales
  layer: conceptual
entities:
  - name: Customer
    type: concept
    description: A buyer of goods.
  - name: Order
    type: concept
`;

function loadEntity(text, name) {
  const doc = yaml.load(text);
  return (doc.entities || []).find((e) => e.name === name);
}

test("setEntityOwner sets and clears the owner field", () => {
  const set = setEntityOwner(BASE_YAML, "Customer", "Sales Team");
  assert.equal(loadEntity(set, "Customer").owner, "Sales Team");

  const cleared = setEntityOwner(set, "Customer", "");
  assert.equal(loadEntity(cleared, "Customer").owner, undefined);
});

test("setEntityDomain and setEntitySubjectArea write distinct fields", () => {
  const a = setEntityDomain(BASE_YAML, "Customer", "sales");
  const b = setEntitySubjectArea(a, "Customer", "Customer Profile");
  const ent = loadEntity(b, "Customer");
  assert.equal(ent.domain, "sales");
  assert.equal(ent.subject_area, "Customer Profile");
});

test("setEntityTags de-duplicates, trims, and clears empty arrays", () => {
  const written = setEntityTags(BASE_YAML, "Customer", ["core", " core ", "person", ""]);
  const ent = loadEntity(written, "Customer");
  assert.deepEqual(ent.tags, ["core", "person"]);

  const cleared = setEntityTags(written, "Customer", []);
  assert.equal(loadEntity(cleared, "Customer").tags, undefined);
});

test("setEntityTerms behaves like setEntityTags but on the terms array", () => {
  const written = setEntityTerms(BASE_YAML, "Customer", ["customer_id", "email"]);
  assert.deepEqual(loadEntity(written, "Customer").terms, ["customer_id", "email"]);

  const cleared = setEntityTerms(written, "Customer", []);
  assert.equal(loadEntity(cleared, "Customer").terms, undefined);
});

test("setEntityVisibility only accepts internal/shared/public; other values clear", () => {
  const shared = setEntityVisibility(BASE_YAML, "Customer", "shared");
  assert.equal(loadEntity(shared, "Customer").visibility, "shared");

  const internal = setEntityVisibility(shared, "Customer", "INTERNAL");
  assert.equal(loadEntity(internal, "Customer").visibility, "internal");

  const cleared = setEntityVisibility(internal, "Customer", "garbage");
  assert.equal(loadEntity(cleared, "Customer").visibility, undefined);
});

test("setters return null when the entity does not exist", () => {
  assert.equal(setEntityOwner(BASE_YAML, "Nonexistent", "X"), null);
  assert.equal(setEntityDomain(BASE_YAML, "Nonexistent", "X"), null);
  assert.equal(setEntityVisibility(BASE_YAML, "Nonexistent", "shared"), null);
});

test("setters preserve unrelated entities and fields", () => {
  const after = setEntityOwner(BASE_YAML, "Customer", "Sales Team");
  const order = loadEntity(after, "Order");
  assert.ok(order, "Order entity should still exist");
  assert.equal(order.type, "concept");
  // Customer's existing description must not be lost.
  assert.equal(loadEntity(after, "Customer").description, "A buyer of goods.");
});
