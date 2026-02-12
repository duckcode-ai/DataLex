import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

const LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": "90",
  "elk.layered.spacing.nodeNodeBetweenLayers": "140",
  "elk.layered.spacing.edgeNodeBetweenLayers": "48",
  "elk.padding": "[top=50,left=50,bottom=50,right=50]",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
};

const FORCE_LAYOUT_OPTIONS = {
  "elk.algorithm": "force",
  "elk.force.temperature": "0.001",
  "elk.force.iterations": "450",
  "elk.spacing.nodeNode": "90",
  "elk.padding": "[top=50,left=50,bottom=50,right=50]",
};

const LARGE_GRAPH_THRESHOLD = 200;
const VERY_LARGE_GRAPH_THRESHOLD = 450;
const COMPACT_NODE_WIDTH = 140;
const COMPACT_NODE_HEIGHT = 56;

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

function parseLayoutOptions(options) {
  if (typeof options === "string") {
    return { density: options };
  }
  return options || {};
}

function getSchemaKey(node) {
  return node?.data?.subject_area || node?.data?.schema || "(default)";
}

function getVisibleFieldCount(node, fieldView) {
  const fields = Array.isArray(node?.data?.fields) ? node.data.fields : [];
  if (fieldView === "minimal") return Math.min(8, fields.length);
  if (fieldView === "keys") {
    const classifications = node?.data?.classifications || {};
    let count = 0;
    for (const field of fields) {
      const key = `${node.id}.${field.name}`;
      if (field.primary_key || field.unique || Boolean(classifications[key])) count++;
    }
    return count;
  }
  return fields.length;
}

function estimateNodeSize(node, options = {}) {
  const fieldView = options.fieldView || "all";
  const isLargeGraph = Boolean(options.isLargeGraph);
  const isEntityNode = node?.type === "entityNode";

  if (!isEntityNode) {
    return {
      width: node?.measured?.width || node?.width || 240,
      height: node?.measured?.height || node?.height || 120,
    };
  }

  if (isLargeGraph) {
    return { width: COMPACT_NODE_WIDTH, height: COMPACT_NODE_HEIGHT };
  }

  const fields = Array.isArray(node?.data?.fields) ? node.data.fields : [];
  const visibleFields = getVisibleFieldCount(node, fieldView);
  const hiddenFields = Math.max(0, fields.length - visibleFields);
  const tags = Array.isArray(node?.data?.tags) ? node.data.tags : [];

  let height = 78;
  if (tags.length > 0) height += 20;
  if (node?.data?.subject_area || node?.data?.schema || node?.data?.sla) height += 14;
  if (node?.data?.description) height += 30;
  if (visibleFields > 0) height += 8 + visibleFields * 24;
  if (hiddenFields > 0) height += 20;

  return {
    width: 280,
    height: Math.max(96, Math.min(760, Math.round(height))),
  };
}

function buildSizeMap(nodes, options = {}) {
  const map = new Map();
  for (const node of nodes) {
    const estimated = estimateNodeSize(node, options);
    map.set(node.id, {
      width: node?.measured?.width || node?.width || estimated.width,
      height: node?.measured?.height || node?.height || estimated.height,
    });
  }
  return map;
}

export async function layoutWithElk(nodes, edges, options = {}) {
  if (!nodes || nodes.length === 0) {
    return { nodes: [], edges, groupNodes: [] };
  }

  const parsed = parseLayoutOptions(options);
  const direction = parsed.direction || "RIGHT";
  const density = parsed.density || "normal";
  const fieldView = parsed.fieldView || "all";

  // Grid gives cleaner non-overlapping results for disconnected or very large models.
  if ((edges || []).length === 0 || nodes.length >= VERY_LARGE_GRAPH_THRESHOLD) {
    return fallbackGridLayout(nodes, edges, parsed);
  }

  const spacingMultiplier = density === "compact" ? 0.7 : density === "wide" ? 1.4 : 1;
  const nodeSpacing = Math.round(90 * spacingMultiplier);
  const layerSpacing = Math.round(140 * spacingMultiplier);

  const isLargeGraph = nodes.length > LARGE_GRAPH_THRESHOLD;
  const nodeSizes = buildSizeMap(nodes, { isLargeGraph, fieldView });

  const elkNodes = nodes.map((node) => ({
    id: node.id,
    width: nodeSizes.get(node.id)?.width || 280,
    height: nodeSizes.get(node.id)?.height || 160,
  }));

  const elkEdges = edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }));

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
    children: elkNodes,
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
    return fallbackGridLayout(nodes, edges, parsed);
  }
}

export function fallbackGridLayout(nodes, edges, options = "normal") {
  if (!nodes || nodes.length === 0) return { nodes: [], edges, groupNodes: [] };

  const parsed = parseLayoutOptions(options);
  const density = parsed.density || "normal";
  const fieldView = parsed.fieldView || "all";
  const groupBySubjectArea = parsed.groupBySubjectArea !== false;
  const scale = density === "compact" ? 0.82 : density === "wide" ? 1.25 : 1;

  const sizes = buildSizeMap(nodes, {
    isLargeGraph: nodes.length > LARGE_GRAPH_THRESHOLD,
    fieldView,
  });

  const groups = new Map();
  if (groupBySubjectArea) {
    for (const node of nodes) {
      const key = getSchemaKey(node);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(node);
    }
  } else {
    groups.set("all", [...nodes]);
  }

  const orderedGroups = Array.from(groups.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, groupNodes]) => ({ name, nodes: groupNodes }));

  const innerPadding = Math.round(24 * scale);
  const nodeGapX = Math.round(64 * scale);
  const nodeGapY = Math.round(54 * scale);
  const groupGapX = Math.round(110 * scale);
  const groupGapY = Math.round(90 * scale);
  const groupTitleHeight = groupBySubjectArea && orderedGroups.length > 1 ? Math.round(24 * scale) : 0;

  const groupLayouts = orderedGroups.map((group) => {
    const localCols = Math.max(1, Math.ceil(Math.sqrt(group.nodes.length)));
    const localRows = Math.ceil(group.nodes.length / localCols);
    const colWidths = new Array(localCols).fill(0);
    const rowHeights = new Array(localRows).fill(0);

    group.nodes.forEach((node, idx) => {
      const col = idx % localCols;
      const row = Math.floor(idx / localCols);
      const size = sizes.get(node.id) || { width: 280, height: 160 };
      colWidths[col] = Math.max(colWidths[col], size.width);
      rowHeights[row] = Math.max(rowHeights[row], size.height);
    });

    const colOffsets = [];
    const rowOffsets = [];
    let accX = innerPadding;
    for (let c = 0; c < localCols; c++) {
      colOffsets[c] = accX;
      accX += colWidths[c] + nodeGapX;
    }
    let accY = innerPadding + groupTitleHeight;
    for (let r = 0; r < localRows; r++) {
      rowOffsets[r] = accY;
      accY += rowHeights[r] + nodeGapY;
    }

    const nodePositions = new Map();
    group.nodes.forEach((node, idx) => {
      const col = idx % localCols;
      const row = Math.floor(idx / localCols);
      nodePositions.set(node.id, { x: colOffsets[col], y: rowOffsets[row] });
    });

    const width = innerPadding * 2 + colWidths.reduce((sum, w) => sum + w, 0) + Math.max(0, localCols - 1) * nodeGapX;
    const height = innerPadding * 2 + groupTitleHeight + rowHeights.reduce((sum, h) => sum + h, 0) + Math.max(0, localRows - 1) * nodeGapY;

    return {
      name: group.name,
      width,
      height,
      nodePositions,
    };
  });

  const globalCols = Math.max(1, Math.ceil(Math.sqrt(groupLayouts.length)));
  const globalRows = Math.ceil(groupLayouts.length / globalCols);
  const globalColWidths = new Array(globalCols).fill(0);
  const globalRowHeights = new Array(globalRows).fill(0);

  groupLayouts.forEach((group, idx) => {
    const col = idx % globalCols;
    const row = Math.floor(idx / globalCols);
    globalColWidths[col] = Math.max(globalColWidths[col], group.width);
    globalRowHeights[row] = Math.max(globalRowHeights[row], group.height);
  });

  const globalColOffsets = [];
  const globalRowOffsets = [];
  let gx = 60;
  for (let c = 0; c < globalCols; c++) {
    globalColOffsets[c] = gx;
    gx += globalColWidths[c] + groupGapX;
  }
  let gy = 60;
  for (let r = 0; r < globalRows; r++) {
    globalRowOffsets[r] = gy;
    gy += globalRowHeights[r] + groupGapY;
  }

  const absolutePositions = new Map();
  groupLayouts.forEach((group, idx) => {
    const col = idx % globalCols;
    const row = Math.floor(idx / globalCols);
    const originX = globalColOffsets[col];
    const originY = globalRowOffsets[row];
    for (const [nodeId, pos] of group.nodePositions.entries()) {
      absolutePositions.set(nodeId, {
        x: originX + pos.x,
        y: originY + pos.y,
      });
    }
  });

  const layoutedNodes = nodes.map((node) => ({
    ...node,
    position: absolutePositions.get(node.id) || node.position,
  }));

  return { nodes: layoutedNodes, edges, groupNodes: [] };
}
