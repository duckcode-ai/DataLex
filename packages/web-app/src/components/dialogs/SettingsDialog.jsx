/* SettingsDialog — deliberately just two things: the AI provider and the
   database connection. Everything else (themes, shortcuts, tour, about)
   was removed so setup is obvious. Both panes test in place and auto-save:
   AI defaults persist to the browser as you type; a warehouse connection
   saves when its test passes (the api-server persists on a passing test).

   Theme switching lives in the top-bar theme menu; density in the status
   bar — neither needs a settings page. */
import React from "react";
import {
  Bot, KeyRound, Check, Plug, Database, Loader2, CircleCheck,
  CircleAlert, RefreshCw, Sparkles,
} from "lucide-react";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import { emitJourneyEvent } from "../../lib/onboardingJourney";
import { testAiSettings, testConnector, fetchConnections } from "../../lib/api";
import Modal from "./Modal";
import SkillsManager from "./SkillsManager";

/* Broadcast so any open page (Home, the enterprise workbench) re-reads AI
   readiness the moment a provider is connected — no manual refresh. */
function announceAiChanged() {
  try { window.dispatchEvent(new CustomEvent("datalex:ai-changed")); } catch { /* ignore */ }
}

const TABS = [
  { id: "ai",          label: "AI provider",        icon: Bot },
  { id: "connections", label: "Database connection", icon: Database },
  { id: "skills",      label: "Agent skills",       icon: Sparkles },
];

export default function SettingsDialog() {
  const { closeModal, modalPayload } = useUiStore();
  const [active, setActive] = React.useState(
    ["ai", "connections", "skills"].includes(modalPayload?.initialTab) ? modalPayload.initialTab : "ai"
  );

  return (
    <Modal
      title="Settings"
      subtitle="Connect your AI provider and your database. That's all you need."
      size="xl"
      onClose={closeModal}
      bodyClassName="pad-0"
      cardClassName="dlx-settings-card"
      footer={
        <button type="button" className="panel-btn primary" onClick={closeModal}>
          Done
        </button>
      }
    >
      <div className="dlx-settings-grid">
        <nav className="dlx-settings-nav" role="tablist" aria-label="Settings sections">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={active === id}
              className={`dlx-settings-nav-item ${active === id ? "active" : ""}`}
              onClick={() => setActive(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>
        <div className="dlx-settings-content">
          {active === "ai"          && <AiProviderPane />}
          {active === "connections" && <ConnectionPane />}
          {active === "skills"      && <SkillsManager />}
        </div>
      </div>
    </Modal>
  );
}

/* ─────────────────────────── helpers ─────────────────────────── */
function readStorage(key, fallback = "") {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function writeStorage(key, value) {
  try {
    if (value == null || value === "") localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode */ }
}

/* ─────────────────────────── AI provider ─────────────────────────── */
const AI_PROVIDERS = [
  { id: "local",     label: "Local search only", needsKey: false, hint: "No external calls — keyword search over your model." },
  { id: "openai",    label: "OpenAI",            needsKey: true,  hint: "Set OPENAI_API_KEY or paste a key below." },
  { id: "anthropic", label: "Anthropic Claude",  needsKey: true,  hint: "Set ANTHROPIC_API_KEY or paste a key below." },
  { id: "gemini",    label: "Google Gemini",     needsKey: true,  hint: "Set GEMINI_API_KEY or paste a key below." },
  { id: "ollama",    label: "Ollama (local LLM)", needsKey: false, hint: "Runs against a local Ollama server; set the base URL." },
];

function AiProviderPane() {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const [provider, setProvider] = React.useState(() => readStorage("datalex.ai.provider", "local"));
  const [model, setModel] = React.useState(() => readStorage("datalex.ai.model", ""));
  const [baseUrl, setBaseUrl] = React.useState(() => readStorage("datalex.ai.baseUrl", ""));
  const [apiKey, setApiKey] = React.useState(() => readStorage("datalex.ai.apiKey", ""));
  const [saveKey, setSaveKey] = React.useState(() => Boolean(readStorage("datalex.ai.apiKey", "")));
  const [test, setTest] = React.useState(null); // {ok, message}
  const [busy, setBusy] = React.useState(false);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const mounted = React.useRef(false);

  const meta = AI_PROVIDERS.find((p) => p.id === provider) || AI_PROVIDERS[0];

  // Auto-save on every change — no save button. Skip the very first run so
  // we don't flash "Saved" before the user touches anything.
  React.useEffect(() => {
    writeStorage("datalex.ai.provider", provider);
    writeStorage("datalex.ai.model", model);
    writeStorage("datalex.ai.baseUrl", baseUrl);
    writeStorage("datalex.ai.apiKey", saveKey ? apiKey : "");
    if (!mounted.current) { mounted.current = true; return; }
    const configured = (saveKey && apiKey.trim()) || provider === "local" || provider === "ollama";
    if (configured) emitJourneyEvent("ai:settings:saved", { provider });
    setSavedFlash(true);
    const t = setTimeout(() => setSavedFlash(false), 1400);
    return () => clearTimeout(t);
  }, [provider, model, baseUrl, apiKey, saveKey]);

  // Test == connect. Passing the projectId is what makes the api-server
  // persist the provider config AND mark testStatus=passed, which is what
  // every page reads for "AI ready". Without it the test would pass but
  // the pages would keep showing "Set up AI".
  const runTest = async () => {
    setBusy(true); setTest(null);
    try {
      const payload = {
        provider, enabled: true,
        model: model || undefined,
        baseUrl: baseUrl || undefined,
        apiKey: apiKey || undefined,
      };
      if (activeProjectId) payload.projectId = activeProjectId;
      const res = await testAiSettings(payload);
      const ready = res?.generation?.ready;
      const ok = !!res?.ok;
      setTest({
        ok,
        message: ok
          ? (provider === "local"
              ? "Local search ready. Add a provider for AI generation."
              : ready
                ? "Connected — AI is ready across DataLex."
                : `Provider ready: ${res.provider || provider}`)
          : (res?.message || "Test returned no status."),
      });
      if (ok) {
        if ((saveKey && apiKey.trim()) || provider !== "local") emitJourneyEvent("ai:settings:saved", { provider });
        announceAiChanged();
      }
    } catch (err) {
      setTest({ ok: false, message: err?.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dlx-settings-pane">
      <header>
        <h3 className="dlx-settings-pane-title">AI provider</h3>
        <p className="dlx-settings-pane-sub">DataLex uses this to detect domains and contracts, draft models, and explain readiness gaps. Changes save automatically.</p>
      </header>

      <section className="set-card">
        <div className="set-card-title"><KeyRound size={13} /> Provider {savedFlash && <span className="set-saved"><Check size={11} /> Saved</span>}</div>

        <div className="set-provider-grid">
          {AI_PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`set-provider-tile ${provider === p.id ? "active" : ""}`}
              onClick={() => setProvider(p.id)}
            >
              <span className="set-provider-name">{p.label}</span>
              {!p.needsKey && <span className="set-provider-tag">no key</span>}
            </button>
          ))}
        </div>
        <p className="dlx-settings-pane-sub" style={{ marginTop: 4 }}>{meta.hint}</p>

        <div className="set-form">
          <label className="set-row">
            <span className="set-label">Model <span className="set-opt">optional</span></span>
            <input className="set-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="default or model id" />
          </label>
          {(provider === "ollama") && (
            <label className="set-row">
              <span className="set-label">Base URL</span>
              <input className="set-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434" />
            </label>
          )}
          {meta.needsKey && (
            <label className="set-row">
              <span className="set-label">API key</span>
              <input className="set-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-… (or use an env var)" autoComplete="off" />
            </label>
          )}
        </div>

        {meta.needsKey && (
          <label className={`set-check ${saveKey ? "on" : ""}`}>
            <input type="checkbox" checked={saveKey} onChange={(e) => setSaveKey(e.target.checked)} />
            <span>Remember the key in this browser. Leave off to use an environment variable or a single session.</span>
          </label>
        )}

        <div className="set-actions">
          <button className="set-btn primary" type="button" onClick={runTest} disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Test provider
          </button>
        </div>
        {test && (
          <div className={`set-status ${test.ok ? "ok" : "bad"}`}>
            {test.ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />} {test.message}
          </div>
        )}
      </section>
    </div>
  );
}

/* ─────────────────────────── Database connection ─────────────────────────── */
const DB_CONNECTORS = [
  { type: "postgres",  label: "PostgreSQL" },
  { type: "mysql",     label: "MySQL" },
  { type: "snowflake", label: "Snowflake", connector: "snowflake_password" },
  { type: "bigquery",  label: "BigQuery" },
  { type: "databricks",label: "Databricks" },
  { type: "sqlserver", label: "SQL Server" },
  { type: "redshift",  label: "Redshift" },
];

const DB_FIELDS = {
  postgres: [
    { key: "host", label: "Host", placeholder: "localhost", required: true },
    { key: "port", label: "Port", placeholder: "5432" },
    { key: "database", label: "Database", placeholder: "mydb", required: true },
    { key: "user", label: "User", placeholder: "postgres", required: true },
    { key: "password", label: "Password", placeholder: "••••••••", secret: true },
  ],
  mysql: [
    { key: "host", label: "Host", placeholder: "localhost", required: true },
    { key: "port", label: "Port", placeholder: "3306" },
    { key: "database", label: "Database", placeholder: "mydb", required: true },
    { key: "user", label: "User", placeholder: "root", required: true },
    { key: "password", label: "Password", placeholder: "••••••••", secret: true },
  ],
  snowflake_password: [
    { key: "host", label: "Account", placeholder: "ORGID-ACCTNAME", required: true },
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
    { key: "http_path", label: "HTTP Path", placeholder: "/sql/1.0/warehouses/xxxx", required: true },
    { key: "token", label: "Access Token", placeholder: "dapi…", secret: true, required: true },
    { key: "catalog", label: "Catalog", placeholder: "main" },
  ],
  sqlserver: [
    { key: "host", label: "Host", placeholder: "sqlserver.company.internal", required: true },
    { key: "port", label: "Port", placeholder: "1433" },
    { key: "database", label: "Database", placeholder: "warehouse", required: true },
    { key: "user", label: "User", placeholder: "svc_user", required: true },
    { key: "password", label: "Password", placeholder: "••••••••", secret: true },
  ],
  redshift: [
    { key: "host", label: "Cluster Endpoint", placeholder: "mycluster.abc123.us-east-1.redshift.amazonaws.com", required: true },
    { key: "port", label: "Port", placeholder: "5439" },
    { key: "database", label: "Database", placeholder: "dev", required: true },
    { key: "user", label: "User", placeholder: "awsuser", required: true },
    { key: "password", label: "Password", placeholder: "••••••••", secret: true },
  ],
};

function draftKey(connector) { return `datalex.conn.draft.${connector}`; }

function ConnectionPane() {
  const [type, setType] = React.useState("postgres");
  const selected = DB_CONNECTORS.find((c) => c.type === type) || DB_CONNECTORS[0];
  const connector = selected.connector || selected.type;
  const fields = DB_FIELDS[connector] || [];

  const [values, setValues] = React.useState({});
  const [busy, setBusy] = React.useState(false);
  const [test, setTest] = React.useState(null); // {ok, message}
  const [saved, setSaved] = React.useState([]);
  const [drivers, setDrivers] = React.useState({});

  // Load the saved draft for this connector (auto-restore unsaved input).
  React.useEffect(() => {
    setTest(null);
    try {
      const raw = localStorage.getItem(draftKey(connector));
      setValues(raw ? JSON.parse(raw) : {});
    } catch { setValues({}); }
  }, [connector]);

  // Auto-save the draft (minus secrets) as the user types.
  React.useEffect(() => {
    try {
      const safe = {};
      for (const f of fields) if (!f.secret) safe[f.key] = values[f.key] || "";
      localStorage.setItem(draftKey(connector), JSON.stringify(safe));
    } catch { /* ignore */ }
  }, [values, connector, fields]);

  const refreshSaved = React.useCallback(() => {
    fetchConnections().then(setSaved).catch(() => setSaved([]));
  }, []);

  React.useEffect(() => {
    refreshSaved();
    // Driver availability — shows why a test might fail before you try.
    fetch("/api/connectors").then((r) => r.json()).then((d) => {
      const list = Array.isArray(d) ? d : (d.connectors || []);
      const map = {};
      for (const c of list) map[c.type] = c;
      setDrivers(map);
    }).catch(() => {});
  }, [refreshSaved]);

  const setField = (key, val) => setValues((v) => ({ ...v, [key]: val }));

  const driver = drivers[type];
  const driverMissing = driver && driver.installed === false;

  const testAndSave = async () => {
    setBusy(true); setTest(null);
    try {
      const payload = { connector, ...values };
      const res = await testConnector(payload);
      if (res?.ok) {
        const detail = res.serverVersion ? ` · ${res.serverVersion}` : "";
        const ping = typeof res.pingMs === "number" ? ` (${res.pingMs}ms)` : "";
        setTest({ ok: true, message: `Connected and saved${ping}${detail}` });
        refreshSaved();
      } else {
        setTest({ ok: false, message: res?.error || res?.message || "Connection test failed." });
      }
    } catch (err) {
      setTest({ ok: false, message: err?.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dlx-settings-pane">
      <header>
        <h3 className="dlx-settings-pane-title">Database connection</h3>
        <p className="dlx-settings-pane-sub">Connect a warehouse to introspect schemas and pull tables. Test passes → the connection is saved.</p>
      </header>

      <section className="set-card">
        <div className="set-card-title"><Plug size={13} /> New connection</div>

        <label className="set-row">
          <span className="set-label">Warehouse</span>
          <select className="set-input" value={type} onChange={(e) => setType(e.target.value)}>
            {DB_CONNECTORS.map((c) => (
              <option key={c.type} value={c.type}>{c.label}</option>
            ))}
          </select>
        </label>

        {driverMissing && (
          <div className="set-status warn">
            <CircleAlert size={14} /> Driver not installed — {driver.status || `install the ${selected.label} driver to test`}.
          </div>
        )}

        <div className="set-form">
          {fields.map((f) => (
            <label key={f.key} className="set-row">
              <span className="set-label">{f.label}{f.required && <span className="set-req">*</span>}</span>
              <input
                className="set-input"
                type={f.secret ? "password" : "text"}
                value={values[f.key] || ""}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
                autoComplete="off"
              />
            </label>
          ))}
        </div>

        <div className="set-actions">
          <button className="set-btn primary" type="button" onClick={testAndSave} disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Test &amp; save connection
          </button>
        </div>
        {test && (
          <div className={`set-status ${test.ok ? "ok" : "bad"}`}>
            {test.ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />} {test.message}
          </div>
        )}
      </section>

      <section className="set-card">
        <div className="set-card-title">
          <Database size={13} /> Saved connections
          <button type="button" className="set-mini" onClick={refreshSaved} title="Refresh"><RefreshCw size={11} /></button>
        </div>
        {saved.length === 0 ? (
          <p className="dlx-settings-pane-sub">No saved connections yet. Test one above to save it.</p>
        ) : (
          <div className="set-conn-list">
            {saved.map((c) => (
              <div key={c.id || c.fingerprint} className="set-conn-row">
                <span className="set-conn-dot" />
                <span className="set-conn-name">{c.label || c.database || c.host || c.id}</span>
                <span className="set-conn-type">{c.connector || c.dialect || c.type}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
