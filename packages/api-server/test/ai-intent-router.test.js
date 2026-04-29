// Pins the intent classifier (Phase 1 of the AI architecture rebuild).
//
// We assert on top-intent + a confidence floor, NOT on exact scores —
// the rules will get tuned over time and locking exact scores would make
// every tweak a test churn. What matters is that each example routes to
// the right intent.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, INTENTS } from "../ai/intent-router.js";

function expectIntent(message, context, expected, { minConfidence = 0.5 } = {}) {
  const result = classifyIntent(message, context);
  assert.equal(
    result.intent,
    expected,
    `expected ${expected}, got ${result.intent} (scores=${JSON.stringify(result.scores)}) for: ${message.slice(0, 100)}`,
  );
  assert.ok(
    result.confidence >= minConfidence,
    `confidence ${result.confidence} below floor ${minConfidence} for: ${message.slice(0, 100)}`,
  );
}

describe("classifyIntent — validation_fix", () => {
  test("validation_issue context dominates", () => {
    // Even a generic "what's going on" message routes to validation_fix
    // when the user clicked "Ask AI" inside a Validation panel.
    expectIntent(
      "What's going on with this?",
      { kind: "validation_issue", filePath: "models/foo.yml" },
      INTENTS.VALIDATION_FIX,
    );
  });

  test("dbt_readiness_finding context dominates", () => {
    expectIntent(
      "Help me with this",
      { kind: "dbt_readiness_finding", filePath: "models/foo.yml" },
      INTENTS.VALIDATION_FIX,
    );
  });

  test("explicit fix vocabulary without context", () => {
    expectIntent("Fix this MISSING_MODEL_SECTION error", {}, INTENTS.VALIDATION_FIX);
    expectIntent("Resolve the validation issue in dim_customers.yml", {}, INTENTS.VALIDATION_FIX);
    expectIntent("Patch this error and propose the smallest YAML fix", {}, INTENTS.VALIDATION_FIX);
  });

  test("structured prompt format from ValidationPanel", () => {
    const promptFromValidationPanel = [
      "Explain this DataLex validation finding in one plain-English sentence, then propose the smallest YAML patch that resolves it.",
      "Code: MISSING_MODEL_SECTION",
      "Severity: error",
      "File (FIX THIS EXACT FILE): models/common/dim_deal_path.yml",
      "Use the patch_yaml change type targeting the file path above.",
    ].join("\n");
    expectIntent(promptFromValidationPanel, {}, INTENTS.VALIDATION_FIX, { minConfidence: 0.6 });
  });
});

describe("classifyIntent — describe", () => {
  test("explicit description vocabulary", () => {
    expectIntent("Suggest a description for fct_orders", {}, INTENTS.DESCRIBE);
    expectIntent("Write a description for the customer_id column", {}, INTENTS.DESCRIBE);
    expectIntent("Make this description tighter", {}, INTENTS.DESCRIBE);
    expectIntent("Rewrite this description to be more technical", {}, INTENTS.DESCRIBE);
  });

  test("description_target context dominates", () => {
    expectIntent(
      "Help with this",
      { kind: "description_target" },
      INTENTS.DESCRIBE,
    );
  });

  test("the existing /api/ai/suggest one-shot prompt", () => {
    const promptFromSuggest = [
      "Target kind: field",
      "Field name: customer_id",
      "Parent entity: Customer",
      "Write the description now. Return ONLY the description text, no preamble.",
    ].join("\n");
    expectIntent(promptFromSuggest, {}, INTENTS.DESCRIBE);
  });
});

describe("classifyIntent — create_artifact", () => {
  test("explicit build/create vocabulary", () => {
    expectIntent("Build me a customer 360 conceptual model", {}, INTENTS.CREATE_ARTIFACT);
    expectIntent("Create a fact_orders mart entity", {}, INTENTS.CREATE_ARTIFACT);
    expectIntent("Generate a stg_customers staging model from the source", {}, INTENTS.CREATE_ARTIFACT);
    expectIntent("Design a logical model for the sales domain", {}, INTENTS.CREATE_ARTIFACT);
  });

  test("draft / propose new artifact phrasing", () => {
    expectIntent("Draft a new diagram for the marketing domain", {}, INTENTS.CREATE_ARTIFACT);
    expectIntent("Propose a new conceptual model for billing", {}, INTENTS.CREATE_ARTIFACT);
  });
});

describe("classifyIntent — explain", () => {
  test("question-shaped messages", () => {
    expectIntent("What does fct_orders mean?", {}, INTENTS.EXPLAIN);
    expectIntent("How is dim_customers related to fct_orders?", {}, INTENTS.EXPLAIN);
    expectIntent("Why does the readiness gate flag this column?", {}, INTENTS.EXPLAIN);
    expectIntent("Explain how the doc-block round-trip works", {}, INTENTS.EXPLAIN);
  });

  test("default fallback when nothing matches", () => {
    const result = classifyIntent("hello", {});
    assert.equal(result.intent, INTENTS.EXPLAIN);
    assert.equal(result.confidence, 0.4); // fallback floor
  });

  test("ambiguous short messages fall back to explain", () => {
    const result = classifyIntent("?", {});
    assert.equal(result.intent, INTENTS.EXPLAIN);
  });
});

describe("classifyIntent — refactor", () => {
  test("explicit rename vocabulary", () => {
    expectIntent("Rename customer_id to customer_pk across this domain", {}, INTENTS.REFACTOR);
    expectIntent("Rename across all schema.yml files", {}, INTENTS.REFACTOR);
  });

  test("structural restructure vocabulary", () => {
    expectIntent("Move dim_customers from staging to marts", {}, INTENTS.REFACTOR);
    expectIntent("Extract the customer logic into a separate model", {}, INTENTS.REFACTOR);
    expectIntent("Split this fact table by date partitions", {}, INTENTS.REFACTOR);
    expectIntent("Consolidate these duplicate columns into a canonical entity", {}, INTENTS.REFACTOR);
  });

  test("lift / promote vocabulary", () => {
    expectIntent("Lift the email column to a canonical logical entity", {}, INTENTS.REFACTOR);
    expectIntent("Promote this concept to the logical layer", {}, INTENTS.REFACTOR);
  });
});

describe("classifyIntent — explore", () => {
  test("list / find vocabulary", () => {
    expectIntent("List all models that touch customer email", {}, INTENTS.EXPLORE);
    expectIntent("Find every reference to customer_id", {}, INTENTS.EXPLORE);
    expectIntent("Show me which entities use the source jaffle_shop", {}, INTENTS.EXPLORE);
  });

  test("where-is questions", () => {
    expectIntent("Where is customer_id used in the marts layer?", {}, INTENTS.EXPLORE);
    expectIntent("Which models depend on stg_customers?", {}, INTENTS.EXPLORE);
  });

  test("references-to phrasing", () => {
    expectIntent("Any references to dim_products in the staging layer?", {}, INTENTS.EXPLORE);
    expectIntent("All references to the deprecated email_address column", {}, INTENTS.EXPLORE);
  });
});

describe("classifyIntent — confidence", () => {
  test("strong winner gets high confidence", () => {
    const result = classifyIntent(
      "Build me a customer 360 conceptual model with entities for customer, order, line item",
      {},
    );
    assert.equal(result.intent, INTENTS.CREATE_ARTIFACT);
    assert.ok(result.confidence > 0.6, `expected high confidence, got ${result.confidence}`);
  });

  test("ambiguous message gets moderate confidence", () => {
    // "explain how to build" is genuinely ambiguous between explain and
    // create_artifact. Confidence should be modest in either case.
    const result = classifyIntent("Explain how to build a fact table", {});
    assert.ok(
      result.confidence < 0.85,
      `ambiguous prompt should not get high confidence; got ${result.confidence}`,
    );
  });

  test("fallback intent gets exactly the floor confidence", () => {
    const result = classifyIntent("zzzz", {});
    assert.equal(result.intent, INTENTS.EXPLAIN);
    assert.equal(result.confidence, 0.4);
  });

  test("scores object exposed for diagnostics", () => {
    const result = classifyIntent("Fix this error", {});
    assert.ok(result.scores);
    assert.equal(typeof result.scores[INTENTS.VALIDATION_FIX], "number");
    assert.ok(result.scores[INTENTS.VALIDATION_FIX] > 0);
  });
});

describe("classifyIntent — context override of weak keywords", () => {
  test("validation_issue context wins even when message has create vocabulary", () => {
    // Edge case: a user wrote "create the missing model: section" inside
    // a validation_issue context. The CONTEXT should win — they're fixing,
    // not creating an artifact.
    expectIntent(
      "Create the missing model: section for me",
      { kind: "validation_issue", filePath: "models/dim.yml" },
      INTENTS.VALIDATION_FIX,
    );
  });

  test("description_target context wins over generic words", () => {
    expectIntent(
      "I'm not sure what to write here",
      { kind: "description_target" },
      INTENTS.DESCRIBE,
    );
  });
});
