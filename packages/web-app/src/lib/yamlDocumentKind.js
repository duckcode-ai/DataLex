import yaml from "js-yaml";

export const YAML_DOCUMENT_KINDS = Object.freeze({
  DATALEX_NATIVE: "datalex_native",
  DBT_PROPERTIES: "dbt_properties",
  DBT_SEMANTIC: "dbt_semantic",
  DBT_SAVED_QUERIES: "dbt_saved_queries",
  UNKNOWN: "unknown_yaml",
});

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasArraySection(doc, names) {
  return names.some((name) => Array.isArray(doc?.[name]));
}

export function classifyYamlDocument(doc) {
  if (!isObject(doc)) return YAML_DOCUMENT_KINDS.UNKNOWN;

  const nativeKind = String(doc.kind || "").trim().toLowerCase();
  if (
    (isObject(doc.model) && Array.isArray(doc.entities)) ||
    ["model", "diagram", "source", "enum"].includes(nativeKind)
  ) {
    return YAML_DOCUMENT_KINDS.DATALEX_NATIVE;
  }

  const hasSemanticLayer = hasArraySection(doc, ["semantic_models", "metrics"]);
  const hasSavedQueries = hasArraySection(doc, ["saved_queries"]);
  const hasDbtProperties = hasArraySection(doc, ["models", "sources", "exposures", "seeds", "snapshots", "macros"]);

  if (hasSemanticLayer) return YAML_DOCUMENT_KINDS.DBT_SEMANTIC;
  if (hasSavedQueries) return YAML_DOCUMENT_KINDS.DBT_SAVED_QUERIES;
  if (hasDbtProperties) return YAML_DOCUMENT_KINDS.DBT_PROPERTIES;

  return YAML_DOCUMENT_KINDS.UNKNOWN;
}

export function classifyYamlText(yamlText) {
  try {
    return classifyYamlDocument(yaml.load(yamlText));
  } catch (_err) {
    return YAML_DOCUMENT_KINDS.UNKNOWN;
  }
}

export function isDbtYamlDocumentKind(kind) {
  return [
    YAML_DOCUMENT_KINDS.DBT_PROPERTIES,
    YAML_DOCUMENT_KINDS.DBT_SEMANTIC,
    YAML_DOCUMENT_KINDS.DBT_SAVED_QUERIES,
  ].includes(kind);
}

export function dbtVersionWarning(doc, kind) {
  if (!isDbtYamlDocumentKind(kind)) return null;
  const version = String(doc?.version ?? "").trim();
  if (version === "2" || version === "2.0") return null;
  if (kind === YAML_DOCUMENT_KINDS.DBT_SEMANTIC || kind === YAML_DOCUMENT_KINDS.DBT_SAVED_QUERIES) {
    return "dbt semantic layer YAML was detected without `version: 2`; DataLex will treat it as dbt YAML and skip native model validation.";
  }
  return "dbt properties YAML was detected without `version: 2`; DataLex will treat it as dbt YAML and skip native model validation.";
}
