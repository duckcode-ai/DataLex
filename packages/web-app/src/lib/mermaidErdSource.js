/* Mermaid `erDiagram` source builder. Pure function — extracted from
 * MermaidERD.jsx so the same diagram can be embedded in markdown
 * exports (Phase 5a) without duplicating the logic.
 *
 * Returns the mermaid source as a string, or null when there's nothing
 * to draw. Caller decides what to do with `null`: MermaidERD shows a
 * placeholder; the markdown exporter omits the section.
 */

const MERMAID_ID = /[^A-Za-z0-9_]+/g;

function mermaidId(name) {
  const cleaned = String(name || "").replace(MERMAID_ID, "_");
  return cleaned || "Entity";
}

function mermaidType(t) {
  return String(t || "string").replace(MERMAID_ID, "_") || "string";
}

export function buildErdSource(entities) {
  if (!Array.isArray(entities) || entities.length === 0) return null;

  const lines = ["erDiagram"];
  const seen = new Set();
  const relationships = [];

  for (const ent of entities) {
    if (!ent || typeof ent !== "object") continue;
    const name = String(ent.name || "").trim();
    if (!name) continue;
    const id = mermaidId(name);
    if (seen.has(id)) continue;
    seen.add(id);

    const fields = Array.isArray(ent.fields) ? ent.fields.slice(0, 8) : [];
    const fieldLines = [];
    for (const fld of fields) {
      if (!fld || typeof fld !== "object") continue;
      const fname = String(fld.name || "").trim();
      if (!fname) continue;
      const tags = [];
      if (fld.primary_key) tags.push("PK");
      if (fld.foreign_key && fld.foreign_key.entity) {
        tags.push("FK");
        relationships.push({
          left: id,
          right: mermaidId(fld.foreign_key.entity),
          label: fname,
        });
      }
      const tagStr = tags.length ? " " + tags.join(",") : "";
      fieldLines.push(`        ${mermaidType(fld.type)} ${fname}${tagStr}`);
    }

    if (fieldLines.length) {
      lines.push(`    ${id} {`);
      lines.push(...fieldLines);
      lines.push("    }");
    } else {
      // Conceptual entity with no fields — render as a bare box.
      lines.push(`    ${id}`);
    }
  }

  const seenRels = new Set();
  for (const rel of relationships) {
    if (!seen.has(rel.right)) continue;
    const key = `${rel.left}|${rel.right}|${rel.label}`;
    if (seenRels.has(key)) continue;
    seenRels.add(key);
    lines.push(`    ${rel.right} ||--o{ ${rel.left} : "${rel.label}"`);
  }

  return lines.length > 1 ? lines.join("\n") : null;
}
