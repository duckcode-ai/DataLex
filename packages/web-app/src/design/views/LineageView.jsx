/* Lineage view — the "fully traced" path, domain-first.
 *
 * Default altitude is a per-domain coverage roll-up (how traced is each business
 * area), not a flat list of every entity. Drilling into a domain shows the
 * concept-level trace: DataLex concept → the dbt model that builds it, split
 * into "traced to dbt" vs "not yet in dbt". The DQL → App stages live in the
 * separate DQL project; rather than render two permanently-empty columns, they
 * collapse into a single "connect DQL" affordance until a DQL project is wired.
 *
 * Two modes:
 *   - global rail (embedded=false): page header + roll-up, drill into a domain.
 *   - workspace tab (embedded=true): locked to one domain, just the trace.
 */
import React from "react";
import { Boxes, Database, ArrowRight, RefreshCw, ChevronRight, ArrowLeft, PlugZap, Plus } from "lucide-react";
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

const SUCCESS = "var(--success, #1d9e75)";

/* One business concept can appear at multiple layers (conceptual + logical +
   physical) with the same name — collapse them to a single lineage row,
   preferring the instance that's bound to a dbt model. */
function dedupeByName(entities) {
  const byName = new Map();
  for (const e of entities || []) {
    const key = String(e?.name || "").toLowerCase();
    if (!key) continue;
    const prev = byName.get(key);
    if (!prev || (!prev?.binding?.ref && e?.binding?.ref)) byName.set(key, e);
  }
  return [...byName.values()];
}

/* Collapse a domain's entities into business concepts using the manifest's
   conformance map. Conformance ties a concept (e.g. Customer) to the physical
   model(s) that realize it (dim_customer) and its canonical join key — so the
   conceptual "Customer", the logical "Customer", and the physical "DimCustomer"
   become one traced row "Customer → dim_customer" instead of three. Entities not
   covered by a conformance record fall back to their own row (traced if bound). */
function buildDomainConcepts(domainName, entities, conformance) {
  const concepts = [];
  const coveredNames = new Set();
  const coveredRefs = new Set();

  for (const rec of conformance || []) {
    if (String(rec?.domain || "") !== String(domainName || "")) continue;
    const refs = (rec.physical || []).map((p) => p?.binding?.ref).filter(Boolean);
    coveredNames.add(String(rec.concept || "").toLowerCase());
    for (const p of rec.physical || []) {
      if (p?.entity) coveredNames.add(String(p.entity).toLowerCase());
      if (p?.binding?.ref) coveredRefs.add(p.binding.ref);
    }
    concepts.push({ name: rec.concept, refs, canonicalKey: rec.canonical_key || null, conformed: true });
  }

  const seen = new Set(concepts.map((c) => String(c.name).toLowerCase()));
  for (const e of dedupeByName(entities) || []) {
    const lname = String(e?.name || "").toLowerCase();
    const ref = e?.binding?.ref;
    if (!lname || seen.has(lname) || coveredNames.has(lname)) continue;
    if (ref && coveredRefs.has(ref)) continue;
    seen.add(lname);
    concepts.push({ name: e.name, refs: ref ? [ref] : [], canonicalKey: null, conformed: false });
  }
  return concepts.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function CoverageBar({ value, total }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--bg-2)" }}>
      <div style={{ width: `${pct}%`, background: SUCCESS }} />
    </div>
  );
}

function ConnectDqlBanner() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, padding: "10px 12px", border: "1px solid var(--border-default)", borderRadius: 10, background: "var(--bg-1)", fontSize: 12, color: "var(--text-secondary)" }}>
      <PlugZap size={15} style={{ color: "var(--accent, #5b6cff)", flexShrink: 0 }} />
      Connect your DQL project to light up certified answers and the apps that show them.
    </div>
  );
}

/* Per-domain concept trace: one row per business concept (conformance-collapsed)
   → the dbt model(s) that realize it, grouped by whether it reaches dbt. */
function DomainTrace({ domainName, concepts, onGoto }) {
  const traced = concepts.filter((c) => (c.refs || []).length > 0);
  const untraced = concepts.filter((c) => (c.refs || []).length === 0);

  if (concepts.length === 0) {
    return (
      <div style={{ border: "1px dashed var(--border-default)", borderRadius: 10, padding: 20, background: "var(--bg-1)", maxWidth: 560 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>No concepts in {domainName} yet</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
          Model some concepts for this domain — their lineage to dbt appears here.
        </div>
        {onGoto && <button className="panel-btn primary" style={{ marginTop: 12 }} onClick={() => onGoto("diagram")}>Open modeler</button>}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: SUCCESS, margin: "0 0 8px" }}>Traced to dbt · {traced.length}</div>
      {traced.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "0 0 4px" }}>No concept reaches a dbt model yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {traced.map((c, i) => (
            <div key={`${c.name}.${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid var(--border-default)", borderRadius: 8, background: "var(--bg-1)" }}>
              <Boxes size={15} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{c.name}</span>
              <ArrowRight size={14} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
              <span style={{ display: "flex", gap: 4, minWidth: 0, flexWrap: "wrap" }}>
                {c.refs.map((r) => (
                  <code key={r} style={{ fontSize: 12, padding: "2px 8px", background: "var(--bg-2)", color: SUCCESS, borderRadius: 4, whiteSpace: "nowrap" }}>{r}</code>
                ))}
              </span>
              {c.canonicalKey?.length > 0 && (
                <span style={{ fontSize: 11, color: "var(--text-tertiary)", whiteSpace: "nowrap" }} title="Canonical key — the stable key agents join on">
                  joins on {c.canonicalKey.join(", ")}
                </span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>DQL &amp; app pending</span>
            </div>
          ))}
        </div>
      )}

      {untraced.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-tertiary)", margin: "18px 0 8px" }}>Not yet in dbt · {untraced.length}</div>
          <div style={{ display: "grid", gap: 6 }}>
            {untraced.map((c, i) => (
              <div key={`${c.name}.${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px dashed var(--border-default)", borderRadius: 8 }}>
                <Boxes size={15} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                <span style={{ fontSize: 13, minWidth: 0, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                {onGoto && (
                  <button className="panel-btn" style={{ marginLeft: "auto", padding: "3px 8px", fontSize: 11 }} onClick={() => onGoto("diagram")}>
                    <Plus size={11} /> Model in dbt
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function LineageView({ projectId, projectPath, domain, embedded = false, onGoto }) {
  const [state, setState] = React.useState({ loading: true, manifest: null });
  const [tick, setTick] = React.useState(0);
  // Global rail is the portfolio view: always start at the roll-up and drill in
  // via local selection — the user's pick wins and isn't yanked by activeDomain.
  // (The per-domain trace lives in the workspace Lineage tab, embedded=true.)
  const [selected, setSelected] = React.useState(null);

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

  const domains = React.useMemo(() => {
    const conformance = manifest?.conformance || [];
    return (manifest?.domains || []).map((d) => {
      const concepts = buildDomainConcepts(d.name, d.entities || [], conformance);
      return { name: d.name, concepts, total: concepts.length, inDbt: concepts.filter((c) => (c.refs || []).length > 0).length };
    });
  }, [manifest]);

  // Which domain is being traced: the workspace lock, or the rail's local selection.
  const activeDomainName = embedded ? domain : selected;
  const activeDomain = activeDomainName ? domains.find((d) => d.name === activeDomainName) : null;

  if (loading) {
    return <div style={{ padding: embedded ? 4 : 24, fontSize: 13, color: "var(--text-tertiary)" }}>Loading lineage…</div>;
  }

  // Embedded (workspace tab): just the trace for this domain.
  if (embedded) {
    return <DomainTrace domainName={domain} concepts={activeDomain?.concepts || []} onGoto={onGoto} />;
  }

  return (
    <div className="shell-view" style={{ padding: 20, overflow: "auto", color: "var(--text-primary)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        {activeDomainName && (
          <button className="panel-btn" onClick={() => setSelected(null)} title="Back to all domains">
            <ArrowLeft size={13} /> Domains
          </button>
        )}
        <Boxes size={18} strokeWidth={1.8} />
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Lineage{activeDomainName ? ` · ${activeDomainName}` : ""}</h2>
        <span style={{ flex: 1 }} />
        <button className="panel-btn" onClick={() => setTick((n) => n + 1)} title="Rebuild manifest and refresh">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      <p style={{ margin: "0 0 18px", fontSize: 12, color: "var(--text-secondary)", maxWidth: 760, lineHeight: 1.5 }}>
        {activeDomainName
          ? `How meaning flows in ${activeDomainName}: each concept → the dbt model that builds it → the certified DQL blocks and apps downstream.`
          : "How traced is each domain — concepts modeled, how many reach dbt, and how many are certified for answers in DQL. Open a domain to see the concept-level path."}
      </p>

      {/* Roll-up */}
      {!activeDomainName && (
        domains.length === 0 ? (
          <div style={{ border: "1px dashed var(--border-default)", borderRadius: 10, padding: 24, background: "var(--bg-1)", maxWidth: 640 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Nothing to trace yet</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              This project has no modeled concepts in its manifest yet. Model some entities with dbt bindings and build
              the manifest — their lineage appears here, grouped by domain.
            </div>
            {onGoto && <button className="panel-btn primary" style={{ marginTop: 12 }} onClick={() => onGoto("domains")}>Go to domains</button>}
          </div>
        ) : (
          <>
            <div style={{ border: "1px solid var(--border-default)", borderRadius: 10, overflow: "hidden", maxWidth: 720 }}>
              {domains.map((d, i) => (
                <div
                  key={d.name || i}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(d.name)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(d.name); } }}
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", cursor: "pointer", borderBottom: i < domains.length - 1 ? "1px solid var(--border-default)" : "none", background: "var(--bg-1)" }}
                >
                  <div style={{ minWidth: 120 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{d.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{d.total} concept{d.total === 1 ? "" : "s"}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CoverageBar value={d.inDbt} total={d.total} />
                    <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 12 }}>
                      <span style={{ color: SUCCESS }}><Database size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{d.inDbt} in dbt</span>
                      <span style={{ color: "var(--text-tertiary)" }}>0 certified in DQL</span>
                    </div>
                  </div>
                  <ChevronRight size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                </div>
              ))}
            </div>
            <ConnectDqlBanner />
          </>
        )
      )}

      {/* Drill-in */}
      {activeDomainName && (
        <>
          <DomainTrace domainName={activeDomainName} concepts={activeDomain?.concepts || []} onGoto={onGoto} />
          <ConnectDqlBanner />
        </>
      )}
    </div>
  );
}
