import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

const LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": "80",
  "elk.layered.spacing.nodeNodeBetweenLayers": "120",
  "elk.layered.spacing.edgeNodeBetweenLayers": "40",
  "elk.padding": "[top=50,left=50,bottom=50,right=50]",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
};

const FORCE_LAYOUT_OPTIONS = {
  "elk.algorithm": "force",
  "elk.force.temperature": "0.001",
  "elk.force.iterations": "300",
  "elk.spacing.nodeNode": "60",
  "elk.padding": "[top=50,left=50,bottom=50,right=50]",
};

const LARGE_GRAPH_THRESHOLD = 200;

const SUBJECT_AREA_COLORS = [
  { bg: "rgba(59,130,246,0.06)", border: "rgba(59,130,246,0.25)", text: "#2563eb" },
  { bg: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.25)", text: "#059669" },
  { bg: "rgba(168,85,247,0.06)", border: "rgba(168,85,247,0.25)", text: "#7c3aed" },
  { bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.25)", text: "#d97706" },
  { bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.25)", text: "#dc2626" },
  { bg: "rgba(6,182,212,0.06)", border: "rgba(6,182,212,0.25)", text: "#0891b2" },
  { bg: "rgba(236,72,153,0.06)", border: "rgba(236,72,153,0.25)", text: "#db2777" },
  { bg: "rgba(99,102,241,0.06)", border: "rgba(99,102,241,0.25)", text: "#4f46e5" },
];

export function getSubjectAreaColor(index) {
  return SUBJECT_AREA_COLORS[index % SUBJECT_AREA_COLORS.length];
}

export async function layoutWithElk(nodes, edges, options = {}) {
  if (!nodes || nodes.length === 0) {
    return { nodes: [], edges, groupNodes: [] };
  }

  const direction = options.direction || "RIGHT";
  const density = options.density || "normal";
  const groupBySubjectArea = options.groupBySubjectArea !== false;

  const spacingMultiplier = density === "compact" ? 0.7 : density === "wide" ? 1.4 : 1;
  const nodeSpacing = Math.round(80 * spacingMultiplier);
  const layerSpacing = Math.round(120 * spacingMultiplier);

  const isLargeGraph = nodes.length > LARGE_GRAPH_THRESHOLD;
  const defaultWidth = isLargeGraph ? 160 : 300;
  const defaultHeight = isLargeGraph ? 60 : 200;

  const elkNodes = nodes.map((node) => ({
    id: node.id,
    width: node.measured?.width || defaultWidth,
    height: node.measured?.height || defaultHeight,
  }));

  const elkEdges = edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }));

  // Flat layout — no compound grouping (schema identity shown via entity accent colors)
  const children = elkNodes;

  const baseOptions = isLargeGraph
    ? { ...FORCE_LAYOUT_OPTIONS, "elk.spacing.nodeNode": String(nodeSpacing) }
    : {
        ...LAYOUT_OPTIONS,
        "elk.direction": direction,
        "elk.spacing.nodeNode": String(nodeSpacing),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(layerSpacing),
      };

  const graph = {
    id: "root",
    layoutOptions: baseOptions,
    children,
    edges: elkEdges,
  };

  try {
    const result = await elk.layout(graph);

    const positionMap = new Map();
    for (const child of result.children || []) {
      positionMap.set(child.id, { x: child.x || 0, y: child.y || 0 });
    }

    const layoutedNodes = nodes.map((node) => {
      const pos = positionMap.get(node.id);
      return {
        ...node,
        position: pos || node.position,
      };
    });

    return { nodes: layoutedNodes, edges, groupNodes: [] };
  } catch (err) {
    console.warn("[elk] Layout failed, falling back to grid:", err);
    return fallbackGridLayout(nodes, edges, density);
  }
}

export function fallbackGridLayout(nodes, edges, density = "normal") {
  const scale = density === "compact" ? 0.8 : density === "wide" ? 1.3 : 1;
  const spacingX = 380 * scale;
  const spacingY = 280 * scale;
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));

  const layoutedNodes = nodes.map((node, index) => ({
    ...node,
    position: {
      x: 60 + (index % columns) * spacingX,
      y: 60 + Math.floor(index / columns) * spacingY,
    },
  }));

  return { nodes: layoutedNodes, edges, groupNodes: [] };
}
