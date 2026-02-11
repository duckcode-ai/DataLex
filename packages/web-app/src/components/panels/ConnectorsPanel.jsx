import React, { useState, useEffect, useCallback } from "react";
import {
  Database,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Plug,
  Eye,
  EyeOff,
  Download,
  ChevronRight,
  ChevronLeft,
  Table2,
  Layers,
  Check,
  Square,
  CheckSquare,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";

const API = "http://localhost:3001";

const CONNECTOR_FIELDS = {
  postgres: [
    { key: "host", label: "Host", placeholder: "localhost", required: true },
    { key: "port", label: "Port", placeholder: "5432", type: "number" },
    { key: "database", label: "Database", placeholder: "mydb", required: true },
    { key: "user", label: "User", placeholder: "postgres", required: true },
    { key: "password", label: "Password", placeholder: "••••••••", secret: true },
  ],
  mysql: [
    { key: "host", label: "Host", placeholder: "localhost", required: true },
    { key: "port", label: "Port", placeholder: "3306", type: "number" },
    { key: "database", label: "Database", placeholder: "mydb", required: true },
    { key: "user", label: "User", placeholder: "root", required: true },
    { key: "password", label: "Password", placeholder: "••••••••", secret: true },
  ],
  snowflake: [
    { key: "host", label: "Account", placeholder: "acct.snowflakecomputing.com", required: true },
    { key: "user", label: "User", placeholder: "MY_USER", required: true },
    { key: "password", label: "Password", placeholder: "••••••••", secret: true },
    { key: "database", label: "Database", placeholder: "MY_DB", required: true },
    { key: "warehouse", label: "Warehouse", placeholder: "COMPUTE_WH" },
  ],
  bigquery: [
    { key: "project", label: "Project ID", placeholder: "my-gcp-project", required: true },
  ],
  databricks: [
    { key: "host", label: "Server Hostname", placeholder: "adb-xxx.azuredatabricks.net", required: true },
    { key: "port", label: "Port", placeholder: "443", type: "number" },
    { key: "token", label: "Access Token", placeholder: "dapi...", secret: true, required: true },
    { key: "catalog", label: "Catalog", placeholder: "main" },
  ],
};

const CONNECTOR_META = {
  postgres: { name: "PostgreSQL", color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", accent: "bg-blue-500" },
  mysql: { name: "MySQL", color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200", accent: "bg-orange-500" },
  snowflake: { name: "Snowflake", color: "text-cyan-600", bg: "bg-cyan-50", border: "border-cyan-200", accent: "bg-cyan-500" },
  bigquery: { name: "BigQuery", color: "text-green-600", bg: "bg-green-50", border: "border-green-200", accent: "bg-green-500" },
  databricks: { name: "Databricks", color: "text-red-600", bg: "bg-red-50", border: "border-red-200", accent: "bg-red-500" },
};

const STEPS = [
  { id: "connect", label: "Connect", icon: Plug },
  { id: "schemas", label: "Schemas", icon: Layers },
  { id: "tables", label: "Tables", icon: Table2 },
  { id: "pull", label: "Pull", icon: Download },
];

async function apiPost(path, body) {
  const resp = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
  return data;
}

export default function ConnectorsPanel() {
  const [connectors, setConnectors] = useState(null);
  const [selectedConnector, setSelectedConnector] = useState(null);
  const [step, setStep] = useState(0);
  const [formValues, setFormValues] = useState({});
  const [showSecrets, setShowSecrets] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Step 1: connection test
  const [connected, setConnected] = useState(false);

  // Step 2: schemas
  const [schemas, setSchemas] = useState([]);
  const [selectedSchema, setSelectedSchema] = useState(null);

  // Step 3: tables
  const [tables, setTables] = useState([]);
  const [selectedTables, setSelectedTables] = useState(new Set());

  // Step 4: pull result
  const [pullResult, setPullResult] = useState(null);

  const { loadImportedYaml } = useWorkspaceStore();
  const { addToast, setBottomPanelTab } = useUiStore();

  // Fetch connector list
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${API}/api/connectors`);
        if (resp.ok) setConnectors(await resp.json());
        else setConnectors(Object.keys(CONNECTOR_META).map((t) => ({ type: t, name: CONNECTOR_META[t].name, installed: false, status: "API server not running" })));
      } catch (_) {
        setConnectors(Object.keys(CONNECTOR_META).map((t) => ({ type: t, name: CONNECTOR_META[t].name, installed: false, status: "API server not running" })));
      }
    })();
  }, []);

  const resetWizard = () => {
    setStep(0);
    setConnected(false);
    setSchemas([]);
    setSelectedSchema(null);
    setTables([]);
    setSelectedTables(new Set());
    setPullResult(null);
    setError(null);
  };

  const selectConnector = (type) => {
    setSelectedConnector(type);
    setFormValues({});
    setShowSecrets({});
    resetWizard();
  };

  const handleFieldChange = (key, value) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    if (connected) { setConnected(false); setStep(0); }
    setError(null);
  };

  // Step 1: Test connection
  const handleTestConnection = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await apiPost("/api/connectors/test", { connector: selectedConnector, ...formValues });
      if (data.ok) {
        setConnected(true);
        // Auto-advance: fetch schemas
        setStep(1);
        await fetchSchemas();
      } else {
        setError(data.message || "Connection failed");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Fetch schemas
  const fetchSchemas = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiPost("/api/connectors/schemas", { connector: selectedConnector, ...formValues });
      setSchemas(data);
      if (data.length === 1) {
        setSelectedSchema(data[0].name);
      }
    } catch (err) {
      setError(err.message);
      setSchemas([]);
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Fetch tables for selected schema
  const fetchTables = async (schemaName) => {
    setLoading(true);
    setError(null);
    setSelectedSchema(schemaName);
    try {
      const params = { connector: selectedConnector, ...formValues, db_schema: schemaName };
      if (selectedConnector === "bigquery") params.dataset = schemaName;
      const data = await apiPost("/api/connectors/tables", params);
      setTables(data);
      setSelectedTables(new Set(data.map((t) => t.name)));
      setStep(2);
    } catch (err) {
      setError(err.message);
      setTables([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleTable = (name) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAllTables = () => {
    if (selectedTables.size === tables.length) setSelectedTables(new Set());
    else setSelectedTables(new Set(tables.map((t) => t.name)));
  };

  // Step 4: Pull
  const handlePull = async () => {
    setLoading(true);
    setError(null);
    setPullResult(null);
    try {
      const params = {
        connector: selectedConnector,
        ...formValues,
        db_schema: selectedSchema,
        model_name: formValues.model_name || selectedSchema || "imported_model",
        tables: [...selectedTables].join(","),
      };
      if (selectedConnector === "bigquery") params.dataset = selectedSchema;
      const data = await apiPost("/api/connectors/pull", params);
      if (data.success) {
        setPullResult(data);
        setStep(3);
        if (data.yaml) {
          loadImportedYaml(params.model_name, data.yaml);
          addToast?.({ message: `Pulled ${data.entityCount || 0} tables from ${CONNECTOR_META[selectedConnector]?.name} / ${selectedSchema}`, type: "success" });
        }
      } else {
        setError(data.error || "Pull failed");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fields = selectedConnector ? (CONNECTOR_FIELDS[selectedConnector] || []) : [];
  const meta = selectedConnector ? CONNECTOR_META[selectedConnector] : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border-primary bg-bg-secondary/50 shrink-0">
        <Database size={12} className="text-accent-blue" />
        <span className="text-xs font-semibold text-text-primary">Database Connectors</span>
        {selectedConnector && meta && (
          <span className={`text-[10px] font-semibold ${meta.color}`}>{meta.name}</span>
        )}
        {/* Step indicator */}
        {selectedConnector && (
          <div className="flex items-center gap-0.5 ml-auto mr-1">
            {STEPS.map((s, i) => {
              const StepIcon = s.icon;
              const isActive = i === step;
              const isDone = i < step;
              return (
                <div key={s.id} className="flex items-center gap-0.5">
                  {i > 0 && <div className={`w-3 h-px ${isDone ? "bg-green-400" : "bg-border-primary"}`} />}
                  <div
                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${
                      isActive ? `${meta.bg} ${meta.color} ${meta.border} border` :
                      isDone ? "bg-green-50 text-green-600 border border-green-200" :
                      "text-text-muted"
                    }`}
                  >
                    {isDone ? <Check size={8} /> : <StepIcon size={8} />}
                    {s.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Connector selector */}
        <div>
          <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1.5">Select Database</div>
          <div className="grid grid-cols-5 gap-1.5">
            {Object.entries(CONNECTOR_META).map(([type, cm]) => {
              const isSelected = selectedConnector === type;
              const connInfo = connectors?.find((c) => c.type === type);
              const isInstalled = connInfo?.installed;
              return (
                <button key={type} onClick={() => selectConnector(type)}
                  className={`flex flex-col items-center gap-1 px-2 py-2 rounded-md border text-center transition-colors text-[10px] ${
                    isSelected ? `${cm.border} ${cm.bg} ${cm.color}` : "border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover"
                  }`}>
                  <Database size={14} className="shrink-0" />
                  <div className="font-semibold leading-tight">{cm.name}</div>
                  {connInfo && (
                    <div className={`text-[8px] ${isInstalled ? "text-green-600" : "text-amber-500"}`}>
                      {isInstalled ? "ready" : "no driver"}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 0: Connection form */}
        {selectedConnector && step === 0 && (
          <div className={`rounded-lg border ${meta.border} ${meta.bg} p-3 space-y-2`}>
            <div className={`text-xs font-semibold ${meta.color} flex items-center gap-1.5`}>
              <Plug size={12} />
              {meta.name} Connection
            </div>
            <div className="grid grid-cols-3 gap-2">
              {fields.map((f) => (
                <div key={f.key}>
                  <label className="text-[10px] text-text-muted font-medium block mb-0.5">
                    {f.label} {f.required && <span className="text-red-400">*</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={f.secret && !showSecrets[f.key] ? "password" : (f.type || "text")}
                      value={formValues[f.key] || ""}
                      onChange={(e) => handleFieldChange(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      className="w-full px-2 py-1 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent-blue"
                    />
                    {f.secret && (
                      <button onClick={() => setShowSecrets((p) => ({ ...p, [f.key]: !p[f.key] }))}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                        {showSecrets[f.key] ? <EyeOff size={10} /> : <Eye size={10} />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={handleTestConnection} disabled={loading}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold rounded-md text-white ${meta.accent} hover:opacity-90 transition-colors disabled:opacity-50`}>
                {loading ? <Loader2 size={11} className="animate-spin" /> : <Plug size={11} />}
                Connect & Browse Schemas
                <ChevronRight size={11} />
              </button>
            </div>
          </div>
        )}

        {/* Step 1: Schema browser */}
        {selectedConnector && step === 1 && (
          <div className={`rounded-lg border ${meta.border} ${meta.bg} p-3 space-y-2`}>
            <div className="flex items-center justify-between">
              <div className={`text-xs font-semibold ${meta.color} flex items-center gap-1.5`}>
                <Layers size={12} />
                Select Schema
                <span className="text-[10px] font-normal text-text-muted">({schemas.length} found)</span>
              </div>
              <button onClick={() => { setStep(0); setConnected(false); }}
                className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary">
                <ChevronLeft size={10} /> Back
              </button>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={16} className="animate-spin text-text-muted" />
                <span className="ml-2 text-[11px] text-text-muted">Loading schemas...</span>
              </div>
            ) : schemas.length === 0 ? (
              <div className="text-[11px] text-text-muted text-center py-3">No schemas found.</div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 max-h-40 overflow-y-auto">
                {schemas.map((s) => (
                  <button key={s.name} onClick={() => fetchTables(s.name)}
                    className={`flex items-center justify-between px-2.5 py-2 rounded-md border text-left transition-colors text-[11px] ${
                      selectedSchema === s.name
                        ? `${meta.border} ${meta.bg} ${meta.color} font-semibold`
                        : "border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover"
                    }`}>
                    <div className="flex items-center gap-1.5">
                      <Layers size={11} className="shrink-0" />
                      <span className="truncate">{s.name}</span>
                    </div>
                    <span className="text-[9px] text-text-muted shrink-0 ml-1">{s.table_count} tbl</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Table browser with checkboxes */}
        {selectedConnector && step === 2 && (
          <div className={`rounded-lg border ${meta.border} ${meta.bg} p-3 space-y-2`}>
            <div className="flex items-center justify-between">
              <div className={`text-xs font-semibold ${meta.color} flex items-center gap-1.5`}>
                <Table2 size={12} />
                {selectedSchema}
                <span className="text-[10px] font-normal text-text-muted">
                  ({selectedTables.size}/{tables.length} selected)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setStep(1)}
                  className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary">
                  <ChevronLeft size={10} /> Schemas
                </button>
              </div>
            </div>

            {/* Select all / none */}
            <div className="flex items-center gap-2 pb-1 border-b border-border-primary/50">
              <button onClick={toggleAllTables}
                className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary">
                {selectedTables.size === tables.length ? <CheckSquare size={11} /> : <Square size={11} />}
                {selectedTables.size === tables.length ? "Deselect all" : "Select all"}
              </button>
              <div className="ml-auto">
                <label className="text-[10px] text-text-muted font-medium mr-1">Model name:</label>
                <input type="text" value={formValues.model_name || ""}
                  onChange={(e) => setFormValues((p) => ({ ...p, model_name: e.target.value }))}
                  placeholder={selectedSchema || "imported_model"}
                  className="px-2 py-0.5 text-[10px] rounded border border-border-primary bg-bg-primary text-text-primary w-36 focus:outline-none focus:border-accent-blue"
                />
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={16} className="animate-spin text-text-muted" />
                <span className="ml-2 text-[11px] text-text-muted">Loading tables...</span>
              </div>
            ) : (
              <div className="max-h-44 overflow-y-auto space-y-0.5">
                {tables.map((t) => {
                  const checked = selectedTables.has(t.name);
                  return (
                    <button key={t.name} onClick={() => toggleTable(t.name)}
                      className={`flex items-center gap-2 w-full px-2 py-1 rounded text-[11px] text-left transition-colors ${
                        checked ? "bg-white/60" : "opacity-50 hover:opacity-80"
                      }`}>
                      {checked ? <CheckSquare size={11} className={meta.color} /> : <Square size={11} className="text-text-muted" />}
                      <Table2 size={10} className="text-text-muted shrink-0" />
                      <span className="flex-1 truncate font-medium">{t.name}</span>
                      <span className="text-[9px] text-text-muted">{t.type}</span>
                      <span className="text-[9px] text-text-muted w-12 text-right">{t.column_count} cols</span>
                      {t.row_count != null && (
                        <span className="text-[9px] text-text-muted w-16 text-right">{Number(t.row_count).toLocaleString()} rows</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Pull button */}
            <div className="flex items-center gap-2 pt-1">
              <button onClick={handlePull} disabled={loading || selectedTables.size === 0}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold rounded-md text-white ${meta.accent} hover:opacity-90 transition-colors disabled:opacity-50`}>
                {loading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                Pull {selectedTables.size} Table{selectedTables.size !== 1 ? "s" : ""} into Model
                <ChevronRight size={11} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Pull result */}
        {selectedConnector && step === 3 && pullResult && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
              <CheckCircle2 size={12} />
              Schema Pulled Successfully
            </div>
            <div className="text-[11px] text-green-800 grid grid-cols-4 gap-2">
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{pullResult.entityCount || 0}</div>
                <div className="text-[9px] text-green-600">Tables</div>
              </div>
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{pullResult.fieldCount || 0}</div>
                <div className="text-[9px] text-green-600">Columns</div>
              </div>
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{pullResult.relationshipCount || 0}</div>
                <div className="text-[9px] text-green-600">Relationships</div>
              </div>
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{pullResult.indexCount || 0}</div>
                <div className="text-[9px] text-green-600">Indexes</div>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => setBottomPanelTab("properties")}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-md text-white bg-green-500 hover:bg-green-600 transition-colors">
                <CheckCircle2 size={11} /> View Model
              </button>
              <button onClick={() => { setStep(2); setPullResult(null); }}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-md border border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover transition-colors">
                <ChevronLeft size={11} /> Back to Tables
              </button>
              <button onClick={() => { resetWizard(); }}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-md border border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover transition-colors">
                <RefreshCw size={11} /> Pull Another Schema
              </button>
            </div>
            {pullResult.yaml && (
              <details className="mt-1">
                <summary className="text-[10px] text-green-600 cursor-pointer hover:underline">View generated YAML</summary>
                <pre className="mt-1 p-2 bg-white rounded border border-green-200 text-[10px] font-mono text-text-primary overflow-x-auto max-h-48 overflow-y-auto">
                  {pullResult.yaml}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
            <AlertCircle size={12} className="text-red-500 mt-0.5 shrink-0" />
            <div className="text-[11px] text-red-700 flex-1">{error}</div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 shrink-0">
              <RefreshCw size={10} />
            </button>
          </div>
        )}

        {/* Help text */}
        {!selectedConnector && (
          <div className="text-[11px] text-text-muted p-3 text-center space-y-1">
            <p>Select a database above to browse schemas and pull tables into a DataLex model.</p>
            <p className="text-[10px]">
              Workflow: <strong>Connect</strong> → <strong>Browse Schemas</strong> → <strong>Select Tables</strong> → <strong>Pull Model</strong>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
