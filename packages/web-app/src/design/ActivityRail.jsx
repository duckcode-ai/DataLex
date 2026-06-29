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
  Boxes, ClipboardCheck, Network, ShieldCheck, Inbox,
  GitBranch, Rocket, FolderGit2, Home, Settings, Share2,
} from "lucide-react";

/* Modes that mean "I'm working on the model" — the Model rail item stays
   lit for any of them, since the spine's view toggles switch among them. */
const MODEL_MODES = new Set(["diagram", "table", "docs", "views", "enums", "capabilities"]);

/* The rail IS the documented workflow spine, numbered 1→6 so a new user
   always knows where they are and what's next:

     1 Connect → 2 AI → 3 Readiness → 4 Generate → 5 Certified → 6 Publish

   Generate/Review/Certify all happen on the Generate surface (step 4); the
   certified output lands in Certified (step 5). The Model canvas and the
   utility destinations (Version, Settings) are deliberately kept OUT of the
   numbered spine — they are a workspace and tools, not workflow steps. */
const GROUPS = [
  {
    key: "home",
    items: [
      { id: "home", label: "Home", Icon: Home, tip: "Home — your domain portfolio: pick a domain to work in." },
    ],
  },
  {
    key: "workspace",
    title: "Workspace",
    items: [
      { id: "domains",   label: "Domains",   Icon: Network,        tip: "Your business domains. Start here — click a domain to model it." },
      { id: "readiness", label: "Readiness", Icon: ClipboardCheck, tip: "What's modeled vs. missing, by domain. Works without AI." },
      { id: "diagram", rail: "model", label: "Model", Icon: Boxes, tip: "Conceptual → logical → physical diagrams of the active layer." },
      { id: "publish",   label: "Export",    Icon: Rocket,         tip: "Build the model manifest that DQL reads — your DataLex modeling, exported to DQL." },
    ],
  },
  {
    key: "system",
    items: [
      { id: "__connect",  label: "Connect",  Icon: FolderGit2, tip: "Attach a dbt project (Git URL or local folder). One-time setup." },
      { id: "__version",  label: "Version",  Icon: GitBranch,  tip: "Branch, working changes, breaking-change check, history, and commit." },
      { id: "__settings", label: "Settings", Icon: Settings,   tip: "AI provider, database connection, and agent skills." },
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
          {group.title && <div className="activity-rail-grouptitle" aria-hidden="true">{group.title}</div>}
          {group.items.map((item) => {
            const Ico = item.Icon;
            const active = isActive(item);
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`activity-rail-item ${active ? "active" : ""} ${item.step ? "has-step" : ""}`}
                title={item.tip}
                onClick={() => handle(item)}
              >
                {item.step && <span className="activity-rail-step" aria-hidden="true">{item.step}</span>}
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
