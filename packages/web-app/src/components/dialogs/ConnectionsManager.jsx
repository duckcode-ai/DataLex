import React, { useEffect, useState } from "react";
import { X, Plug, RefreshCw, ArrowRight, AlertCircle, Zap, Trash2, CheckCircle2, XCircle, Pencil } from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import { fetchConnections, deleteConnection, testConnection } from "../../lib/api";
import ConnectorLogo from "../icons/ConnectorLogo";

const DIALECT_ORDER = [
  "postgres",
  "mysql",
  "snowflake",
  "bigquery",
  "databricks",
  "sqlserver",
  "azure_sql",
  "azure_fabric",
  "redshift",
  "duckdb",
  "dbt_repo",
];

const DIALECT_LABEL = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  snowflake: "Snowflake",
  bigquery: "BigQuery",
  databricks: "Databricks",
  sqlserver: "SQL Server",
  azure_sql: "Azure SQL",
  azure_fabric: "Azure Fabric",
  redshift: "Redshift",
  duckdb: "DuckDB",
  dbt_repo: "dbt",
};

export default function ConnectionsManager() {
  const { closeModal, setActiveActivity, setPendingConnectorType, addToast } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [testState, setTestState] = useState({}); // { [id]: { status: "idle"|"running"|"ok"|"fail", message } }
  const [busy, setBusy] = useState({}); // { [id]: true } for delete

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const list = await fetchConnections();
      setConnections(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err?.message || "Failed to load connections.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const grouped = groupByDialect(connections);

  const openInConnect = (dialect) => {
    if (dialect) setPendingConnectorType(dialect);
    setActiveActivity("connect");
    closeModal();
    addToast?.({ type: "info", message: `Opening ${DIALECT_LABEL[dialect] || dialect} in Connect view.` });
  };

  const handleTest = async (conn) => {
    const id = conn.id || conn.fingerprint;
    setTestState((s) => ({ ...s, [id]: { status: "running" } }));
    try {
      const payload = {
        connector: conn.connector,
        connection_id: conn.id,
        connection_name: conn.name,
        ...(conn.details || {}),
        ...(conn.secrets || {}),
      };
      const result = await testConnection(payload);
      if (result?.ok) {
        setTestState((s) => ({ ...s, [id]: { status: "ok", message: result.message || "Connected" } }));
        addToast?.({ type: "success", message: `${conn.name}: connection OK` });
      } else {
        setTestState((s) => ({ ...s, [id]: { status: "fail", message: result?.message || "Test failed" } }));
        addToast?.({ type: "error", message: `${conn.name}: ${result?.message || "test failed"}` });
      }
    } catch (err) {
      setTestState((s) => ({ ...s, [id]: { status: "fail", message: err.message } }));
      addToast?.({ type: "error", message: err.message });
    }
  };

  const handleDelete = async (conn) => {
    const name = conn.name || conn.id;
    if (!window.confirm(`Delete connection "${name}"? This can't be undone.`)) return;
    const id = conn.id || conn.fingerprint;
    setBusy((s) => ({ ...s, [id]: true }));
    try {
      await deleteConnection(id);
      setConnections((prev) => prev.filter((c) => (c.id || c.fingerprint) !== id));
      addToast?.({ type: "success", message: `Deleted ${name}` });
    } catch (err) {
      addToast?.({ type: "error", message: err.message });
    } finally {
      setBusy((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
    }
  };

  const handleEdit = (conn) => {
    if (conn.connector) setPendingConnectorType(conn.connector);
    setActiveActivity("connect");
    closeModal();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={closeModal}
    >
      <div
        className="w-[760px] max-w-[94vw] h-[560px] max-h-[90vh] rounded-xl border border-border-primary bg-bg-surface shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 h-12 border-b border-border-primary bg-bg-secondary shrink-0">
          <div className="flex items-center gap-2">
            <Plug size={16} className="text-text-secondary" />
            <h2 className="t-subtitle text-text-primary">Connections</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={load}
              disabled={loading}
              className="dl-toolbar-btn dl-toolbar-btn--ghost-icon"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={closeModal}
              className="dl-toolbar-btn dl-toolbar-btn--ghost-icon"
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-md border border-accent-red/30 bg-accent-red-soft text-accent-red">
              <AlertCircle size={14} />
              <span className="text-xs">{error}</span>
            </div>
          )}

          {loading && !connections.length && (
            <div className="flex items-center justify-center py-10 text-text-muted">
              <RefreshCw size={16} className="animate-spin mr-2" />
              <span className="text-sm">Loading connections…</span>
            </div>
          )}

          {!loading && !connections.length && !error && (
            <EmptyState onOpenConnect={() => openInConnect(null)} />
          )}

          {grouped.map(({ dialect, items }) => (
            <DialectSection
              key={dialect}
              dialect={dialect}
              items={items}
              canEdit={canEdit}
              testState={testState}
              busy={busy}
              onTest={handleTest}
              onDelete={handleDelete}
              onEdit={handleEdit}
              onManage={() => openInConnect(dialect)}
            />
          ))}
        </div>

        <div className="flex items-center justify-between px-4 h-12 border-t border-border-primary bg-bg-secondary shrink-0">
          <span className="t-caption text-text-muted">
            {connections.length} {connections.length === 1 ? "connection" : "connections"}
          </span>
          <button
            onClick={() => openInConnect(null)}
            className="dl-toolbar-btn dl-toolbar-btn--primary"
            disabled={!canEdit}
          >
            Add connection
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DialectSection({ dialect, items, canEdit, testState, busy, onTest, onDelete, onEdit, onManage }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center gap-2 px-1 py-1.5">
        <ConnectorLogo type={dialect} size={14} />
        <span className="t-label text-text-primary">{DIALECT_LABEL[dialect] || dialect}</span>
        <span className="t-caption text-text-muted">{items.length}</span>
        <button
          onClick={onManage}
          className="ml-auto text-xs text-accent-blue hover:underline"
        >
          Add new →
        </button>
      </div>
      <div className="rounded-lg border border-border-primary overflow-hidden">
        {items.map((conn) => (
          <ConnectionRow
            key={conn.id || conn.fingerprint}
            conn={conn}
            canEdit={canEdit}
            testStatus={testState[conn.id || conn.fingerprint]}
            isBusy={!!busy[conn.id || conn.fingerprint]}
            onTest={() => onTest(conn)}
            onDelete={() => onDelete(conn)}
            onEdit={() => onEdit(conn)}
          />
        ))}
      </div>
    </div>
  );
}

function ConnectionRow({ conn, canEdit, testStatus, isBusy, onTest, onDelete, onEdit }) {
  const name = conn.name || conn.connection_name || conn.fingerprint || "Connection";
  const updatedAt = conn.updatedAt || conn.lastConnectedAt || conn.createdAt || "";
  const details = conn.details || conn.params || {};
  const host = details.host || details.account || details.project || details.catalog || details.database || "";
  const importCount = Array.isArray(conn.imports) ? conn.imports.length : 0;
  const status = testStatus?.status;

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-border-primary/60 last:border-b-0 hover:bg-bg-hover transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="t-label text-text-primary truncate">{name}</span>
          {host && <span className="t-caption text-text-muted truncate">· {host}</span>}
          {status === "ok" && (
            <span className="flex items-center gap-1 text-accent-green text-[11px]">
              <CheckCircle2 size={11} /> OK
            </span>
          )}
          {status === "fail" && (
            <span
              className="flex items-center gap-1 text-status-error text-[11px]"
              title={testStatus?.message}
            >
              <XCircle size={11} /> Failed
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {updatedAt && (
            <span className="t-caption text-text-muted">
              Updated {formatDate(updatedAt)}
            </span>
          )}
          {importCount > 0 && (
            <span className="t-caption text-text-muted">
              {importCount} {importCount === 1 ? "import" : "imports"}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onTest}
          disabled={status === "running"}
          className="dl-toolbar-btn dl-toolbar-btn--ghost-icon"
          title="Test connection"
        >
          {status === "running" ? (
            <RefreshCw size={13} className="animate-spin" />
          ) : (
            <Zap size={13} />
          )}
        </button>
        {canEdit && (
          <>
            <button
              onClick={onEdit}
              className="dl-toolbar-btn dl-toolbar-btn--ghost-icon"
              title="Edit in Connect view"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={onDelete}
              disabled={isBusy}
              className="p-1.5 rounded hover:bg-status-error/10 text-text-muted hover:text-status-error transition-colors disabled:opacity-40"
              title="Delete connection"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onOpenConnect }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10">
      <Plug size={28} className="text-text-muted mb-3" />
      <p className="t-label text-text-secondary">No connections yet</p>
      <p className="t-caption text-text-muted mt-1 max-w-[320px]">
        Connect to Postgres, Snowflake, BigQuery, Databricks, or other warehouses
        to import schemas into DataLex.
      </p>
      <button
        onClick={onOpenConnect}
        className="dl-toolbar-btn dl-toolbar-btn--primary mt-4"
      >
        Add your first connection
        <ArrowRight size={14} />
      </button>
    </div>
  );
}

function groupByDialect(connections) {
  const buckets = new Map();
  for (const conn of connections || []) {
    const dialect = String(conn?.connector || "unknown").toLowerCase();
    if (!buckets.has(dialect)) buckets.set(dialect, []);
    buckets.get(dialect).push(conn);
  }
  const ordered = [];
  const seen = new Set();
  for (const d of DIALECT_ORDER) {
    if (buckets.has(d)) {
      ordered.push({ dialect: d, items: buckets.get(d) });
      seen.add(d);
    }
  }
  for (const [d, items] of buckets.entries()) {
    if (!seen.has(d)) ordered.push({ dialect: d, items });
  }
  return ordered;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}
