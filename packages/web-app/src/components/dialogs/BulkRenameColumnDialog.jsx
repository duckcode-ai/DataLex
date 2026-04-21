/* BulkRenameColumnDialog — v0.4.0 bulk refactor surface.
 *
 * Renames a single column across every YAML file in the workspace. The
 * user picks the new name, clicks Scan, reviews a unified-diff preview
 * of every touched file, then clicks Apply. Writes are atomic at the
 * refactor level — on partial failure the engine rolls back successful
 * writes (see `bulkRefactor.js`).
 *
 * Payload shape (from entry points):
 *   { entity, oldField }                 ← column fully specified
 *   { entity, columns: [{name}, …] }     ← column picker mode (entity known)
 *
 * The three entry points are all thin:
 *   • Column Inspector — "Rename column…" button (fully specified)
 *   • Command palette  — "Rename column across project…" (picker mode if
 *                        an entity is selected, guard otherwise)
 *   • Entity context menu on canvas — "Rename column…" (picker mode)
 *
 * This file deliberately keeps the unified-diff renderer inline (an
 * LCS-based two-way line diff, capped at 2k lines per side) rather than
 * reaching into DiffPanel. DiffPanel consumes git-produced unified diff
 * text; we'd rather not spawn a process just to render a two-string
 * compare.
 */
import React, { useMemo, useState } from "react";
import {
  Replace, AlertCircle, ChevronRight, ChevronDown,
  Loader2, CheckCircle2, FileText,
} from "lucide-react";
import Modal from "./Modal";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { saveFileContent } from "../../lib/api";
import {
  planBulkColumnRename,
  applyBulkColumnRename,
  summariseRefs,
} from "../../lib/bulkRefactor";

/* LCS-based line diff. Returns an ops list [{op, line}] where op is one
   of " " (context), "-" (deleted), "+" (added). Capped at 2k lines per
   side; beyond that we fall back to naive-by-index alignment so the UI
   stays responsive. Column-rename diffs are small in practice — this
   fallback is pure safety netting. */
function diffLines(a, b) {
  const A = String(a || "").split("\n");
  const B = String(b || "").split("\n");
  const m = A.length, n = B.length;

  if (m > 2000 || n > 2000) {
    const max = Math.max(m, n);
    const ops = [];
    for (let k = 0; k < max; k++) {
      const la = A[k], lb = B[k];
      if (la === lb) ops.push({ op: " ", line: la ?? "" });
      else {
        if (la !== undefined) ops.push({ op: "-", line: la });
        if (lb !== undefined) ops.push({ op: "+", line: lb });
      }
    }
    return ops;
  }

  // Classic LCS DP, backwards fill so we can walk forwards.
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (A[i] === B[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { ops.push({ op: " ", line: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: "-", line: A[i] }); i++; }
    else { ops.push({ op: "+", line: B[j] }); j++; }
  }
  while (i < m) ops.push({ op: "-", line: A[i++] });
  while (j < n) ops.push({ op: "+", line: B[j++] });
  return ops;
}

/* Compact hunk extractor — drops long runs of unchanged context down to
   ±2 lines around each change. Keeps preview readable without hiding
   where in the file the edit landed. */
function trimContext(ops, ctx = 2) {
  const out = [];
  const n = ops.length;
  const isChange = (k) => k >= 0 && k < n && ops[k].op !== " ";
  for (let k = 0; k < n; k++) {
    const o = ops[k];
    if (o.op !== " ") { out.push(o); continue; }
    let keep = false;
    for (let d = 1; d <= ctx; d++) {
      if (isChange(k - d) || isChange(k + d)) { keep = true; break; }
    }
    if (keep) out.push(o);
    else if (out.length && out[out.length - 1].op !== "…") out.push({ op: "…", line: "" });
  }
  // Strip a trailing ellipsis-only row if we ended on untouched context.
  while (out.length && out[out.length - 1].op === "…") out.pop();
  return out;
}

function DiffBlock({ oldContent, newContent }) {
  const lines = useMemo(
    () => trimContext(diffLines(oldContent, newContent)),
    [oldContent, newContent]
  );
  return (
    <pre
      style={{
        margin: 0, padding: 8,
        fontFamily: "var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace)",
        fontSize: 11, lineHeight: 1.5,
        color: "var(--text-primary)",
        maxHeight: 240, overflow: "auto",
        background: "var(--bg-canvas, var(--bg-1))",
        whiteSpace: "pre",
        borderRadius: 6,
        border: "1px solid var(--border-default)",
      }}
    >
      {lines.map((l, i) => {
        let bg = "transparent";
        let color = "var(--text-secondary)";
        let prefix = " ";
        if (l.op === "+") { color = "var(--cat-billing)"; bg = "var(--cat-billing-soft)"; prefix = "+"; }
        else if (l.op === "-") { color = "#ef4444"; bg = "rgba(239, 68, 68, 0.10)"; prefix = "-"; }
        else if (l.op === "…") { color = "var(--text-tertiary)"; prefix = "⋯"; }
        return (
          <div key={i} style={{ background: bg, color, padding: "0 6px" }}>
            {l.op === "…" ? "  ⋯" : `${prefix} ${l.line || ""}`}
          </div>
        );
      })}
    </pre>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
export default function BulkRenameColumnDialog() {
  const { closeModal, addToast, modalPayload } = useUiStore();
  const initEntity = String(modalPayload?.entity || "");
  const initOld = String(modalPayload?.oldField || "");
  const pickableColumns = Array.isArray(modalPayload?.columns)
    ? modalPayload.columns.map((c) => (typeof c === "string" ? c : c?.name)).filter(Boolean)
    : [];

  const [entity] = useState(initEntity);
  const [oldField, setOldField] = useState(initOld);
  const [newField, setNewField] = useState(initOld);
  const [plan, setPlan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());

  const canScan = !!entity && !!oldField && !!newField.trim() && newField !== oldField;
  const hasBlockingErrors = !!plan && (plan.errors || []).length > 0;
  const canApply = !!plan && !hasBlockingErrors && (plan.affected || []).length > 0 && !applying;

  const toggleExpand = (path) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleScan = async () => {
    if (!canScan) return;
    setError("");
    setPlan(null);
    setScanning(true);
    try {
      const s = useWorkspaceStore.getState();
      // Prime the content cache so the planner can inspect every YAML.
      const paths = (s.projectFiles || [])
        .map((f) => (f?.fullPath || f?.path || "").replace(/^[/\\]+/, ""))
        .filter((p) => p && /\.(ya?ml)$/i.test(p));
      try {
        await s.ensureFilesLoaded(paths);
      } catch (_err) {
        /* soft-fail — planner will skip uncached files */
      }
      const after = useWorkspaceStore.getState();
      const result = await planBulkColumnRename({
        projectFiles: after.projectFiles,
        fileContentCache: after.fileContentCache,
        entity,
        oldField,
        newField: newField.trim(),
      });
      setPlan(result);
      // Auto-expand the declaring file so the user sees the primary rename.
      if (result.declaringFile) {
        setExpanded(new Set([result.declaringFile]));
      }
    } catch (err) {
      setError(err?.message || "Scan failed.");
    } finally {
      setScanning(false);
    }
  };

  const handleApply = async () => {
    if (!canApply) return;
    setError("");
    setApplying(true);
    try {
      const { written, errors } = await applyBulkColumnRename(plan, {
        saveFile: saveFileContent,
      });

      if (errors && errors.length > 0) {
        const msg = errors.map((e) => `${e.path}: ${e.message}`).join("; ");
        setError(`Apply failed — ${msg}`);
        addToast({ type: "error", message: `Rename failed. Changes rolled back.` });
        return;
      }

      // Sync workspace store with the new disk state so the canvas + open
      // editors re-render without a round-trip. We update the cache in
      // place and, if the active file was touched, push the new content
      // through updateContent so isDirty and history stay honest.
      const s = useWorkspaceStore.getState();
      const nextCache = { ...(s.fileContentCache || {}) };
      let activeUpdated = null;
      for (const entry of plan.affected) {
        nextCache[entry.path] = entry.newContent;
        const active = s.activeFile;
        if (active) {
          const activeKey = (active.fullPath || active.path || "").replace(/^[/\\]+/, "");
          if (activeKey === entry.path) activeUpdated = entry.newContent;
        }
      }
      useWorkspaceStore.setState({ fileContentCache: nextCache });
      if (activeUpdated != null) {
        // The file was just saved to disk — mark it as the new baseline
        // rather than a pending edit.
        useWorkspaceStore.setState({
          activeFileContent: activeUpdated,
          originalContent: activeUpdated,
          isDirty: false,
        });
      }

      addToast({
        type: "success",
        message: `Renamed ${entity}.${oldField} → ${entity}.${newField.trim()} across ${written.length} file${written.length === 1 ? "" : "s"}.`,
      });
      closeModal();
    } catch (err) {
      setError(err?.message || "Apply failed.");
    } finally {
      setApplying(false);
    }
  };

  // Guard: we need at least an entity. If the caller didn't pre-select a
  // column, we render a dropdown below (picker mode) — but without an
  // entity there's nothing we can do.
  if (!entity) {
    return (
      <Modal
        icon={<Replace size={14} />}
        title="Rename column across project"
        size="md"
        onClose={closeModal}
        footer={<button type="button" className="panel-btn" onClick={closeModal}>Close</button>}
      >
        <div className="dlx-modal-alert">
          <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>Select a table first — right-click an entity on the canvas, or use the Inspector's "Rename column…" button.</span>
        </div>
      </Modal>
    );
  }

  const summary = plan ? summariseRefs(plan) : "";

  return (
    <Modal
      icon={<Replace size={14} />}
      title="Rename column across project"
      subtitle="Scans every YAML file for FKs, relationships, indexes, metrics, and key sets. Preview before writing."
      size="lg"
      onClose={closeModal}
      footer={
        <>
          <button type="button" className="panel-btn" onClick={closeModal} disabled={applying}>
            Cancel
          </button>
          {!plan ? (
            <button
              type="button"
              className="panel-btn primary"
              onClick={handleScan}
              disabled={!canScan || scanning}
            >
              {scanning ? (<><Loader2 size={12} className="animate-spin" style={{ marginRight: 6 }} />Scanning…</>) : "Scan project"}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="panel-btn"
                onClick={handleScan}
                disabled={!canScan || scanning}
              >
                {scanning ? "Scanning…" : "Re-scan"}
              </button>
              <button
                type="button"
                className="panel-btn primary"
                onClick={handleApply}
                disabled={!canApply}
              >
                {applying ? (<><Loader2 size={12} className="animate-spin" style={{ marginRight: 6 }} />Applying…</>) : `Apply to ${plan.affected.length} file${plan.affected.length === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </>
      }
    >
      {/* Source row — fixed display if oldField was pre-set, dropdown
          picker if the caller only knew the entity. */}
      {initOld ? (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px",
            background: "var(--bg-2)",
            border: "1px solid var(--border-default)",
            borderRadius: 8,
            marginBottom: 14,
            fontSize: 12,
            fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)",
          }}
        >
          <span style={{ color: "var(--text-tertiary)", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.4, fontFamily: "inherit" }}>
            Column
          </span>
          <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{entity}</span>
          <span style={{ color: "var(--text-tertiary)" }}>.{oldField}</span>
        </div>
      ) : (
        <div className="dlx-modal-section">
          <label className="dlx-modal-field-label" htmlFor="bulk-rename-old">
            Column to rename <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>({entity})</span>
          </label>
          <select
            id="bulk-rename-old"
            className="panel-input"
            value={oldField}
            onChange={(e) => { setOldField(e.target.value); setNewField(e.target.value); setPlan(null); setError(""); }}
          >
            <option value="">Choose column…</option>
            {pickableColumns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {pickableColumns.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 6 }}>
              No columns available for this entity — the entity may have been opened without model data.
            </div>
          )}
        </div>
      )}

      {/* New name input */}
      <div className="dlx-modal-section">
        <label className="dlx-modal-field-label" htmlFor="bulk-rename-new">New column name</label>
        <input
          id="bulk-rename-new"
          className="panel-input"
          value={newField}
          onChange={(e) => { setNewField(e.target.value); setPlan(null); setError(""); }}
          placeholder="e.g. customer_id"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!plan) handleScan(); else if (canApply) handleApply(); }
          }}
        />
      </div>

      {/* Error banner (scan or apply) */}
      {error && (
        <div className="dlx-modal-alert" style={{ marginBottom: 12 }}>
          <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Plan output */}
      {plan && (
        <div className="dlx-modal-section">
          {/* Plan-level errors (e.g. collision) */}
          {plan.errors && plan.errors.length > 0 && (
            <div className="dlx-modal-alert" style={{ marginBottom: 10 }}>
              <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {plan.errors.map((e, i) => (
                  <span key={i}>
                    {e.path ? <code style={{ fontFamily: "var(--font-mono)" }}>{e.path}</code> : null}
                    {e.path ? " — " : ""}
                    {e.message}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Summary row */}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 10px",
              background: (plan.affected || []).length > 0 ? "var(--accent-dim)" : "var(--bg-2)",
              border: "1px solid var(--border-default)",
              borderRadius: 6,
              marginBottom: 10,
              fontSize: 12,
            }}
          >
            {(plan.affected || []).length > 0 ? (
              <CheckCircle2 size={14} style={{ color: "var(--accent)" }} />
            ) : (
              <AlertCircle size={14} style={{ color: "var(--text-tertiary)" }} />
            )}
            <span style={{ color: "var(--text-primary)" }}>
              {summary || "No references found."}
            </span>
          </div>

          {/* Affected files list */}
          {(plan.affected || []).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {plan.affected.map((entry) => {
                const isOpen = expanded.has(entry.path);
                const refCount = (entry.refs || []).length;
                return (
                  <div
                    key={entry.path}
                    style={{
                      border: "1px solid var(--border-default)",
                      borderRadius: 6,
                      background: "var(--bg-1)",
                      overflow: "hidden",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpand(entry.path)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        width: "100%",
                        padding: "8px 10px",
                        background: "transparent",
                        border: "none",
                        color: "var(--text-primary)",
                        textAlign: "left",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <FileText size={12} style={{ color: "var(--text-tertiary)" }} />
                      <span style={{ fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {entry.path}
                      </span>
                      {entry.path === plan.declaringFile && (
                        <span
                          style={{
                            fontSize: 10, color: "var(--accent)",
                            background: "var(--accent-dim)",
                            padding: "1px 6px", borderRadius: 4,
                            textTransform: "uppercase", letterSpacing: 0.4,
                          }}
                        >
                          declares
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                        {refCount} ref{refCount === 1 ? "" : "s"}
                      </span>
                    </button>
                    {isOpen && (
                      <div style={{ padding: "0 10px 10px" }}>
                        <DiffBlock oldContent={entry.oldContent} newContent={entry.newContent} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Pre-scan hint */}
      {!plan && !scanning && (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            lineHeight: 1.5,
            padding: "8px 2px",
          }}
        >
          Click <strong>Scan project</strong> to find every YAML reference to <code>{entity}.{oldField}</code>. Nothing is written until you review and Apply.
        </div>
      )}
    </Modal>
  );
}
