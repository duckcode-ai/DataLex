// Pins the tightened `extractModelingMemories` contract: only imperative-mood
// rule statements get persisted; one-shot prompts (questions, requests, the
// "Suggest with AI" template) do NOT.
//
// Catches the regression that originally caused users to see their own
// "suggest a description for X" prompts replayed back as "Remembered
// modeling preferences" — see commit history for context.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  extractModelingMemories,
  pruneAutoExtractedMemoryRules,
} from "../ai/agentStore.js";

describe("extractModelingMemories", () => {
  test("extracts imperative rules (always / never / prefer / use only / avoid)", () => {
    const cases = [
      { input: "Always use snake_case for column names.", expectCategory: "naming_rule" },
      { input: "Never include PII in staging models.", expectCategory: "user_preference" },
      { input: "Prefer dim_/fct_ prefixes for marts.", expectCategory: "naming_rule" },
      { input: "Avoid joining facts across grain levels.", expectCategory: "user_preference" },
      { input: "Use only doc-block references for shared descriptions.", expectCategory: "user_preference" },
      { input: "Rule: every primary key column needs a unique + not_null test.", expectCategory: "dbt_implementation_rule" },
      { input: "Convention: customer domain owns billing entities.", expectCategory: "domain_decision" },
    ];

    for (const c of cases) {
      const result = extractModelingMemories(c.input);
      assert.equal(result.length, 1, `expected 1 rule for: ${c.input}`);
      assert.equal(result[0].category, c.expectCategory);
    }
  });

  test("does NOT extract one-shot prompts that mention dbt / model / test", () => {
    const cases = [
      "For the dbt + DataLex model at packages/web-app/test-results/jaffle-shop/models/marts/core/dim_customers.yml (domain: imported, layer: ?), suggest a 1-2 sentence description that explains what business concept this model represents. Reply with ONLY the description text — no preamble, no quotes.",
      "Can you suggest a description for fct_orders?",
      "What does the customer_id column mean in this dbt model?",
      "Generate tests for the schema.yml file.",
      "Help me understand the contract on this source.",
      "I'm looking at the metric exposure and don't get how it joins.",
    ];

    for (const input of cases) {
      const result = extractModelingMemories(input);
      assert.equal(result.length, 0, `expected 0 memories for: ${input.slice(0, 80)}…`);
    }
  });

  test("ignores lines longer than 240 chars even if they start with an imperative", () => {
    const long = "Always " + "x".repeat(300);
    assert.equal(extractModelingMemories(long).length, 0);
  });
});

describe("pruneAutoExtractedMemoryRules", () => {
  test("drops the polluted-prompt patterns from the old over-eager extractor", () => {
    const polluted = [
      { id: "1", category: "dbt_implementation_rule", content: "For the dbt + DataLex model at /path/to/foo.yml (domain: ?, layer: ?), suggest a 1-2 sentence description …" },
      { id: "2", category: "user_preference", content: "Reply with ONLY the description text — no preamble, no quotes." },
      { id: "3", category: "user_preference", content: "Always use snake_case." },
      { id: "4", category: "user_preference", content: "For the entity Customer in `dim_customers.yml` …" },
      { id: "5", category: "user_preference", content: "For the field email on entity Customer …" },
    ];
    const { memories, droppedCount } = pruneAutoExtractedMemoryRules(polluted);
    assert.equal(droppedCount, 4);
    assert.equal(memories.length, 1);
    assert.equal(memories[0].id, "3");
  });

  test("is idempotent — second pass drops nothing", () => {
    const list = [{ id: "9", category: "user_preference", content: "Never expose raw PII." }];
    const first = pruneAutoExtractedMemoryRules(list);
    const second = pruneAutoExtractedMemoryRules(first.memories);
    assert.equal(first.droppedCount, 0);
    assert.equal(second.droppedCount, 0);
    assert.deepEqual(second.memories, list);
  });
});
