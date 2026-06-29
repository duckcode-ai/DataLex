/* Lineage view — the end-to-end "fully traced" path: DataLex concept → the dbt
 * model that builds it → the certified DQL blocks that answer questions from it
 * → the apps that show it.
 *
 * DataLex → dbt is traced from the manifest entity bindings (real). DQL → App
 * lives in the separate DQL project, which reads this manifest to bind certified
 * blocks back to these concepts — so those stages are shown as the downstream
 * destination and light up once a DQL project is connected.
 */
import React from "react";
import { Boxes, Database, ShieldCheck, LayoutDashboard, ArrowRight, RefreshCw } from "lucide-react";
import { buildDatalexManifest, fetchFileContent } from "../../lib/api";

async function loadManifest(projectId, projectPath) {
  try {
    const res = await buildDatalexManifest(projectId);
    const inline = res?.manifest || res?.result?.manifest;
    if (inline && typeof inline === "object") return inline;
  } catch (_e) { /* fall through */ }
  if (projectPath) {
    for (const candidate of [`${projectPath}/datalex-manifest.json`, `${projectPath}/DataLex/datalex-manifest.json`]) {
      try {
        const file = await fetchFileContent(candidate);
        const raw = file?.content ?? file?.body ?? "";
        if (raw) return JSON.parse(raw);
      } catch (_e) { /* try next */ }
    }
  }
  return null;
}

function StageHead({ icon: Icon, label, sub }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
      <Icon size={15} style={{ flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{sub}</div>
      </div>
    </div>
  );
}

const GRID = "1.2fr 22px 1.2fr 22px 1fr 22px 1fr";
const Arrow = () => <ArrowRight size={14} style={{ color: "var(--text-tertiary)" }} />;

export default function LineageView({ projectId, projectPath, domain, onGoto }) {
  const [state, setState] = React.useState({ loading: true, manifest: null });
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!projectId) { setState({ loading: false, manifest: null }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    loadManifest(projectId, projectPath)
      .then((m) => { if (!cancelled) setState({ loading: false, manifest: m }); })
      .catch(() => { if (!cancelled) setState({ loading: false, manifest: null }); });
    return () => { cancelled = true; };
  }, [projectId, projectPath, tick]);

  const { loading, manifest } = state;

  const rows = React.useMemo(() => {
    const out = [];
    for (const d of (manifest?.domains || [])) {
      if (domain && d.name !== domain) continue;
      for (const e of (d.entities || [])) {
        out.push({ domain: d.name, entity: e.name, dbt: e.binding?.ref || null });
      }
    }
    return out;
  }, [manifest, domain]);

  return (
    <div className="shell-view" style={{ padding: 20, overflow: "auto", color: "var(--text-primary)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <Boxes size={18} strokeWidth={1.8} />
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Lineage{domain ? ` · ${domain}` : ""}</h2>
        <span style={{ flex: 1 }} />
        <button className="panel-btn" onClick={() => setTick((n) => n + 1)} title="Rebuild manifest and refresh">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      <p style={{ margin: "0 0 18px", fontSize: 12, color: "var(--text-secondary)", maxWidth: 760, lineHeight: 1.5 }}>
        How meaning flows end to end: your DataLex concept → the dbt model that builds it → the certified DQL blocks
        that answer questions from it → the apps that show it. This is the "fully traced" path.
      </p>

      {loading && <div style={{ padding: 24, fontSize: 13, color: "var(--text-tertiary)" }}>Loading lineage…</div>}

      {!loading && rows.length === 0 && (
        <div style={{ border: "1px dashed var(--border-default)", borderRadius: 10, padding: 24, background: "var(--bg-1)", maxWidth: 640 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Nothing to trace yet</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            Model some entities with dbt bindings and build the manifest — their lineage appears here.
          </div>
          {onGoto && <button className="panel-btn primary" style={{ marginTop: 12 }} onClick={() => onGoto("domains")}>Go to domains</button>}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, alignItems: "center", padding: "0 12px 10px" }}>
            <StageHead icon={Boxes} label="DataLex" sub="business concept" />
            <span />
            <StageHead icon={Database} label="dbt" sub="model that builds it" />
            <span />
            <StageHead icon={ShieldCheck} label="DQL" sub="certified answers" />
            <span />
            <StageHead icon={LayoutDashboard} label="App" sub="where it's shown" />
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {rows.map((r, i) => (
              <div key={`${r.domain}.${r.entity}.${i}`} style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, alignItems: "center", border: "1px solid var(--border-default)", borderRadius: 10, padding: "10px 12px", background: "var(--bg-1)" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.entity}</div>
                  <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{r.domain}</div>
                </div>
                <Arrow />
                <div style={{ minWidth: 0, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.dbt ? <code>{r.dbt}</code> : <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                </div>
                <Arrow />
                <div style={{ minWidth: 0, fontSize: 11, color: "var(--text-tertiary)" }}>certified blocks</div>
                <Arrow />
                <div style={{ minWidth: 0, fontSize: 11, color: "var(--text-tertiary)" }}>apps</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 16, maxWidth: 760, lineHeight: 1.5 }}>
            DataLex → dbt is traced from your model. The <strong>DQL → App</strong> stages light up once your DQL
            project is connected — it reads this manifest to bind certified blocks back to these concepts.
          </p>
        </>
      )}
    </div>
  );
}
