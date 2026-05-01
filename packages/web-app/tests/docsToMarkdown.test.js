import test from "node:test";
import assert from "node:assert/strict";
import { buildDocsMarkdown } from "../src/design/views/docsToMarkdown.js";

test("renders an H1 with the model name", () => {
  const md = buildDocsMarkdown({ model: { name: "Sales", entities: [] } });
  assert.match(md, /^# Sales\b/);
});

test("renders meta chips when version/domain/owners are present", () => {
  const md = buildDocsMarkdown({
    model: {
      name: "Sales",
      version: "1.2.0",
      domain: "sales",
      owners: ["sales@example.com"],
      entities: [],
    },
  });
  assert.match(md, /\*\*Version\*\* `1\.2\.0`/);
  assert.match(md, /\*\*Domain\*\* `sales`/);
  assert.match(md, /\*\*Owners\*\* `sales@example\.com`/);
});

test("falls back to top-level fields when there's no nested model object", () => {
  // Diagram-style YAMLs often use top-level keys, no `model:` wrapper.
  const md = buildDocsMarkdown({ name: "Flat Doc", description: "Top-level shape", entities: [] });
  assert.match(md, /^# Flat Doc\b/);
  assert.match(md, /Top-level shape/);
});

test("emits a mermaid erDiagram block when entities have fields", () => {
  const md = buildDocsMarkdown({
    model: {
      name: "X",
      entities: [
        { name: "Customer", type: "table", fields: [{ name: "id", type: "int", primary_key: true }] },
        { name: "Order", type: "table", fields: [{ name: "customer_id", type: "int", foreign_key: { entity: "Customer", field: "id" } }] },
      ],
    },
  });
  assert.match(md, /## Entity-relationship diagram/);
  assert.match(md, /```mermaid\nerDiagram/);
  assert.match(md, /Customer \|\|--o\{ Order : "customer_id"/);
  assert.match(md, /```\n/);
});

test("omits the ERD section when there are no entities", () => {
  const md = buildDocsMarkdown({ model: { name: "Empty", entities: [] } });
  assert.doesNotMatch(md, /Entity-relationship diagram/);
  assert.doesNotMatch(md, /```mermaid/);
});

test("renders an EventStorming section when EventStorming entities exist", () => {
  const md = buildDocsMarkdown({
    model: {
      name: "ES",
      entities: [
        { name: "Customer", type: "actor", description: "places orders" },
        { name: "PlaceOrder", type: "command" },
        { name: "OrderPlaced", type: "event", description: "order accepted" },
      ],
    },
  });
  assert.match(md, /## EventStorming flow/);
  assert.match(md, /### Actors/);
  assert.match(md, /### Commands/);
  assert.match(md, /### Events/);
  assert.match(md, /1\. \*\*Customer\*\* — places orders/);
  assert.match(md, /1\. \*\*PlaceOrder\*\*\n/);
  assert.match(md, /1\. \*\*OrderPlaced\*\* — order accepted/);
});

test("EventStorming groups appear in canonical Brandolini order", () => {
  const md = buildDocsMarkdown({
    model: {
      name: "ES",
      entities: [
        { name: "P", type: "policy" },
        { name: "E", type: "event" },
        { name: "A", type: "actor" },
        { name: "Agg", type: "aggregate" },
        { name: "C", type: "command" },
      ],
    },
  });
  const idxActor = md.indexOf("### Actors");
  const idxCmd = md.indexOf("### Commands");
  const idxAgg = md.indexOf("### Aggregates");
  const idxEvt = md.indexOf("### Events");
  const idxPol = md.indexOf("### Policies");
  assert.ok(idxActor < idxCmd && idxCmd < idxAgg && idxAgg < idxEvt && idxEvt < idxPol);
});

test("omits EventStorming section when no EventStorming entities exist", () => {
  const md = buildDocsMarkdown({
    model: { name: "Plain", entities: [{ name: "Customer", type: "table" }] },
  });
  assert.doesNotMatch(md, /EventStorming flow/);
});

test("renders per-entity sections with field tables", () => {
  const md = buildDocsMarkdown({
    model: {
      name: "X",
      entities: [
        {
          name: "Customer",
          type: "table",
          description: "the buyer",
          fields: [
            { name: "id", type: "int", primary_key: true, description: "surrogate key" },
            { name: "email", type: "varchar", unique: true, nullable: false, description: "contact" },
          ],
        },
      ],
    },
  });
  assert.match(md, /### Customer/);
  assert.match(md, /\*\*Type\*\*: `table`/);
  assert.match(md, /the buyer/);
  assert.match(md, /\| Field \| Type \| Flags \| Description \|/);
  assert.match(md, /\| `id` \| `int` \| PK \| surrogate key \|/);
  assert.match(md, /\| `email` \| `varchar` \| unique, not-null \| contact \|/);
});

test("omits the Fields subsection when an entity has none", () => {
  const md = buildDocsMarkdown({
    model: {
      name: "X",
      entities: [{ name: "Concept", type: "concept", description: "an idea" }],
    },
  });
  assert.match(md, /### Concept/);
  assert.match(md, /an idea/);
  assert.doesNotMatch(md, /\*\*Fields\*\*/);
});

test("escapes pipes in description cells so the table doesn't break", () => {
  const md = buildDocsMarkdown({
    model: {
      name: "X",
      entities: [
        {
          name: "E",
          type: "table",
          fields: [{ name: "code", type: "varchar", description: "values like A|B|C" }],
        },
      ],
    },
  });
  assert.match(md, /values like A\\\|B\\\|C/);
});

test("ends with a single trailing newline", () => {
  const md = buildDocsMarkdown({ model: { name: "X", entities: [] } });
  assert.equal(md.endsWith("\n"), true);
  assert.equal(md.endsWith("\n\n"), false);
});

test("handles malformed input without throwing", () => {
  // Defensive — the docs export button shouldn't crash on a partially
  // edited or in-flight YAML buffer.
  assert.doesNotThrow(() => buildDocsMarkdown({}));
  assert.doesNotThrow(() => buildDocsMarkdown(null));
  assert.doesNotThrow(() => buildDocsMarkdown({ model: { entities: [null, "junk", { name: "" }] } }));
});
