// Shared schema-level color palette used by EntityNode, SchemaOverviewNode, etc.
// Each schema gets a consistent color based on its index.

export const SCHEMA_COLORS = [
  { bg: "bg-blue-500",    bgLight: "bg-blue-50",    border: "border-blue-300",   text: "text-blue-700",   hex: "#3b82f6" },
  { bg: "bg-emerald-500", bgLight: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-700", hex: "#10b981" },
  { bg: "bg-purple-500",  bgLight: "bg-purple-50",  border: "border-purple-300", text: "text-purple-700", hex: "#8b5cf6" },
  { bg: "bg-amber-500",   bgLight: "bg-amber-50",   border: "border-amber-300",  text: "text-amber-700",  hex: "#f59e0b" },
  { bg: "bg-rose-500",    bgLight: "bg-rose-50",    border: "border-rose-300",   text: "text-rose-700",   hex: "#f43f5e" },
  { bg: "bg-cyan-500",    bgLight: "bg-cyan-50",    border: "border-cyan-300",   text: "text-cyan-700",   hex: "#06b6d4" },
  { bg: "bg-pink-500",    bgLight: "bg-pink-50",    border: "border-pink-300",   text: "text-pink-700",   hex: "#ec4899" },
  { bg: "bg-indigo-500",  bgLight: "bg-indigo-50",  border: "border-indigo-300", text: "text-indigo-700", hex: "#6366f1" },
  { bg: "bg-teal-500",    bgLight: "bg-teal-50",    border: "border-teal-300",   text: "text-teal-700",   hex: "#14b8a6" },
  { bg: "bg-orange-500",  bgLight: "bg-orange-50",  border: "border-orange-300", text: "text-orange-700", hex: "#f97316" },
];

// Build a stable schema→colorIndex map from a list of entity nodes
export function buildSchemaColorMap(entities) {
  const schemas = new Set();
  for (const e of entities) {
    const schema = e.subject_area || e.schema || "(default)";
    schemas.add(schema);
  }
  const map = {};
  let idx = 0;
  for (const s of [...schemas].sort()) {
    map[s] = idx % SCHEMA_COLORS.length;
    idx++;
  }
  return map;
}

export function getSchemaColor(index) {
  return SCHEMA_COLORS[(index || 0) % SCHEMA_COLORS.length];
}
