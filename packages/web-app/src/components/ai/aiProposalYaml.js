import yaml from "js-yaml";

function cleanPath(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/^DataLex\//i, "");
}

function slug(value, fallback = "core") {
  const text = String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9_ -]+/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || fallback;
}

function layerFolder(value) {
  const layer = String(value || "").trim().toLowerCase();
  if (layer === "physical") return "physical";
  if (layer === "logical") return "Logical";
  return "Conceptual";
}

function pathLayer(value) {
  const parts = cleanPath(value).split("/").filter(Boolean);
  const layer = String(parts[1] || "").toLowerCase();
  if (["conceptual", "logical", "physical"].includes(layer)) return layer;
  return "";
}

function isDomainLayerPath(value, suffix) {
  const path = cleanPath(value);
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 3
    && ["conceptual", "logical", "physical"].includes(String(parts[1] || "").toLowerCase())
    && new RegExp(`\\.${suffix}\\.ya?ml$`, "i").test(path);
}

function nameFromChange(change, suffix) {
  if (change?.name) return slug(change.name, "ai_generated");
  const path = cleanPath(change?.path || change?.fullPath || change?.toPath || "");
  const file = path.split("/").pop() || "ai_generated";
  return slug(file.replace(new RegExp(`\\.${suffix}\\.ya?ml$`, "i"), "").replace(/\.ya?ml$/i, ""), "ai_generated");
}

export function aiProposalPath(change, suffix = "diagram") {
  const path = cleanPath(change?.path || change?.fullPath || change?.toPath || "");
  if (isDomainLayerPath(path, suffix)) return path;
  const parts = path.split("/").filter(Boolean);
  const domain = slug(change?.domain || change?.subject_area || change?.subjectArea || parts[0] || "core", "core");
  const layer = String(change?.layer || change?.modelKind || pathLayer(path) || "conceptual").toLowerCase();
  const name = nameFromChange(change, suffix);
  return `${domain}/${layerFolder(layer)}/${name}.${suffix}.yaml`;
}

function proposalKind(change) {
  const type = String(change?.type || change?.operation || change?.action || "").toLowerCase();
  const path = cleanPath(change?.path || change?.fullPath || change?.toPath || "");
  if (type.includes("model") || /\.model\.ya?ml$/i.test(path)) return "model";
  return "diagram";
}

export function proposalEditableYaml(change) {
  const existing = change?.content ?? change?.yaml_content ?? change?.yamlContent;
  if (typeof existing === "string" && existing.trim()) return existing;
  const kind = proposalKind(change);
  const layer = String(change?.layer || change?.modelKind || pathLayer(change?.path) || "conceptual").toLowerCase();
  const domain = String(change?.domain || "core").trim() || "core";
  const name = nameFromChange(change, kind);
  if (kind === "model") {
    return yaml.dump({
      model: {
        name,
        kind: layer,
        domain,
      },
      entities: Array.isArray(change?.entities) ? change.entities : [],
      relationships: Array.isArray(change?.relationships) ? change.relationships : [],
    }, { lineWidth: 120, noRefs: true });
  }
  return yaml.dump({
    kind: "diagram",
    name,
    title: change?.title || name.replace(/_/g, " "),
    layer,
    domain,
    entities: Array.isArray(change?.entities) ? change.entities : [],
    relationships: Array.isArray(change?.relationships) ? change.relationships : [],
  }, { lineWidth: 120, noRefs: true });
}

export function proposalChangeFromYaml(change, yamlText) {
  const kind = proposalKind(change);
  const path = aiProposalPath(change, kind);
  const {
    entities: _entities,
    relationships: _relationships,
    yaml_content: _yamlContentSnake,
    yamlContent: _yamlContentCamel,
    ...rest
  } = change || {};
  return {
    ...rest,
    type: String(change?.type || "").startsWith("create_") ? change.type : (change?.type || "update_file"),
    path,
    content: String(yamlText || ""),
  };
}

export function proposalEditorTitle(change, index = 0) {
  const kind = proposalKind(change);
  const path = aiProposalPath(change, kind);
  return `${index + 1}. ${path}`;
}
