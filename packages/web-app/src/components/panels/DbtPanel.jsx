/* DbtPanel — single bottom-drawer tab that surfaces every dbt-shape
 * resource present in the active YAML. Replaces the previous one-tab-
 * per-shape strip (Snapshots / Exposures / Unit Tests / dbt YAML / SQL
 * Preview / Constraints), most of which were either placeholders or
 * empty for the file the user actually had open.
 *
 * Reads (in this order, each rendered only when non-empty):
 *   models[]              — dbt schema.yml model entries
 *   sources[]             — dbt schema.yml source entries (with tables)
 *   semantic_models[]     — dbt semantic layer
 *   metrics[]             — dbt metrics
 *   saved_queries[]       — dbt saved queries
 *   unit_tests[]          — dbt 1.8+ unit tests
 *   exposures[]           — downstream consumers
 *   snapshots[]           — SCD-2 tables
 *
 * Read-only by design — DocsView is the place to edit descriptions.
 * Clicking a row scrolls the YAML editor (future hook); for now this
 * is a structured "what's in this file" surface so the dbt tab is
 * never blank when the file is dbt-shaped.
 */
import React, { useMemo } from "react";
import yaml from "js-yaml";
import {
  Braces,
  AlertTriangle,
  Database,
  Eye,
  FlaskConical,
  Camera,
  GitBranch,
  Layers,
  Sigma,
  Table as TableIcon,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import {
  PanelFrame,
  PanelSection,
  PanelEmpty,
  PanelCard,
  StatusPill,
  KeyValueGrid,
} from "./PanelFrame";

function safeLoad(text) {
  try {
    const doc = yaml.load(text);
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null;
  } catch (_err) {
    return null;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/* ── per-shape renderers ─────────────────────────────────────────── */

function ModelsSection({ models }) {
  return (
    <PanelSection title="dbt models" count={models.length} icon={<Database size={11} />}>
      {models.map((m, idx) => {
        const cols = asArray(m.columns);
        const noDesc = !m.description;
        return (
          <PanelCard
            key={m.name || idx}
            title={m.name || `model_${idx}`}
            subtitle={m.description || ""}
            tone={noDesc ? "warning" : "neutral"}
            icon={noDesc ? <AlertTriangle size={11} /> : null}
            actions={
              <StatusPill tone="info">{cols.length} col{cols.length === 1 ? "" : "s"}</StatusPill>
            }
          >
            <KeyValueGrid
              items={[
                { label: "materialization", value: m?.config?.materialized || "—" },
                { label: "contract", value: m?.config?.contract?.enforced ? "enforced" : "—" },
                { label: "columns", value: cols.length },
                {
                  label: "tests",
                  value: cols.reduce((acc, c) => acc + (asArray(c?.tests).length + asArray(c?.data_tests).length), 0),
                },
              ]}
            />
          </PanelCard>
        );
      })}
    </PanelSection>
  );
}

function SourcesSection({ sources }) {
  const tableCount = sources.reduce((acc, s) => acc + asArray(s.tables).length, 0);
  return (
    <PanelSection title="dbt sources" count={sources.length} icon={<TableIcon size={11} />}>
      {sources.map((s, idx) => (
        <PanelCard
          key={s.name || idx}
          title={s.name || `source_${idx}`}
          subtitle={s.description || ""}
          tone="neutral"
          actions={<StatusPill tone="info">{asArray(s.tables).length} table{asArray(s.tables).length === 1 ? "" : "s"}</StatusPill>}
        >
          <KeyValueGrid
            items={[
              { label: "database", value: s.database || "—" },
              { label: "schema", value: s.schema || "—" },
              { label: "loader", value: s.loader || "—" },
              { label: "tables", value: asArray(s.tables).map((t) => t.name || "?").join(", ") || "—" },
            ]}
          />
        </PanelCard>
      ))}
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 6 }}>
        {tableCount} source table{tableCount === 1 ? "" : "s"} total.
      </div>
    </PanelSection>
  );
}

function SemanticModelsSection({ semanticModels }) {
  return (
    <PanelSection title="semantic_models" count={semanticModels.length} icon={<Layers size={11} />}>
      {semanticModels.map((sm, idx) => {
        const entities = asArray(sm.entities);
        const dimensions = asArray(sm.dimensions);
        const measures = asArray(sm.measures);
        const noPrimary = entities.length > 0 && !entities.some((e) => String(e?.type || "").toLowerCase() === "primary");
        return (
          <PanelCard
            key={sm.name || idx}
            title={sm.name || `semantic_model_${idx}`}
            subtitle={sm.description || ""}
            tone={noPrimary ? "warning" : "neutral"}
            icon={noPrimary ? <AlertTriangle size={11} /> : null}
            actions={<StatusPill tone="info">{`model ${sm.model || "?"}`}</StatusPill>}
          >
            <KeyValueGrid
              items={[
                { label: "entities", value: entities.length },
                { label: "dimensions", value: dimensions.length },
                { label: "measures", value: measures.length },
                { label: "primary_entity", value: entities.find((e) => String(e?.type || "").toLowerCase() === "primary")?.name || "—" },
              ]}
            />
          </PanelCard>
        );
      })}
    </PanelSection>
  );
}

function metricSummary(metric) {
  const t = String(metric?.type || "").toLowerCase();
  const tp = metric?.type_params || {};
  if (t === "simple" && tp.measure) {
    return typeof tp.measure === "object" ? tp.measure?.name : tp.measure;
  }
  if (t === "ratio") {
    const num = typeof tp.numerator === "object" ? tp.numerator?.name : tp.numerator;
    const den = typeof tp.denominator === "object" ? tp.denominator?.name : tp.denominator;
    return num && den ? `${num} / ${den}` : "(incomplete)";
  }
  if (t === "derived") return tp.expr || "(no expr)";
  if (t === "cumulative") {
    const measure = typeof tp.measure === "object" ? tp.measure?.name : tp.measure;
    return measure ? `cumulative(${measure})` : "(no measure)";
  }
  return "—";
}

function MetricsSection({ metrics }) {
  return (
    <PanelSection title="metrics" count={metrics.length} icon={<Sigma size={11} />}>
      {metrics.map((m, idx) => {
        const noDesc = !m.description;
        return (
          <PanelCard
            key={m.name || idx}
            title={m.name || `metric_${idx}`}
            subtitle={m.description || (noDesc ? "(no description)" : "")}
            tone={noDesc ? "warning" : "neutral"}
            icon={noDesc ? <AlertTriangle size={11} /> : null}
            actions={<StatusPill tone="info">{m.type || "(no type)"}</StatusPill>}
          >
            <KeyValueGrid
              items={[
                { label: "label", value: m.label || "—" },
                { label: "definition", value: <code style={{ fontSize: 11 }}>{metricSummary(m)}</code> },
              ]}
            />
          </PanelCard>
        );
      })}
    </PanelSection>
  );
}

function SavedQueriesSection({ savedQueries }) {
  return (
    <PanelSection title="saved_queries" count={savedQueries.length} icon={<Sigma size={11} />}>
      {savedQueries.map((sq, idx) => {
        const params = sq.query_params || {};
        const metricsList = asArray(params.metrics);
        const groupBy = asArray(params.group_by);
        const exports = asArray(sq.exports);
        return (
          <PanelCard
            key={sq.name || idx}
            title={sq.name || `saved_query_${idx}`}
            subtitle={sq.description || ""}
            tone="neutral"
            actions={<StatusPill tone="info">{`${exports.length} export${exports.length === 1 ? "" : "s"}`}</StatusPill>}
          >
            <KeyValueGrid
              items={[
                { label: "metrics", value: metricsList.join(", ") || "—" },
                { label: "group_by", value: groupBy.join(", ") || "—" },
                { label: "where", value: Array.isArray(params.where) ? params.where.join(" AND ") : (params.where || "—") },
              ]}
            />
          </PanelCard>
        );
      })}
    </PanelSection>
  );
}

function UnitTestsSection({ tests }) {
  return (
    <PanelSection title="unit_tests" count={tests.length} icon={<FlaskConical size={11} />}>
      {tests.map((t, idx) => {
        const given = asArray(t.given);
        const expect = t.expect || {};
        const expectRows = Array.isArray(expect.rows) ? expect.rows.length : 0;
        const noDesc = !t.description;
        return (
          <PanelCard
            key={t.name || idx}
            title={t.name || `unit_test_${idx}`}
            subtitle={t.description || (noDesc ? "(no description)" : "")}
            tone={noDesc ? "warning" : "neutral"}
            icon={noDesc ? <AlertTriangle size={11} /> : null}
            actions={<StatusPill tone="info">{`model ${t.model || "?"}`}</StatusPill>}
          >
            <KeyValueGrid
              items={[
                { label: "given inputs", value: given.length },
                { label: "expected rows", value: expectRows },
                { label: "overrides", value: t.overrides ? "yes" : "—" },
              ]}
            />
          </PanelCard>
        );
      })}
    </PanelSection>
  );
}

function ExposuresSection({ exposures }) {
  return (
    <PanelSection title="exposures" count={exposures.length} icon={<Eye size={11} />}>
      {exposures.map((e, idx) => {
        const owner = e.owner || {};
        const noOwner = !owner.email && !owner.name;
        const depends = asArray(e.depends_on);
        return (
          <PanelCard
            key={e.name || idx}
            title={e.label || e.name || `exposure_${idx}`}
            subtitle={e.description || ""}
            tone={noOwner ? "warning" : "neutral"}
            icon={noOwner ? <AlertTriangle size={11} /> : null}
            actions={<StatusPill tone="info">{e.type || "(no type)"}</StatusPill>}
          >
            <KeyValueGrid
              items={[
                { label: "owner", value: owner.name || owner.email || "—" },
                { label: "maturity", value: e.maturity || "—" },
                { label: "depends_on", value: depends.length ? `${depends.length} ref${depends.length === 1 ? "" : "s"}` : "—" },
              ]}
            />
          </PanelCard>
        );
      })}
    </PanelSection>
  );
}

function SnapshotsSection({ snapshots }) {
  return (
    <PanelSection title="snapshots" count={snapshots.length} icon={<Camera size={11} />}>
      {snapshots.map((snap, idx) => {
        const cfg = snap.snapshot || snap.config || {};
        const cols = asArray(snap.columns);
        const missing = !cfg.strategy || !cfg.unique_key;
        return (
          <PanelCard
            key={snap.name || idx}
            title={snap.name || `snapshot_${idx}`}
            subtitle={snap.description || ""}
            tone={missing ? "warning" : "neutral"}
            icon={missing ? <AlertTriangle size={11} /> : null}
            actions={<StatusPill tone={missing ? "warning" : "info"}>{cfg.strategy || "no strategy"}</StatusPill>}
          >
            <KeyValueGrid
              items={[
                { label: "unique_key", value: cfg.unique_key || "—" },
                { label: "updated_at", value: cfg.updated_at || "—" },
                { label: "columns", value: cols.length },
              ]}
            />
          </PanelCard>
        );
      })}
    </PanelSection>
  );
}

/* ── main panel ─────────────────────────────────────────────────── */

export default function DbtPanel() {
  const { activeFileContent, activeFile } = useWorkspaceStore();
  const data = useMemo(() => {
    const doc = safeLoad(activeFileContent || "");
    if (!doc) return null;
    return {
      models: asArray(doc.models),
      sources: asArray(doc.sources),
      semanticModels: asArray(doc.semantic_models),
      metrics: asArray(doc.metrics),
      savedQueries: asArray(doc.saved_queries),
      unitTests: asArray(doc.unit_tests),
      exposures: asArray(doc.exposures),
      snapshots: asArray(doc.snapshots),
    };
  }, [activeFileContent]);

  if (!activeFileContent) {
    return (
      <PanelFrame icon={<Braces size={14} />} eyebrow="dbt resources" title="dbt">
        <PanelEmpty
          icon={Braces}
          title="No file open"
          description="Open a YAML file to see the dbt resources it declares."
        />
      </PanelFrame>
    );
  }

  if (!data) {
    return (
      <PanelFrame icon={<Braces size={14} />} eyebrow="dbt resources" title="dbt">
        <PanelEmpty
          icon={AlertTriangle}
          title="Unparseable YAML"
          description="Switch to the editor to fix syntax errors before this view can read the file."
        />
      </PanelFrame>
    );
  }

  const total =
    data.models.length + data.sources.length + data.semanticModels.length +
    data.metrics.length + data.savedQueries.length + data.unitTests.length +
    data.exposures.length + data.snapshots.length;

  if (total === 0) {
    return (
      <PanelFrame icon={<Braces size={14} />} eyebrow="dbt resources" title="dbt">
        <PanelEmpty
          icon={GitBranch}
          title="No dbt content in this file"
          description="This YAML doesn't declare any dbt resources (models, sources, semantic_models, metrics, saved_queries, unit_tests, exposures, or snapshots). Native DataLex models live under the Studio tab."
        />
      </PanelFrame>
    );
  }

  const filePath = activeFile?.path || activeFile?.fullPath || activeFile?.name || "";
  return (
    <PanelFrame
      icon={<Braces size={14} />}
      eyebrow="dbt resources"
      title="dbt"
      subtitle={`${total} resource${total === 1 ? "" : "s"}${filePath ? ` · ${filePath.split("/").pop()}` : ""}`}
    >
      {data.models.length > 0 && <ModelsSection models={data.models} />}
      {data.sources.length > 0 && <SourcesSection sources={data.sources} />}
      {data.semanticModels.length > 0 && <SemanticModelsSection semanticModels={data.semanticModels} />}
      {data.metrics.length > 0 && <MetricsSection metrics={data.metrics} />}
      {data.savedQueries.length > 0 && <SavedQueriesSection savedQueries={data.savedQueries} />}
      {data.unitTests.length > 0 && <UnitTestsSection tests={data.unitTests} />}
      {data.exposures.length > 0 && <ExposuresSection exposures={data.exposures} />}
      {data.snapshots.length > 0 && <SnapshotsSection snapshots={data.snapshots} />}
    </PanelFrame>
  );
}
