/* Export DDL dialog — lets users pick a dialect and generate forward SQL
   for the active model file. Result is shown inline and optionally saved
   to disk (api-server handles the write). */
import React, { useState } from "react";
import { X, Download, RefreshCw, AlertCircle, Copy, Check } from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { generateForwardSql, saveFileContent } from "../../lib/api";

const DIALECTS = [
  { id: "snowflake",  label: "Snowflake" },
  { id: "databricks", label: "Databricks" },
  { id: "bigquery",   label: "BigQuery" },
  { id: "postgres",   label: "PostgreSQL" },
  { id: "duckdb",     label: "DuckDB" },
];

export default function ExportDdlDialog() {
  const { closeModal } = useUiStore();
  const { activeFile, projectPath, projectConfig } = useWorkspaceStore();
  const [dialect, setDialect] = useState(() => String(projectConfig?.defaultDialect || "snowflake").toLowerCase());
  const [sql, setSql] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [copied, setCopied] = useState(false);

  const run = async () => {
    if (!activeFile?.fullPath) { setError("Open a .model.yaml file first."); return; }
    setBusy(true); setError(""); setSql(""); setSavedPath("");
    try {
      const res = await generateForwardSql(activeFile.fullPath, dialect);
      setSql(String(res?.sql || res?.output || "").trim());
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveToDisk = async () => {
    if (!sql || !activeFile?.fullPath || !projectPath) return;
    setBusy(true); setError("");
    try {
      const fileName = String(activeFile.fullPath).split("/").pop().replace(/\.model\.ya?ml$/i, "") || "model";
      const configured = projectConfig?.ddlDialects?.[dialect] || `ddl/${dialect}`;
      const folder = String(configured).replace(/^\/+|\/+$/g, "");
      const outPath = `${String(projectPath).replace(/\/+$/, "")}/${folder}/${fileName}.sql`;
      await saveFileContent(outPath, `${sql}\n`);
      setSavedPath(outPath);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
      <div className="bg-bg-secondary border border-border-primary rounded-xl shadow-2xl w-[720px] max-w-[92vw] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Download size={16} className="text-accent-blue" />
            Export DDL
          </h3>
          <button onClick={closeModal} className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-auto">
          <div className="flex items-center gap-3">
            <label className="text-xs text-text-muted font-medium">Dialect</label>
            <select value={dialect} onChange={(e) => setDialect(e.target.value)}
                    className="bg-bg-primary border border-border-primary rounded-md px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue">
              {DIALECTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <div className="flex-1 text-xs text-text-muted font-mono truncate">
              {activeFile?.fullPath || "— no file —"}
            </div>
            <button onClick={run} disabled={busy || !activeFile}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white hover:bg-accent-blue/80 transition-colors disabled:opacity-50">
              {busy ? <RefreshCw size={11} className="animate-spin" /> : <Download size={11} />}
              Generate
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-status-error bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <AlertCircle size={12} /> {error}
            </div>
          )}

          {sql && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted font-medium">Output ({sql.split("\n").length} lines)</span>
                <div className="flex-1" />
                <button onClick={copy} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-muted hover:text-text-primary border border-border-primary">
                  {copied ? <Check size={10} /> : <Copy size={10} />} {copied ? "Copied" : "Copy"}
                </button>
                <button onClick={saveToDisk} disabled={busy}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-bg-hover text-text-primary border border-border-primary hover:bg-bg-primary disabled:opacity-50">
                  <Download size={10} /> Save to disk
                </button>
              </div>
              <pre className="text-[11px] bg-bg-primary border border-border-primary rounded-md p-3 overflow-auto font-mono text-text-primary" style={{ maxHeight: 380 }}>
                {sql}
              </pre>
              {savedPath && (
                <div className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                  Saved to <code className="font-mono">{savedPath}</code>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
