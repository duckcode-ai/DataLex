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
  GitBranch, Rocket, FolderGit2, Home, Settings,
} from "lucide-react";

/* Modes that mean "I'm working on the model" — the Model rail item stays
   lit for any of them, since the spine's view toggles switch among them. */
const MODEL_MODES = new Set(["diagram", "table", "docs", "views", "enums", "capabilities"]);

/* The rail reads top-to-bottom as the AI-first daily workflow:
     set up (connect a repo, configure AI)
       → generate (let AI detect domains, contracts, proposals)
         → model & review (check readiness, then draw conceptual →
           logical → physical diagrams)
           → ship (version, publish).
   Order matters: this is both the navigation and the recommended path. */
const GROUPS = [
  {
    key: "home",
    items: [
      { id: "home", label: "Home", Icon: Home, tip: "Workspace home — your AI-first setup steps and live project status." },
    ],
  },
  {
    key: "setup",
    items: [
      { id: "__connect", label: "Connect", Icon: FolderGit2, tip: "Attach a dbt project — a Git URL or a local folder. Start here." },
      { id: "__ai",      label: "AI",      Icon: Sparkles,   tip: "Connect the AI provider DataLex uses to detect domains and contracts and to draw diagrams." },
    ],
  },
  {
    key: "generate",
    items: [
      { id: "domains",    label: "Domains",   Icon: Network,     tip: "AI-detected business domains and certification priorities." },
      { id: "contracts",  label: "Contracts", Icon: ShieldCheck, tip: "AI-detected data contracts — statuses, evidence, blockers." },
      { id: "proposals",  label: "Proposals", Icon: Inbox,       tip: "AI-generated proposal packs ready for review." },
    ],
  },
  {
    key: "model",
    items: [
      { id: "readiness",  label: "Readiness", Icon: ClipboardCheck, tip: "Enterprise readiness by domain — what's missing before certification." },
      { id: "diagram", rail: "model", label: "Model", Icon: Boxes, tip: "Conceptual → logical → physical diagrams of the active layer." },
    ],
  },
  {
    key: "ship",
    items: [
      { id: "__version",  label: "Version",   Icon: GitBranch, tip: "Branch, working changes, semantic diff, history, and commit." },
      { id: "publish",    label: "Publish",   Icon: Rocket,    tip: "Build the DataLex manifest and integration readiness." },
    ],
  },
  {
    key: "system",
    items: [
      { id: "__settings", label: "Settings",  Icon: Settings,  tip: "AI provider, database connection, and agent skills." },
    ],
  },
];

export default function ActivityRail({ activeMode, onSelectMode, onOpenVersion, onConnect, onOpenAi, onOpenSettings, versionActive = false }) {
  const isActive = (item) => {
    if (item.id === "__version") return versionActive;
    if (item.id === "__connect" || item.id === "__ai" || item.id === "__settings") return false;
    if (item.rail === "model") return MODEL_MODES.has(activeMode);
    return activeMode === item.id;
  };
  const handle = (item) => {
    if (item.id === "__version") return onOpenVersion?.();
    if (item.id === "__connect") return onConnect?.();
    if (item.id === "__ai") return onOpenAi?.();
    if (item.id === "__settings") return onOpenSettings?.();
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
