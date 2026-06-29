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
import yaml from "js-yaml";
import { ArrowLeft, LayoutDashboard, Boxes, FileCheck2, ClipboardCheck, Sparkles, Plus, ShieldCheck, Layers, Wand2, FolderOpen } from "lucide-react";
import ConceptModelView from "./ConceptModelView";
import { fetchEnterpriseReadiness, createProjectFile, aiConceptualize } from "../../lib/api";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";

const LBL = { fontSize: 11, color: "var(--text-secondary)", display: "block", marginBottom: 4 };
const INP = { width: "100%", padding: "7px 9px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border-default)", background: "var(--bg-1)", color: "var(--text-primary)", boxSizing: "border-box" };
const slugify = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const TABS = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "model", label: "Model", Icon: Layers },
  { id: "concept", label: "Concept model", Icon: Boxes },
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
          Suggested next: review the concept model for this domain, then build out the logical and physical layers.
        </div>
        <button className="panel-btn primary" onClick={() => setTab("concept")}>Concept model</button>
        <button className="panel-btn" onClick={() => onGoto?.("diagram")}>Open modeler</button>
      </div>
    </div>
  );
}

function Contracts({ domain, projectId, onGoto }) {
  const addToast = useUiStore((s) => s.addToast);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState({ name: "", entity: "", definition: "", grain: "", dimensions: "", ref: "", owner: "" });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const domainSlug = slugify(domain) || "core";

  const submit = async () => {
    const name = slugify(f.name);
    const entity = f.entity.trim();
    if (!name) { addToast?.({ type: "error", message: "Contract needs a name." }); return; }
    if (!entity) { addToast?.({ type: "error", message: "Contract needs an entity (e.g. Customer)." }); return; }
    if (!projectId) { addToast?.({ type: "error", message: "Open a project first." }); return; }
    const obj = { kind: "contract", name, domain: domainSlug, entity, version: 1, status: "draft" };
    if (f.definition.trim()) obj.business_definition = f.definition.trim();
    if (f.grain.trim()) obj.grain = f.grain.trim();
    const dims = f.dimensions.split(",").map((s) => s.trim()).filter(Boolean);
    if (dims.length) obj.dimensions = dims;
    if (f.ref.trim()) obj.source = { kind: "dbt_model", ref: f.ref.trim() };
    if (f.owner.trim()) obj.owner = f.owner.trim();
    setBusy(true);
    try {
      await createProjectFile(projectId, `${domainSlug}/contracts/${name}.contract.yaml`, yaml.dump(obj));
      addToast?.({ type: "success", message: `Created contract "${name}" as a draft. Review and certify it under Generate.` });
      setOpen(false);
      setF({ name: "", entity: "", definition: "", grain: "", dimensions: "", ref: "", owner: "" });
    } catch (err) {
      addToast?.({ type: "error", message: `Could not create contract: ${err?.message || err}` });
    } finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <ShieldCheck size={16} style={{ color: "var(--accent, #5b6cff)" }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>Contracts · {domain}</span>
        <span style={{ flex: 1 }} />
        {!open && <button className="panel-btn primary" onClick={() => setOpen(true)}><Plus size={13} /> New contract</button>}
      </div>

      {open && (
        <div style={{ border: "1px solid var(--border-default)", borderRadius: 10, padding: 14, background: "var(--bg-1)", marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={LBL}>Name (snake_case)</label><input style={INP} placeholder="active_customers" value={f.name} onChange={set("name")} /></div>
            <div><label style={LBL}>Entity</label><input style={INP} placeholder="Customer" value={f.entity} onChange={set("entity")} /></div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={LBL}>Business definition</label>
            <textarea style={{ ...INP, minHeight: 56, resize: "vertical" }} placeholder="One row per customer who placed an order in the period." value={f.definition} onChange={set("definition")} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
            <div><label style={LBL}>Grain</label><input style={INP} placeholder="customer_id" value={f.grain} onChange={set("grain")} /></div>
            <div><label style={LBL}>Owner</label><input style={INP} placeholder="growth@acme.com" value={f.owner} onChange={set("owner")} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
            <div><label style={LBL}>Dimensions (comma-separated)</label><input style={INP} placeholder="region, tier" value={f.dimensions} onChange={set("dimensions")} /></div>
            <div><label style={LBL}>Source dbt model</label><input style={INP} placeholder="dim_customers" value={f.ref} onChange={set("ref")} /></div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="panel-btn primary" disabled={busy} onClick={submit}>{busy ? "Creating…" : "Create draft contract"}</button>
            <button className="panel-btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          <p style={{ fontSize: 11, color: "var(--text-tertiary)", margin: "10px 0 0" }}>
            Writes <code>{domainSlug}/contracts/{slugify(f.name) || "<name>"}.contract.yaml</code> as a draft. Certify it under Generate when ready.
          </p>
        </div>
      )}

      <div style={{ border: "1px dashed var(--border-default)", borderRadius: 10, padding: 16, background: "var(--bg-1)" }}>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 12 }}>
          Prefer AI? Generate drafts from your dbt evidence, then certify. Everything stays draft until certified —
          DQL still runs without certification; it just adds trust.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="panel-btn" onClick={() => onGoto?.("proposals")}>Generate with AI</button>
          <button className="panel-btn" onClick={() => onGoto?.("contracts")}>Certified library</button>
        </div>
      </div>
    </div>
  );
}

/* Guided model builder — Conceptual → Logical → Physical, one layer at a time,
   build-with-AI or build-by-hand, skip what you don't need. Reuses the
   conceptualizer (/ai/conceptualize) and the modeler's forward-generation
   (LayerSpine conceptual→logical→physical). Layer state is read from the
   project's files under DataLex/<domain>/<layer>/. */
function BuildModel({ domain, projectId, onGoto }) {
  const addToast = useUiStore((s) => s.addToast);
  const projectFiles = useWorkspaceStore((s) => s.projectFiles);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const [busy, setBusy] = React.useState("");
  const domainSlug = slugify(domain);

  const layerFiles = (layer) => (projectFiles || []).filter((file) => {
    const p = String(file?.path || file?.fullPath || "").toLowerCase();
    return p.includes(`/${domainSlug}/${layer}/`) || p.startsWith(`${domainSlug}/${layer}/`);
  });

  const openLayer = (layer) => {
    const files = layerFiles(layer);
    if (files.length && openFile) openFile(files[0]);
    onGoto?.("diagram");
  };

  const buildConceptualAI = async () => {
    if (!projectId) { addToast?.({ type: "error", message: "Open a project first." }); return; }
    setBusy("conceptual");
    try {
      await aiConceptualize(projectId);
      addToast?.({ type: "success", message: "AI proposed conceptual entities — review and edit them in the modeler." });
      onGoto?.("diagram");
    } catch (err) {
      addToast?.({ type: "error", message: `Build with AI failed: ${err?.message || err}` });
    } finally { setBusy(""); }
  };

  const LAYERS = [
    { id: "conceptual", label: "Conceptual", desc: "Business concepts — what this domain means, in plain terms.", ai: true },
    { id: "logical", label: "Logical", desc: "Conformed entities, keys, and relationships.", ai: false },
    { id: "physical", label: "Physical", desc: "dbt-backed tables, columns, and types.", ai: false },
  ];

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 16px", lineHeight: 1.5 }}>
        Build the <strong>{domain}</strong> model one layer at a time — with AI or by hand. Skip any layer you don't
        need; each one generates forward from the last in the modeler.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {LAYERS.map((L, i) => {
          const files = layerFiles(L.id);
          const built = files.length > 0;
          return (
            <div key={L.id} style={{ border: "1px solid var(--border-default)", borderRadius: 12, padding: 14, background: "var(--bg-1)", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: built ? "var(--success, #1d9e75)" : "var(--bg-2)", color: built ? "#fff" : "var(--text-secondary)", border: built ? "none" : "1px solid var(--border-default)" }}>
                {built ? "✓" : i + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{L.label}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{L.desc}</div>
                <div style={{ fontSize: 11, color: built ? "var(--success, #1d9e75)" : "var(--text-tertiary)", marginTop: 3 }}>
                  {built ? `Built · ${files.length} file${files.length === 1 ? "" : "s"}` : "Not started"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {L.ai && (
                  <button className="panel-btn primary" disabled={busy === L.id} onClick={buildConceptualAI}>
                    <Wand2 size={12} /> {busy === L.id ? "Building…" : "Build with AI"}
                  </button>
                )}
                <button className="panel-btn" onClick={() => openLayer(L.id)}>
                  <FolderOpen size={12} /> {built ? "Open" : "Build in modeler"}
                </button>
              </div>
            </div>
          );
        })}
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
      {tab === "model" && <BuildModel domain={domain} projectId={projectId} onGoto={onGoto} />}
      {tab === "concept" && <ConceptModelView projectId={projectId} projectPath={projectPath} domain={domain} onGoto={onGoto} />}
      {tab === "contracts" && <Contracts domain={domain} projectId={projectId} onGoto={onGoto} />}
    </div>
  );
}
