/* dbtLint — client-side linting of imported dbt entities.
 *
 * Runs entirely in-memory against parsed YAML entity objects. Produces a flat
 * array of findings shaped the same as `runModelChecks` (code / severity /
 * path / message) so ValidationPanel can render them in the same UI.
 *
 * We intentionally keep the rules lightweight: the goal is to nudge dbt users
 * toward complete metadata, not to replace `dbt-checkpoint` or `sqlfluff`.
 * Every rule is a function that returns an array of findings — easy to add
 * more, easy to disable individually.
 *
 * Consumed by:
 *   - ColumnsView → per-column warning pill beside the column name
 *   - ValidationPanel → aggregated findings across the active file
 *
 * Nothing in this file writes to YAML or persists state. Pure functions only.
 */

/** @typedef {{
 *   code: string,
 *   severity: "error" | "warn" | "info",
 *   path: string,
 *   field?: string,
 *   message: string,
 * }} LintFinding
 */

/**
 * Lint a single entity / model / source-table object.
 *
 * @param {object} entity  Parsed entity dict (as produced by yaml.load).
 * @param {object} [opts]
 * @param {string} [opts.filePath] Optional file path, used in `path` for UI display.
 * @returns {LintFinding[]}
 */
export function lintEntity(entity, opts = {}) {
  if (!entity || typeof entity !== "object") return [];
  const filePath = opts.filePath || "";
  const entityName = entity.name || "(unnamed)";
  const pathBase = filePath ? `${filePath}#${entityName}` : entityName;

  const out = [];

  // Entity-level: missing description weakens documentation coverage.
  if (!hasValue(entity.description)) {
    out.push({
      code: "DBT_ENTITY_NO_DESCRIPTION",
      severity: "warn",
      path: pathBase,
      message: `Entity \`${entityName}\` has no description.`,
    });
  }

  // Column-level rules run once per column, then aggregate.
  const columns = pickColumns(entity);
  if (columns.length === 0) {
    out.push({
      code: "DBT_ENTITY_NO_COLUMNS",
      severity: "warn",
      path: pathBase,
      message: `Entity \`${entityName}\` declares no columns.`,
    });
    return out;
  }

  for (const col of columns) {
    const colName = col.name || "(unnamed)";
    const colPath = `${pathBase}.${colName}`;

    if (!hasValue(col.description)) {
      out.push({
        code: "DBT_COLUMN_NO_DESCRIPTION",
        severity: "warn",
        path: colPath,
        field: colName,
        message: `Column \`${colName}\` has no description.`,
      });
    }

    if (!hasValue(col.type) && !hasValue(col.data_type)) {
      out.push({
        code: "DBT_COLUMN_NO_TYPE",
        severity: "warn",
        path: colPath,
        field: colName,
        message: `Column \`${colName}\` has no \`type\` / \`data_type\`. Contracts will fail.`,
      });
    }

    if (isPrimaryKey(col) && !hasTestCoverage(col)) {
      out.push({
        code: "DBT_PK_NO_TESTS",
        severity: "info",
        path: colPath,
        field: colName,
        message: `Primary-key column \`${colName}\` has no \`tests\` (add \`unique\` / \`not_null\`).`,
      });
    }
  }

  return out;
}

/**
 * Lint every entity inside a parsed DataLex model doc (a file with
 * `entities: [...]`). Returns a flat array — callers group by path as needed.
 */
export function lintDoc(doc, opts = {}) {
  if (!doc || typeof doc !== "object") return [];
  const filePath = opts.filePath || "";

  // DataLex-native file: top-level `entities` array.
  if (Array.isArray(doc.entities)) {
    return doc.entities.flatMap((e) => lintEntity(e, { filePath }));
  }

  // dbt-shaped file: `models:` or `sources:` arrays (pre-import).
  const out = [];
  if (Array.isArray(doc.models)) {
    for (const m of doc.models) out.push(...lintEntity(m, { filePath }));
  }
  if (Array.isArray(doc.sources)) {
    for (const src of doc.sources) {
      for (const t of src.tables || []) {
        out.push(...lintEntity(t, { filePath: `${filePath || ""}#${src.name || ""}` }));
      }
    }
  }

  // DataLex per-file entity shape: `kind: model|source` + top-level columns.
  if (!out.length && (doc.kind === "model" || doc.kind === "source")) {
    if (doc.kind === "source" && Array.isArray(doc.tables)) {
      for (const t of doc.tables) out.push(...lintEntity(t, { filePath }));
    } else {
      out.push(...lintEntity(doc, { filePath }));
    }
  }

  return out;
}

/**
 * Summarise a findings array into the counts the UI header needs.
 * Small helper so callers don't re-implement the same reduce.
 */
export function summarise(findings) {
  const by = { error: 0, warn: 0, info: 0 };
  for (const f of findings || []) {
    if (by[f.severity] !== undefined) by[f.severity] += 1;
  }
  return { ...by, total: by.error + by.warn + by.info };
}

/* ------------------------ helpers ------------------------ */

function hasValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

function pickColumns(entity) {
  // DataLex uses `fields` for user-authored models, `columns` for dbt-shaped.
  const raw = entity.columns || entity.fields;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  // dbt manifests sometimes emit columns as a map keyed by name.
  if (typeof raw === "object") {
    return Object.entries(raw).map(([name, col]) => ({ name, ...(col || {}) }));
  }
  return [];
}

function isPrimaryKey(col) {
  if (col.primary_key === true) return true;
  if (col.pk === true) return true;
  const flags = col.flags || [];
  if (Array.isArray(flags) && flags.includes("PK")) return true;
  const constraints = col.constraints || [];
  if (Array.isArray(constraints)) {
    for (const c of constraints) {
      if (c && c.type === "primary_key") return true;
    }
  }
  return false;
}

function hasTestCoverage(col) {
  const tests = col.tests;
  if (!tests) return false;
  if (Array.isArray(tests)) return tests.length > 0;
  if (typeof tests === "object") return Object.keys(tests).length > 0;
  return Boolean(tests);
}
