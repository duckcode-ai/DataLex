/* DocsView — top-level "readable docs" view of the active YAML model.
 *
 * Mounted as the `docs` workspace view-mode (alongside Diagram, Table,
 * Views, Enums). Full-width surface, not a side-panel widget.
 *
 * Responsibilities:
 *   1. Render the active file as readable docs: header chips, model
 *      description, mermaid ER diagram, per-entity sections with field
 *      tables.
 *   2. Surface dbt readiness chips per entity — "3 missing descriptions",
 *      "missing not-null tests", etc. — sourced from /api/dbt/review.
 *   3. Inline editing — click any description to edit; saves dispatch a
 *      yamlPatch op + updateContent so the same change shows up in the
 *      Code editor and any AI agent that reads activeFileContent.
 *   4. AI assistance — every empty description gets a "Suggest with AI"
 *      button that opens the existing AI assistant with a focused
 *      prompt prefilled. Uses the same surface as Cmd+K → Ask AI; no
 *      new infra.
 *
 * No file is ever written to disk by this view. YAML stays the single
 * source of truth.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import yaml from "js-yaml";
import { Sparkles, FileText, AlertTriangle, Loader2 } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import {
  setModelDescription,
  setEntityDescription,
  patchField,
} from "../../design/yamlPatch";
import {
  fetchDbtReadinessReview,
  runDbtReadinessReview,
  suggestAiDescription,
} from "../../lib/api";
import EditableDescription from "./EditableDescription";
import MermaidERD from "./MermaidERD";

/* AI provider gating.
 *
 * The Suggest endpoint refuses to call the LLM when no real provider is
 * configured (it 503's with code "NO_PROVIDER"). Mirror that check on
 * the client so the inline ✨ AI buttons can render disabled-with-tooltip
 * instead of clicking through to a confusing error.
 *
 * Provider config lives in localStorage (set by SettingsDialog → AI):
 *   datalex.ai.provider  ∈ { "local", "openai", "anthropic", "gemini", "ollama" }
 *   datalex.ai.apiKey    (the key, if applicable)
 *
 * "local" and unset both mean "no real LLM" — gate the button. The
 * `local` provider passes through the readiness gate's `aiConfigured`
 * check (which counts local as "configured"), but for actual one-shot
 * generation we need a real LLM.
 */
function readAiProviderForSuggest() {
  try {
    const provider = (localStorage.getItem("datalex.ai.provider") || "").trim().toLowerCase();
    if (!provider || provider === "local") return null;
    return {
      provider,
      apiKey: localStorage.getItem("datalex.ai.apiKey") || "",
      model: localStorage.getItem("datalex.ai.model") || "",
      baseUrl: localStorage.getItem("datalex.ai.baseUrl") || "",
    };
  } catch {
    return null;
  }
}

function flagsCellFor(field) {
  const flags = [];
  if (field.primary_key) flags.push("PK");
  if (field.foreign_key && field.foreign_key.entity) {
    const target = field.foreign_key.field || "?";
    flags.push(`FK→${field.foreign_key.entity}.${target}`);
  }
  if (field.unique) flags.push("unique");
  if (field.nullable === false) flags.push("not-null");
  return flags.length ? flags.join(" ") : "—";
}

/**
 * AiActionButtons — renders the inline ✨ AI controls next to a description.
 *
 *  - Empty description → single "Suggest" button (mode=suggest)
 *  - Existing description → two compact buttons: "Rewrite" + "Tighter"
 *  - All disabled (with tooltip) when no AI provider is configured
 *  - Per-button spinner when that exact (target, mode) is in flight
 *
 * Three sizes for the three call sites (model = lg, entity = md, field = sm).
 */
function AiActionButtons({
  aiEnabled,
  aiDisabledHint,
  hasDescription,
  busyKey,         // current global busy key from DocsView state
  baseKey,         // unique-per-target prefix (e.g. "model:foo.yml" or "entity:Customer")
  size = "md",     // "lg" | "md" | "sm"
  onAsk,           // (mode) => void
}) {
  const sz = size === "lg"
    ? { icon: 11, fs: 11.5, py: 4, px: 9 }
    : size === "sm"
    ? { icon: 9, fs: 10.5, py: 2, px: 6 }
    : { icon: 11, fs: 11.5, py: 4, px: 9 };

  const baseStyle = (active) => ({
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: `${sz.py}px ${sz.px}px`,
    borderRadius: size === "sm" ? 4 : 6,
    border: `1px solid ${aiEnabled ? "var(--accent, #3b82f6)" : "var(--border-default)"}`,
    background: aiEnabled
      ? (active ? "var(--accent, #3b82f6)" : "rgba(59,130,246,0.12)")
      : "var(--bg-2)",
    color: aiEnabled
      ? (active ? "#fff" : "var(--accent, #3b82f6)")
      : "var(--text-tertiary)",
    fontSize: sz.fs,
    fontWeight: 600,
    cursor: aiEnabled ? "pointer" : "not-allowed",
    whiteSpace: "nowrap",
    opacity: aiEnabled ? 1 : 0.7,
  });

  const renderBtn = (mode, label, primary = false) => {
    const busy = busyKey === `${baseKey}:${mode}`;
    return (
      <button
        key={mode}
        type="button"
        onClick={() => onAsk(mode)}
        disabled={!aiEnabled || busy}
        title={aiEnabled
          ? (busy ? "Generating…" : `${label} with AI`)
          : aiDisabledHint}
        style={{
          ...baseStyle(primary),
          cursor: aiEnabled && !busy ? "pointer" : "not-allowed",
        }}
      >
        {busy
          ? <Loader2 size={sz.icon} style={{ animation: "spin 0.9s linear infinite" }} />
          : <Sparkles size={sz.icon} />}
        {size === "sm" && busy ? "…" : label}
      </button>
    );
  };

  if (!hasDescription) {
    return renderBtn("suggest", size === "sm" ? "AI" : "Suggest with AI", true);
  }
  return (
    <>
      {renderBtn("rewrite", size === "sm" ? "AI" : "Rewrite", false)}
      {size !== "sm" && renderBtn("tighter", "Tighter", false)}
    </>
  );
}

function parseYaml(text) {
  try {
    const doc = yaml.load(text);
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null;
  } catch {
    return null;
  }
}

function ReadinessChip({ status, count, label }) {
  const tone =
    status === "red" ? { bg: "rgba(239,68,68,0.16)", color: "#fca5a5", border: "rgba(239,68,68,0.4)" }
    : status === "yellow" ? { bg: "rgba(234,179,8,0.16)", color: "#fde68a", border: "rgba(234,179,8,0.4)" }
    : { bg: "rgba(34,197,94,0.14)", color: "#86efac", border: "rgba(34,197,94,0.35)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        background: tone.bg,
        color: tone.color,
        border: `1px solid ${tone.border}`,
        fontSize: 11,
        fontWeight: 600,
      }}
      title={`${count} ${label} from the readiness gate`}
    >
      {count} {label}
    </span>
  );
}

export default function DocsView() {
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const activeFileContent = useWorkspaceStore((s) => s.activeFileContent);
  const updateContent = useWorkspaceStore((s) => s.updateContent);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);

  // Refresh the provider snapshot whenever the file changes — covers the
  // case where the user just saved their AI key in Settings and clicks
  // back into the Docs view. This is cheap (a localStorage read).
  const [aiProvider, setAiProvider] = useState(() => readAiProviderForSuggest());
  useEffect(() => {
    setAiProvider(readAiProviderForSuggest());
  }, [activeFile?.path]);
  const aiEnabled = Boolean(aiProvider);
  const aiDisabledHint = "Add an OpenAI / Anthropic / Gemini / Ollama provider in Settings → AI to enable inline suggestions.";

  // In-flight requests, keyed by a deterministic signature so we can show
  // a per-button spinner without coupling to a global loading flag.
  const [aiBusyKey, setAiBusyKey] = useState(null);
  const [aiError, setAiError] = useState("");

  const doc = useMemo(() => parseYaml(activeFileContent || ""), [activeFileContent]);

  // -------- readiness review (per file) --------
  const [reviewByPath, setReviewByPath] = useState({});
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");

  // Cheap cache pull on mount + project change.
  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    fetchDbtReadinessReview(activeProjectId)
      .then((res) => {
        if (cancelled) return;
        setReviewByPath(res?.byPath || {});
      })
      .catch(() => { /* cached review may not exist yet — that's fine */ });
    return () => { cancelled = true; };
  }, [activeProjectId]);

  const runReview = async () => {
    if (!activeProjectId) return;
    setReviewing(true);
    setReviewError("");
    try {
      const res = await runDbtReadinessReview({ projectId: activeProjectId, scope: "all" });
      setReviewByPath(res?.byPath || {});
    } catch (err) {
      setReviewError(err?.message || String(err));
    } finally {
      setReviewing(false);
    }
  };

  if (!activeFile) {
    return (
      <div className="shell-view" style={{ padding: 32, color: "var(--text-tertiary)", fontSize: 14 }}>
        <FileText size={28} style={{ opacity: 0.5, marginBottom: 10 }} />
        <div style={{ fontSize: 16, marginBottom: 6, color: "var(--text-secondary)" }}>No file open</div>
        <div>Click any YAML file in the Explorer to see its readable docs view here.</div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="shell-view" style={{ padding: 32, color: "var(--text-tertiary)", fontSize: 14 }}>
        <AlertTriangle size={22} style={{ color: "var(--warn, #f59e0b)" }} />
        <div style={{ marginTop: 10 }}>
          Could not parse <code>{activeFile.path || activeFile.name}</code> as YAML. Switch to{" "}
          <strong>Diagram</strong> or open it in the right panel's YAML tab to fix the syntax.
        </div>
      </div>
    );
  }

  const meta = (doc.model && typeof doc.model === "object") ? doc.model : doc;
  const title = doc.title || meta.title || meta.name || activeFile.name;
  const layer = doc.layer || meta.layer || null;
  const domain = meta.domain || doc.domain || null;
  const owners = Array.isArray(meta.owners) ? meta.owners : [];
  const entities = Array.isArray(doc.entities) ? doc.entities : [];
  const relationships = Array.isArray(doc.relationships) ? doc.relationships : [];

  // Pull this file's readiness summary out of the cached review.
  const fileReview = (() => {
    const path = activeFile.path || activeFile.fullPath;
    if (!path || !reviewByPath) return null;
    return reviewByPath[path] || reviewByPath[path.replace(/^\/+/, "")] || null;
  })();

  // -------- patch dispatchers --------
  const writeIfChanged = (next) => {
    if (next && next !== activeFileContent) updateContent(next);
  };
  const handleModelDescription = (text) => {
    writeIfChanged(setModelDescription(activeFileContent || "", text));
  };
  const handleEntityDescription = (entityName) => (text) => {
    writeIfChanged(setEntityDescription(activeFileContent || "", entityName, text));
  };
  const handleFieldDescription = (entityName, fieldName) => (text) => {
    writeIfChanged(patchField(activeFileContent || "", entityName, fieldName, { description: text }));
  };

  // -------- One-shot inline AI suggestion / rewrite --------
  // Calls POST /api/ai/suggest with just the path + entity/field name —
  // the server reads the YAML, builds a focused prompt, invokes ONLY the
  // description_writer agent, returns plain text. Result is written back
  // through the same yamlPatch helpers as inline edits.
  //
  // `mode` ∈ "suggest" | "rewrite" | "tighter":
  //   - suggest  → empty descriptions; produces a fresh one-shot
  //   - rewrite  → existing descriptions; produces a clearer replacement
  //   - tighter  → existing descriptions; compresses while keeping meaning
  const askAiToSuggest = useCallback(async (kind, target, mode = "suggest") => {
    if (!aiEnabled || !activeFile) return;
    const filePath = activeFile.path || activeFile.fullPath || activeFile.name;
    const key = (kind === "model"
      ? `model:${filePath}`
      : kind === "entity"
      ? `entity:${target}`
      : `field:${target.entity}.${target.field}`) + `:${mode}`;
    setAiBusyKey(key);
    setAiError("");
    try {
      const resp = await suggestAiDescription({
        projectId: activeProjectId,
        provider: aiProvider,
        mode,
        target: {
          kind,
          path: filePath,
          entity: kind === "entity" ? String(target) : kind === "field" ? target.entity : undefined,
          field: kind === "field" ? target.field : undefined,
        },
      });
      const text = String(resp?.description || "").trim();
      if (!text) {
        setAiError("AI returned an empty suggestion. Try again or write the description by hand.");
        return;
      }
      // Write back through the same patch helpers an inline edit would use.
      if (kind === "model") {
        writeIfChanged(setModelDescription(activeFileContent || "", text));
      } else if (kind === "entity") {
        writeIfChanged(setEntityDescription(activeFileContent || "", String(target), text));
      } else {
        writeIfChanged(patchField(activeFileContent || "", target.entity, target.field, { description: text }));
      }
    } catch (err) {
      // The server uses a known code when no real provider is configured.
      // Refresh our local snapshot so the buttons disable themselves on
      // the next render.
      if (err?.code === "NO_PROVIDER") {
        setAiProvider(null);
        setAiError(err.message || aiDisabledHint);
      } else {
        setAiError(err?.message || "AI suggestion failed.");
      }
    } finally {
      setAiBusyKey(null);
    }
  }, [aiEnabled, activeFile, activeProjectId, aiProvider, activeFileContent]);

  const renderEntityReadiness = (entityName) => {
    if (!fileReview || !Array.isArray(fileReview.findings)) return null;
    // The readiness review's `findings` are file-scoped; filter by entity if present.
    const matched = fileReview.findings.filter((f) => {
      if (!f) return false;
      const path = String(f.path || "");
      return path.includes(entityName) || (f.entity && f.entity === entityName);
    });
    if (matched.length === 0) return null;
    const errors = matched.filter((f) => f.severity === "error" || f.severity === "high").length;
    const warnings = matched.filter((f) => f.severity === "warning" || f.severity === "medium").length;
    return (
      <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
        {errors > 0 && <ReadinessChip status="red" count={errors} label="errors" />}
        {warnings > 0 && <ReadinessChip status="yellow" count={warnings} label="warnings" />}
      </div>
    );
  };

  return (
    <div
      className="shell-view"
      style={{
        height: "100%",
        overflowY: "auto",
        padding: "24px 32px 40px",
        fontSize: 13.5,
        lineHeight: 1.6,
        color: "var(--text-primary)",
      }}
    >
      {/* Inline `@keyframes spin` once for the AI Loader2 icons + a couple
          of utility classes so the prose surface feels like a real docs
          page, not a YAML dump. Scoped via a single <style> so we don't
          touch the global stylesheet. */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .dlx-docs-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.01em;
          background: var(--bg-2);
          border: 1px solid var(--border-default);
          color: var(--text-secondary);
        }
        .dlx-docs-pill code { font-size: 11px; color: var(--text-primary); background: transparent; padding: 0; }
        .dlx-docs-eyebrow {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-tertiary);
          margin: 0 0 8px;
        }
        .dlx-docs-card {
          padding: 18px 20px 20px;
          border-radius: 12px;
          border: 1px solid var(--border-default);
          background: var(--bg-1);
          margin-bottom: 18px;
          transition: border-color 0.15s;
        }
        .dlx-docs-card:hover { border-color: var(--border-strong); }
        .dlx-docs-card-header {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 6px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border-subtle, var(--border-default));
        }
        .dlx-docs-fields-table tr:hover td {
          background: var(--bg-2);
        }
        .dlx-docs-fields-table td { transition: background 0.1s; }
      `}</style>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        {/* Hero header */}
        <header style={{ marginBottom: 24 }}>
          <p className="dlx-docs-eyebrow" style={{ marginBottom: 4 }}>
            {layer ? `${layer} model` : "Model"}{domain ? ` · ${domain}` : ""}
          </p>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
            <h1 style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.015em",
              lineHeight: 1.15,
              flex: 1,
              minWidth: 0,
            }}>
              {title}
            </h1>
            <button
              type="button"
              onClick={runReview}
              disabled={reviewing || !activeProjectId}
              title="Run the dbt readiness gate over this project"
              style={{
                padding: "7px 13px",
                borderRadius: 8,
                border: "1px solid var(--border-default)",
                background: "var(--bg-2)",
                color: "var(--text-secondary)",
                fontSize: 12,
                fontWeight: 600,
                cursor: reviewing || !activeProjectId ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
                marginTop: 4,
              }}
            >
              {reviewing ? "Running readiness…" : "Run readiness check"}
            </button>
          </div>
          {/* Meta pills row */}
          <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {fileReview && fileReview.status && (
              <ReadinessChip
                status={fileReview.status}
                count={fileReview.score ?? 0}
                label={`/100 · ${(fileReview.counts?.total ?? 0)} findings`}
              />
            )}
            {layer && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>Layer</strong> <code>{layer}</code></span>}
            {domain && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>Domain</strong> <code>{domain}</code></span>}
            {meta.version && <span className="dlx-docs-pill"><strong style={{ opacity: 0.6 }}>Version</strong> <code>{meta.version}</code></span>}
            {owners.length > 0 && (
              <span className="dlx-docs-pill" title={owners.join(", ")}>
                <strong style={{ opacity: 0.6 }}>Owners</strong> <code>{owners[0]}{owners.length > 1 ? ` +${owners.length - 1}` : ""}</code>
              </span>
            )}
            <span className="dlx-docs-pill" title={activeFile.path || activeFile.name}>
              <strong style={{ opacity: 0.6 }}>Source</strong> <code>{(activeFile.path || activeFile.name).split("/").slice(-2).join("/")}</code>
            </span>
          </div>
          {reviewError && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-tertiary)" }}>
              Readiness check failed: {reviewError}
            </div>
          )}
        </header>

        {/* Model description card */}
        <section className="dlx-docs-card" style={{ marginBottom: 24 }}>
          <p className="dlx-docs-eyebrow">Overview</p>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px", minWidth: 0, fontSize: 14, lineHeight: 1.65 }}>
              <EditableDescription
                value={meta.description || ""}
                placeholder="Add a short summary of what this model represents."
                onSave={handleModelDescription}
                ariaLabel="model description"
              />
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0, marginTop: 4 }}>
            <AiActionButtons
              aiEnabled={aiEnabled}
              aiDisabledHint={aiDisabledHint}
              hasDescription={Boolean(meta.description)}
              busyKey={aiBusyKey}
              baseKey={`model:${activeFile.path || activeFile.fullPath || activeFile.name}`}
              size="lg"
              onAsk={(mode) => askAiToSuggest("model", null, mode)}
            />
            </div>
          </div>
          {aiError && (
            <div style={{
              marginTop: 8,
              padding: "6px 10px",
              fontSize: 12,
              color: "var(--text-secondary)",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: 6,
            }}>
              {aiError}
            </div>
          )}
        </section>

        {/* Mermaid ERD */}
        {entities.length > 0 && (
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)" }}>
              Entity-relationship diagram
            </h2>
            <MermaidERD entities={entities} />
          </section>
        )}

        {/* Per-entity sections */}
        {entities.map((ent, idx) => {
          if (!ent || typeof ent !== "object") return null;
          const entName = String(ent.name || `Entity ${idx + 1}`);
          const fields = Array.isArray(ent.fields) ? ent.fields : [];
          return (
            <section
              key={entName + idx}
              className="dlx-docs-card"
              id={`entity-${entName}`}
            >
              <header className="dlx-docs-card-header">
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.005em" }}>{entName}</h3>
                <span className="dlx-docs-pill" style={{ background: "var(--bg-3, rgba(59,130,246,0.08))", borderColor: "rgba(59,130,246,0.25)", color: "var(--text-primary)" }}>
                  {ent.type || "entity"}
                </span>
                {fields.length > 0 && (
                  <span className="dlx-docs-pill" style={{ opacity: 0.8 }}>
                    {fields.length} field{fields.length === 1 ? "" : "s"}
                  </span>
                )}
                {renderEntityReadiness(entName)}
              </header>

              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <div style={{ flex: "1 1 240px", minWidth: 0, fontSize: 13.5, lineHeight: 1.6 }}>
                  <EditableDescription
                    value={ent.description || ""}
                    placeholder={`Describe the ${entName} entity.`}
                    onSave={handleEntityDescription(entName)}
                    ariaLabel={`${entName} description`}
                  />
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0, marginTop: 4 }}>
                  <AiActionButtons
                    aiEnabled={aiEnabled}
                    aiDisabledHint={aiDisabledHint}
                    hasDescription={Boolean(ent.description)}
                    busyKey={aiBusyKey}
                    baseKey={`entity:${entName}`}
                    size="md"
                    onAsk={(mode) => askAiToSuggest("entity", entName, mode)}
                  />
                </div>
              </div>

              {fields.length > 0 && (
                <>
                <p className="dlx-docs-eyebrow" style={{ margin: "16px 0 6px" }}>Fields</p>
                <table
                  className="dlx-docs-fields-table"
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 12.5,
                  }}
                >
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--text-tertiary)", fontSize: 11 }}>
                      <th style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-default)", width: "22%", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Field</th>
                      <th style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-default)", width: "14%", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Type</th>
                      <th style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-default)", width: "20%", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Flags</th>
                      <th style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-default)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((fld, fIdx) => {
                      if (!fld || typeof fld !== "object") return null;
                      const fname = String(fld.name || "");
                      if (!fname) return null;
                      const isPk = !!fld.primary_key;
                      return (
                        <tr key={fname + fIdx} style={{ verticalAlign: "top" }}>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-subtle, var(--border-default))" }}>
                            <code style={{ fontWeight: isPk ? 700 : 500 }}>{fname}</code>
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-subtle, var(--border-default))", color: "var(--text-secondary)" }}>
                            <code>{String(fld.type || "string")}</code>
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-subtle, var(--border-default))", color: "var(--text-secondary)", fontSize: 11.5 }}>
                            {flagsCellFor(fld)}
                          </td>
                          <td style={{ padding: "4px 10px", borderBottom: "1px solid var(--border-subtle, var(--border-default))" }}>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <EditableDescription
                                  value={fld.description || ""}
                                  placeholder="Add a description"
                                  onSave={handleFieldDescription(entName, fname)}
                                  multiline={false}
                                  ariaLabel={`${entName}.${fname} description`}
                                />
                              </div>
                              <AiActionButtons
                                aiEnabled={aiEnabled}
                                aiDisabledHint={aiDisabledHint}
                                hasDescription={Boolean(fld.description)}
                                busyKey={aiBusyKey}
                                baseKey={`field:${entName}.${fname}`}
                                size="sm"
                                onAsk={(mode) => askAiToSuggest("field", { entity: entName, field: fname }, mode)}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </>
              )}
            </section>
          );
        })}

        {/* Relationships table (read-only for now) */}
        {relationships.length > 0 && (
          <section style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)" }}>
              Relationships
            </h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-secondary)" }}>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}>From</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}>To</th>
                  <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}>Cardinality</th>
                </tr>
              </thead>
              <tbody>
                {relationships.map((r, idx) => (
                  <tr key={(r?.name || idx) + ""}>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}><code>{r?.from || "?"}</code></td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}><code>{r?.to || "?"}</code></td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border-default)" }}><code>{r?.cardinality || "?"}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}
