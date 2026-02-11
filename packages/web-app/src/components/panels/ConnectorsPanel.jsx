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

  // Step 2: schemas (multi-select)
  const [schemas, setSchemas] = useState([]);
  const [selectedSchemas, setSelectedSchemas] = useState(new Set());

  // Step 3: tables (per-schema preview before pull)
  const [previewSchema, setPreviewSchema] = useState(null);
  const [previewTables, setPreviewTables] = useState([]);
  const [schemaTableSelections, setSchemaTableSelections] = useState({});

  // Step 4: pull result
  const [pullResult, setPullResult] = useState(null);
  const [pullProgress, setPullProgress] = useState(null);

  const { loadImportedYaml, loadMultipleImportedYaml } = useWorkspaceStore();
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
    setSelectedSchemas(new Set());
    setPreviewSchema(null);
    setPreviewTables([]);
    setSchemaTableSelections({});
    setPullResult(null);
    setPullProgress(null);
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
      // Auto-select all schemas by default
      setSelectedSchemas(new Set(data.map((s) => s.name)));
    } catch (err) {
      setError(err.message);
      setSchemas([]);
    } finally {
      setLoading(false);
    }
  };

  // Schema multi-select helpers
  const toggleSchema = (name) => {
    setSelectedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAllSchemas = () => {
    if (selectedSchemas.size === schemas.length) setSelectedSchemas(new Set());
    else setSelectedSchemas(new Set(schemas.map((s) => s.name)));
  };

  // Step 3: Preview tables for a specific schema (optional drill-in)
  const fetchTablesPreview = async (schemaName) => {
    setLoading(true);
    setError(null);
    setPreviewSchema(schemaName);
    try {
      const params = { connector: selectedConnector, ...formValues, db_schema: schemaName };
      if (selectedConnector === "bigquery") params.dataset = schemaName;
      const data = await apiPost("/api/connectors/tables", params);
      setPreviewTables(data);
      // Initialize table selection for this schema (all selected by default)
      setSchemaTableSelections((prev) => ({
        ...prev,
        [schemaName]: prev[schemaName] || new Set(data.map((t) => t.name)),
      }));
    } catch (err) {
      setError(err.message);
      setPreviewTables([]);
    } finally {
      setLoading(false);
    }
  };

  const togglePreviewTable = (name) => {
    if (!previewSchema) return;
    setSchemaTableSelections((prev) => {
      const current = new Set(prev[previewSchema] || []);
      if (current.has(name)) current.delete(name);
      else current.add(name);
      return { ...prev, [previewSchema]: current };
    });
  };

  const toggleAllPreviewTables = () => {
    if (!previewSchema) return;
    const current = schemaTableSelections[previewSchema] || new Set();
    if (current.size === previewTables.length) {
      setSchemaTableSelections((prev) => ({ ...prev, [previewSchema]: new Set() }));
    } else {
      setSchemaTableSelections((prev) => ({ ...prev, [previewSchema]: new Set(previewTables.map((t) => t.name)) }));
    }
  };

  // Step 4: Pull — multi-schema mode
  const handlePull = async () => {
    const schemasToProcess = [...selectedSchemas];
    if (schemasToProcess.length === 0) return;

    setLoading(true);
    setError(null);
    setPullResult(null);
    setPullProgress({ current: 0, total: schemasToProcess.length, currentSchema: schemasToProcess[0] });

    try {
      if (schemasToProcess.length === 1) {
        // Single schema — use original endpoint for backward compat
        const schemaName = schemasToProcess[0];
        const tableSet = schemaTableSelections[schemaName];
        const params = {
          connector: selectedConnector,
          ...formValues,
          db_schema: schemaName,
          model_name: schemaName,
          tables: tableSet ? [...tableSet].join(",") : "",
        };
        if (selectedConnector === "bigquery") params.dataset = schemaName;
        const data = await apiPost("/api/connectors/pull", params);
        if (data.success && data.yaml) {
          loadImportedYaml(schemaName, data.yaml);
          setPullResult({
            schemasProcessed: 1,
            schemasFailed: 0,
            totalEntities: data.entityCount || 0,
            totalFields: data.fieldCount || 0,
            totalRelationships: data.relationshipCount || 0,
            results: [{ schema: schemaName, success: true, ...data }],
            errors: [],
          });
          addToast?.({ message: `Pulled ${data.entityCount || 0} tables from ${CONNECTOR_META[selectedConnector]?.name} / ${schemaName}`, type: "success" });
        } else {
          setError(data.error || "Pull failed");
        }
      } else {
        // Multi-schema — use pull-multi endpoint
        const schemaEntries = schemasToProcess.map((name) => {
          const tableSet = schemaTableSelections[name];
          return tableSet && tableSet.size > 0 ? { name, tables: [...tableSet] } : name;
        });
        const data = await apiPost("/api/connectors/pull-multi", {
          connector: selectedConnector,
          ...formValues,
          schemas: schemaEntries,
        });

        // Load each successful schema as a separate model file
        const files = (data.results || []).filter((r) => r.success && r.yaml).map((r) => ({
          name: r.schema,
          yaml: r.yaml,
        }));
        if (files.length > 0) {
          loadMultipleImportedYaml(files);
          addToast?.({ message: `Pulled ${files.length} schemas (${data.totalEntities} tables) as separate model files`, type: "success" });
        }
        setPullResult(data);
        if (data.errors?.length > 0 && files.length === 0) {
          setError(`All ${data.errors.length} schema pulls failed`);
        }
      }
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setPullProgress(null);
    }
  };

  const fields = selectedConnector ? (CONNECTOR_FIELDS[selectedConnector] || []) : [];
  const meta = selectedConnector ? CONNECTOR_META[selectedConnector] : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Step indicator bar */}
      {selectedConnector && meta && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border-primary bg-bg-secondary/30 shrink-0">
          <span className={`text-[11px] font-semibold ${meta.color}`}>{meta.name}</span>
          <div className="flex items-center gap-0.5 ml-2">
            {STEPS.map((s, i) => {
              const StepIcon = s.icon;
              const isActive = i === step;
              const isDone = i < step;
              return (
                <div key={s.id} className="flex items-center gap-0.5">
                  {i > 0 && <div className={`w-4 h-px ${isDone ? "bg-green-400" : "bg-border-primary"}`} />}
                  <div
                    className={`flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-medium ${
                      isActive ? `${meta.bg} ${meta.color} ${meta.border} border` :
                      isDone ? "bg-green-50 text-green-600 border border-green-200" :
                      "text-text-muted"
                    }`}
                  >
                    {isDone ? <Check size={9} /> : <StepIcon size={9} />}
                    {s.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-3xl mx-auto space-y-4">
        {/* Connector selector */}
        <div>
          <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-2">Select Database</div>
          <div className="grid grid-cols-5 gap-2">
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

        {/* Step 1: Schema browser — multi-select */}
        {selectedConnector && step === 1 && (
          <div className={`rounded-lg border ${meta.border} ${meta.bg} p-3 space-y-2`}>
            <div className="flex items-center justify-between">
              <div className={`text-xs font-semibold ${meta.color} flex items-center gap-1.5`}>
                <Layers size={12} />
                Select Schemas
                <span className="text-[10px] font-normal text-text-muted">
                  ({selectedSchemas.size}/{schemas.length} selected — each becomes a separate model file)
                </span>
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
              <>
                {/* Select all / none */}
                <div className="flex items-center gap-2 pb-1 border-b border-border-primary/50">
                  <button onClick={toggleAllSchemas}
                    className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary">
                    {selectedSchemas.size === schemas.length ? <CheckSquare size={11} /> : <Square size={11} />}
                    {selectedSchemas.size === schemas.length ? "Deselect all" : "Select all"}
                  </button>
                  <span className="text-[9px] text-text-muted ml-auto">
                    {schemas.reduce((s, sc) => s + (sc.table_count || 0), 0)} total tables across {schemas.length} schemas
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto">
                  {schemas.map((s) => {
                    const checked = selectedSchemas.has(s.name);
                    return (
                      <div key={s.name} className="flex items-center gap-1">
                        <button onClick={() => toggleSchema(s.name)}
                          className={`flex items-center gap-2 flex-1 px-2.5 py-2 rounded-md border text-left transition-colors text-[11px] ${
                            checked
                              ? `${meta.border} bg-white/80 ${meta.color} font-semibold`
                              : "border-border-primary bg-bg-primary text-text-secondary opacity-60 hover:opacity-80"
                          }`}>
                          {checked ? <CheckSquare size={11} className={meta.color} /> : <Square size={11} className="text-text-muted" />}
                          <Layers size={10} className="shrink-0" />
                          <span className="truncate flex-1">{s.name}</span>
                          <span className="text-[9px] text-text-muted shrink-0">{s.table_count} tbl</span>
                        </button>
                        {checked && (
                          <button onClick={() => { fetchTablesPreview(s.name); setStep(2); }}
                            title="Preview & filter tables"
                            className="p-1.5 rounded border border-border-primary bg-bg-primary text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors">
                            <Eye size={10} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Pull button */}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={handlePull} disabled={loading || selectedSchemas.size === 0}
                    className={`flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold rounded-md text-white ${meta.accent} hover:opacity-90 transition-colors disabled:opacity-50`}>
                    {loading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                    Pull {selectedSchemas.size} Schema{selectedSchemas.size !== 1 ? "s" : ""} as Separate Models
                    <ChevronRight size={11} />
                  </button>
                  <span className="text-[9px] text-text-muted">
                    Creates {selectedSchemas.size} .model.yaml file{selectedSchemas.size !== 1 ? "s" : ""}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 2: Table preview for a specific schema */}
        {selectedConnector && step === 2 && previewSchema && (
          <div className={`rounded-lg border ${meta.border} ${meta.bg} p-3 space-y-2`}>
            <div className="flex items-center justify-between">
              <div className={`text-xs font-semibold ${meta.color} flex items-center gap-1.5`}>
                <Table2 size={12} />
                {previewSchema}
                <span className="text-[10px] font-normal text-text-muted">
                  ({(schemaTableSelections[previewSchema] || new Set()).size}/{previewTables.length} tables selected)
                </span>
              </div>
              <button onClick={() => { setStep(1); setPreviewSchema(null); }}
                className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary">
                <ChevronLeft size={10} /> Back to Schemas
              </button>
            </div>

            <div className="text-[10px] text-text-muted bg-white/50 rounded px-2 py-1 border border-border-primary/30">
              Filter tables for <strong>{previewSchema}</strong>. Uncheck tables you don't want to import. This schema will become <strong>{previewSchema}.model.yaml</strong>.
            </div>

            {/* Select all / none */}
            <div className="flex items-center gap-2 pb-1 border-b border-border-primary/50">
              <button onClick={toggleAllPreviewTables}
                className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary">
                {(schemaTableSelections[previewSchema] || new Set()).size === previewTables.length ? <CheckSquare size={11} /> : <Square size={11} />}
                {(schemaTableSelections[previewSchema] || new Set()).size === previewTables.length ? "Deselect all" : "Select all"}
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={16} className="animate-spin text-text-muted" />
                <span className="ml-2 text-[11px] text-text-muted">Loading tables...</span>
              </div>
            ) : (
              <div className="max-h-44 overflow-y-auto space-y-0.5">
                {previewTables.map((t) => {
                  const checked = (schemaTableSelections[previewSchema] || new Set()).has(t.name);
                  return (
                    <button key={t.name} onClick={() => togglePreviewTable(t.name)}
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

            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => { setStep(1); setPreviewSchema(null); }}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold rounded-md text-white ${meta.accent} hover:opacity-90 transition-colors`}>
                <Check size={11} /> Done — Back to Schemas
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Pull result — per-schema breakdown */}
        {selectedConnector && step === 3 && pullResult && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
              <CheckCircle2 size={12} />
              {pullResult.schemasProcessed === 1 ? "Schema Pulled Successfully" : `${pullResult.schemasProcessed} Schemas Pulled as Separate Model Files`}
              {pullResult.schemasFailed > 0 && (
                <span className="text-[10px] font-normal text-amber-600">({pullResult.schemasFailed} failed)</span>
              )}
            </div>

            {/* Totals */}
            <div className="text-[11px] text-green-800 grid grid-cols-4 gap-2">
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{pullResult.schemasProcessed || 0}</div>
                <div className="text-[9px] text-green-600">Model Files</div>
              </div>
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{pullResult.totalEntities || 0}</div>
                <div className="text-[9px] text-green-600">Tables</div>
              </div>
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{pullResult.totalFields || 0}</div>
                <div className="text-[9px] text-green-600">Columns</div>
              </div>
              <div className="text-center p-2 bg-white rounded border border-green-200">
                <div className="text-lg font-bold">{pullResult.totalRelationships || 0}</div>
                <div className="text-[9px] text-green-600">Relationships</div>
              </div>
            </div>

            {/* Per-schema breakdown */}
            {pullResult.results && pullResult.results.length > 1 && (
              <div className="space-y-1">
                <div className="text-[10px] text-green-700 font-semibold uppercase tracking-wider">Per-Schema Files</div>
                <div className="max-h-32 overflow-y-auto space-y-0.5">
                  {pullResult.results.map((r) => (
                    <div key={r.schema} className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] ${r.success ? "bg-white/60" : "bg-red-50"}`}>
                      {r.success ? <CheckCircle2 size={10} className="text-green-500 shrink-0" /> : <AlertCircle size={10} className="text-red-500 shrink-0" />}
                      <span className="font-semibold truncate flex-1">{r.schema}.model.yaml</span>
                      {r.success ? (
                        <>
                          <span className="text-[9px] text-text-muted">{r.entityCount} tbl</span>
                          <span className="text-[9px] text-text-muted">{r.fieldCount} col</span>
                          <span className="text-[9px] text-text-muted">{r.relationshipCount} rel</span>
                        </>
                      ) : (
                        <span className="text-[9px] text-red-500 truncate">{r.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => setBottomPanelTab("properties")}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-md text-white bg-green-500 hover:bg-green-600 transition-colors">
                <CheckCircle2 size={11} /> View Model
              </button>
              <button onClick={() => { resetWizard(); }}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-md border border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover transition-colors">
                <RefreshCw size={11} /> Pull Another Database
              </button>
            </div>

            {/* YAML preview for single-schema pulls */}
            {pullResult.results?.length === 1 && pullResult.results[0]?.yaml && (
              <details className="mt-1">
                <summary className="text-[10px] text-green-600 cursor-pointer hover:underline">View generated YAML</summary>
                <pre className="mt-1 p-2 bg-white rounded border border-green-200 text-[10px] font-mono text-text-primary overflow-x-auto max-h-48 overflow-y-auto">
                  {pullResult.results[0].yaml}
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
        </div>{/* end max-w-3xl */}
      </div>
    </div>
  );
}
