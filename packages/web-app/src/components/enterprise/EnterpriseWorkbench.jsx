import React from "react";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  FileCode2,
  Filter,
  GitBranch,
  Inbox,
  KeyRound,
  Network,
  RefreshCw,
  Rocket,
  Search,
  Server,
  ShieldCheck,
  Loader2,
  SlidersHorizontal,
  Sparkles,
  XCircle,
} from "lucide-react";

import {
  buildAiContext,
  buildDatalexManifest,
  certifyProposal,
  fetchAiContextStatus,
  fetchAiSettings,
  fetchEnterpriseScan,
  fetchDqlReadiness,
  generateEnterpriseProposal,
  saveAiSettings,
  testAiSettings,
} from "../../lib/api";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";

const WORKFLOW_MODES = new Set(["ai-setup", "readiness", "domains", "proposals", "contracts", "publish"]);
const ENTERPRISE_AI_PROVIDERS = ["openai", "anthropic", "ollama"];
const PROVIDER_COPY = {
  openai: {
    title: "OpenAI",
    description: "Best default for strong structured generation across contracts, diagrams, and glossary drafts.",
    modelPlaceholder: "gpt-4.1-mini",
    baseUrlPlaceholder: "https://api.openai.com/v1",
  },
  anthropic: {
    title: "Claude",
    description: "Useful for business-readable proposal summaries and review questions.",
    modelPlaceholder: "claude-3-5-sonnet-latest",
    baseUrlPlaceholder: "https://api.anthropic.com",
  },
  ollama: {
    title: "Ollama",
    description: "Local provider for offline exploration. Test the chosen model before generation.",
    modelPlaceholder: "llama3.1",
    baseUrlPlaceholder: "http://localhost:11434",
  },
};
const PACK_TYPES = [
  ["core_certification", "Core certification"],
  ["datalex_contract", "DataLex contract"],
  ["dbt_contract", "dbt contract suggestion"],
  ["metric_contract", "Metric family"],
  ["glossary", "Glossary/docs"],
];
const SCOPE_OPTIONS = [
  ["focused", "Focused"],
  ["larger", "Larger"],
];

function formatNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString() : "0";
}

function label(value) {
  return String(value || "core").replace(/_/g, " ");
}

function statusTone(status) {
  const text = String(status || "").toLowerCase();
  if (["ready", "certified", "green", "passed"].includes(text)) return "good";
  if (["blocked", "rejected", "red", "failed"].includes(text)) return "bad";
  return "warn";
}

function StatusPill({ status }) {
  return <span className={`enterprise-pill ${statusTone(status)}`}>{String(status || "draft")}</span>;
}

function compileOutputExcerpt(compile) {
  const text = String(compile?.stdout || compile?.stderr || "").trim();
  if (!text) return "";
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const firstIssue = lines.findIndex((line) => /\berror\(s\):|\bwarning\(s\):|✗|failed/i.test(line));
  const sliceStart = firstIssue >= 0 ? firstIssue : Math.max(0, lines.length - 8);
  return lines.slice(sliceStart, sliceStart + 8).join("\n");
}

function uniqueDomains(scan) {
  return Array.from(new Set((scan?.domains || []).map((domain) => domain.name).filter(Boolean))).sort();
}

function rowMatchesQuery(row, query, fields = ["name", "domain", "path", "summary", "target"]) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => String(row?.[field] || "").toLowerCase().includes(needle));
}

function LimitNote({ limit, noun }) {
  if (!limit?.truncated) return null;
  return (
    <div className="enterprise-limit-note">
      <Inbox size={14} /> Showing {formatNumber(limit.returned)} of {formatNumber(limit.total)} {noun}. Use filters to narrow the queue.
    </div>
  );
}

function SearchBox({ value, onChange, placeholder = "Search" }) {
  return (
    <label className="enterprise-search">
      <Search size={14} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function GenerateControls({ scan, options, onChange, onGenerate, generating, aiReady, onOpenSetup }) {
  const domains = uniqueDomains(scan);
  const selectedDomain = options.domain || domains[0] || "core";
  const update = (patch) => onChange({ ...options, ...patch });
  return (
    <div className="enterprise-controls">
      <div className="enterprise-control-title">
        <SlidersHorizontal size={15} />
        <span>Generate focused pack</span>
      </div>
      <label>
        <span>Domain</span>
        <select value={selectedDomain} onChange={(event) => update({ domain: event.target.value })}>
          {domains.map((domain) => <option key={domain} value={domain}>{label(domain)}</option>)}
          {!domains.length && <option value="core">Core</option>}
        </select>
      </label>
      <label>
        <span>Pack type</span>
        <select value={options.packType || "core_certification"} onChange={(event) => update({ packType: event.target.value })}>
          {PACK_TYPES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </label>
      <label>
        <span>Scope</span>
        <select value={options.scopeSize || "focused"} onChange={(event) => update({ scopeSize: event.target.value })}>
          {SCOPE_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </label>
      <button
        className={aiReady ? "enterprise-primary" : "enterprise-secondary"}
        type="button"
        disabled={aiReady && generating === selectedDomain}
        onClick={() => aiReady ? onGenerate(selectedDomain, options) : onOpenSetup?.()}
      >
        {generating === selectedDomain
          ? <><Loader2 size={14} className="spin" /> Generating…</>
          : <><Sparkles size={14} /> {aiReady ? "Generate" : "Set up AI"}</>}
      </button>
    </div>
  );
}

/* Per-destination empty-state copy. Each activity-rail destination gets a
   purpose-specific prompt so it reads as a first-class workspace even
   before a repo is connected — every path still needs a dbt project, so
   the action stays "Connect repo". */
const EMPTY_STATES = {
  "ai-setup":  { Icon: Sparkles,      title: "Set up your AI provider",        body: "Connect a dbt project, then point DataLex at OpenAI, Claude, or Ollama to draft domains, contracts, and diagrams." },
  readiness:   { Icon: ClipboardCheck, title: "See your enterprise readiness",  body: "Connect a dbt project to score readiness by domain — contracts, metrics, owners, grains, and DQL status." },
  domains:     { Icon: Network,        title: "Discover your business domains", body: "Connect a dbt project and DataLex groups your models into business domains with certification priorities." },
  proposals:   { Icon: Inbox,          title: "Review AI proposal packs",       body: "Connect a dbt project to generate small, reviewable AI proposal packs — accept, edit, or reject each change." },
  contracts:   { Icon: ShieldCheck,    title: "Govern your data contracts",     body: "Connect a dbt project to see every contract's status, owner, source, and confidence on one certified surface." },
  publish:     { Icon: Rocket,         title: "Publish your DataLex manifest",  body: "Connect a dbt project, then build the DataLex manifest and check integration readiness before you ship." },
};
const DEFAULT_EMPTY = { Icon: Network, title: "Connect a dbt project", body: "DataLex starts from your existing repo, scans dbt metadata, then builds small AI proposal packs for review." };

function EmptyState({ onConnect, mode }) {
  const copy = EMPTY_STATES[mode] || DEFAULT_EMPTY;
  const Ico = copy.Icon;
  return (
    <main className="enterprise-workbench">
      <section className="enterprise-empty">
        <Ico size={30} strokeWidth={1.7} />
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
        <button className="enterprise-primary" type="button" onClick={onConnect}>
          <GitBranch size={15} /> Connect repo
        </button>
      </section>
    </main>
  );
}

function MetricTile({ label: name, value, tone = "" }) {
  return (
    <div className={`enterprise-metric ${tone}`}>
      <span>{name}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function DetectionBar({ detected, integrations }) {
  const items = [
    ["dbt_project.yml", detected?.dbt_project],
    ["manifest.json", detected?.manifest_json],
    ["DataLex folder", detected?.datalex_workspace],
  ];
  if (integrations?.dql?.enabled) items.push(["DQL integration", detected?.dql_workspace]);
  return (
    <div className="enterprise-detection">
      {items.map(([name, ok]) => (
        <span key={name} className={ok ? "found" : "missing"}>
          {ok ? <CheckCircle2 size={13} /> : <CircleDashed size={13} />}
          {name}
        </span>
      ))}
    </div>
  );
}

function providerRow(settings, providerId) {
  return (settings?.settings?.providers || settings?.providers || []).find((item) => item.id === providerId) || {
    id: providerId,
    label: PROVIDER_COPY[providerId]?.title || providerId,
    enabled: providerId === "ollama",
    hasApiKey: providerId === "ollama",
    model: "",
    baseUrl: "",
    testStatus: "untested",
    source: "none",
  };
}

function AiProviderCard({ provider, values, onChange, onSave, onTest, busy }) {
  const copy = PROVIDER_COPY[provider.id] || {};
  const requiresKey = provider.requiresApiKey !== false && provider.id !== "ollama";
  const testTone = provider.testStatus === "passed" ? "good" : provider.testStatus === "failed" ? "bad" : "warn";
  const sourceLabel = provider.source === "env+local"
    ? "env + local"
    : provider.source === "env"
      ? "env"
      : provider.source === "local"
        ? "local"
        : "not saved";
  return (
    <article className={`enterprise-provider-card ${provider.selected ? "selected" : ""}`}>
      <div className="enterprise-card-head">
        <div>
          <h3>{copy.title || provider.label}</h3>
          <p>{copy.description}</p>
        </div>
        <StatusPill status={provider.testStatus || "untested"} />
      </div>
      <div className="enterprise-provider-meta">
        <span className={testTone}><KeyRound size={13} /> {sourceLabel}</span>
        {provider.apiKeyPreview && <span>{provider.apiKeyPreview}</span>}
        {provider.testedAt && <span>tested {new Date(provider.testedAt).toLocaleString()}</span>}
      </div>
      <div className="enterprise-provider-fields">
        <label>
          <span>Model</span>
          <input
            name={`datalex-${provider.id}-model`}
            autoComplete="off"
            spellCheck={false}
            value={values.model ?? provider.model ?? ""}
            placeholder={provider.model || copy.modelPlaceholder}
            onChange={(event) => onChange(provider.id, { model: event.target.value })}
          />
        </label>
        <label>
          <span>Base URL</span>
          <input
            name={`datalex-${provider.id}-base-url`}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={values.baseUrl ?? provider.baseUrl ?? ""}
            placeholder={provider.baseUrl || copy.baseUrlPlaceholder}
            onChange={(event) => onChange(provider.id, { baseUrl: event.target.value })}
          />
        </label>
        {requiresKey && (
          <label>
            <span>API key</span>
            <input
              type="password"
              name={`datalex-${provider.id}-api-token`}
              value={values.apiKey || ""}
              placeholder={provider.hasApiKey ? "Saved or env key is set" : "Paste key for local use"}
              autoComplete="new-password"
              spellCheck={false}
              onChange={(event) => onChange(provider.id, { apiKey: event.target.value })}
            />
          </label>
        )}
      </div>
      {provider.testMessage && <p className="enterprise-provider-message">{provider.testMessage}</p>}
      <div className="enterprise-actions">
        <button className="enterprise-secondary" type="button" disabled={busy === `${provider.id}:save`} onClick={() => onSave(provider.id)}>
          Save
        </button>
        <button className="enterprise-primary" type="button" disabled={busy === `${provider.id}:test`} onClick={() => onTest(provider.id)}>
          <Sparkles size={14} /> Test provider
        </button>
      </div>
    </article>
  );
}

function AiSetupView({ scan, aiSettings, contextStatus, providerInputs, onProviderChange, onSaveProvider, onTestProvider, onBuildContext, busy, onOpenMode }) {
  const generation = aiSettings?.generation || scan?.ai || {};
  const totals = scan?.totals || {};
  return (
    <>
      <DetectionBar detected={scan?.detected} integrations={scan?.integrations} />
      <section className="enterprise-ai-hero">
        <div>
          <p className="enterprise-kicker">AI-first setup</p>
          <h2>Configure AI before generation</h2>
          <p>
            AI will use your dbt manifest, YAML, semantic metrics, tests, exposures, and descriptions to propose business domains and contracts.
          </p>
        </div>
        <StatusPill status={generation.ready ? "ready" : "blocked"} />
      </section>
      <section className="enterprise-metrics-grid">
        <MetricTile label="Models AI can inspect" value={totals.models} />
        <MetricTile label="Semantic metrics" value={totals.semantic_metrics} />
        <MetricTile label="Exposures" value={totals.exposures} />
        <MetricTile label="Existing dbt contracts" value={totals.existing_dbt_contracts} />
        <MetricTile label="Contract opportunities" value={totals.missing_contracts} tone={totals.missing_contracts ? "warn" : ""} />
        <MetricTile label="Context records" value={contextStatus?.recordCount || 0} />
      </section>
      {!generation.ready && (
        <div className="enterprise-warning">
          <AlertTriangle size={16} /> {generation.message || "Choose and test OpenAI, Claude, or Ollama before AI generation."}
        </div>
      )}
      <section className="enterprise-two-col ai-setup">
        <div className="enterprise-section">
          <div className="enterprise-section-head">
            <h2>Providers</h2>
            <span>project-private settings</span>
          </div>
          <div className="enterprise-provider-grid">
            {ENTERPRISE_AI_PROVIDERS.map((providerId) => {
              const provider = providerRow(aiSettings, providerId);
              return (
                <AiProviderCard
                  key={providerId}
                  provider={provider}
                  values={providerInputs[providerId] || {}}
                  onChange={onProviderChange}
                  onSave={onSaveProvider}
                  onTest={onTestProvider}
                  busy={busy}
                />
              );
            })}
          </div>
        </div>
        <div className="enterprise-section">
          <div className="enterprise-section-head">
            <h2>AI Context</h2>
            <span>{contextStatus?.exists ? "indexed" : "not built"}</span>
          </div>
          <article className="enterprise-context-card">
            <BrainCircuit size={22} />
            <div>
              <h3>Project context index</h3>
              <p>DataLex builds a local index from dbt metadata, DataLex YAML, docs, tests, semantic files, and skills. Memory is advisory and never overrides certified artifacts.</p>
            </div>
            <div className="enterprise-dql-list">
              <span><Server size={14} /> Records: {formatNumber(contextStatus?.recordCount)}</span>
              <span><FileCode2 size={14} /> dbt manifest: {scan?.detected?.manifest_json ? "found" : "missing"}</span>
              <span><ShieldCheck size={14} /> DataLex contracts: {formatNumber(totals.datalex_contracts)}</span>
            </div>
            <button className="enterprise-primary large" type="button" disabled={busy === "context"} onClick={onBuildContext}>
              <RefreshCw size={14} className={busy === "context" ? "spin" : ""} /> Build AI context
            </button>
            {generation.ready && (
              <button className="enterprise-secondary wide" type="button" onClick={() => onOpenMode("readiness")}>
                Continue to Readiness
              </button>
            )}
          </article>
        </div>
      </section>
    </>
  );
}

function DomainCard({ domain, compact = false }) {
  return (
    <article className="enterprise-domain-card">
      <div className="enterprise-card-head">
        <div>
          <h3>{label(domain.name)}</h3>
          <p>{formatNumber(domain.models)} models, {formatNumber(domain.semantic_metrics)} metrics</p>
        </div>
        <StatusPill status={domain.certified_contracts ? "certified" : domain.draft_proposals ? "draft" : "needs review"} />
      </div>
      <div className="enterprise-mini-grid">
        <MetricTile label="Facts" value={domain.fact_tables} />
        <MetricTile label="dbt contracts" value={domain.existing_dbt_contracts} />
        <MetricTile label="Missing" value={domain.missing_contracts} tone={domain.missing_contracts ? "warn" : ""} />
        <MetricTile label="Certified" value={domain.certified_contracts} />
      </div>
      {!compact && (
        <div className="enterprise-gap-row">
          {(domain.gaps || []).slice(0, 5).map((gap) => <span key={gap}>{label(gap)}</span>)}
          {!(domain.gaps || []).length && <span>no high-risk gaps</span>}
        </div>
      )}
    </article>
  );
}

function Header({ scan, mode, loading, onRefresh }) {
  const titleMap = {
    "ai-setup": "AI Setup",
    readiness: "Enterprise Readiness",
    domains: "Business Domains",
    proposals: "AI Proposal Queue",
    contracts: "Contracts",
    publish: "Publish",
  };
  return (
    <header className="enterprise-header">
      <div>
        <p className="enterprise-kicker">{scan?.project?.name || "DataLex"} workflow</p>
        <h1>{titleMap[mode] || "Enterprise Readiness"}</h1>
      </div>
      <button className="enterprise-secondary" type="button" onClick={onRefresh} disabled={loading}>
        <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh scan
      </button>
    </header>
  );
}

function ReadinessView({ scan, onGenerate, generating, onOpenMode, onOpenAiSetup, aiReady }) {
  const totals = scan?.totals || {};
  const topDomains = (scan?.domains || []).slice(0, 6);
  const topPacks = (scan?.proposal_packs || []).slice(0, 4);
  return (
    <>
      <DetectionBar detected={scan?.detected} integrations={scan?.integrations} />
      {!scan?.detected?.manifest_json && (
        <div className="enterprise-warning">
          <AlertTriangle size={16} /> target/manifest.json was not found. DataLex can scan YAML-only, but dbt metadata quality will be lower.
        </div>
      )}
      <section className="enterprise-metrics-grid">
        <MetricTile label="Models" value={totals.models} />
        <MetricTile label="Fact tables" value={totals.fact_tables} />
        <MetricTile label="Semantic metrics" value={totals.semantic_metrics} />
        <MetricTile label="dbt contracts" value={totals.existing_dbt_contracts} />
        <MetricTile label="Missing contracts" value={totals.missing_contracts} tone={totals.missing_contracts ? "warn" : ""} />
        <MetricTile label="Certified contracts" value={totals.certified_contracts} />
      </section>
      {!aiReady && (
        <div className="enterprise-warning">
          <Sparkles size={16} /> AI generation is not ready yet. Scan results are available, but proposal generation starts after you connect AI.
          <button className="enterprise-secondary" type="button" onClick={onOpenAiSetup}>Set up AI</button>
        </div>
      )}
      <section className="enterprise-two-col">
        <div className="enterprise-section">
          <div className="enterprise-section-head">
            <h2>Prioritized Domains</h2>
            <button type="button" onClick={() => onOpenMode("domains")}>View all</button>
          </div>
          <div className="enterprise-card-list">
            {topDomains.map((domain) => <DomainCard key={domain.name} domain={domain} compact />)}
            {!topDomains.length && <p className="enterprise-muted">No domain metadata detected yet.</p>}
          </div>
        </div>
        <div className="enterprise-section">
          <div className="enterprise-section-head">
            <h2>Next AI Packs</h2>
            <button type="button" onClick={() => onOpenMode("proposals")}>Review queue</button>
          </div>
          <div className="enterprise-pack-list">
            {topPacks.map((pack) => (
              <article key={pack.id} className="enterprise-pack">
                <div>
                  <h3>{pack.title}</h3>
                  <p>{formatNumber(pack.scope?.models)} focused models, {formatNumber(pack.scope?.metric_families)} metric families</p>
                </div>
                <StatusPill status={pack.status} />
                <button
                  className={aiReady ? "enterprise-primary" : "enterprise-secondary"}
                  type="button"
                  disabled={aiReady && generating === pack.domain}
                  onClick={() => aiReady ? onGenerate(pack.domain) : onOpenAiSetup?.()}
                >
                  {generating === pack.domain
                    ? <><Loader2 size={14} className="spin" /> Generating…</>
                    : <><Sparkles size={14} /> {aiReady ? "Generate draft" : "Set up AI"}</>}
                </button>
              </article>
            ))}
            {!topPacks.length && <p className="enterprise-muted">No proposal packs are queued yet.</p>}
          </div>
        </div>
      </section>
    </>
  );
}

function DomainsView({ scan, onGenerate, generating, query, onQueryChange, aiReady, onOpenSetup }) {
  const domains = (scan?.domains || []).filter((domain) => rowMatchesQuery(domain, query, ["name", "top_models"]));
  return (
    <section className="enterprise-section full">
      <div className="enterprise-section-head">
        <h2>Domain Readiness</h2>
        <span>{formatNumber(domains.length)} of {formatNumber(scan?.domains?.length)} detected domains</span>
      </div>
      <div className="enterprise-toolbar">
        <SearchBox value={query} onChange={onQueryChange} placeholder="Search domains or top models" />
      </div>
      <div className="enterprise-domain-grid">
        {domains.map((domain) => (
          <div key={domain.name} className="enterprise-domain-wrap">
            <DomainCard domain={domain} />
            <button
              className="enterprise-secondary wide"
              type="button"
              disabled={aiReady && generating === domain.name}
              onClick={() => aiReady ? onGenerate(domain.name) : onOpenSetup?.()}
            >
              {generating === domain.name
                ? <><Loader2 size={14} className="spin" /> Generating…</>
                : <><Sparkles size={14} /> {aiReady ? "Generate focused proposal" : "Set up AI first"}</>}
            </button>
          </div>
        ))}
        {!domains.length && <p className="enterprise-muted">No domains match the current search.</p>}
      </div>
    </section>
  );
}

function ProposalsView({ scan, onGenerate, onCertify, generating, certifying, generationOptions, setGenerationOptions, filters, setFilters, aiReady, onOpenSetup }) {
  const proposals = scan?.proposals || [];
  const domains = uniqueDomains(scan);
  const visibleProposals = proposals.filter((proposal) => {
    if (filters.domain && filters.domain !== "all" && proposal.domain !== filters.domain) return false;
    if (filters.status && filters.status !== "all" && proposal.status !== filters.status) return false;
    return rowMatchesQuery(proposal, filters.query);
  });
  const updateFilters = (patch) => setFilters({ ...filters, ...patch });
  return (
    <section className="enterprise-two-col proposals">
      <div className="enterprise-section">
        <div className="enterprise-section-head">
          <h2>Proposal Packs</h2>
          <span>small batches only</span>
        </div>
        <GenerateControls
          scan={scan}
          options={generationOptions}
          onChange={setGenerationOptions}
          onGenerate={onGenerate}
          generating={generating}
          aiReady={aiReady}
          onOpenSetup={onOpenSetup}
        />
        <LimitNote limit={scan?.limits?.proposal_packs} noun="proposal packs" />
        <div className="enterprise-pack-list">
          {(scan?.proposal_packs || []).map((pack) => (
            <article key={pack.id} className="enterprise-pack detailed">
              <div>
                <h3>{pack.title}</h3>
                <p>{pack.includes?.slice(0, 4).join(", ")}</p>
                <div className="enterprise-evidence">
                  <span>{formatNumber(pack.scope?.fact_tables)} fact contracts</span>
                  <span>{formatNumber(pack.scope?.metric_families)} metric families</span>
                  <span>{Math.round((pack.evidence?.confidence || 0) * 100)}% confidence</span>
                </div>
              </div>
              <StatusPill status={pack.status} />
              <button
                className={aiReady ? "enterprise-primary" : "enterprise-secondary"}
                type="button"
                disabled={aiReady && generating === pack.domain}
                onClick={() => aiReady ? onGenerate(pack.domain, generationOptions) : onOpenSetup?.()}
              >
                {generating === pack.domain
                  ? <><Loader2 size={14} className="spin" /> Generating…</>
                  : <><Sparkles size={14} /> {aiReady ? "Generate" : "Set up AI"}</>}
              </button>
            </article>
          ))}
        </div>
      </div>
      <div className="enterprise-section">
        <div className="enterprise-section-head">
          <h2>Review Cards</h2>
          <span>{formatNumber(visibleProposals.length)} of {formatNumber(scan?.limits?.proposals?.total || proposals.length)} proposals</span>
        </div>
        <div className="enterprise-toolbar">
          <SearchBox value={filters.query || ""} onChange={(query) => updateFilters({ query })} placeholder="Search proposals" />
          <label className="enterprise-filter">
            <Filter size={14} />
            <select value={filters.domain || "all"} onChange={(event) => updateFilters({ domain: event.target.value })}>
              <option value="all">All domains</option>
              {domains.map((domain) => <option key={domain} value={domain}>{label(domain)}</option>)}
            </select>
          </label>
          <label className="enterprise-filter">
            <select value={filters.status || "all"} onChange={(event) => updateFilters({ status: event.target.value })}>
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="reviewed">Reviewed</option>
              <option value="certified">Certified</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
        </div>
        <LimitNote limit={scan?.limits?.proposals} noun="proposal cards" />
        <div className="enterprise-review-list">
          {visibleProposals.map((proposal) => {
            const files = proposal.proposed_change?.applied_files || proposal.proposed_change?.files || [];
            return (
              <article key={proposal.path} className="enterprise-review-card">
                <div className="enterprise-card-head">
                  <div>
                    <h3>{label(proposal.name)}</h3>
                    <p>{proposal.summary || proposal.path}</p>
                  </div>
                  <StatusPill status={proposal.status} />
                </div>
                <div className="enterprise-evidence">
                  <span>{label(proposal.domain)}</span>
                  <span>{proposal.proposal_type || "proposal"}</span>
                  <span>{Math.round((proposal.confidence || 0) * 100)}% confidence</span>
                  <span>{proposal.evidence?.source_models?.length || 0} source models</span>
                </div>
                {!!files.length && (
                  <div className="enterprise-file-chips">
                    {files.slice(0, 8).map((file) => <code key={file}>{file}</code>)}
                    {files.length > 8 && <span>+{files.length - 8} more</span>}
                  </div>
                )}
                <div className="enterprise-actions">
                  <button
                    type="button"
                    className="enterprise-secondary"
                    disabled={certifying === proposal.path}
                    onClick={() => onCertify(proposal.path, "reviewed")}
                  >
                    {certifying === proposal.path
                      ? <><Loader2 size={14} className="spin" /> Working…</>
                      : <><ClipboardCheck size={14} /> Mark reviewed</>}
                  </button>
                  <button
                    type="button"
                    className="enterprise-primary"
                    disabled={proposal.status === "certified" || certifying === proposal.path}
                    onClick={() => onCertify(proposal.path, "certified")}
                  >
                    {certifying === proposal.path
                      ? <><Loader2 size={14} className="spin" /> Certifying…</>
                      : <><ShieldCheck size={14} /> Certify</>}
                  </button>
                  <button
                    type="button"
                    className="enterprise-danger"
                    disabled={proposal.status === "rejected" || certifying === proposal.path}
                    onClick={() => onCertify(proposal.path, "rejected")}
                  >
                    <XCircle size={14} /> Reject
                  </button>
                </div>
              </article>
            );
          })}
          {!visibleProposals.length && <p className="enterprise-muted">No proposals match the current filters.</p>}
        </div>
      </div>
    </section>
  );
}

function ContractsView({ scan, filters, setFilters }) {
  // Prefer the unified contract surface (authored DataLex contracts +
  // enforced dbt contracts + missing-contract opportunities) so the board
  // is meaningful on a freshly connected dbt project. Fall back to the
  // authored-only list for older API responses.
  const contracts = (scan?.contract_surface && scan.contract_surface.length)
    ? scan.contract_surface
    : (scan?.contracts || []);
  const domains = uniqueDomains(scan);
  const visibleContracts = contracts.filter((contract) => {
    if (filters.domain && filters.domain !== "all" && contract.domain !== filters.domain) return false;
    if (filters.status && filters.status !== "all" && contract.status !== filters.status) return false;
    return rowMatchesQuery(contract, filters.query, ["name", "domain", "path"]);
  });
  const updateFilters = (patch) => setFilters({ ...filters, ...patch });
  return (
    <section className="enterprise-section full">
      <div className="enterprise-section-head">
        <h2>Certified Contract Surface</h2>
        <span>{formatNumber(visibleContracts.length)} of {formatNumber(scan?.limits?.contracts?.total || contracts.length)} contracts</span>
      </div>
      <div className="enterprise-toolbar">
        <SearchBox value={filters.query || ""} onChange={(query) => updateFilters({ query })} placeholder="Search contracts" />
        <label className="enterprise-filter">
          <Filter size={14} />
          <select value={filters.domain || "all"} onChange={(event) => updateFilters({ domain: event.target.value })}>
            <option value="all">All domains</option>
            {domains.map((domain) => <option key={domain} value={domain}>{label(domain)}</option>)}
          </select>
        </label>
        <label className="enterprise-filter">
          <select value={filters.status || "all"} onChange={(event) => updateFilters({ status: event.target.value })}>
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="reviewed">Reviewed</option>
            <option value="certified">Certified</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </div>
      <LimitNote limit={scan?.limits?.contracts} noun="contracts" />
      <div className="enterprise-table">
        <div className="enterprise-table-row head">
          <span>Contract</span>
          <span>Domain</span>
          <span>Status</span>
          <span>Source</span>
          <span>Confidence</span>
        </div>
        {visibleContracts.map((contract) => (
          <div className="enterprise-table-row" key={contract.path}>
            <strong>{label(contract.name)}</strong>
            <span>{label(contract.domain)}</span>
            <span><StatusPill status={contract.status} /></span>
            <span>{contract.source?.ref || contract.path}</span>
            <span>{Math.round((contract.confidence || 0) * 100)}%</span>
          </div>
        ))}
      </div>
      {!visibleContracts.length && <p className="enterprise-muted">No contracts match the current filters.</p>}
    </section>
  );
}

function PublishView({ scan, manifestResult, dqlReadinessResult, building, onBuild }) {
  const publish = scan?.publish || {};
  const dql = scan?.dql || {};
  const dqlEnabled = Boolean(scan?.integrations?.dql?.enabled || publish.dql_enabled);
  const compile = dqlReadinessResult?.compile || null;
  const compileStatus = compile?.status === "passed" ? "ready" : compile?.status === "failed" ? "blocked" : compile?.status;
  const certifiedWithoutContract = publish.dql_certified_without_contract ?? dql.certified_without_contract ?? 0;
  const compileExcerpt = compileOutputExcerpt(compile);
  return (
    <section className="enterprise-two-col publish">
      <div className="enterprise-section">
        <div className="enterprise-section-head">
          <h2>DataLex Manifest Readiness</h2>
          <StatusPill status={publish.status || "warning"} />
        </div>
        <div className="enterprise-metrics-grid compact">
          <MetricTile label="Certified contracts" value={publish.certified_contracts} />
          <MetricTile label="Draft proposals" value={publish.draft_proposals} />
          <MetricTile label="Rejected excluded" value={publish.rejected_proposals_excluded} />
          <MetricTile label="Metric contracts" value={scan?.totals?.metric_contracts} />
        </div>
        <div className="enterprise-warning-list">
          {(publish.warnings || []).map((warning) => <span key={warning}><AlertTriangle size={14} /> {warning}</span>)}
          {dqlEnabled && certifiedWithoutContract > 0 && (
            <span><AlertTriangle size={14} /> {formatNumber(certifiedWithoutContract)} certified DQL blocks do not declare a DataLex contract.</span>
          )}
        </div>
        <button className="enterprise-primary large" type="button" disabled={building} onClick={onBuild}>
          <Rocket size={15} /> Build DataLex manifest
        </button>
      </div>
      <div className="enterprise-section">
        <div className="enterprise-section-head">
          <h2>{dqlEnabled ? "DQL Readiness" : "Optional Integrations"}</h2>
          <StatusPill status={dqlEnabled ? (publish.status || "warning") : "default off"} />
        </div>
        {dqlEnabled ? (
          <>
            <div className="enterprise-dql-list">
              <span><FileCode2 size={14} /> Blocks scanned: {formatNumber(dql.blocks)}</span>
              <span><ShieldCheck size={14} /> Certified blocks: {formatNumber(dql.certified_blocks)}</span>
              <span><AlertTriangle size={14} /> Missing contract refs: {formatNumber(dql.missing_contract_refs)}</span>
              <span><AlertTriangle size={14} /> Certified without contract: {formatNumber(certifiedWithoutContract)}</span>
              {compile && <span><Rocket size={14} /> DQL compile: {compile.status}</span>}
            </div>
            {compile && (
              <div className={`enterprise-compile-result ${compile.status === "failed" ? "bad" : ""}`}>
                <StatusPill status={compileStatus || "warning"} />
                <div>
                  <strong>{compile.message || (compile.status === "passed" ? "DQL compile passed with the DataLex manifest." : "DQL compile readiness checked.")}</strong>
                  <p>{compile.reason || compile.dqlPath || "No DQL path configured"}</p>
                  {Array.isArray(compile.command) && compile.command.length > 0 && (
                    <code>{compile.command.join(" ")}</code>
                  )}
                  {compileExcerpt && <pre>{compileExcerpt}</pre>}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="enterprise-compile-result">
            <CircleDashed size={16} />
            <div>
              <strong>DQL is not part of the default OSS publish gate.</strong>
              <p>DataLex will build the manifest locally. Cloud can combine DataLex and DQL later, or this project can opt in through datalex.yaml integrations.</p>
            </div>
          </div>
        )}
        {manifestResult && (
          <div className="enterprise-manifest-result">
            <CheckCircle2 size={16} />
            <div>
              <strong>{manifestResult.path}</strong>
              <p>{formatNumber(manifestResult.summary?.domains)} domains, {formatNumber(manifestResult.summary?.contracts)} certified contracts</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function EnterpriseWorkbench({ mode = "ai-setup" }) {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const refreshProjectFiles = useWorkspaceStore((s) => s.refreshProjectFiles);
  const openModal = useUiStore((s) => s.openModal);
  const addToast = useUiStore((s) => s.addToast);
  const setShellViewMode = useUiStore((s) => s.setShellViewMode);
  const [scan, setScan] = React.useState(null);
  const [aiSettings, setAiSettings] = React.useState(null);
  const [aiContextStatus, setAiContextStatus] = React.useState(null);
  const [providerInputs, setProviderInputs] = React.useState({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [generating, setGenerating] = React.useState("");
  const [certifying, setCertifying] = React.useState("");
  const [building, setBuilding] = React.useState(false);
  const [aiBusy, setAiBusy] = React.useState("");
  const [manifestResult, setManifestResult] = React.useState(null);
  const [dqlReadinessResult, setDqlReadinessResult] = React.useState(null);
  const [domainQuery, setDomainQuery] = React.useState("");
  const [generationOptions, setGenerationOptions] = React.useState({ domain: "", packType: "core_certification", scopeSize: "focused" });
  const [proposalFilters, setProposalFilters] = React.useState({ query: "", domain: "all", status: "all" });
  const [contractFilters, setContractFilters] = React.useState({ query: "", domain: "all", status: "all" });
  const activeMode = WORKFLOW_MODES.has(mode) ? mode : "ai-setup";
  const aiReady = Boolean((aiSettings?.generation || scan?.ai || {}).ready);

  const refresh = React.useCallback(async ({ force = false } = {}) => {
    if (!activeProjectId) return;
    setLoading(true);
    setError("");
    try {
      const payload = await fetchEnterpriseScan(activeProjectId, { force });
      setScan(payload);
    } catch (err) {
      setError(err?.message || "Enterprise scan failed");
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  const refreshAiSetup = React.useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const [settings, context] = await Promise.all([
        fetchAiSettings(activeProjectId),
        fetchAiContextStatus(activeProjectId),
      ]);
      setAiSettings(settings);
      setAiContextStatus(context);
    } catch (err) {
      setError(err?.message || "AI setup status failed");
    }
  }, [activeProjectId]);

  // Refresh the scan on mount AND whenever the active workflow view changes
  // (clicking a sidebar destination). The server caches the scan by file
  // state, so when nothing changed this returns fast; after a certify or
  // generate it picks up the new numbers — so every page shows fresh data
  // instead of a stale snapshot from when the workbench first mounted.
  React.useEffect(() => {
    refresh();
  }, [refresh, activeMode]);

  React.useEffect(() => {
    refreshAiSetup();
  }, [refreshAiSetup, activeMode]);

  // AI is configured in the Settings dialog now. When it changes, re-read
  // readiness and re-scan so these pages flip from "Set up AI" to
  // "Generate" without a manual refresh.
  const openAiSettings = React.useCallback(() => openModal?.("settings", { initialTab: "ai" }), [openModal]);
  React.useEffect(() => {
    const onAiChanged = () => { refreshAiSetup(); refresh({ force: true }); };
    window.addEventListener("datalex:ai-changed", onAiChanged);
    return () => window.removeEventListener("datalex:ai-changed", onAiChanged);
  }, [refreshAiSetup, refresh]);

  React.useEffect(() => {
    const providers = aiSettings?.settings?.providers || [];
    if (!providers.length) return;
    setProviderInputs((prev) => {
      const next = { ...prev };
      for (const provider of providers) {
        if (!ENTERPRISE_AI_PROVIDERS.includes(provider.id)) continue;
        next[provider.id] = {
          model: next[provider.id]?.model ?? provider.model ?? "",
          baseUrl: next[provider.id]?.baseUrl ?? provider.baseUrl ?? "",
          apiKey: next[provider.id]?.apiKey || "",
        };
      }
      return next;
    });
  }, [aiSettings]);

  React.useEffect(() => {
    const firstDomain = scan?.domains?.[0]?.name || "";
    if (firstDomain && !generationOptions.domain) {
      setGenerationOptions((prev) => ({ ...prev, domain: firstDomain }));
    }
  }, [scan, generationOptions.domain]);

  const handleGenerate = React.useCallback(async (domain, options = {}) => {
    if (!activeProjectId) return;
    if (!aiReady) {
      addToast?.({ type: "info", message: "Set up and test AI before generating proposals." });
      openAiSettings();
      return;
    }
    const selectedDomain = domain || options.domain || generationOptions.domain || "core";
    setGenerating(selectedDomain);
    try {
      const result = await generateEnterpriseProposal(activeProjectId, {
        domain: selectedDomain,
        packType: options.packType || generationOptions.packType || "core_certification",
        scopeSize: options.scopeSize || generationOptions.scopeSize || "focused",
      });
      addToast?.({
        type: result.status === "already_exists" ? "info" : "success",
        message: result.status === "already_exists" ? "Draft proposal already exists" : "Draft proposal generated",
      });
      await refreshProjectFiles?.(activeProjectId);
      await refreshAiSetup();
      await refresh({ force: true });
      setShellViewMode("proposals");
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "Proposal generation failed" });
    } finally {
      setGenerating("");
    }
  }, [activeProjectId, addToast, aiReady, generationOptions, refreshProjectFiles, refresh, refreshAiSetup, setShellViewMode, openAiSettings]);

  const handleProviderChange = React.useCallback((provider, patch) => {
    setProviderInputs((prev) => ({
      ...prev,
      [provider]: {
        ...(prev[provider] || {}),
        ...patch,
      },
    }));
  }, []);

  const providerPayload = React.useCallback((provider) => {
    const values = providerInputs[provider] || {};
    const payload = {
      projectId: activeProjectId,
      provider,
      enabled: true,
      model: values.model,
      baseUrl: values.baseUrl,
    };
    if (values.apiKey) payload.apiKey = values.apiKey;
    return payload;
  }, [activeProjectId, providerInputs]);

  const handleSaveProvider = React.useCallback(async (provider) => {
    if (!activeProjectId) return;
    setAiBusy(`${provider}:save`);
    try {
      const result = await saveAiSettings(providerPayload(provider));
      setAiSettings(result);
      addToast?.({ type: "success", message: `${PROVIDER_COPY[provider]?.title || provider} settings saved` });
      await refresh({ force: true });
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "AI provider settings failed" });
    } finally {
      setAiBusy("");
    }
  }, [activeProjectId, addToast, providerPayload, refresh]);

  const handleTestProvider = React.useCallback(async (provider) => {
    if (!activeProjectId) return;
    setAiBusy(`${provider}:test`);
    try {
      const result = await testAiSettings(providerPayload(provider));
      setAiSettings(result);
      addToast?.({ type: "success", message: `${PROVIDER_COPY[provider]?.title || provider} is ready` });
      await refresh({ force: true });
    } catch (err) {
      await refreshAiSetup();
      addToast?.({ type: "error", message: err?.message || "AI provider test failed" });
    } finally {
      setAiBusy("");
    }
  }, [activeProjectId, addToast, providerPayload, refresh, refreshAiSetup]);

  const handleBuildAiContext = React.useCallback(async () => {
    if (!activeProjectId) return;
    setAiBusy("context");
    try {
      const result = await buildAiContext(activeProjectId);
      setAiContextStatus(result);
      setAiSettings(result);
      addToast?.({ type: "success", message: `AI context built with ${formatNumber(result.recordCount)} records` });
      await refresh({ force: true });
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "AI context build failed" });
    } finally {
      setAiBusy("");
    }
  }, [activeProjectId, addToast, refresh]);

  const handleCertify = React.useCallback(async (proposalPath, status) => {
    if (!activeProjectId || !proposalPath) return;
    setCertifying(proposalPath);
    try {
      await certifyProposal(activeProjectId, { proposalPath, status });
      addToast?.({ type: "success", message: status === "certified" ? "Proposal certified and contract written" : `Proposal marked ${status}` });
      await refreshProjectFiles?.(activeProjectId);
      await refresh({ force: true });
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "Proposal update failed" });
    } finally {
      setCertifying("");
    }
  }, [activeProjectId, addToast, refreshProjectFiles, refresh]);

  const handleBuildManifest = React.useCallback(async () => {
    if (!activeProjectId) return;
    setBuilding(true);
    try {
      const result = await buildDatalexManifest(activeProjectId);
      setManifestResult(result);
      if (scan?.integrations?.dql?.enabled) {
        const dqlReadiness = await fetchDqlReadiness(activeProjectId, { datalexManifest: result.fullPath, force: true });
        setDqlReadinessResult(dqlReadiness);
      } else {
        setDqlReadinessResult(null);
      }
      addToast?.({ type: "success", message: "DataLex manifest built" });
      await refreshProjectFiles?.(activeProjectId);
      await refresh({ force: true });
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "Manifest build failed" });
    } finally {
      setBuilding(false);
    }
  }, [activeProjectId, addToast, refreshProjectFiles, refresh, scan?.integrations?.dql?.enabled]);

  if (!activeProjectId) {
    return <EmptyState mode={activeMode} onConnect={() => openModal?.("importDbtRepo")} />;
  }

  return (
    <main className="enterprise-workbench">
      <Header scan={scan} mode={activeMode} loading={loading} onRefresh={() => refresh({ force: true })} />
      {(generating || certifying) && (
        <div className="enterprise-running" role="status" aria-live="polite">
          <Loader2 size={14} className="spin" />
          <span>{generating ? `Generating proposal pack for ${label(generating)}…` : "Certifying…"} This can take a moment.</span>
          <div className="enterprise-running-bar"><span /></div>
        </div>
      )}
      {error && <div className="enterprise-error"><AlertTriangle size={16} /> {error}</div>}
      {loading && !scan && <div className="enterprise-loading"><RefreshCw size={16} className="spin" /> Scanning dbt and DataLex metadata...</div>}
      {scan && activeMode === "ai-setup" && (
        <AiSetupView
          scan={scan}
          aiSettings={aiSettings}
          contextStatus={aiContextStatus}
          providerInputs={providerInputs}
          onProviderChange={handleProviderChange}
          onSaveProvider={handleSaveProvider}
          onTestProvider={handleTestProvider}
          onBuildContext={handleBuildAiContext}
          busy={aiBusy}
          onOpenMode={setShellViewMode}
        />
      )}
      {scan && activeMode === "readiness" && (
        <ReadinessView scan={scan} onGenerate={handleGenerate} generating={generating} onOpenMode={setShellViewMode} onOpenAiSetup={openAiSettings} aiReady={aiReady} />
      )}
      {scan && activeMode === "domains" && (
        <DomainsView
          scan={scan}
          onGenerate={handleGenerate}
          generating={generating}
          query={domainQuery}
          onQueryChange={setDomainQuery}
          aiReady={aiReady}
          onOpenSetup={openAiSettings}
        />
      )}
      {scan && activeMode === "proposals" && (
        <ProposalsView
          scan={scan}
          onGenerate={handleGenerate}
          onCertify={handleCertify}
          generating={generating}
          certifying={certifying}
          generationOptions={generationOptions}
          setGenerationOptions={setGenerationOptions}
          filters={proposalFilters}
          setFilters={setProposalFilters}
          aiReady={aiReady}
          onOpenSetup={openAiSettings}
        />
      )}
      {scan && activeMode === "contracts" && <ContractsView scan={scan} filters={contractFilters} setFilters={setContractFilters} />}
      {scan && activeMode === "publish" && (
        <PublishView
          scan={scan}
          manifestResult={manifestResult}
          dqlReadinessResult={dqlReadinessResult}
          building={building}
          onBuild={handleBuildManifest}
        />
      )}
    </main>
  );
}
