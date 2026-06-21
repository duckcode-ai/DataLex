/* SkillsManager — author the agent Skills that teach DataLex when to apply
   your business / dbt / governance standards. Moved out of the left sidebar
   into Settings so the modeling sidebar stays focused on objects and files.
   Self-contained: reads the workspace store directly. */
import React from "react";
import { Sparkles, Plus, FileText } from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import { rebuildAiIndex } from "../../lib/api";

const DATALEX_SKILL_FOLDER = "Skills";

const SKILL_TEMPLATES = [
  {
    id: "conceptual", name: "conceptual-business-modeling", title: "Conceptual",
    description: "Business concepts, domains, owners, glossary terms, and business relationships.",
    useWhen: "conceptual model\nbusiness concept\nbusiness scenario\ndomain model\nbounded context",
    tags: "conceptual,business,glossary", layers: "conceptual",
    agentModes: "conceptual_architect\nrelationship_modeler",
    body: "- Create concepts, not tables.\n- Require description, owner, subject_area, domain, tags, and glossary terms when known.\n- Use relationship verbs in business language.\n- Ask follow-up questions when business meaning is unclear.",
  },
  {
    id: "logical", name: "logical-modeling-standards", title: "Logical",
    description: "Entities, attributes, candidate keys, optionality, and lineage.",
    useWhen: "logical model\nattribute\ncandidate key\nnormalization\npromote to logical",
    tags: "logical,attributes,keys", layers: "logical",
    agentModes: "logical_modeler\nyaml_patch_engineer",
    body: "- Preserve conceptual lineage with derived_from or mapped_from metadata.\n- Define attributes with business names and descriptions.\n- Identify candidate keys and optionality from business meaning.\n- Avoid warehouse-only implementation choices.",
  },
  {
    id: "physical", name: "physical-dbt-modeling", title: "Physical dbt",
    description: "dbt YAML, columns, datatypes, tests, constraints, and contracts.",
    useWhen: "physical model\ndbt\nschema.yml\ncolumn\ndatatype\ntest\nconstraint",
    tags: "physical,dbt,tests,constraints", layers: "physical",
    agentModes: "physical_dbt_developer\nyaml_patch_engineer",
    body: "- Preserve existing dbt YAML, descriptions, tests, tags, meta, and contracts.\n- Prefer focused YAML patches over full-file rewrites.\n- Infer datatypes from existing YAML, SQL, catalog metadata, or clear naming conventions.\n- Do not run dbt or apply DDL.",
  },
  {
    id: "contract", name: "domain-contract-designer", title: "Contracts",
    description: "Domain-specific DataLex contracts for DQL certification, accepted sources, metrics, grain, and review policy.",
    useWhen: "DataLex contract\ncertified block\naccepted source\nmetric grain\nDQL certification\nbusiness definition",
    tags: "contract,certification,domain,metrics,lineage", layers: "conceptual,logical,physical",
    agentModes: "contract_designer\ngovernance_reviewer\nyaml_patch_engineer",
    body: "- Start from the selected business concept and domain vocabulary; do not write generic contract boilerplate.\n- Define the business decision value, grain, accepted sources, metrics, dimensions, required tests, owner, and certification policy.\n- Use dbt, semantic, lineage, glossary, and peer concept context to recommend accepted_sources with confidence and rationale.\n- If source, grain, owner, or metric logic is uncertain, keep the contract in draft and add open_questions instead of inventing facts.",
  },
  {
    id: "governance", name: "governance-and-validation", title: "Governance",
    description: "Validation, coverage, ownership, policy, and quality rules.",
    useWhen: "validation\ncoverage\ngovernance\nmissing description\nmissing owner\npolicy",
    tags: "governance,validation,quality", layers: "conceptual,logical,physical",
    agentModes: "governance_reviewer\nyaml_patch_engineer",
    body: "- Explain what is missing, why it matters, and the smallest safe YAML fix.\n- Separate blockers from documentation quality improvements.\n- Prioritize owner, description, glossary, keys, tests, and relationship endpoints by layer.",
  },
];

function skillSlug(value) {
  return String(value || "modeling-skill").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "modeling-skill";
}
function skillList(value, fallback = []) {
  const items = String(value || "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
}
function buildSkillContent({ name, description, useWhen, tags, layers, agentModes, body }) {
  const title = String(name || "modeling-skill").trim();
  const useWhenList = skillList(useWhen, ["modeling assistance"]);
  const tagList = skillList(tags, ["modeling"]);
  const layerList = skillList(layers, ["conceptual", "logical", "physical"]);
  const agentModeList = skillList(agentModes, ["governance_reviewer"]);
  return [
    "---",
    `name: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(String(description || "DataLex AI modeling skill").trim())}`,
    "use_when:", ...useWhenList.map((i) => `  - ${JSON.stringify(i)}`),
    "tags:", ...tagList.map((i) => `  - ${JSON.stringify(i)}`),
    "layers:", ...layerList.map((i) => `  - ${JSON.stringify(i)}`),
    "agent_modes:", ...agentModeList.map((i) => `  - ${JSON.stringify(i)}`),
    "priority: 1", "---", "",
    `# ${title}`, "", "## When to use", ...useWhenList.map((i) => `- ${i}`),
    "", "## Instructions", String(body || "- Add your team's modeling standards here.").trim(), "",
  ].join("\n");
}

export default function SkillsManager() {
  const projectFiles = useWorkspaceStore((s) => s.projectFiles);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const offlineMode = useWorkspaceStore((s) => s.offlineMode);
  const openFile = useWorkspaceStore((s) => s.switchTab);
  const createNewFile = useWorkspaceStore((s) => s.createNewFile);
  const addToast = useUiStore((s) => s.addToast);
  const closeModal = useUiStore((s) => s.closeModal);

  const initial = SKILL_TEMPLATES[0];
  const [selected, setSelected] = React.useState(initial.id);
  const [name, setName] = React.useState(initial.name);
  const [description, setDescription] = React.useState(initial.description);
  const [useWhen, setUseWhen] = React.useState(initial.useWhen);
  const [tags, setTags] = React.useState(initial.tags);
  const [layers, setLayers] = React.useState(initial.layers);
  const [agentModes, setAgentModes] = React.useState(initial.agentModes);
  const [body, setBody] = React.useState(initial.body);
  const [status, setStatus] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const explorerReady = !offlineMode && !!activeProjectId;

  const skillFiles = React.useMemo(() => (
    (projectFiles || [])
      .filter((f) => String(f.path || f.name || "").replace(/\\/g, "/").toLowerCase().startsWith(`${DATALEX_SKILL_FOLDER.toLowerCase()}/`))
      .sort((a, b) => String(a.path || a.name || "").localeCompare(String(b.path || b.name || "")))
  ), [projectFiles]);

  const applyTemplate = (id) => {
    const t = SKILL_TEMPLATES.find((x) => x.id === id) || SKILL_TEMPLATES[0];
    setSelected(t.id); setName(t.name); setDescription(t.description);
    setUseWhen(t.useWhen); setTags(t.tags); setLayers(t.layers);
    setAgentModes(t.agentModes); setBody(t.body);
  };

  const createSkill = async () => {
    if (!explorerReady) { setStatus("Open a local project before creating skills."); return; }
    const slug = skillSlug(name);
    const content = buildSkillContent({ name, description, useWhen, tags, layers, agentModes, body });
    setBusy(true); setStatus("");
    try {
      const skillPath = `${DATALEX_SKILL_FOLDER}/${slug}.md`;
      await createNewFile(skillPath, content);
      await rebuildAiIndex(activeProjectId).catch(() => null);
      addToast?.({ type: "success", message: `Created AI skill ${skillPath}` });
      setStatus(`Created and indexed ${skillPath}.`);
    } catch (err) {
      setStatus(`Skill create failed: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dlx-settings-pane">
      <header>
        <h3 className="dlx-settings-pane-title">Agent skills</h3>
        <p className="dlx-settings-pane-sub">Teach DataLex when to apply your business, dbt, and governance standards. Skills are indexed automatically and selected by intent during agent runs.</p>
      </header>

      <div className="left-skills-templates">
        {SKILL_TEMPLATES.map((t) => (
          <button key={t.id} type="button"
            className={`left-skill-template ${selected === t.id ? "active" : ""}`}
            onClick={() => applyTemplate(t.id)}>
            <strong>{t.title}</strong>
            <span>{t.description}</span>
          </button>
        ))}
      </div>

      <div className="left-skill-form">
        <label><span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="business-modeling-standards" /></label>
        <label><span>Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When this skill should guide the AI" /></label>
        <label><span>Use when</span>
          <textarea rows={3} value={useWhen} onChange={(e) => setUseWhen(e.target.value)} placeholder="One trigger per line" /></label>
        <div className="left-skill-grid">
          <label><span>Tags</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="dbt,governance" /></label>
          <label><span>Layers</span>
            <input value={layers} onChange={(e) => setLayers(e.target.value)} placeholder="conceptual,logical,physical" /></label>
        </div>
        <label><span>Agent modes</span>
          <textarea rows={2} value={agentModes} onChange={(e) => setAgentModes(e.target.value)} placeholder="physical_dbt_developer" /></label>
        <label><span>Instructions</span>
          <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write the rules this skill should enforce..." /></label>
        <button className="left-skill-create" type="button" onClick={createSkill} disabled={busy || !explorerReady}>
          <Plus size={13} /> {busy ? "Creating..." : "Create skill"}
        </button>
        {!explorerReady && <div className="left-skill-status">Open a local project to create skills.</div>}
        {status && <div className="left-skill-status">{status}</div>}
      </div>

      <div className="left-skills-existing">
        <div className="left-skills-heading">Existing skills <span>{skillFiles.length}</span></div>
        {skillFiles.length === 0 ? (
          <div className="left-skills-empty">No skill files yet. Create one from a template above.</div>
        ) : skillFiles.map((file) => (
          <button key={file.fullPath || file.path || file.name} type="button" className="left-skill-file"
            onClick={() => { openFile?.(file); closeModal?.(); }}>
            <FileText size={13} />
            <span>{file.path || file.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
