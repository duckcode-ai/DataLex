/* Home — the dedicated landing for the workspace. Replaces the old
   slide-in onboarding journey panel with a full page that lays out the
   AI-first flow as clean, explained steps, each showing live status
   derived from real project signals (not a localStorage checklist):

     1. Connect a dbt project        done when a project is open
     2. Set up your AI provider      done when a key/local provider is set
     3. Detect with AI               done when contracts/proposals exist
     4. Model conceptual→logical→…   done when diagrams exist
     5. Certify & publish            done when a contract is certified

   The status tiles up top summarize where the project stands at a glance.
   Navigation is delegated to the shell (rail destinations / dialogs). */
import React from "react";
import {
  FolderGit2, Sparkles, ScanSearch, Boxes, Rocket,
  Check, ArrowRight, ShieldCheck, GitBranch, Database, Activity,
} from "lucide-react";
import { fetchEnterpriseScan } from "../lib/api";

function aiConfigured() {
  try {
    if (localStorage.getItem("datalex.ai.apiKey")) return true;
    if (localStorage.getItem("datalex.ai.provider") === "local") return true;
    return false;
  } catch {
    return false;
  }
}

function StatusTile({ icon: Icon, label, value, tone = "" }) {
  return (
    <div className={`home-tile ${tone ? `tone-${tone}` : ""}`}>
      <div className="home-tile-head"><Icon size={14} strokeWidth={1.8} /> {label}</div>
      <div className="home-tile-value">{value}</div>
    </div>
  );
}

export default function HomeView({
  projectName,
  hasProject,
  isDemo,
  projectId,
  branch = "main",
  changedCount = 0,
  gate = { tone: "ok", label: "passing" },
  onGoto,
  onConnect,
  onOpenAi,
}) {
  const [scan, setScan] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!projectId) { setScan(null); return; }
    let cancelled = false;
    setLoading(true);
    fetchEnterpriseScan(projectId, tick ? { force: true } : {})
      .then((res) => { if (!cancelled) setScan(res?.scan || res || null); })
      .catch(() => { if (!cancelled) setScan(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, tick]);

  // Re-scan when AI is connected in Settings so the status flips live.
  React.useEffect(() => {
    const onChanged = () => setTick((n) => n + 1);
    window.addEventListener("datalex:ai-changed", onChanged);
    return () => window.removeEventListener("datalex:ai-changed", onChanged);
  }, []);

  const totals = scan?.totals || {};
  // Use the server's readiness (provider saved + tested) when a project is
  // loaded, so Home agrees with the enterprise pages. Fall back to the
  // browser-config check only before a project exists.
  const aiReady = projectId ? Boolean(scan?.ai?.ready) : aiConfigured();
  const detected = (totals.datalex_contracts || 0) > 0 || (totals.proposals || 0) > 0;
  const modeled = (totals.diagrams || 0) > 0;
  const certified = (totals.certified_contracts || 0) > 0;

  const steps = [
    {
      id: "connect", icon: FolderGit2, title: "Connect a dbt project",
      desc: "Point DataLex at a Git URL or a local dbt folder. Your YAML stays in place — DataLex reads it and indexes the manifest.",
      done: hasProject, cta: hasProject ? "Reconnect" : "Connect repo", onClick: onConnect,
    },
    {
      id: "ai", icon: Sparkles, title: "Connect AI & your database",
      desc: "Add an AI provider (OpenAI / Anthropic / local) and, optionally, a warehouse connection. Both test in place and save automatically — no other setup.",
      done: aiReady, cta: aiReady ? "Open settings" : "Set up AI & database", onClick: onOpenAi,
    },
    {
      id: "detect", icon: ScanSearch, title: "Detect domains, contracts & proposals",
      desc: "Let AI group models into business domains, surface missing contracts, and stage reviewable proposal packs — your governance surface, drafted for you.",
      done: detected, locked: !hasProject, cta: "Open Readiness", onClick: () => onGoto?.("readiness"),
    },
    {
      id: "model", icon: Boxes, title: "Model conceptual → logical → physical",
      desc: "Draw the conceptual layer first — the primary, platform-free business view — then generate logical and physical diagrams from it.",
      done: modeled, locked: !hasProject, cta: "Open Model", onClick: () => onGoto?.("diagram"),
    },
    {
      id: "ship", icon: Rocket, title: "Certify & publish",
      desc: "Review the readiness gate, certify contracts, then build the DataLex manifest and check integration readiness before you ship.",
      done: certified, locked: !hasProject, cta: "Open Publish", onClick: () => onGoto?.("publish"),
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="home-view">
      <header className="home-hero">
        <div className="home-hero-eyebrow">Workspace</div>
        <h1 className="home-hero-title">{hasProject ? projectName : "Welcome to DataLex"}</h1>
        <p className="home-hero-sub">
          Turn your dbt project into a governed, AI-ready model — without leaving Git.
          Follow the steps below; each lights up as you go.
        </p>
        <div className="home-progress">
          <div className="home-progress-bar"><span style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
          <span className="home-progress-label">{doneCount} of {steps.length} done</span>
        </div>
      </header>

      <section className="home-tiles" aria-label="Project status">
        <StatusTile icon={Database} label="Connection" value={isDemo ? "Demo mode" : hasProject ? "Connected" : "None"} tone={hasProject && !isDemo ? "ok" : ""} />
        <StatusTile icon={Sparkles} label="AI provider" value={aiReady ? "Ready" : "Not set"} tone={aiReady ? "ok" : "warn"} />
        <StatusTile icon={Boxes} label="Models" value={loading ? "…" : (totals.models ?? 0)} />
        <StatusTile icon={ShieldCheck} label="Contracts" value={loading ? "…" : `${totals.existing_dbt_contracts ?? 0} / ${(totals.existing_dbt_contracts ?? 0) + (totals.missing_contracts ?? 0)}`} tone={(totals.missing_contracts ?? 0) > 0 ? "warn" : "ok"} />
        <StatusTile icon={Activity} label="Readiness gate" value={gate.label} tone={gate.tone === "ok" ? "ok" : gate.tone === "error" ? "bad" : "warn"} />
        <StatusTile icon={GitBranch} label="Changes" value={isDemo ? "—" : `${changedCount} on ${branch}`} />
      </section>

      <section className="home-steps" aria-label="Setup steps">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const state = step.done ? "done" : step.locked ? "locked" : "active";
          return (
            <div key={step.id} className={`home-step ${state}`}>
              <div className="home-step-rail">
                <div className="home-step-badge">
                  {step.done ? <Check size={15} strokeWidth={2.4} /> : <span className="home-step-num">{i + 1}</span>}
                </div>
                {i < steps.length - 1 && <div className="home-step-line" />}
              </div>
              <div className="home-step-body">
                <div className="home-step-head">
                  <Icon size={16} strokeWidth={1.8} />
                  <span className="home-step-title">{step.title}</span>
                  <span className={`home-step-status ${state}`}>
                    {step.done ? "Done" : step.locked ? "Connect first" : "Next"}
                  </span>
                </div>
                <p className="home-step-desc">{step.desc}</p>
                <button type="button" className="home-step-cta" onClick={step.onClick} disabled={step.locked}>
                  {step.cta} <ArrowRight size={13} strokeWidth={2} />
                </button>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
