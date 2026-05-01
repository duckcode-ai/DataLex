/* docsToMarkdown — Phase 5a. Pure function that turns a parsed YAML
 * model document into a portable, paste-anywhere Markdown string.
 *
 * Why this shape:
 *   - GitHub, GitLab, Confluence-with-Mermaid-macro, Notion (via paste),
 *     and most LLM tools render mermaid fenced code blocks. Embedding
 *     the same `erDiagram` source the Docs view shows means the
 *     diagram travels with the doc instead of being a screenshot.
 *   - Tables are GitHub-flavored markdown — render correctly in
 *     Confluence, GitHub PR descriptions, and pandoc → DOCX.
 *   - We deliberately omit the dbt-specific cards (semantic models,
 *     metrics, exposures, snapshots). Those have rich domain renderers
 *     in DocsView; doing them as markdown is a separate slice and
 *     mostly useful inside the dbt ecosystem itself.
 *
 * Returns a string ending with a single trailing newline.
 */

import { buildEventStormingFlow } from "./eventStormingFlow.js";
import { buildErdSource } from "../../lib/mermaidErdSource.js";

const ES_GROUP_BLURB = {
  actor: "people, roles, or external systems that initiate work in this domain",
  command: "intents — what an actor asks the system to do",
  aggregate: "consistency boundaries that handle commands and emit events",
  event: "facts that have happened in the domain (past tense)",
  policy: "rules that react to events and trigger the next command",
};

function escapeMd(s) {
  // Markdown table cells: pipes and newlines need escaping. Everything
  // else can pass through; readers expect prose to look like prose.
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function escapeInline(s) {
  // Block context (description paragraphs) — keep newlines, just trim.
  return String(s ?? "").trim();
}

function fieldFlags(field) {
  const flags = [];
  if (field?.primary_key) flags.push("PK");
  if (field?.foreign_key?.entity) {
    const target = field.foreign_key.field || "?";
    flags.push(`FK→${field.foreign_key.entity}.${target}`);
  }
  if (field?.unique) flags.push("unique");
  if (field?.nullable === false) flags.push("not-null");
  return flags.length ? flags.join(", ") : "—";
}

function modelMeta(doc) {
  const m = (doc && (doc.model || doc)) || {};
  return {
    name: String(doc?.model?.name || doc?.name || "Untitled model").trim(),
    version: doc?.model?.version || doc?.version || "",
    domain: doc?.model?.domain || doc?.domain || "",
    description: doc?.model?.description || doc?.description || "",
    owners: Array.isArray(m.owners) ? m.owners.filter(Boolean) : [],
    state: m.state || doc?.state || "",
  };
}

function entitiesOf(doc) {
  if (Array.isArray(doc?.entities)) return doc.entities;
  if (Array.isArray(doc?.model?.entities)) return doc.model.entities;
  return [];
}

function renderHeader(meta) {
  const lines = [`# ${meta.name}`];
  const chips = [];
  if (meta.version) chips.push(`**Version** \`${meta.version}\``);
  if (meta.domain) chips.push(`**Domain** \`${meta.domain}\``);
  if (meta.state) chips.push(`**State** \`${meta.state}\``);
  if (meta.owners.length) chips.push(`**Owners** ${meta.owners.map((o) => `\`${o}\``).join(", ")}`);
  if (chips.length) lines.push("", chips.join(" · "));
  return lines.join("\n");
}

function renderOverview(meta) {
  const desc = escapeInline(meta.description);
  if (!desc) return null;
  return ["## Overview", "", desc].join("\n");
}

function renderErd(entities) {
  const src = buildErdSource(entities);
  if (!src) return null;
  return ["## Entity-relationship diagram", "", "```mermaid", src, "```"].join("\n");
}

function renderEventStorming(entities) {
  const groups = buildEventStormingFlow(entities);
  if (groups.length === 0) return null;

  const out = ["## EventStorming flow", ""];
  out.push("The pieces of this domain in workshop order — actors trigger commands, aggregates handle them, events record what happened, policies react.");
  for (const g of groups) {
    out.push("", `### ${g.label}`);
    const blurb = ES_GROUP_BLURB[g.type];
    if (blurb) out.push("", `_${blurb}_`);
    out.push("");
    g.items.forEach((e, idx) => {
      const name = String(e?.name || `${g.label.slice(0, -1)} ${idx + 1}`);
      const desc = escapeInline(e?.description);
      out.push(desc ? `${idx + 1}. **${name}** — ${desc}` : `${idx + 1}. **${name}**`);
    });
  }
  return out.join("\n");
}

function renderEntityFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return null;
  const out = [
    "| Field | Type | Flags | Description |",
    "| --- | --- | --- | --- |",
  ];
  for (const f of fields) {
    if (!f || typeof f !== "object") continue;
    const name = escapeMd(f.name || "");
    if (!name) continue;
    const type = escapeMd(f.type || "");
    const flags = escapeMd(fieldFlags(f));
    const desc = escapeMd(f.description || "");
    out.push(`| \`${name}\` | \`${type}\` | ${flags} | ${desc} |`);
  }
  return out.length > 2 ? out.join("\n") : null;
}

function renderEntities(entities) {
  if (!Array.isArray(entities) || entities.length === 0) return null;
  const out = ["## Entities"];
  for (const e of entities) {
    if (!e || typeof e !== "object") continue;
    const name = String(e.name || "").trim();
    if (!name) continue;
    const type = e.type || "entity";
    out.push("", `### ${name}`, "", `**Type**: \`${type}\``);
    const desc = escapeInline(e.description);
    if (desc) out.push("", desc);
    const fieldsTable = renderEntityFields(e.fields);
    if (fieldsTable) out.push("", "**Fields**", "", fieldsTable);
  }
  return out.length > 1 ? out.join("\n") : null;
}

export function buildDocsMarkdown(doc) {
  const meta = modelMeta(doc);
  const ents = entitiesOf(doc);

  const sections = [
    renderHeader(meta),
    renderOverview(meta),
    renderErd(ents),
    renderEventStorming(ents),
    renderEntities(ents),
  ].filter(Boolean);

  return sections.join("\n\n") + "\n";
}
