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
import { Lightbulb, Workflow, Database, ChevronRight } from "lucide-react";

const LAYERS = [
  { id: "conceptual", label: "Conceptual", Icon: Lightbulb, token: "--layer-conceptual", soft: "--layer-conceptual-soft", hint: "Business ideas, concepts, and contracts — platform-free." },
  { id: "logical",    label: "Logical",    Icon: Workflow,  token: "--layer-logical",    soft: "--layer-logical-soft",    hint: "Platform-neutral entities, attributes, keys, and relationships." },
  { id: "physical",   label: "Physical",   Icon: Database,  token: "--layer-physical",   soft: "--layer-physical-soft",   hint: "Dialect-typed tables, constraints, and dbt model targets." },
];

function normalizeLayer(modelKind) {
  const k = String(modelKind || "").toLowerCase();
  if (k === "conceptual" || k === "logical" || k === "physical") return k;
  return "physical";
}

export default function LayerSpine({ modelKind, objectCount = 0, fileName = "" }) {
  const active = normalizeLayer(modelKind);
  const activeMeta = LAYERS.find((l) => l.id === active) || LAYERS[2];
  return (
    <div className="layer-spine" role="group" aria-label="Modeling layer">
      <span className="layer-spine-eyebrow">Layer</span>
      <div className="layer-spine-track">
        {LAYERS.map((layer, i) => {
          const isActive = layer.id === active;
          const Ico = layer.Icon;
          return (
            <React.Fragment key={layer.id}>
              {i > 0 && <ChevronRight className="layer-spine-sep" size={13} />}
              <span
                className={`layer-spine-seg ${isActive ? "active" : ""}`}
                title={layer.hint}
                style={isActive ? { "--seg-accent": `var(${layer.token})`, "--seg-soft": `var(${layer.soft})` } : undefined}
                aria-current={isActive ? "step" : undefined}
              >
                <Ico size={13} strokeWidth={1.8} />
                {layer.label}
              </span>
            </React.Fragment>
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
