import React from "react";
import yaml from "js-yaml";

function cleanName(value, fallback = "Item") {
  const text = String(value || "").trim();
  return text || fallback;
}

function endpointName(endpoint) {
  if (endpoint == null) return "";
  if (typeof endpoint === "string") return endpoint;
  return endpoint.entity || endpoint.table || endpoint.name || endpoint.model || "";
}

function entityName(entity, index) {
  return cleanName(entity?.entity || entity?.name || entity?.table || entity?.model, `Entity ${index + 1}`);
}

function entityFields(entity) {
  const raw = entity?.fields || entity?.columns || entity?.attributes || [];
  return Array.isArray(raw)
    ? raw.map((field) => cleanName(field?.name || field?.field || field?.column || field, "")).filter(Boolean)
    : [];
}

function parseContent(change) {
  const content = change?.content ?? change?.yaml_content ?? change?.yamlContent ?? "";
  if (!content || typeof content !== "string") return null;
  try {
    return yaml.load(content) || null;
  } catch (_err) {
    return null;
  }
}

export function buildAiProposalPreviewData(change) {
  const doc = parseContent(change);
  const type = String(change?.type || change?.operation || change?.action || "").toLowerCase();
  const path = String(change?.path || change?.fullPath || change?.toPath || "");
  const isDiagram = type.includes("diagram") || /\.diagram\.ya?ml$/i.test(path) || doc?.kind === "diagram";
  const rawEntities = Array.isArray(change?.entities)
    ? change.entities
    : Array.isArray(doc?.entities)
      ? doc.entities
      : [];
  const relationships = Array.isArray(change?.relationships)
    ? change.relationships
    : Array.isArray(doc?.relationships)
      ? doc.relationships
      : [];
  const previewable = rawEntities.length > 0 || relationships.length > 0 || isDiagram;
  if (!previewable) return null;

  const generated = rawEntities.map((entity, index) => {
    const rawX = entity?.x;
    const rawY = entity?.y;
    return {
      id: entityName(entity, index),
      name: entityName(entity, index),
      type: cleanName(entity?.type || (isDiagram ? "diagram node" : "entity"), ""),
      fields: entityFields(entity),
      x: Number.isFinite(Number(rawX)) ? Number(rawX) : null,
      y: Number.isFinite(Number(rawY)) ? Number(rawY) : null,
      subjectArea: entity?.subject_area || entity?.subjectArea || entity?.domain || "",
    };
  });

  const count = Math.max(generated.length, 1);
  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(count))));
  const nodes = generated.map((entity, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    return {
      ...entity,
      x: entity.x ?? 58 + col * 190,
      y: entity.y ?? 54 + row * 120,
    };
  });

  return {
    title: cleanName(change?.title || doc?.title || change?.name || doc?.name || doc?.model?.name || path.split("/").pop(), "AI proposal"),
    layer: cleanName(change?.layer || doc?.layer || doc?.model?.kind || "", ""),
    domain: cleanName(change?.domain || doc?.domain || doc?.model?.domain || "", ""),
    path,
    kind: isDiagram ? "diagram" : "model",
    nodes,
    relationships: relationships.map((relationship, index) => {
      const verb = cleanName(relationship?.verb || "", "");
      return {
        name: cleanName(relationship?.name || verb || `relationship_${index + 1}`),
        from: endpointName(relationship?.from),
        to: endpointName(relationship?.to),
        cardinality: cleanName(relationship?.cardinality || relationship?.type || relationship?.relationship_type || "", ""),
        verb,
        description: cleanName(relationship?.description || "", ""),
      };
    }).filter((relationship) => relationship.from && relationship.to),
  };
}

function relationshipLabel(relationship) {
  if (relationship.verb) return relationship.verb;
  if (relationship.cardinality) return relationship.cardinality.replace(/_/g, " ");
  return relationship.name;
}

function cardinalityLabel(value) {
  return String(value || "").replace(/_/g, ":").replace("one", "1").replace("many", "N") || "relationship";
}

function relationshipSentence(relationship) {
  const label = relationshipLabel(relationship);
  const base = label
    ? `${relationship.from} ${label} ${relationship.to}.`
    : `${relationship.from} relates to ${relationship.to}.`;
  if (relationship.description && relationship.description !== relationship.verb) return relationship.description;
  if (!relationship.cardinality) return base;
  return `${base} Cardinality: ${cardinalityLabel(relationship.cardinality)}.`;
}

export default function AiProposalPreview({ change, compact = false }) {
  const preview = buildAiProposalPreviewData(change);
  if (!preview) return null;
  const nodeWidth = compact ? 190 : 220;
  const nodeHeight = compact ? 86 : 104;
  const maxSourceX = Math.max(0, ...preview.nodes.map((node) => node.x || 0));
  const maxSourceY = Math.max(0, ...preview.nodes.map((node) => node.y || 0));
  const scaleX = maxSourceX > 0 ? (compact ? 1.18 : 1.35) : 1;
  const scaleY = maxSourceY > 0 ? (compact ? 1.12 : 1.28) : 1;
  const nodes = preview.nodes.map((node) => ({
    ...node,
    x: Math.max(40, Math.round(node.x * scaleX)),
    y: Math.max(42, Math.round(node.y * scaleY)),
  }));
  const layoutNodeByName = new Map(nodes.map((node) => [node.name, node]));
  const width = Math.max(compact ? 820 : 980, ...nodes.map((node) => node.x + nodeWidth + 72));
  const height = Math.max(compact ? 430 : 520, ...nodes.map((node) => node.y + nodeHeight + 70));

  return (
    <div className={`ai-proposal-preview ${compact ? "compact" : "expanded"}`}>
      <div className="ai-proposal-preview-head">
        <div>
          <strong>{preview.title}</strong>
          <span>{preview.path || `${preview.domain || "domain"} · ${preview.layer || preview.kind}`}</span>
        </div>
        <div className="ai-proposal-preview-pills">
          {preview.layer && <span className="status-pill tone-info">{preview.layer}</span>}
          {preview.domain && <span className="status-pill tone-neutral">{preview.domain}</span>}
          <span className="status-pill tone-success">{preview.nodes.length} object{preview.nodes.length === 1 ? "" : "s"}</span>
          <span className="status-pill tone-accent">{preview.relationships.length} relation{preview.relationships.length === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div className="ai-proposal-preview-canvas">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Preview of ${preview.title}`}>
          <defs>
            <marker id="ai-preview-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          {preview.relationships.map((relationship, index) => {
            const from = layoutNodeByName.get(relationship.from);
            const to = layoutNodeByName.get(relationship.to);
            if (!from || !to) return null;
            const x1 = from.x + nodeWidth;
            const y1 = from.y + nodeHeight / 2;
            const x2 = to.x;
            const y2 = to.y + nodeHeight / 2;
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            return (
              <g key={`${relationship.name}-${index}`} className="ai-proposal-preview-edge">
                <path d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`} markerEnd="url(#ai-preview-arrow)" />
                <text x={midX} y={midY - 8} textAnchor="middle">{relationshipLabel(relationship)}</text>
              </g>
            );
          })}
          {nodes.map((node) => (
            <g key={node.name} className="ai-proposal-preview-node" transform={`translate(${node.x}, ${node.y})`}>
              <rect width={nodeWidth} height={nodeHeight} rx="12" />
              <text className="node-title" x="14" y="26">{node.name}</text>
              <text className="node-meta" x="14" y="48">{node.type || node.subjectArea || preview.layer || "model object"}</text>
              {node.subjectArea && <text className="node-field" x="14" y="66">{node.subjectArea}</text>}
              {!compact && node.fields.slice(0, 2).map((field, index) => (
                <text key={field} className="node-field" x="14" y={84 + index * 14}>{field}</text>
              ))}
            </g>
          ))}
        </svg>
      </div>
      {preview.relationships.length > 0 ? (
        <div className="ai-proposal-preview-meaning">
          <div className="ai-mini-heading">Business flow</div>
          {preview.relationships.map((relationship, index) => (
            <div key={`${relationship.name}-meaning-${index}`} className="ai-proposal-flow-row">
              <strong>{relationship.from}</strong>
              <span>{relationshipLabel(relationship)}</span>
              <strong>{relationship.to}</strong>
              <small>{relationshipSentence(relationship)}</small>
            </div>
          ))}
        </div>
      ) : (
        <div className="ai-proposal-preview-meaning empty">
          <div className="ai-mini-heading">Business flow</div>
          <span>No relationships proposed yet. A flow proposal should include business relationships before apply.</span>
        </div>
      )}
    </div>
  );
}
