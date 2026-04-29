import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const AGENT_DIR = join(".datalex", "agent");
const CHATS_FILE = "chats.json";
const MEMORY_FILE = "memory.json";
const INDEX_FILE = "index.json";
const SQLITE_FILE = "runtime.sqlite";
const SQLITE_ENABLED = !["0", "false", "no"].includes(String(process.env.DATALEX_AI_SQLITE || "1").toLowerCase());
let sqliteModulePromise = null;

function nowIso() {
  return new Date().toISOString();
}

function agentPath(project, file = "") {
  return join(project.path, AGENT_DIR, file);
}

async function loadSqliteModule() {
  if (!SQLITE_ENABLED) return null;
  if (!sqliteModulePromise) {
    sqliteModulePromise = import("node:sqlite").catch(() => null);
  }
  return sqliteModulePromise;
}

async function withSqlite(project, fn) {
  const mod = await loadSqliteModule();
  const DatabaseSync = mod?.DatabaseSync;
  if (!DatabaseSync) return null;
  await mkdir(agentPath(project), { recursive: true });
  const db = new DatabaseSync(agentPath(project, SQLITE_FILE));
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_json_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    return fn(db);
  } catch (_err) {
    return null;
  } finally {
    try { db.close(); } catch (_err) {}
  }
}

async function readSqliteJson(project, file) {
  const row = await withSqlite(project, (db) => {
    return db.prepare("SELECT value FROM ai_json_store WHERE key = ?").get(file);
  });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value);
  } catch (_err) {
    return null;
  }
}

async function writeSqliteJson(project, file, value) {
  await withSqlite(project, (db) => {
    db.prepare(`
      INSERT INTO ai_json_store (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(file, JSON.stringify(value), nowIso());
    return true;
  });
}

async function readJson(project, file, fallback) {
  const sqliteValue = await readSqliteJson(project, file);
  if (sqliteValue) return sqliteValue;
  try {
    const raw = await readFile(agentPath(project, file), "utf-8");
    const parsed = JSON.parse(raw);
    await writeSqliteJson(project, file, parsed);
    return parsed;
  } catch (_err) {
    return fallback;
  }
}

async function writeJson(project, file, value) {
  await mkdir(agentPath(project), { recursive: true });
  await writeFile(agentPath(project, file), `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await writeSqliteJson(project, file, value);
}

export async function getAiRuntimeStorageInfo(project) {
  const sqliteAvailable = Boolean((await loadSqliteModule())?.DatabaseSync);
  return {
    mode: sqliteAvailable && SQLITE_ENABLED ? "sqlite+json" : "json",
    jsonDir: agentPath(project),
    sqlitePath: agentPath(project, SQLITE_FILE),
    sqliteEnabled: SQLITE_ENABLED,
    sqliteAvailable,
  };
}

export async function persistAiIndexSnapshot(project, index) {
  const snapshot = {
    version: 1,
    projectId: index?.projectId,
    builtAt: index?.builtAt,
    projectPath: index?.projectPath,
    modelPath: index?.modelPath,
    recordCount: Array.isArray(index?.records) ? index.records.length : 0,
    typedCounts: index?.typedCounts || {},
    dbtArtifacts: index?.dbtArtifacts || {},
    records: Array.isArray(index?.records) ? index.records : [],
  };
  await writeJson(project, INDEX_FILE, snapshot);
  return snapshot;
}

function normalizeText(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function titleFromMessage(message) {
  const clean = normalizeText(message).replace(/[^\w\s-]/g, "").trim();
  if (!clean) return "New modeling chat";
  const words = clean.split(/\s+/).slice(0, 7);
  return words.join(" ");
}

export async function listAiChats(project, { limit = 50 } = {}) {
  const store = await readJson(project, CHATS_FILE, { version: 1, chats: [] });
  return (Array.isArray(store.chats) ? store.chats : [])
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
    }))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, limit);
}

export async function getAiChat(project, chatId) {
  if (!chatId) return null;
  const store = await readJson(project, CHATS_FILE, { version: 1, chats: [] });
  return (Array.isArray(store.chats) ? store.chats : []).find((chat) => chat.id === chatId) || null;
}

export async function createAiChat(project, { title, message } = {}) {
  const store = await readJson(project, CHATS_FILE, { version: 1, chats: [] });
  const time = nowIso();
  const chat = {
    id: randomUUID(),
    title: title || titleFromMessage(message),
    createdAt: time,
    updatedAt: time,
    messages: [],
  };
  store.version = 1;
  store.chats = Array.isArray(store.chats) ? store.chats : [];
  store.chats.unshift(chat);
  await writeJson(project, CHATS_FILE, store);
  return chat;
}

export async function appendAiChatMessages(project, chatId, messages = []) {
  const store = await readJson(project, CHATS_FILE, { version: 1, chats: [] });
  store.version = 1;
  store.chats = Array.isArray(store.chats) ? store.chats : [];
  let chat = store.chats.find((item) => item.id === chatId);
  if (!chat) {
    chat = await createAiChat(project, { message: messages.find((m) => m.role === "user")?.content || "" });
    chatId = chat.id;
    const refreshed = await readJson(project, CHATS_FILE, { version: 1, chats: [] });
    store.chats = refreshed.chats;
    chat = store.chats.find((item) => item.id === chatId);
  }
  const time = nowIso();
  chat.messages = Array.isArray(chat.messages) ? chat.messages : [];
  for (const message of messages) {
    chat.messages.push({
      id: message.id || randomUUID(),
      role: message.role,
      content: String(message.content || ""),
      createdAt: message.createdAt || time,
      metadata: message.metadata || {},
    });
  }
  chat.updatedAt = time;
  await writeJson(project, CHATS_FILE, store);
  return chat;
}

/**
 * Read the per-project memory store with a one-time selective migration
 * to drop entries auto-extracted by the old over-eager regex (see
 * `pruneAutoExtractedMemoryRules` below). Subsequent reads are no-ops
 * because the matched entries are already gone.
 *
 * Both `listAiMemories` and `upsertAiMemories` go through this helper so
 * the cleanup happens on first load regardless of which path the
 * api-server hits first.
 */
async function loadMemoryStoreMigrated(project) {
  const store = await readJson(project, MEMORY_FILE, { version: 1, memories: [] });
  const list = Array.isArray(store.memories) ? store.memories : [];
  const { memories: cleaned, droppedCount } = pruneAutoExtractedMemoryRules(list);
  if (droppedCount > 0) {
    store.memories = cleaned;
    await writeJson(project, MEMORY_FILE, store);
    try {
      // eslint-disable-next-line no-console
      console.log(`[memory] migrated ${droppedCount} auto-extracted entries from polluted store`);
    } catch { /* logger not available */ }
  }
  return store;
}

export async function listAiMemories(project) {
  const store = await loadMemoryStoreMigrated(project);
  return (Array.isArray(store.memories) ? store.memories : [])
    .filter((memory) => !memory.supersededBy)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

export async function upsertAiMemories(project, memories = []) {
  const store = await loadMemoryStoreMigrated(project);
  store.version = 1;
  store.memories = Array.isArray(store.memories) ? store.memories : [];
  const existing = new Map(store.memories.filter((m) => !m.supersededBy).map((m) => [normalizeText(m.content).toLowerCase(), m]));
  const added = [];
  const time = nowIso();
  for (const item of memories) {
    const content = normalizeText(item.content);
    if (!content) continue;
    const key = content.toLowerCase();
    if (existing.has(key)) continue;
    const memory = {
      id: randomUUID(),
      category: item.category || "business_standard",
      content,
      sourceChatId: item.sourceChatId || null,
      createdAt: time,
      updatedAt: time,
      supersededBy: null,
    };
    store.memories.unshift(memory);
    existing.set(key, memory);
    added.push(memory);
  }
  if (added.length) await writeJson(project, MEMORY_FILE, store);
  return added;
}

export async function deleteAiMemory(project, memoryId) {
  const store = await loadMemoryStoreMigrated(project);
  const before = Array.isArray(store.memories) ? store.memories.length : 0;
  store.memories = (Array.isArray(store.memories) ? store.memories : []).filter((memory) => memory.id !== memoryId);
  if (store.memories.length !== before) {
    await writeJson(project, MEMORY_FILE, store);
    return true;
  }
  return false;
}

/**
 * Extract user-stated *rules* from a chat message and persist them as
 * modeling memory.
 *
 * The previous heuristic was wildly over-eager — any line containing
 * "dbt", "model", or "test" was tagged as a `dbt_implementation_rule`.
 * That meant ordinary one-shot prompts ("suggest a description for the
 * dbt model …") landed in `<project>/.datalex/agent/memory.json`,
 * polluted future agent runs, and surfaced back to the user as
 * "Remembered modeling preferences."
 *
 * Tightened contract: a memory is extracted ONLY when the line is in
 * imperative mood AND looks like a structural rule. We require:
 *   1. The line starts with an imperative trigger
 *      (always / never / prefer / avoid / do not / don't / use only / use this /
 *       rule: / standard: / convention:).
 *   2. The line is short enough to be a rule, not a paragraph (≤ 240 chars).
 *
 * Anything else — questions, requests, descriptions of intent — is
 * deliberately ignored. False negatives are vastly preferable to false
 * positives here: a missed memory is recoverable; a poisoned memory
 * needs a manual cleanup.
 */
// Split into two alternations because `\b` only marks a word↔non-word
// boundary — after a literal `:` followed by space, there's no boundary,
// so the colon-prefix patterns need a separate match without `\b`.
const MEMORY_IMPERATIVE_RX = /^(always|never|prefer|avoid|do not|don't|use only|use this)\b|^(rule|standard|convention)\s*:/;

export function extractModelingMemories(message) {
  const text = String(message || "");
  const candidates = [];
  const lines = text.split(/\r?\n|[.;]\s+/).map(normalizeText).filter(Boolean);
  for (const line of lines) {
    if (line.length > 240) continue;
    const lower = line.toLowerCase();
    if (!MEMORY_IMPERATIVE_RX.test(lower)) continue;

    // Within the imperative subset, classify the rule into a category so
    // downstream consumers (chat UI, system-prompt rendering) can group.
    // Order matters: dbt-implementation hints (test / contract / schema)
    // beat naming hints (column / convention) when both are present —
    // "every PK column needs a unique + not_null test" is a test-coverage
    // rule, not a naming rule.
    if (/\b(dbt|schema\.yml|test|contract|source|exposure|metric)\b/.test(lower)) {
      candidates.push({ category: "dbt_implementation_rule", content: line });
    } else if (/\b(domain|subject area|bounded context)\b/.test(lower)) {
      candidates.push({ category: "domain_decision", content: line });
    } else if (/\b(naming|name|names?|suffix(?:es)?|prefix(?:es)?|case|column|snake|camel|pascal|kebab)\b/.test(lower)) {
      // "convention" is intentionally NOT here — it's used as a generic
      // sentence prefix ("Convention: customer domain owns …") far more
      // often than as an actual naming hint, and the prefix doesn't
      // imply the rule's category.
      candidates.push({ category: "naming_rule", content: line });
    } else if (/\b(glossary|term|definition|dictionary)\b/.test(lower)) {
      candidates.push({ category: "glossary_convention", content: line });
    } else {
      candidates.push({ category: "user_preference", content: line });
    }
  }
  return candidates.slice(0, 8);
}

/**
 * One-time selective migration for memory stores polluted by the old
 * over-eager extractor. Drops only entries whose `content` matches the
 * known polluted-prompt patterns from the original "Suggest with AI"
 * button (which sent its own prompt template through `/api/ai/ask` and
 * got every prompt persisted as a rule).
 *
 * Idempotent — second run is a no-op because the matched entries are
 * already gone. Returns the cleaned memory list and the count dropped
 * so callers can log it.
 */
const POLLUTED_MEMORY_PATTERNS = [
  /^For the dbt \+ DataLex model at /i,
  /Reply with ONLY/i,
  /suggest a 1-2 sentence/i,
  /^For the entity .+ in `/i,
  /^For the field .+ on entity /i,
];

export function pruneAutoExtractedMemoryRules(memories) {
  if (!Array.isArray(memories)) return { memories: [], droppedCount: 0 };
  const kept = [];
  let dropped = 0;
  for (const m of memories) {
    const content = String(m?.content || "");
    if (POLLUTED_MEMORY_PATTERNS.some((rx) => rx.test(content))) {
      dropped += 1;
      continue;
    }
    kept.push(m);
  }
  return { memories: kept, droppedCount: dropped };
}

export function renderMemoryContext(memories = []) {
  const active = memories.slice(0, 20);
  if (!active.length) return "";
  const lines = active.map((memory) => `- [${memory.category}] ${memory.content}`);
  return `Persisted DataLex modeling memory:\n${lines.join("\n")}`;
}
