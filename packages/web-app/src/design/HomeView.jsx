/* Home — the domain portfolio (Level 0 of the information architecture).
 *
 * This is the calm landing: connected repo + overall readiness, then the list
 * of business domains with their dbt doc score and certification standing.
 * Clicking a domain drills into its workspace (Overview / Concept model /
 * Contracts) via `onSelectDomain`.
 *
 * When a project has no detectable domains yet (fresh connect, nothing modeled)
 * we fall back to a compact getting-started so first-run users still have a
 * clear path: Connect → AI → Generate.
 */
import React from "react";
import yaml from "js-yaml";
import {
  FolderGit2, Sparkles, ScanSearch, Rocket, ArrowRight, ChevronRight,
  ShieldCheck, Boxes, Activity, Plus,
} from "lucide-react";
import { fetchEnterpriseReadiness, fetchEnterpriseScan, createProjectFile } from "../lib/api";
import useUiStore from "../stores/uiStore";

const slugifyDomain = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function aiConfigured() {
  try {
    if (localStorage.getItem("datalex.ai.apiKey")) return true;
    if (localStorage.getItem("datalex.ai.provider") === "local") return true;
    return false;
  } catch {
    return false;
  }
}

/* Normalize whatever shape the readiness endpoint returns into a flat list of
   domain rows with the fields the portfolio needs. Defensive: the endpoint has
   evolved, so we read several possible key names and fall back gracefully. */
function normalizeDomains(readiness) {
  const rows =
    (Array.isArray(readiness?.domains) && readiness.domains) ||
    (Array.isArray(readiness?.rows) && readiness.rows) ||
    (Array.isArray(readiness) && readiness) ||
    [];
  return rows
    .map((r) => ({
      name: r?.name || r?.domain || "",
      models: r?.models ?? r?.model_count ?? r?.total ?? null,
      score: r?.score ?? r?.doc_score ?? r?.readiness ?? null,
      certified: r?.certified ?? r?.certified_contracts ?? 0,
      highValue: r?.high_value ?? r?.missing_contracts ?? r?.opportunities ?? 0,
    }))
    .filter((r) => r.name);
}

function scoreTone(score) {
  if (score == null) return "var(--text-tertiary)";
  if (score >= 70) return "var(--success, #1d9e75)";
  if (score >= 50) return "var(--warning, #ba7517)";
  return "var(--danger, #c0392b)";
}

function Stat({ label, value }) {
  return (
    <div style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "10px 12px", background: "var(--bg-1)", minWidth: 0 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function GettingStarted({ hasProject, aiReady, onConnect, onOpenAi, onGoto }) {
  const steps = [
    { id: "connect", Icon: FolderGit2, title: "Connect a dbt project", desc: "Point DataLex at a Git URL or a local dbt folder.", done: hasProject, cta: hasProject ? "Reconnect" : "Connect repo", onClick: onConnect },
    { id: "ai", Icon: Sparkles, title: "Connect AI & your database", desc: "Add a provider key (or run a local model) so DataLex can propose contracts.", done: aiReady, cta: aiReady ? "AI ready" : "Set up AI", onClick: onOpenAi },
    { id: "generate", Icon: ScanSearch, title: "Detect domains & generate", desc: "Scan the project, then generate contracts for the domains that matter.", done: false, cta: "Open Generate", onClick: () => onGoto?.("proposals") },
  ];
  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 640 }}>
      {steps.map((s) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid var(--border-default)", borderRadius: 10, padding: 14, background: "var(--bg-1)" }}>
          <s.Icon size={18} style={{ color: s.done ? "var(--success, #1d9e75)" : "var(--accent, #5b6cff)", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{s.desc}</div>
          </div>
          <button className={`panel-btn ${s.done ? "" : "primary"}`} onClick={s.onClick}>{s.cta}</button>
        </div>
      ))}
    </div>
  );
}

export default function HomeView({
  projectName,
  hasProject,
  isDemo,
  projectId,
  onGoto,
  onConnect,
  onOpenAi,
  onSelectDomain,
}) {
  const [domains, setDomains] = React.useState([]);
  const [scan, setScan] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  const [addOpen, setAddOpen] = React.useState(false);
  const [dName, setDName] = React.useState("");
  const [dDesc, setDDesc] = React.useState("");
  const [dBusy, setDBusy] = React.useState(false);
  const addToast = useUiStore((s) => s.addToast);

  React.useEffect(() => {
    if (!projectId) { setDomains([]); setScan(null); return; }
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([fetchEnterpriseReadiness(projectId), fetchEnterpriseScan(projectId, {})])
      .then(([readinessRes, scanRes]) => {
        if (cancelled) return;
        setDomains(readinessRes.status === "fulfilled" ? normalizeDomains(readinessRes.value) : []);
        setScan(scanRes.status === "fulfilled" ? (scanRes.value?.scan || scanRes.value || null) : null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, tick]);

  const createDomain = async () => {
    const slug = slugifyDomain(dName);
    if (!slug) { addToast?.({ type: "error", message: "Domain needs a name." }); return; }
    if (!projectId) { addToast?.({ type: "error", message: "Open a project first." }); return; }
    const obj = { kind: "domain", name: slug };
    if (dDesc.trim()) obj.description = dDesc.trim();
    setDBusy(true);
    try {
      await createProjectFile(projectId, `domains/${slug}.yaml`, yaml.dump(obj));
      addToast?.({ type: "success", message: `Created domain "${slug}". Assign models to it to see readiness.` });
      setAddOpen(false); setDName(""); setDDesc("");
      setTick((t) => t + 1);
    } catch (err) {
      addToast?.({ type: "error", message: `Could not create domain: ${err?.message || err}` });
    } finally { setDBusy(false); }
  };

  const totals = scan?.totals || {};
  const aiReady = projectId ? Boolean(scan?.ai?.ready) : aiConfigured();
  const totalModels = totals.models ?? domains.reduce((n, d) => n + (Number(d.models) || 0), 0);
  const certifiedTotal = totals.certified_contracts ?? domains.reduce((n, d) => n + (Number(d.certified) || 0), 0);
  const overallScore = scan?.doc_score ?? (
    domains.length
      ? Math.round(domains.reduce((n, d) => n + (Number(d.score) || 0), 0) / domains.length)
      : null
  );

  const showPortfolio = hasProject && domains.length > 0;

  return (
    <div className="shell-view" style={{ padding: 24, overflow: "auto", color: "var(--text-primary)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{projectName || "Workspace"}</h1>
        {isDemo && <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>demo workspace</span>}
      </div>
      <p style={{ margin: "0 0 18px", fontSize: 12, color: "var(--text-secondary)" }}>
        {showPortfolio
          ? "Your business domains. Pick one to model and build out — one domain at a time."
          : "Connect a dbt project to see your domains, readiness, and what an AI would get wrong."}
      </p>

      {showPortfolio && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, maxWidth: 480, marginBottom: 22 }}>
          <Stat label="Domains" value={domains.length} />
          <Stat label="Models" value={totalModels || "—"} />
          <Stat label="Overall doc score" value={overallScore == null ? "—" : `${overallScore}`} />
        </div>
      )}

      {loading && !showPortfolio && (
        <div style={{ padding: 24, fontSize: 13, color: "var(--text-tertiary)" }}>Loading workspace…</div>
      )}

      {!loading && !showPortfolio && (
        <GettingStarted
          hasProject={hasProject}
          aiReady={aiReady}
          onConnect={onConnect}
          onOpenAi={onOpenAi}
          onGoto={onGoto}
        />
      )}

      {showPortfolio && (
        <div style={{ marginBottom: 12, maxWidth: 920 }}>
          {!addOpen ? (
            <button className="panel-btn" onClick={() => setAddOpen(true)}><Plus size={13} /> New domain</button>
          ) : (
            <div style={{ border: "1px solid var(--border-default)", borderRadius: 10, padding: 12, background: "var(--bg-1)", display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Domain name</label>
                <input
                  style={{ padding: "7px 9px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border-default)", background: "var(--bg-1)", color: "var(--text-primary)" }}
                  placeholder="finance" value={dName} onChange={(e) => setDName(e.target.value)}
                />
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>Description (optional)</label>
                <input
                  style={{ width: "100%", padding: "7px 9px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border-default)", background: "var(--bg-1)", color: "var(--text-primary)", boxSizing: "border-box" }}
                  placeholder="Finance and revenue logic" value={dDesc} onChange={(e) => setDDesc(e.target.value)}
                />
              </div>
              <button className="panel-btn primary" disabled={dBusy} onClick={createDomain}>{dBusy ? "Creating…" : "Create"}</button>
              <button className="panel-btn" onClick={() => setAddOpen(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {showPortfolio && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, maxWidth: 920 }}>
          {domains.map((d) => (
            <button
              key={d.name}
              type="button"
              onClick={() => onSelectDomain?.(d.name)}
              style={{
                textAlign: "left", cursor: "pointer",
                border: "1px solid var(--border-default)", borderRadius: 12,
                padding: 14, background: "var(--bg-1)", display: "grid", gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Boxes size={15} style={{ color: "var(--text-secondary)" }} />
                <span style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                <ChevronRight size={15} style={{ color: "var(--text-tertiary)" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {d.score != null && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: scoreTone(d.score) }}>doc {d.score}</span>
                )}
                {d.models != null && (
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{d.models} models</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-tertiary)" }}>
                <Boxes size={13} style={{ color: "var(--text-secondary)" }} />
                Open to model
              </div>
            </button>
          ))}
        </div>
      )}

      {showPortfolio && (
        <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
          <button className="panel-btn" onClick={() => onGoto?.("concept")}><Activity size={13} /> Concept model</button>
          <button className="panel-btn" onClick={() => onGoto?.("readiness")}><ScanSearch size={13} /> Readiness</button>
          <button className="panel-btn" onClick={() => onGoto?.("publish")}><Rocket size={13} /> Publish manifest</button>
        </div>
      )}
    </div>
  );
}
