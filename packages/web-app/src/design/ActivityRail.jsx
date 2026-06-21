/* Activity rail — the primary navigation surface (phase 3 of the
   enterprise UI migration, docs/design/enterprise-ui.md). Replaces the
   horizontal 8-mode ViewSwitcher that used to live in the top bar and
   mixed workflow stages with object views in one control.

   The rail drives the same `shellViewMode` store the old switcher did, so
   no downstream wiring changes — it is a re-presentation, grouped by the
   real axis (build → govern → ship), with the object-view toggles
   (Diagram/Table/Docs) moved out to the layer spine where they belong.

   Version is the one new destination: it opens the consolidated git
   surface (phase 4) rather than a shellViewMode. */
import React from "react";
import {
  Boxes, Sparkles, ClipboardCheck, Network, ShieldCheck, Inbox,
  GitBranch, Rocket,
} from "lucide-react";

/* Modes that mean "I'm working on the model" — the Model rail item stays
   lit for any of them, since the spine's view toggles switch among them. */
const MODEL_MODES = new Set(["diagram", "table", "docs", "views", "enums", "capabilities"]);

const GROUPS = [
  {
    key: "build",
    items: [
      { id: "diagram", rail: "model", label: "Model", Icon: Boxes,         tip: "Model workspace — diagram, table, and docs views of the active layer." },
      { id: "ai-setup",            label: "AI",    Icon: Sparkles,         tip: "Configure the AI provider and generate domains, contracts, and diagrams." },
    ],
  },
  {
    key: "govern",
    items: [
      { id: "readiness",  label: "Readiness", Icon: ClipboardCheck, tip: "Enterprise readiness by domain — contracts, metrics, owners, grains, DQL." },
      { id: "domains",    label: "Domains",   Icon: Network,        tip: "Domain-level model groups and certification priorities." },
      { id: "contracts",  label: "Contracts", Icon: ShieldCheck,    tip: "Business and metric contracts — statuses, evidence, blockers." },
      { id: "proposals",  label: "Proposals", Icon: Inbox,          tip: "AI-generated proposal packs ready for review." },
    ],
  },
  {
    key: "ship",
    items: [
      { id: "__version",  label: "Version",   Icon: GitBranch,      tip: "Branch, working changes, semantic diff, history, and commit." },
      { id: "publish",    label: "Publish",   Icon: Rocket,         tip: "Build the DataLex manifest and integration readiness." },
    ],
  },
];

export default function ActivityRail({ activeMode, onSelectMode, onOpenVersion, versionActive = false }) {
  const isActive = (item) => {
    if (item.id === "__version") return versionActive;
    if (item.rail === "model") return MODEL_MODES.has(activeMode);
    return activeMode === item.id;
  };
  const handle = (item) => {
    if (item.id === "__version") return onOpenVersion?.();
    onSelectMode?.(item.id);
  };
  return (
    <nav className="activity-rail" role="tablist" aria-label="Primary navigation">
      {GROUPS.map((group, gi) => (
        <div key={group.key} className="activity-rail-group">
          {gi > 0 && <div className="activity-rail-divider" aria-hidden="true" />}
          {group.items.map((item) => {
            const Ico = item.Icon;
            const active = isActive(item);
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`activity-rail-item ${active ? "active" : ""}`}
                title={item.tip}
                onClick={() => handle(item)}
              >
                <Ico size={20} strokeWidth={1.7} />
                <span className="activity-rail-label">{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
