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

  // Group nodes by subject_area
  const subjectAreas = new Map();
  if (groupBySubjectArea) {
    for (const node of nodes) {
      const sa = node.data?.subject_area || "";
      if (sa) {
        if (!subjectAreas.has(sa)) subjectAreas.set(sa, []);
        subjectAreas.get(sa).push(node.id);
      }
    }
  }

  const elkNodes = nodes.map((node) => ({
    id: node.id,
    width: node.measured?.width || 300,
    height: node.measured?.height || 200,
  }));

  const elkEdges = edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }));

  // Build ELK graph with compound nodes for subject areas
  let children;
  const nodeToGroup = new Map();
  if (subjectAreas.size > 1) {
    const groupChildren = [];
    const ungrouped = [];
    const grouped = new Set();

    let saIdx = 0;
    for (const [sa, nodeIds] of subjectAreas) {
      const groupId = `__group_${sa}`;
      const groupElkNodes = elkNodes.filter((n) => nodeIds.includes(n.id));
      for (const nid of nodeIds) {
        nodeToGroup.set(nid, groupId);
        grouped.add(nid);
      }
      groupChildren.push({
        id: groupId,
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": direction,
          "elk.spacing.nodeNode": String(nodeSpacing),
          "elk.layered.spacing.nodeNodeBetweenLayers": String(layerSpacing),
          "elk.padding": "[top=40,left=30,bottom=30,right=30]",
        },
        children: groupElkNodes,
      });
      saIdx++;
    }

    for (const n of elkNodes) {
      if (!grouped.has(n.id)) ungrouped.push(n);
    }

    children = [...groupChildren, ...ungrouped];
  } else {
    children = elkNodes;
  }

  const graph = {
    id: "root",
    layoutOptions: {
      ...LAYOUT_OPTIONS,
      "elk.direction": direction,
      "elk.spacing.nodeNode": String(nodeSpacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(layerSpacing),
      ...(subjectAreas.size > 1 ? {
        "elk.hierarchyHandling": "INCLUDE_CHILDREN",
        "elk.spacing.componentComponent": String(Math.round(100 * spacingMultiplier)),
      } : {}),
    },
    children,
    edges: elkEdges,
  };

  try {
    const result = await elk.layout(graph);

    const positionMap = new Map();
    const groupNodes = [];
    let saIdx = 0;

    const processChildren = (children, offsetX = 0, offsetY = 0) => {
      for (const child of children || []) {
        if (child.id.startsWith("__group_")) {
          const sa = child.id.replace("__group_", "");
          const color = getSubjectAreaColor(saIdx);
          groupNodes.push({
            id: child.id,
            type: "group",
            position: { x: (child.x || 0) + offsetX, y: (child.y || 0) + offsetY },
            style: {
              width: child.width || 400,
              height: child.height || 300,
              backgroundColor: color.bg,
              border: `2px dashed ${color.border}`,
              borderRadius: 16,
              zIndex: -1,
            },
            data: { label: sa, color },
          });
          processChildren(child.children, (child.x || 0) + offsetX, (child.y || 0) + offsetY);
          saIdx++;
        } else {
          positionMap.set(child.id, { x: (child.x || 0) + offsetX, y: (child.y || 0) + offsetY });
        }
      }
    };

    processChildren(result.children);

    const layoutedNodes = nodes.map((node) => {
      const pos = positionMap.get(node.id);
      return {
        ...node,
        position: pos || node.position,
        parentId: nodeToGroup.get(node.id) || undefined,
        extent: nodeToGroup.get(node.id) ? "parent" : undefined,
      };
    });

    return { nodes: layoutedNodes, edges, groupNodes };
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
