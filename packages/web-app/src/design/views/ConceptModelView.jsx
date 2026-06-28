/* Concept model view — "what the agent understands about your business".
 *
 * Renders the cross-domain relationship graph + entity conformance that the
 * DataLex manifest now exports (manifest.relationships[] + manifest.conformance[]).
 * This is the surface that makes the cross-domain accuracy story visible:
 *   - conformed joins (relationships with join columns) are safe for an agent
 *   - relationships without join columns are flagged as agent-risk
 *   - conformance shows each business concept's canonical key + physical models
 *
 * Data source: the built datalex-manifest.json. We ask the server to (re)build
 * it, then fall back to reading the file off the project root. Both paths are
 * best-effort; the view degrades to a clear empty state when no manifest data
 * is available yet (e.g. nothing modeled, or build not wired in this env).
 */
import React from "react";
import { Link2, AlertTriangle, ShieldCheck, RefreshCw, Boxes } from "lucide-react";
import { buildDatalexManifest, fetchFileContent } from "../../lib/api";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/* A relationship is "conformed" (grain-safe for an agent) when both endpoints
   declare the join columns. Column-less (typically conceptual) edges are still
   shown, but flagged — the agent would have to guess the join key. */
function isConformedEdge(rel) {
  return Boolean(rel?.from?.column && rel?.to?.column);
}

function endpointLabel(ep) {
  if (!ep) return "?";
  const entity = ep.entity || "?";
  return ep.column ? `${entity}.${ep.column}` : entity;
}

async function loadManifest(projectId, projectPath) {
  // 1) Rebuild — the endpoint may return the manifest inline.
  try {
    const res = await buildDatalexManifest(projectId);
    const inline = res?.manifest || res?.result?.manifest;
    if (inline && typeof inline === "object") return inline;
  } catch (_e) {
    /* fall through to file read */
  }
  // 2) Read the written manifest off the project root.
  if (projectPath) {
    for (const candidate of [
      `${projectPath}/datalex-manifest.json`,
      `${projectPath}/DataLex/datalex-manifest.json`,
    ]) {
      try {
        const file = await fetchFileContent(candidate);
        const raw = file?.content ?? file?.body ?? "";
        if (raw) return JSON.parse(raw);
      } catch (_e) {
        /* try next candidate */
      }
    }
  }
  return null;
}

function SummaryStat({ label, value, tone = "" }) {
  return (
    <div style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 12px", background: "var(--bg-1)", minWidth: 0 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 18, fontWeight: 700, color: tone === "risk" ? "var(--danger, #c0392b)" : "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

export default function ConceptModelView({ projectId, projectPath, domain, onGoto }) {
  const [state, setState] = React.useState({ loading: true, error: "", manifest: null });
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!projectId) { setState({ loading: false, error: "", manifest: null }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: "" }));
    loadManifest(projectId, projectPath)
      .then((manifest) => { if (!cancelled) setState({ loading: false, error: "", manifest }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, error: err?.message || String(err), manifest: null }); });
    return () => { cancelled = true; };
  }, [projectId, projectPath, tick]);

  const { loading, error, manifest } = state;

  const relationships = React.useMemo(() => {
    const all = asArray(manifest?.relationships);
    if (!domain) return all;
    return all.filter((r) => r?.from?.domain === domain || r?.to?.domain === domain);
  }, [manifest, domain]);

  const conformance = React.useMemo(() => {
    const all = asArray(manifest?.conformance);
    if (!domain) return all;
    return all.filter((c) => c?.domain === domain);
  }, [manifest, domain]);

  const conformedCount = React.useMemo(() => relationships.filter(isConformedEdge).length, [relationships]);
  const riskCount = relationships.length - conformedCount;

  return (
    <div className="shell-view" style={{ padding: 20, overflow: "auto", color: "var(--text-primary)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <Boxes size={18} strokeWidth={1.8} />
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
          What the agent understands{domain ? ` · ${domain}` : ""}
        </h2>
        <span style={{ flex: 1 }} />
        <button className="panel-btn" onClick={() => setTick((n) => n + 1)} title="Rebuild manifest and refresh">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--text-secondary)", maxWidth: 720, lineHeight: 1.5 }}>
        Business concepts, their conformed keys, and the cross-domain joins an AI agent relies on.
        Joins with a shared key are grain-safe; joins without one are flagged — the agent would have to guess.
      </p>

      {loading && (
        <div style={{ padding: 24, fontSize: 13, color: "var(--text-tertiary)" }}>Loading concept model…</div>
      )}

      {!loading && !manifest && (
        <div style={{ border: "1px dashed var(--border-default)", borderRadius: 10, padding: 24, background: "var(--bg-1)", maxWidth: 640 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>No concept model yet</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 12 }}>
            Model entities and relationships (conceptual → logical → physical), then build the DataLex
            manifest. Relationships and conformance will appear here for agents to use.
            {error ? ` (${error})` : ""}
          </div>
          {onGoto && (
            <button className="panel-btn primary" onClick={() => onGoto("diagram")}>Open the modeler</button>
          )}
        </div>
      )}

      {!loading && manifest && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, maxWidth: 560, marginBottom: 20 }}>
            <SummaryStat label="Concepts" value={conformance.length} />
            <SummaryStat label="Conformed joins" value={conformedCount} />
            <SummaryStat label="At-risk joins" value={riskCount} tone={riskCount ? "risk" : ""} />
          </div>

          <section style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 10px" }}>Cross-domain joins</h3>
            {relationships.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>No relationships modeled yet.</div>
            )}
            <div style={{ display: "grid", gap: 8 }}>
              {relationships.map((rel, i) => {
                const conformed = isConformedEdge(rel);
                return (
                  <div
                    key={rel.name || i}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      border: "1px solid var(--border-default)", borderRadius: 8,
                      padding: "9px 12px", background: "var(--bg-1)",
                    }}
                  >
                    {conformed
                      ? <ShieldCheck size={15} style={{ color: "var(--success, #1d9e75)", flexShrink: 0 }} />
                      : <AlertTriangle size={15} style={{ color: "var(--warning, #ba7517)", flexShrink: 0 }} />}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        {endpointLabel(rel.from)} <span style={{ color: "var(--text-tertiary)" }}>→</span> {endpointLabel(rel.to)}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                        {(rel.cardinality || "—").replace(/_/g, " ")}
                        {rel.layer ? ` · ${rel.layer}` : ""}
                        {rel.from?.domain && rel.to?.domain && rel.from.domain !== rel.to.domain
                          ? ` · ${rel.from.domain} ↔ ${rel.to.domain}` : ""}
                      </div>
                    </div>
                    <span
                      className={`status-pill ${conformed ? "tone-info" : "tone-warning"}`}
                      style={{ fontSize: 10, flexShrink: 0 }}
                    >
                      {conformed ? "conformed" : "no shared key"}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h3 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 10px" }}>Conformance</h3>
            {conformance.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>No conformed concepts yet.</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
              {conformance.map((c, i) => (
                <div key={c.concept || i} style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: 12, background: "var(--bg-1)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                    <Link2 size={14} style={{ color: "var(--accent, #5b6cff)" }} />
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{c.concept}</span>
                    {c.domain && <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{c.domain}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    <div>canonical key: <code>{asArray(c.canonical_key).join(", ") || "—"}</code></div>
                    {asArray(c.business_key).length > 0 && <div>business key: <code>{c.business_key.join(", ")}</code></div>}
                    <div style={{ marginTop: 4 }}>
                      physical: {asArray(c.physical).length === 0
                        ? "—"
                        : c.physical.map((p) => p.binding?.ref || p.entity).join(", ")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
