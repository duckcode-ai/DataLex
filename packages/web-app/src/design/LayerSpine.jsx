/* Layer spine — always-visible conceptual → logical → physical indicator.
   Phase 2 of the enterprise UI migration (docs/design/enterprise-ui.md):
   the 3-layer modeling discipline is DataLex's core differentiator, so it
   becomes a primary, persistent navigation surface instead of being
   inferred silently from filenames.

   v1 is a display surface: it reflects the active model's layer (derived
   from `modelKind`) and the flow between layers. Layer switching (routing
   to a sibling file in another layer) and the per-layer view toggles are
   tracked as follow-up increments in the spec. */
import React from "react";
import { Lightbulb, Workflow, Database, ChevronRight, Layers, Table2, FileText, Plus } from "lucide-react";

const LAYERS = [
  { id: "conceptual", label: "Conceptual", Icon: Lightbulb, token: "--layer-conceptual", soft: "--layer-conceptual-soft", hint: "Business ideas, concepts, and contracts — platform-free." },
  { id: "logical",    label: "Logical",    Icon: Workflow,  token: "--layer-logical",    soft: "--layer-logical-soft",    hint: "Platform-neutral entities, attributes, keys, and relationships." },
  { id: "physical",   label: "Physical",   Icon: Database,  token: "--layer-physical",   soft: "--layer-physical-soft",   hint: "Dialect-typed tables, constraints, and dbt model targets." },
];

const LAYER_INDEX = { conceptual: 0, logical: 1, physical: 2 };

/* Object-view toggles — how to render the active layer. Moved here from
   the old top-bar ViewSwitcher; they drive shellViewMode. */
const VIEWS = [
  { id: "diagram", label: "Diagram", Icon: Layers },
  { id: "table",   label: "Table",   Icon: Table2 },
  { id: "docs",    label: "Docs",    Icon: FileText },
];

function normalizeLayer(modelKind) {
  const k = String(modelKind || "").toLowerCase();
  if (k === "conceptual" || k === "logical" || k === "physical") return k;
  return "physical";
}

export default function LayerSpine({ modelKind, objectCount = 0, fileName = "", viewMode = "diagram", onSelectView, onNewModel, siblings = null, onSelectLayer }) {
  const active = normalizeLayer(modelKind);
  const activeMeta = LAYERS.find((l) => l.id === active) || LAYERS[2];
  // The spine is interactive only when we know the layer siblings of the
  // active file (a layered diagram). Otherwise it stays a display surface.
  const interactive = !!(siblings && onSelectLayer);
  const activeIdx = LAYER_INDEX[active] ?? 2;
  return (
    <div className="layer-spine" role="group" aria-label="Modeling layer">
      {onNewModel && (
        <button type="button" className="layer-spine-new" onClick={onNewModel}
          title="Create a new conceptual, logical, or physical model">
          <Plus size={13} strokeWidth={2.2} /> New model
        </button>
      )}
      <span className="layer-spine-eyebrow">Layer</span>
      <div className="layer-spine-track">
        {LAYERS.map((layer, i) => {
          const isActive = layer.id === active;
          const Ico = layer.Icon;
          const sib = siblings?.[layer.id];
          const exists = sib?.exists;
          // Forward-generatable = the next layer down from the active one,
          // when it doesn't exist yet (transform engine can create it).
          const canGenerate = interactive && !exists && LAYER_INDEX[layer.id] === activeIdx + 1;
          const clickable = interactive && !isActive && (exists || canGenerate);
          const title = isActive
            ? layer.hint
            : exists
              ? `Switch to the ${layer.label.toLowerCase()} model · ${layer.hint}`
              : canGenerate
                ? `Generate the ${layer.label.toLowerCase()} model from this ${active} model`
                : `No ${layer.label.toLowerCase()} model yet — generate the logical layer first`;
          const segProps = {
            className: `layer-spine-seg ${isActive ? "active" : ""} ${interactive && !exists && !canGenerate ? "missing" : ""} ${canGenerate ? "generate" : ""}`,
            title,
            style: isActive ? { "--seg-accent": `var(${layer.token})`, "--seg-soft": `var(${layer.soft})` } : undefined,
          };
          return (
            <React.Fragment key={layer.id}>
              {i > 0 && <ChevronRight className="layer-spine-sep" size={13} />}
              {clickable ? (
                <button type="button" {...segProps} onClick={() => onSelectLayer(layer.id)}>
                  {canGenerate ? <Plus size={12} strokeWidth={2.4} /> : <Ico size={13} strokeWidth={1.8} />}
                  {layer.label}
                </button>
              ) : (
                <span {...segProps} aria-current={isActive ? "step" : undefined}>
                  <Ico size={13} strokeWidth={1.8} />
                  {layer.label}
                </span>
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div className="layer-spine-views" role="tablist" aria-label="Object view">
        {VIEWS.map((v) => {
          const Ico = v.Icon;
          const on = viewMode === v.id;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={`layer-spine-view ${on ? "active" : ""}`}
              onClick={() => onSelectView?.(v.id)}
              title={`${v.label} view`}
            >
              <Ico size={13} strokeWidth={1.8} />
              {v.label}
            </button>
          );
        })}
      </div>
      <div className="layer-spine-context">
        {fileName && <span className="layer-spine-file" title={fileName}>{fileName}</span>}
        <span className="layer-spine-count">
          {objectCount} {activeMeta.label.toLowerCase()} object{objectCount === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
