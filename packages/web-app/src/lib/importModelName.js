export function normalizeImportedModelFileName(name) {
  if (!name || typeof name !== "string") {
    return `imported_${Date.now()}.model.yaml`;
  }

  const trimmed = name.trim();
  const base = trimmed.replace(/\s+/g, "_");
  const lower = base.toLowerCase();

  if (lower.endsWith(".model.yaml") || lower.endsWith(".model.yml")) return base;

  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    const noExt = base.replace(/\.(yaml|yml)$/i, "");
    return `${noExt}.model.yaml`;
  }

  return `${base}.model.yaml`;
}
