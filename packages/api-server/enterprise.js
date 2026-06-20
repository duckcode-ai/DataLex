import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { basename, join, relative } from "path";
import yaml from "js-yaml";

export const CANONICAL_DOMAIN_FOLDERS = Object.freeze([
  "conceptual",
  "logical",
  "physical",
  "contracts",
  "proposals",
  "glossary",
  "semantic",
]);

const SKIP_DIRS = new Set([
  ".git",
  ".datalex",
  ".dql",
  "node_modules",
  "dbt_packages",
  "dbt_modules",
  "target",
  "logs",
  "dist",
  "build",
  "__pycache__",
]);

const FACT_RE = /(^fct_|fact|_fact$|orders?|revenue|ledger|transaction|event)/i;
const MART_RE = /(^fct_|^dim_|mart|marts|presentation|report|dashboard|executive)/i;
const SCAN_LIMITS = Object.freeze({
  proposalPacks: 50,
  contractOpportunities: 200,
  artifactRows: 500,
  dqlRows: 200,
});
const DQL_CONFIG_FILES = Object.freeze([
  "dql.json",
  "dql.config.json",
  ".dql/config.json",
  "dql/dql.json",
  "dql/dql.config.json",
]);

const DISABLED_DQL_SCAN = Object.freeze({
  enabled: false,
  root: "",
  blocks: 0,
  certified_blocks: 0,
  missing_contract_refs: 0,
  certified_without_contract: 0,
  draft_blocks: 0,
  rows: [],
  limits: {
    returned: 0,
    total: 0,
    truncated: false,
  },
});

export function slugify(value, fallback = "core") {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!text) return fallback;
  return /^[0-9]/.test(text) ? `d_${text}` : text;
}

export function pascalize(value, fallback = "Entity") {
  const parts = String(value || "")
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!parts.length) return fallback;
  const out = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
  return /^[A-Za-z]/.test(out) ? out : fallback;
}

export function buildDatalexProjectYaml(projectName = "datalex_project") {
  return yaml.dump({
    kind: "project",
    name: slugify(projectName, "datalex_project"),
    version: "1",
    models: [
      "*/conceptual/**/*.yaml",
      "*/logical/**/*.yaml",
      "*/physical/**/*.yaml",
      "imported/dbt/**/*.yaml",
    ],
    domains: "domains/**/*.yaml",
    glossary: "*/glossary/**/*.yaml",
    diagrams: [
      "*/conceptual/**/*.yaml",
      "*/logical/**/*.yaml",
      "*/physical/**/*.yaml",
      "DataLex/*/Conceptual/**/*.yaml",
      "DataLex/*/Logical/**/*.yaml",
      "DataLex/*/Physical/**/*.yaml",
      "datalex/diagrams/**/*.yaml",
    ],
    contracts: [
      "*/contracts/**/*.yaml",
      "DataLex/*/Contracts/**/*.yaml",
      "DataLex/*/contracts/**/*.yaml",
      "contracts/**/*.yaml",
    ],
    proposals: [
      "*/proposals/**/*.yaml",
      ".datalex/proposals/**/*.yaml",
      "DataLex/*/Proposals/**/*.yaml",
      "DataLex/*/proposals/**/*.yaml",
      "proposals/**/*.yaml",
    ],
    metric_contracts: "*/semantic/**/*.yaml",
    semantic_models: "semantic/**/*.yaml",
  }, { lineWidth: 120, noRefs: true, sortKeys: false });
}

export function ensureCanonicalWorkspace(modelRoot, { projectName = "datalex_project", domains = ["core"] } = {}) {
  mkdirSync(modelRoot, { recursive: true });
  const manifestPath = join(modelRoot, "datalex.yaml");
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, buildDatalexProjectYaml(projectName), "utf-8");
  }
  for (const rel of [
    "domains",
    "imported/dbt/core",
    "generated/dbt/core",
    "generated-sql/ddl",
    "generated-sql/migrations",
    "Skills",
  ]) {
    mkdirSync(join(modelRoot, rel), { recursive: true });
    const keep = join(modelRoot, rel, ".gitkeep");
    if (!existsSync(keep)) writeFileSync(keep, "", "utf-8");
  }
  const domainList = Array.from(new Set((domains || []).map((d) => slugify(d)).filter(Boolean)));
  for (const domain of domainList.length ? domainList : ["core"]) {
    for (const folder of CANONICAL_DOMAIN_FOLDERS) {
      const dir = join(modelRoot, domain, folder);
      mkdirSync(dir, { recursive: true });
      const keep = join(dir, ".gitkeep");
      if (!existsSync(keep)) writeFileSync(keep, "", "utf-8");
    }
  }
}

export function canonicalArtifactPath(domain, folder, name, suffix = "yaml") {
  return `${slugify(domain)}/${folder}/${slugify(name)}.${suffix}`;
}

function loadJson(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function loadYaml(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const doc = yaml.load(readFileSync(path, "utf-8"));
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null;
  } catch {
    return null;
  }
}

function walkFiles(root, predicate = () => true, out = []) {
  if (!root || !existsSync(root)) return out;
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(abs, predicate, out);
    } else if (predicate(abs, entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

function hashFiles(files, basePath = "") {
  const hash = createHash("sha256");
  const seen = new Set();
  for (const file of files.sort()) {
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      hash.update(basePath ? relative(basePath, file) : file);
      hash.update(readFileSync(file));
    } catch {
      // Ignore unreadable files for cache identity; scan will skip them too.
    }
  }
  return hash.digest("hex");
}

export function enterpriseCacheKey({ projectRoot, modelRoot }) {
  const files = [];
  const manifest = join(projectRoot, "target", "manifest.json");
  if (existsSync(manifest)) files.push(manifest);
  files.push(...walkFiles(projectRoot, (abs, name) => {
    if (!/\.ya?ml$/i.test(name)) return false;
    const rel = relative(projectRoot, abs).replace(/\\/g, "/");
    return rel === "dbt_project.yml" || rel.startsWith("models/") || rel.startsWith("semantic_models/");
  }));
  files.push(...walkFiles(modelRoot, (abs, name) => /\.(ya?ml|json)$/i.test(name)));
  for (const rel of DQL_CONFIG_FILES) {
    const file = join(projectRoot, rel);
    if (existsSync(file)) files.push(file);
  }
  const dqlRoot = join(projectRoot, "dql");
  files.push(...walkFiles(dqlRoot, (abs, name) => /\.(dql|dqld|json)$/i.test(name)));
  return hashFiles(files, projectRoot);
}

function nodeColumns(node) {
  if (Array.isArray(node?.columns)) {
    return node.columns.map((column) => ({
      name: column?.name || "",
      type: column?.data_type || column?.type || "",
      description: column?.description || "",
    })).filter((column) => column.name);
  }
  return Object.values(node?.columns || {}).map((column) => ({
    name: column?.name || "",
    type: column?.data_type || column?.type || "",
    description: column?.description || "",
  })).filter((column) => column.name);
}

function ownerOf(node) {
  const config = node?.config && typeof node.config === "object" ? node.config : {};
  const meta = node?.meta && typeof node.meta === "object" ? node.meta : {};
  const cfgMeta = config?.meta && typeof config.meta === "object" ? config.meta : {};
  const raw = node?.owner || meta.owner || cfgMeta.owner;
  if (raw && typeof raw === "object") return raw.email || raw.name || "";
  return String(raw || "");
}

function domainFromPath(pathValue) {
  const parts = String(pathValue || "").replace(/\\/g, "/").split("/").filter(Boolean);
  const marts = parts.indexOf("marts");
  if (marts >= 0 && parts[marts + 1]) return parts[marts + 1];
  const models = parts.indexOf("models");
  if (models >= 0 && parts[models + 1]) return parts[models + 1];
  return "";
}

function domainOfNode(node) {
  const config = node?.config && typeof node.config === "object" ? node.config : {};
  const meta = node?.meta && typeof node.meta === "object" ? node.meta : {};
  const cfgMeta = config?.meta && typeof config.meta === "object" ? config.meta : {};
  const explicit = (
    node?.domain ||
    meta?.datalex?.domain ||
    meta.domain ||
    meta.subject_area ||
    cfgMeta.domain ||
    cfgMeta?.datalex?.domain ||
    node?.group
  );
  return explicit ? slugify(explicit) : "unassigned";
}

function explicitDomainOfArtifact(artifact) {
  const meta = artifact?.meta && typeof artifact.meta === "object" ? artifact.meta : {};
  const explicit = artifact?.domain || meta?.datalex?.domain || meta.domain || artifact?.group;
  return explicit ? slugify(explicit) : "";
}

function contractEnforced(node) {
  const config = node?.config && typeof node.config === "object" ? node.config : {};
  const contract = node?.contract && typeof node.contract === "object" ? node.contract : {};
  const cfgContract = config?.contract && typeof config.contract === "object" ? config.contract : {};
  return Boolean(contract.enforced || cfgContract.enforced);
}

function grainOfModel(node, testIndex) {
  const columns = nodeColumns(node);
  const unique = columns.find((column) => (testIndex.get(node.unique_id)?.get(column.name) || []).includes("unique"));
  if (unique) return `one row per ${unique.name}`;
  const id = columns.find((column) => /(^id$|_id$)/i.test(column.name));
  return id ? `likely one row per ${id.name}` : "";
}

function buildTestIndex(manifest) {
  const out = new Map();
  for (const node of Object.values(manifest?.nodes || {})) {
    if (node?.resource_type !== "test") continue;
    const parent = node.attached_node || (node.depends_on?.nodes || []).find((dep) => String(dep).startsWith("model."));
    const column = node.column_name;
    const testName = node.test_metadata?.name || node.name;
    if (!parent || !column || !testName) continue;
    if (!out.has(parent)) out.set(parent, new Map());
    const byColumn = out.get(parent);
    if (!byColumn.has(column)) byColumn.set(column, []);
    byColumn.get(column).push(String(testName));
  }
  return out;
}

function dbtYamlInventory(projectRoot) {
  const out = {
    models: [],
    metrics: [],
    semantic_models: [],
    exposures: [],
    tests: new Map(),
  };
  const yamlFiles = walkFiles(projectRoot, (abs, name) => /\.ya?ml$/i.test(name));
  for (const file of yamlFiles) {
    const doc = loadYaml(file);
    if (!doc || doc.kind) continue;
    const rel = relative(projectRoot, file).replace(/\\/g, "/");
    for (const model of Array.isArray(doc.models) ? doc.models : []) {
      if (!model?.name) continue;
      const uniqueId = `yaml.model.${model.name}`;
      out.models.push({
        ...model,
        unique_id: uniqueId,
        resource_type: "model",
        original_file_path: rel,
        path: rel,
      });
      const byColumn = new Map();
      for (const column of Array.isArray(model.columns) ? model.columns : []) {
        const names = [];
        for (const test of Array.isArray(column?.tests) ? column.tests : []) {
          if (typeof test === "string") names.push(test);
          else if (test && typeof test === "object") names.push(Object.keys(test)[0]);
        }
        if (column?.name && names.length) byColumn.set(column.name, names);
      }
      if (byColumn.size) out.tests.set(uniqueId, byColumn);
    }
    for (const metric of Array.isArray(doc.metrics) ? doc.metrics : []) {
      if (!metric?.name) continue;
      out.metrics.push({
        ...metric,
        unique_id: `yaml.metric.${metric.name}`,
        name: metric.name,
        type: metric.type || "",
        label: metric.label || "",
        description: metric.description || "",
        original_file_path: rel,
        path: rel,
      });
    }
    for (const semanticModel of Array.isArray(doc.semantic_models) ? doc.semantic_models : []) {
      if (!semanticModel?.name) continue;
      out.semantic_models.push({
        ...semanticModel,
        unique_id: `yaml.semantic_model.${semanticModel.name}`,
        original_file_path: rel,
        path: rel,
      });
    }
    for (const exposure of Array.isArray(doc.exposures) ? doc.exposures : []) {
      if (!exposure?.name) continue;
      out.exposures.push({
        ...exposure,
        unique_id: `yaml.exposure.${exposure.name}`,
        original_file_path: rel,
        path: rel,
      });
    }
  }
  return out;
}

function metricNamesFromManifest(manifest) {
  const names = [];
  for (const [uid, metric] of Object.entries(manifest?.metrics || {})) {
    names.push({
      unique_id: uid,
      name: metric?.name || uid.split(".").pop(),
      type: metric?.type || "",
      label: metric?.label || "",
      description: metric?.description || "",
      domain: explicitDomainOfArtifact(metric),
      meta: metric?.meta || {},
      group: metric?.group || "",
    });
  }
  for (const [uid, semanticModel] of Object.entries(manifest?.semantic_models || {})) {
    const semanticDomain = explicitDomainOfArtifact(semanticModel);
    for (const measure of semanticModel?.measures || []) {
      if (measure?.name) {
        names.push({
          unique_id: `${uid}.measure.${measure.name}`,
          name: measure.name,
          type: "measure",
          label: measure.label || "",
          description: measure.description || "",
          semantic_model: semanticModel.name || uid.split(".").pop(),
          domain: explicitDomainOfArtifact(measure) || semanticDomain,
          meta: measure?.meta || {},
          group: measure?.group || "",
        });
      }
    }
  }
  const seen = new Set();
  return names.filter((metric) => {
    const key = String(metric.name || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function metricFamily(name) {
  const text = String(name || "").toLowerCase();
  if (/revenue|sales|spend|ltv|order_total|amount|cost/.test(text)) return "revenue";
  if (/order/.test(text)) return "orders";
  if (/customer|account|buyer/.test(text)) return "customers";
  if (/product|item|sku|supply/.test(text)) return "products";
  if (/location|region|store|market/.test(text)) return "locations";
  if (/risk|fraud|loss|late|churn/.test(text)) return "risk";
  return "core";
}

function scanDatalexArtifacts(modelRoot) {
  const artifacts = {
    contracts: [],
    proposals: [],
    metric_contracts: [],
    domains: [],
    diagrams: [],
    terms: [],
    generated_dbt: [],
  };
  const yamlFiles = walkFiles(modelRoot, (abs, name) => /\.ya?ml$/i.test(name));
  for (const file of yamlFiles) {
    const doc = loadYaml(file);
    const rel = relative(modelRoot, file).replace(/\\/g, "/");
    if (!doc?.kind) {
      if (rel.startsWith("generated/dbt/")) {
        artifacts.generated_dbt.push({
          path: rel,
          name: basename(file).replace(/\.ya?ml$/i, ""),
          domain: slugify(rel.split("/")[2] || "core"),
        });
      }
      continue;
    }
    const row = {
      path: rel,
      name: doc.name || basename(file).replace(/\.ya?ml$/i, ""),
      domain: slugify(doc.domain || rel.split("/")[0] || "core"),
      status: String(doc.status || "draft").toLowerCase(),
      owner: doc.owner || "",
      source: doc.source || null,
      evidence: doc.evidence || null,
      confidence: Number(doc.evidence?.confidence ?? doc.confidence ?? 0),
      proposal_type: doc.proposal_type || "",
      summary: doc.summary || doc.description || "",
      target: doc.target || "",
      proposed_change: doc.proposed_change || null,
      raw: doc,
    };
    if (doc.kind === "contract") artifacts.contracts.push(row);
    else if (doc.kind === "proposal") artifacts.proposals.push(row);
    else if (doc.kind === "metric_contract") artifacts.metric_contracts.push(row);
    else if (doc.kind === "domain") artifacts.domains.push(row);
    else if (doc.kind === "diagram") artifacts.diagrams.push(row);
    else if (doc.kind === "term") artifacts.terms.push(row);
  }
  return artifacts;
}

function readDqlIntegration(modelRoot, projectRoot) {
  const config = loadYaml(join(modelRoot, "datalex.yaml")) || {};
  const dql = config?.integrations?.dql || config?.dql || {};
  const enabled = dql?.enabled === true || String(dql?.enabled || "").toLowerCase() === "true";
  return {
    enabled,
    path: dql?.path || "dql",
    manifest: dql?.manifest || "",
    configured: Boolean(config?.integrations?.dql || config?.dql),
    root: dql?.path ? join(projectRoot, dql.path) : join(projectRoot, "dql"),
  };
}

function scanDql(projectRoot, certifiedContracts, integration = {}) {
  if (!integration?.enabled) return { ...DISABLED_DQL_SCAN };
  const dqlRoot = integration.root || join(projectRoot, integration.path || "dql");
  const contractIds = new Set();
  for (const contract of certifiedContracts) {
    const id = contract.raw?.id || contract.name;
    if (!id) continue;
    contractIds.add(id);
    contractIds.add(`${id}@${contract.raw?.version || 1}`);
  }
  const rows = [];
  for (const file of walkFiles(dqlRoot, (abs, name) => /\.dql$/i.test(name))) {
    let text = "";
    try { text = readFileSync(file, "utf-8"); } catch { continue; }
    const status = (text.match(/status\s*=\s*"([^"]+)"/)?.[1] || "draft").toLowerCase();
    const ref = text.match(/datalex_contract\s*=\s*"([^"]+)"/)?.[1] || "";
    rows.push({
      path: relative(dqlRoot, file).replace(/\\/g, "/"),
      status,
      datalex_contract: ref,
      resolves: ref ? contractIds.has(ref) : false,
    });
  }
  const certified = rows.filter((row) => row.status === "certified");
  return {
    root: existsSync(dqlRoot) ? dqlRoot : "",
    blocks: rows.length,
    certified_blocks: certified.length,
    missing_contract_refs: certified.filter((row) => row.datalex_contract && !row.resolves).length,
    certified_without_contract: certified.filter((row) => !row.datalex_contract).length,
    draft_blocks: rows.filter((row) => row.status !== "certified").length,
    rows: rows.slice(0, SCAN_LIMITS.dqlRows),
    limits: {
      returned: Math.min(rows.length, SCAN_LIMITS.dqlRows),
      total: rows.length,
      truncated: rows.length > SCAN_LIMITS.dqlRows,
    },
  };
}

function emptyDomain(name) {
  return {
    name,
    models: 0,
    fact_tables: 0,
    semantic_metrics: 0,
    semantic_models: 0,
    exposures: 0,
    existing_dbt_contracts: 0,
    missing_contracts: 0,
    high_value_marts: 0,
    missing_owners: 0,
    missing_descriptions: 0,
    unclear_grains: 0,
    relationship_gaps: 0,
    datalex_contracts: 0,
    certified_contracts: 0,
    draft_proposals: 0,
    dql_ready_contracts: 0,
    diagrams: 0,
    glossary_terms: 0,
    metric_contracts: 0,
    generated_dbt_suggestions: 0,
    priority: 0,
    top_models: [],
    metric_families: [],
    gaps: [],
  };
}

function pushTop(list, value, limit = 8) {
  if (!value || list.includes(value)) return;
  if (list.length < limit) list.push(value);
}

function buildProposalPack(domain, opportunities, metricFamilies) {
  const topModels = opportunities.slice(0, 5);
  const families = metricFamilies.slice(0, 8);
  const name = `${domain.name}_core_certification`;
  return {
    id: `${domain.name}.${name}`,
    name,
    domain: domain.name,
    title: `${domain.name.replace(/_/g, " ")} Core Certification Pack`,
    status: "not_generated",
    priority: domain.priority,
    scope: {
      fact_tables: topModels.filter((item) => item.maturity === "fact_table" || item.maturity === "high_value").length,
      metric_families: families.length,
      models: topModels.length,
    },
    includes: [
      "business domain proposal",
      "conceptual diagram",
      "logical diagram",
      "physical dbt-backed diagram",
      "DataLex contract drafts",
      "metric contract family drafts",
      "glossary/docs proposals",
      "dbt contract suggestions",
    ],
    evidence: {
      source_models: topModels.map((item) => item.unique_id),
      semantic_metrics: families.flatMap((family) => family.metrics.slice(0, 10)),
      confidence: topModels.length || families.length ? 0.82 : 0.55,
      assumptions: [
        "AI should generate a focused draft pack; users approve artifacts before certification.",
        "dbt remains the physical source of truth.",
      ],
      open_questions: [
        "Confirm the domain owner.",
        "Confirm the certified metric grain and tax/cancelled-order policy where applicable.",
      ],
    },
  };
}

export function buildEnterpriseScan({ project, modelRoot, readinessReview = null, aiStatus = null }) {
  const projectRoot = project.path;
  const manifestPath = join(projectRoot, "target", "manifest.json");
  const manifest = loadJson(manifestPath);
  const yamlInventory = manifest ? { models: [], metrics: [], semantic_models: [], exposures: [], tests: new Map() } : dbtYamlInventory(projectRoot);
  const testIndex = buildTestIndex(manifest);
  for (const [key, value] of yamlInventory.tests.entries()) testIndex.set(key, value);
  const metrics = [...metricNamesFromManifest(manifest), ...yamlInventory.metrics];
  const modelNodes = manifest
    ? Object.values(manifest?.nodes || {}).filter((node) => node?.resource_type === "model")
    : yamlInventory.models;
  const semanticModels = manifest
    ? Object.values(manifest?.semantic_models || {})
    : yamlInventory.semantic_models;
  const exposures = manifest
    ? Object.values(manifest?.exposures || {})
    : yamlInventory.exposures;
  const artifacts = scanDatalexArtifacts(modelRoot);
  const certifiedContracts = artifacts.contracts.filter((contract) => contract.status === "certified");
  const dqlIntegration = readDqlIntegration(modelRoot, projectRoot);
  const dql = scanDql(projectRoot, certifiedContracts, dqlIntegration);
  const domains = new Map();
  const opportunities = [];

  const ensureDomain = (name) => {
    const key = slugify(name);
    if (!domains.has(key)) domains.set(key, emptyDomain(key));
    return domains.get(key);
  };

  for (const node of modelNodes) {
    const domain = ensureDomain(domainOfNode(node));
    const modelName = node.name || node.unique_id?.split(".").pop() || "model";
    const path = node.original_file_path || node.path || "";
    const isFact = FACT_RE.test(modelName) || FACT_RE.test(path);
    const highValue = MART_RE.test(modelName) || MART_RE.test(path);
    const contracted = contractEnforced(node);
    const ownerMissing = !ownerOf(node);
    const descMissing = !String(node.description || "").trim();
    const grain = grainOfModel(node, testIndex);
    const grainMissing = isFact && !grain;
    const tests = testIndex.get(node.unique_id) || new Map();
    const relationshipGap = nodeColumns(node).filter((column) => /_id$/i.test(column.name) && !(tests.get(column.name) || []).includes("relationships")).length;

    domain.models += 1;
    if (isFact) domain.fact_tables += 1;
    if (contracted) domain.existing_dbt_contracts += 1;
    else domain.missing_contracts += 1;
    if (highValue) domain.high_value_marts += 1;
    if (ownerMissing) domain.missing_owners += 1;
    if (descMissing) domain.missing_descriptions += 1;
    if (grainMissing) domain.unclear_grains += 1;
    domain.relationship_gaps += relationshipGap;
    domain.priority += (isFact ? 10 : 0) + (highValue ? 6 : 0) + (contracted ? 4 : 0) + relationshipGap;
    pushTop(domain.top_models, modelName);

    if (!contracted && (isFact || highValue || metrics.length)) {
      opportunities.push({
        id: `${domain.name}.${modelName}`,
        domain: domain.name,
        model: modelName,
        unique_id: node.unique_id,
        path,
        maturity: isFact ? "fact_table" : highValue ? "high_value" : "contract_opportunity",
        reason: isFact
          ? "fact table or order/revenue-like model without an enforced dbt contract"
          : "high-value mart or metric-adjacent model without an enforced dbt contract",
        grain: grain || "",
        columns: nodeColumns(node).map((column) => column.name).slice(0, 20),
        tests: Array.from(tests.entries()).flatMap(([column, names]) => names.map((name) => `${column}:${name}`)).slice(0, 20),
        semantic_metrics: metrics.map((metric) => metric.name).slice(0, 30),
        confidence: isFact ? 0.84 : 0.72,
      });
    }
  }

  for (const semanticModel of semanticModels) {
    const semanticDomain = semanticModel?.meta?.datalex?.domain || semanticModel?.meta?.domain || semanticModel.group || "unassigned";
    const domain = ensureDomain(semanticDomain);
    domain.semantic_models += 1;
  }

  const metricsByFamily = new Map();
  for (const metric of metrics) {
    const family = metricFamily(metric.name);
    if (!metricsByFamily.has(family)) metricsByFamily.set(family, []);
    metricsByFamily.get(family).push(metric);
  }
  const metricFamilies = Array.from(metricsByFamily.entries()).map(([family, rows]) => ({
    family,
    metrics: rows.map((metric) => metric.name).sort(),
    count: rows.length,
  })).sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));

  for (const metric of metrics) {
    const domain = ensureDomain(explicitDomainOfArtifact(metric) || "unassigned");
    const familyName = metricFamily(metric.name);
    let family = domain.metric_families.find((item) => item.family === familyName);
    if (!family) {
      family = { family: familyName, metrics: [], count: 0 };
      domain.metric_families.push(family);
    }
    family.metrics.push(metric.name);
    family.metrics.sort();
    family.count = family.metrics.length;
    domain.semantic_metrics += 1;
    domain.priority += 1;
  }

  for (const exposure of exposures) {
    const exposureDomain = explicitDomainOfArtifact(exposure) || "unassigned";
    const domain = ensureDomain(exposureDomain);
    domain.exposures += 1;
    domain.priority += 8;
  }

  for (const contract of artifacts.contracts) {
    const domain = ensureDomain(contract.domain);
    domain.datalex_contracts += 1;
    if (contract.status === "certified") {
      domain.certified_contracts += 1;
      domain.dql_ready_contracts += 1;
    }
  }
  for (const proposal of artifacts.proposals) {
    const domain = ensureDomain(proposal.domain);
    if (proposal.status === "draft") domain.draft_proposals += 1;
  }
  for (const diagram of artifacts.diagrams) {
    ensureDomain(diagram.domain).diagrams += 1;
  }
  for (const term of artifacts.terms) {
    ensureDomain(term.domain).glossary_terms += 1;
  }
  for (const metricContract of artifacts.metric_contracts) {
    const domain = ensureDomain(metricContract.domain);
    domain.metric_contracts += 1;
    if (metricContract.status === "certified") domain.dql_ready_contracts += 1;
  }
  for (const suggestion of artifacts.generated_dbt) {
    ensureDomain(suggestion.domain).generated_dbt_suggestions += 1;
  }

  const domainRows = Array.from(domains.values()).map((domain) => {
    const gaps = [];
    if (domain.missing_contracts) gaps.push("missing_contracts");
    if (domain.missing_owners) gaps.push("missing_owners");
    if (domain.missing_descriptions) gaps.push("missing_descriptions");
    if (domain.unclear_grains) gaps.push("unclear_grains");
    if (domain.relationship_gaps) gaps.push("relationship_gaps");
    return { ...domain, gaps };
  }).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));

  const proposalsByDomain = new Map();
  for (const proposal of artifacts.proposals) {
    if (!proposalsByDomain.has(proposal.domain)) proposalsByDomain.set(proposal.domain, []);
    proposalsByDomain.get(proposal.domain).push(proposal);
  }

  const packs = domainRows.slice(0, SCAN_LIMITS.proposalPacks).map((domain) => {
    const existing = (proposalsByDomain.get(domain.name) || []).find((proposal) => /core_certification/.test(proposal.name));
    const domainOpportunities = opportunities.filter((item) => item.domain === domain.name);
    const pack = buildProposalPack(domain, domainOpportunities, domain.metric_families);
    return existing ? { ...pack, status: existing.status, proposal_path: existing.path } : pack;
  });

  const readinessSummary = readinessReview?.summary || { total_files: 0, red: 0, yellow: 0, green: 0, findings: 0, score: 100 };
  const blocked = dqlIntegration.enabled ? dql.missing_contract_refs + dql.certified_without_contract : 0;

  return {
    ok: true,
    projectId: project.id,
    generatedAt: new Date().toISOString(),
    cacheKey: enterpriseCacheKey({ projectRoot, modelRoot }),
    flow: ["Connect", "AI Setup", "Readiness", "Generate", "Review", "Contracts", "Publish"],
    detected: {
      dbt_project: existsSync(join(projectRoot, "dbt_project.yml")),
      manifest_json: existsSync(manifestPath),
      datalex_workspace: existsSync(modelRoot),
      dql_workspace: dqlIntegration.enabled && Boolean(dql.root),
      dql_integration: Boolean(dqlIntegration.enabled),
    },
    integrations: {
      dql: {
        enabled: Boolean(dqlIntegration.enabled),
        configured: Boolean(dqlIntegration.configured),
        path: dqlIntegration.path,
        manifest: dqlIntegration.manifest,
      },
    },
    ai: aiStatus || {
      ready: false,
      reason: "not_checked",
      message: "Configure and test OpenAI, Claude, or Ollama before AI generation.",
    },
    project: {
      name: manifest?.metadata?.project_name || project.name || "dbt_project",
      adapter: manifest?.metadata?.adapter_type || "",
      path: projectRoot,
      datalexRoot: modelRoot,
    },
    totals: {
      models: domainRows.reduce((sum, d) => sum + d.models, 0),
      fact_tables: domainRows.reduce((sum, d) => sum + d.fact_tables, 0),
      semantic_metrics: metrics.length,
      semantic_models: semanticModels.length,
      exposures: exposures.length,
      domains_detected: domainRows.length,
      existing_dbt_contracts: domainRows.reduce((sum, d) => sum + d.existing_dbt_contracts, 0),
      missing_contracts: domainRows.reduce((sum, d) => sum + d.missing_contracts, 0),
      datalex_contracts: artifacts.contracts.length,
      certified_contracts: certifiedContracts.length,
      proposals: artifacts.proposals.length,
      draft_proposals: artifacts.proposals.filter((p) => p.status === "draft").length,
      rejected_proposals: artifacts.proposals.filter((p) => p.status === "rejected").length,
      dql_ready_contracts: certifiedContracts.length + artifacts.metric_contracts.filter((m) => m.status === "certified").length,
      metric_contracts: artifacts.metric_contracts.length,
      diagrams: artifacts.diagrams.length,
      glossary_terms: artifacts.terms.length,
      generated_dbt_suggestions: artifacts.generated_dbt.length,
      missing_owners: domainRows.reduce((sum, d) => sum + d.missing_owners, 0),
      missing_descriptions: domainRows.reduce((sum, d) => sum + d.missing_descriptions, 0),
      unclear_grains: domainRows.reduce((sum, d) => sum + d.unclear_grains, 0),
      relationship_gaps: domainRows.reduce((sum, d) => sum + d.relationship_gaps, 0),
    },
    domains: domainRows,
    metric_families: metricFamilies,
    proposal_packs: packs,
    contract_opportunities: opportunities.sort((a, b) => b.confidence - a.confidence).slice(0, SCAN_LIMITS.contractOpportunities),
    contracts: artifacts.contracts.map(({ raw, ...row }) => row).slice(0, SCAN_LIMITS.artifactRows),
    proposals: artifacts.proposals.map(({ raw, ...row }) => row).slice(0, SCAN_LIMITS.artifactRows),
    limits: {
      proposal_packs: {
        returned: packs.length,
        total: domainRows.length,
        truncated: domainRows.length > SCAN_LIMITS.proposalPacks,
      },
      contract_opportunities: {
        returned: Math.min(opportunities.length, SCAN_LIMITS.contractOpportunities),
        total: opportunities.length,
        truncated: opportunities.length > SCAN_LIMITS.contractOpportunities,
      },
      contracts: {
        returned: Math.min(artifacts.contracts.length, SCAN_LIMITS.artifactRows),
        total: artifacts.contracts.length,
        truncated: artifacts.contracts.length > SCAN_LIMITS.artifactRows,
      },
      proposals: {
        returned: Math.min(artifacts.proposals.length, SCAN_LIMITS.artifactRows),
        total: artifacts.proposals.length,
        truncated: artifacts.proposals.length > SCAN_LIMITS.artifactRows,
      },
      dql_blocks: dql.limits,
    },
    readiness: readinessSummary,
    publish: {
      status: blocked ? "blocked" : certifiedContracts.length ? "ready" : "warning",
      manifest: certifiedContracts.length ? "ready" : "warning",
      certified_contracts: certifiedContracts.length,
      draft_proposals: artifacts.proposals.filter((p) => p.status === "draft").length,
      dql_enabled: Boolean(dqlIntegration.enabled),
      dql_certified_blocks: dqlIntegration.enabled ? dql.certified_blocks : 0,
      dql_missing_contract_refs: dqlIntegration.enabled ? dql.missing_contract_refs : 0,
      dql_certified_without_contract: dqlIntegration.enabled ? dql.certified_without_contract : 0,
      rejected_proposals_excluded: artifacts.proposals.filter((p) => p.status === "rejected").length,
      warnings: [
        ...(existsSync(manifestPath) ? [] : ["target/manifest.json not found; scan is YAML/DataLex-only."]),
        ...(certifiedContracts.length ? [] : ["No certified DataLex contracts yet."]),
        ...(dqlIntegration.enabled && blocked ? ["DQL integration is enabled and has missing contract references."] : []),
      ],
    },
    dql,
  };
}

export function buildDraftProposalPack(scan, { domain = "", packType = "core_certification", scopeSize = "focused" } = {}) {
  const domainName = slugify(domain || scan.domains?.[0]?.name || "core");
  const selectedDomain = scan.domains.find((item) => item.name === domainName) || emptyDomain(domainName);
  const opportunities = (scan.contract_opportunities || []).filter((item) => item.domain === domainName).slice(0, scopeSize === "larger" ? 12 : 5);
  const metricFamilies = (scan.metric_families || []).filter((family) => family.family === domainName || domainName === "semantic").slice(0, 8);
  const pack = buildProposalPack(selectedDomain, opportunities, metricFamilies);
  const name = slugify(`${domainName}_${packType}`);
  const path = canonicalArtifactPath(domainName, "proposals", name, "proposal.yaml");
  const proposalType = ({
    core_certification: "datalex_contract",
    datalex_contract: "datalex_contract",
    dbt_contract: "dbt_contract",
    metric_contract: "metric_contract",
    glossary: "glossary",
    documentation: "documentation",
    conceptual_model: "conceptual_model",
    logical_entity: "logical_entity",
    relationship: "relationship",
    domain: "domain",
    dql_block: "dql_block",
  })[packType] || "datalex_contract";
  const proposedChangesByType = {
    domain: [`domains/${domainName}.yaml`],
    conceptual_model: [`${domainName}/conceptual/${name}.diagram.yaml`],
    logical_entity: [`${domainName}/logical/${name}.diagram.yaml`],
    relationship: [
      `${domainName}/conceptual/${name}.diagram.yaml`,
      `${domainName}/logical/${name}.diagram.yaml`,
      `${domainName}/physical/${name}.diagram.yaml`,
    ],
    dbt_contract: [
      `${domainName}/physical/${name}.diagram.yaml`,
      `generated/dbt/${domainName}/${slugify(opportunities[0]?.model || name)}.contract.yml`,
    ],
    metric_contract: metricFamilies.length
      ? metricFamilies.map((family) => `${domainName}/semantic/${slugify(`${family.family}_metrics`)}.metric.yaml`)
      : [`${domainName}/semantic/${name}.metric.yaml`],
    glossary: [`${domainName}/glossary/${domainName}.term.yaml`],
    documentation: [`${domainName}/glossary/${domainName}.term.yaml`],
    dql_block: [],
    datalex_contract: [
      `domains/${domainName}.yaml`,
      `${domainName}/conceptual/${name}.diagram.yaml`,
      `${domainName}/logical/${name}.diagram.yaml`,
      `${domainName}/physical/${name}.diagram.yaml`,
      `${domainName}/contracts/${name}.contract.yaml`,
      `${domainName}/semantic/${domainName}_metrics.metric.yaml`,
      `${domainName}/glossary/${domainName}.term.yaml`,
      `generated/dbt/${domainName}/${slugify(opportunities[0]?.model || name)}.contract.yml`,
    ],
  };
  const proposedChanges = proposedChangesByType[proposalType] || proposedChangesByType.datalex_contract;
  return {
    path,
    content: yaml.dump({
      kind: "proposal",
      name,
      proposal_type: proposalType,
      status: "draft",
      domain: domainName,
      target: `${domainName} certification pack`,
      summary: pack.title,
      proposed_change: {
        pack_type: packType,
        scope_size: scopeSize,
        files: proposedChanges,
        includes: pack.includes,
      },
      evidence: pack.evidence,
      created_by: "datalex-enterprise-scan",
      created_at: new Date().toISOString(),
      meta: {
        proposal_pack: pack,
        contract_opportunities: opportunities,
        metric_families: metricFamilies,
      },
    }, { lineWidth: 120, noRefs: true, sortKeys: false }),
  };
}
