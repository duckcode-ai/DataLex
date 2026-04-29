/**
 * Intent router — Phase 1 of the AI architecture rebuild.
 *
 * `classifyIntent(message, context)` reads a user request + the request's
 * UI context and returns one of six intents along with a confidence score.
 * Each intent gets routed (in later phases) to a focused per-intent
 * endpoint with its own agent set, tool registry, and output schema.
 *
 * Intent set (deliberately small — six is the right number):
 *
 *   validation_fix   — fix an existing finding (validation issue or dbt
 *                      readiness gap). Output: one patch_yaml.
 *   describe         — write / rewrite a description. Output: prose only.
 *   create_artifact  — build a new model / diagram / entity from scratch.
 *                      Output: create_model or create_diagram change.
 *   explain          — explain something (concept, lineage, behaviour).
 *                      Output: prose answer + sources, NO file changes.
 *   refactor         — rename / move / restructure across files.
 *                      Output: multiple patch_yaml changes.
 *   explore          — list / search / find ("what models touch X?").
 *                      Output: matches + summary.
 *
 * Default fallback when nothing else matches: `explain`. It's the
 * least-destructive intent (prose + sources only, no file mutations),
 * so a misclassification at worst produces an unhelpful answer rather
 * than a wrong file edit.
 *
 * The router is a pure function — no I/O, no LLM calls, no module-scope
 * mutable state. Easy to test and easy to reason about. Keyword-bag
 * scoring is intentional for v1; embedding-based intent routing is in
 * the "out of scope" list of the Path B plan.
 *
 * Used by Phases 3-6 of the rebuild — Phase 1 (this file) just lands the
 * classifier and its tests so the per-intent endpoints can build on top.
 */

export const INTENTS = Object.freeze({
  VALIDATION_FIX: "validation_fix",
  DESCRIBE: "describe",
  CREATE_ARTIFACT: "create_artifact",
  EXPLAIN: "explain",
  REFACTOR: "refactor",
  EXPLORE: "explore",
});

const INTENT_LIST = Object.values(INTENTS);

/**
 * Each rule contributes to one intent's score. Multi-word phrases score
 * higher than single tokens. Context signals (e.g. `context.kind ===
 * "validation_issue"`) are checked separately and apply hard score
 * boosts so they dominate keyword matches.
 *
 * The keyword sets are deliberately small. Better to under-classify and
 * fall through to `explain` than to over-classify and wrongly trigger
 * `create_artifact` or `refactor`.
 */
const INTENT_RULES = [
  {
    intent: INTENTS.VALIDATION_FIX,
    keywords: [
      // imperatives
      "fix", "resolve", "repair", "patch", "correct",
      // nouns of brokenness
      "error", "finding", "issue", "violation", "gap", "missing",
      // modifiers
      "validation", "readiness", "lint",
    ],
    phrases: [
      "fix this", "fix the", "patch this", "patch the",
      "missing required", "resolves it", "smallest patch", "smallest yaml patch",
    ],
  },
  {
    intent: INTENTS.DESCRIBE,
    keywords: [
      "describe", "description", "document", "documentation",
      "summarize", "summary", "explain in plain", "doc",
    ],
    phrases: [
      "suggest a description", "write a description", "rewrite this description",
      "make tighter", "more technical", "more business", "one sentence",
      "1-2 sentence",
    ],
  },
  {
    intent: INTENTS.CREATE_ARTIFACT,
    keywords: [
      // Verbs of creation only — nouns like `model` / `entity` / `diagram`
      // are too generic and appear in refactor / explain / explore
      // prompts too. The verb is what signals "make a new thing".
      "build", "create", "generate", "design", "scaffold", "draft",
    ],
    phrases: [
      "build a", "build me", "build me a", "create a new", "create the",
      "generate a", "design a", "draft a", "propose a new",
      "customer 360", "conceptual model from", "logical model from",
      "build a customer", "create a fact_", "create a dim_", "create a stg_",
    ],
  },
  {
    intent: INTENTS.EXPLAIN,
    keywords: [
      "what", "why", "how", "explain", "mean", "purpose",
      "represent", "represents", "lineage", "depends",
    ],
    phrases: [
      "what does", "what is", "what are", "how does",
      "how is", "why does", "explain how", "explain what",
      "what's the", "tell me about", "purpose of",
    ],
  },
  {
    intent: INTENTS.REFACTOR,
    keywords: [
      "rename", "move", "restructure", "refactor", "extract",
      "split", "merge", "consolidate", "normalize", "lift",
      "promote", "rename across", "rename everywhere",
    ],
    phrases: [
      "rename across", "rename everywhere", "move to", "extract into",
      "split into", "merge with", "consolidate into", "normalize across",
      "lift to canonical", "promote to logical",
    ],
  },
  {
    intent: INTENTS.EXPLORE,
    keywords: [
      "list", "show", "find", "search", "which", "where", "look up",
      "any", "all", "everywhere", "references", "uses", "touches",
    ],
    phrases: [
      "list all", "list every", "show me", "find all", "find every",
      "where is", "where are", "which models", "which entities",
      "what models touch", "what touches", "any references to",
      "all references to", "uses of", "references to",
    ],
  },
];

const KEYWORD_SCORE = 2;
const PHRASE_SCORE = 5;
const CONTEXT_BOOST = 25;
const KIND_TARGET_BOOST = 8;

/**
 * Apply context-based boosts that are deterministic from the surrounding
 * UI state. These dominate keyword matching when present — a click on
 * "Ask AI" inside a Validation panel is far stronger evidence of
 * `validation_fix` than any keyword in the message could be.
 */
function applyContextBoosts(scores, context) {
  const kind = String(context?.kind || "").toLowerCase();
  if (kind === "validation_issue" || kind === "dbt_readiness_finding") {
    scores[INTENTS.VALIDATION_FIX] = (scores[INTENTS.VALIDATION_FIX] || 0) + CONTEXT_BOOST;
  }
  if (kind === "description_target") {
    scores[INTENTS.DESCRIBE] = (scores[INTENTS.DESCRIBE] || 0) + CONTEXT_BOOST;
  }
  // "entity" / "column" contexts on their own don't pin an intent — the
  // user could be asking to describe, refactor, explain, or fix.
  // Apply a small nudge toward DESCRIBE only when the message also
  // contains explicit description vocabulary; handled by phrase scoring.
}

function scoreIntent(rule, lower) {
  let score = 0;
  for (const phrase of rule.phrases || []) {
    if (lower.includes(phrase)) score += PHRASE_SCORE;
  }
  for (const keyword of rule.keywords || []) {
    // Word-boundary match for single-word keywords; substring for
    // multi-word ones (which we treat as phrases in keyword form).
    if (keyword.includes(" ")) {
      if (lower.includes(keyword)) score += KEYWORD_SCORE;
    } else {
      const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (re.test(lower)) score += KEYWORD_SCORE;
    }
  }
  return score;
}

/**
 * Confidence is the top-intent's share of the total intent-pool score.
 * High confidence means one intent dominated; low confidence means the
 * message was ambiguous between two or more.
 */
function computeConfidence(scores, topIntent) {
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total === 0) return 0.4; // fallback intent — modest confidence
  const top = scores[topIntent] || 0;
  // Floor at 0.4, ceil at 0.99 — never claim certainty.
  return Math.max(0.4, Math.min(0.99, top / total));
}

/**
 * Classify a user request into one of six intents.
 *
 * @param {string} message  — the user's chat message / prompt text
 * @param {object} [context] — UI context, e.g. { kind, modelKind, layer,
 *                             entityName, fieldName, filePath, ... }
 * @returns {{ intent: string, confidence: number, scores: object,
 *             reasoning: string }}
 *
 * Always returns an intent — defaults to `explain` when nothing matches.
 * Confidence ranges 0.4 (fallback) to 0.99 (strong winner).
 */
export function classifyIntent(message, context = {}) {
  const text = String(message || "").toLowerCase();

  const scores = Object.fromEntries(INTENT_LIST.map((i) => [i, 0]));

  // Hard kind:value matches in the request. Keep these tight.
  if (text.includes("kind:") || text.includes("entity:") || text.includes("field:")) {
    // Looks like the user is referencing a target by structured key —
    // typically describe / explain. Leave neutral; phrase scoring decides.
  }

  // Score each intent by its rules.
  for (const rule of INTENT_RULES) {
    scores[rule.intent] += scoreIntent(rule, text);
  }

  // Specific kind-target hints inside the message itself (e.g. the
  // ValidationPanel-built prompt contains "Code: MISSING_MODEL_SECTION"
  // and "File:" lines that strongly imply validation_fix).
  if (/\bcode\s*:\s*[a-z_]+/i.test(message || "") && /\bfile\s*:/i.test(message || "")) {
    scores[INTENTS.VALIDATION_FIX] = (scores[INTENTS.VALIDATION_FIX] || 0) + KIND_TARGET_BOOST;
  }

  // Apply context boosts AFTER keyword scoring so they dominate.
  applyContextBoosts(scores, context);

  // Pick the highest-scoring intent, breaking ties by the order in
  // INTENT_LIST (validation_fix wins over describe wins over … wins
  // over explore). The order is chosen so destructive intents need
  // higher confidence to win.
  let intent = INTENTS.EXPLAIN; // safe default
  let topScore = 0;
  for (const candidate of INTENT_LIST) {
    if (scores[candidate] > topScore) {
      topScore = scores[candidate];
      intent = candidate;
    }
  }

  const confidence = computeConfidence(scores, intent);
  const reasoning = topScore === 0
    ? "no rule matched — defaulted to explain"
    : `${intent} score=${topScore} (next-best=${secondBestScore(scores, intent)})`;

  return { intent, confidence, scores, reasoning };
}

function secondBestScore(scores, winner) {
  let second = 0;
  for (const [k, v] of Object.entries(scores)) {
    if (k === winner) continue;
    if (v > second) second = v;
  }
  return second;
}
