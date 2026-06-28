/* Domain workspace — Level 1 of the information architecture.
 *
 * Clicking a domain on Home opens this scoped surface. It replaces the flat
 * top-level enterprise modes (readiness / generate / contracts / publish) with
 * a small, task-shaped local nav: Overview · Concept model · Contracts. Each
 * tab is scoped to the active domain so the user works one business area at a
 * time instead of swimming in the whole project.
 *
 * The tabs reuse existing surfaces where they already exist (Concept model is
 * the new ConceptModelView; Contracts links to the certified-contracts view)
 * and add a light per-domain Overview from the enterprise readiness scan.
 */
import React from "react";
import { ArrowLeft, LayoutDashboard, Boxes, FileCheck2, ClipboardCheck, Sparkles } from "lucide-react";
import ConceptModelView from "./ConceptModelView";
import { fetchEnterpriseReadiness } from "../../lib/api";

const TABS = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "concept", label: "Concept model", Icon: Boxes },
  { id: "contracts", label: "Contracts", Icon: FileCheck2 },
];

function findDomainRow(readiness, domain) {
  const rows =
    (Array.isArray(readiness?.domains) && readiness.domains) ||
    (Array.isArray(readiness?.rows) && readiness.rows) ||
    (Array.isArray(readiness) && readiness) ||
    [];
  const want = String(domain || "").toLowerCase();
  return rows.find((r) => String(r?.name || r?.domain || "").toLowerCase() === want) || null;
}

function StatTile({ label, value }) {
  return (
    <div style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "10px 12px", background: "var(--bg-1)", minWidth: 0 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Overview({ domain, projectId, onGoto, setTab }) {
  const [row, setRow] = React.useState(null);
  React.useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchEnterpriseReadiness(projectId)
      .then((res) => { if (!cancelled) setRow(findDomainRow(res, domain)); })
      .catch(() => { if (!cancelled) setRow(null); });
    return () => { cancelled = true; };
  }, [projectId, domain]);

  const models = row?.models ?? row?.model_count ?? row?.total ?? "—";
  const score = row?.score ?? row?.doc_score ?? row?.readiness ?? "—";
  const certified = row?.certified ?? row?.certified_contracts ?? "—";
  const highValue = row?.high_value ?? row?.missing_contracts ?? row?.opportunities ?? "—";

  return (
    <div style={{ padding: "4px 0" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, maxWidth: 620, marginBottom: 18 }}>
        <StatTile label="Models" value={models} />
        <StatTile label="dbt doc score" value={score} />
        <StatTile label="Certified" value={certified} />
        <StatTile label="High-value" value={highValue} />
      </div>

      <div style={{ border: "1px solid var(--border-default)", borderRadius: 10, padding: 14, background: "var(--bg-1)", maxWidth: 620, display: "flex", alignItems: "center", gap: 10 }}>
        <Sparkles size={16} style={{ color: "var(--accent, #5b6cff)", flexShrink: 0 }} />
        <div style={{ flex: 1, fontSize: 12, color: "var(--text-secondary)" }}>
          Suggested next: review the concept model for this domain, then certify the high-value contracts.
        </div>
        <button className="panel-btn" onClick={() => setTab("concept")}>Concept model</button>
        <button className="panel-btn primary" onClick={() => setTab("contracts")}>Contracts</button>
      </div>
    </div>
  );
}

function Contracts({ onGoto }) {
  return (
    <div style={{ border: "1px dashed var(--border-default)", borderRadius: 10, padding: 24, background: "var(--bg-1)", maxWidth: 620 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <ClipboardCheck size={16} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>Certify what matters</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 12 }}>
        Generate and certify contracts for this domain, ranked by impact. Everything else stays draft —
        DQL still runs without certification; it just adds trust.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="panel-btn primary" onClick={() => onGoto?.("proposals")}>Generate</button>
        <button className="panel-btn" onClick={() => onGoto?.("contracts")}>Certified library</button>
      </div>
    </div>
  );
}

export default function DomainWorkspace({ domain, projectId, projectPath, onGoto, onBack }) {
  const [tab, setTab] = React.useState("overview");

  return (
    <div className="shell-view" style={{ padding: 20, overflow: "auto", color: "var(--text-primary)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button className="panel-btn" onClick={() => onBack?.()} title="Back to domains">
          <ArrowLeft size={13} /> Domains
        </button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{domain || "Domain"}</h2>
      </div>

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border-default)", marginBottom: 16 }}>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              border: "none", background: "transparent", cursor: "pointer",
              padding: "7px 12px", fontSize: 13,
              color: tab === id ? "var(--text-primary)" : "var(--text-secondary)",
              fontWeight: tab === id ? 700 : 400,
              borderBottom: tab === id ? "2px solid var(--accent, #5b6cff)" : "2px solid transparent",
            }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview domain={domain} projectId={projectId} onGoto={onGoto} setTab={setTab} />}
      {tab === "concept" && <ConceptModelView projectId={projectId} projectPath={projectPath} domain={domain} onGoto={onGoto} />}
      {tab === "contracts" && <Contracts onGoto={onGoto} />}
    </div>
  );
}
