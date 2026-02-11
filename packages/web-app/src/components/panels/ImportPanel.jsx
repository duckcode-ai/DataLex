import React, { useState, useCallback, useRef } from "react";
import {
  Upload,
  FileJson,
  Database,
  FileCode,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";

const SUPPORTED_FORMATS = [
  { id: "sql", label: "SQL DDL", icon: Database, extensions: [".sql"], description: "PostgreSQL, Snowflake, BigQuery, Databricks DDL" },
  { id: "dbml", label: "DBML", icon: FileCode, extensions: [".dbml"], description: "Database Markup Language" },
  { id: "spark-schema", label: "Spark Schema", icon: FileJson, extensions: [".json"], description: "Spark StructType JSON / Databricks catalog export" },
];

function detectFormat(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".dbml")) return "dbml";
  if (lower.endsWith(".json")) return "spark-schema";
  return null;
}

function toPascal(name) {
  return name.replace(/["]/g, "").split(/[^A-Za-z0-9]+/).filter(Boolean).map(p => p[0].toUpperCase() + p.slice(1)).join("");
}

function parseClientSide(format, text, modelName) {
  if (format === "sql") return parseSQLClient(text, modelName);
  if (format === "dbml") return parseDBMLClient(text, modelName);
  if (format === "spark-schema") return parseSparkSchemaClient(text, modelName);
  throw new Error(`Client-side parsing not available for "${format}". Start the API server (npm start in packages/api-server).`);
}

function parseSQLClient(text, modelName) {
  const entities = [];
  const relationships = [];
  const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w"`.]+)\s*\((.*?)\)\s*;/gis;
  const viewRe = /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?([\w"`.]+)/gi;
  let match;

  while ((match = tableRe.exec(text)) !== null) {
    const tableName = toPascal(match[1].split(".").pop());
    const body = match[2];
    const fields = [];
    for (const col of body.split(",").map(s => s.trim())) {
      const cm = col.match(/^"?([A-Za-z_]\w*)"?\s+(\S+)/);
      if (cm && !/^(primary|foreign|check|constraint|unique)\s/i.test(col)) {
        const lower = col.toLowerCase();
        fields.push({
          name: cm[1],
          type: cm[2].toLowerCase(),
          nullable: !lower.includes("not null"),
          primary_key: lower.includes("primary key") || undefined,
        });
      }
    }
    entities.push({ name: tableName, type: "table", fields });
  }

  while ((match = viewRe.exec(text)) !== null) {
    const vn = toPascal(match[1].split(".").pop());
    if (!entities.find(e => e.name === vn)) {
      const isMat = /materialized/i.test(match[0]);
      entities.push({ name: vn, type: isMat ? "materialized_view" : "view", fields: [] });
    }
  }

  const yaml = buildYaml(modelName, entities, relationships);
  return buildResult(entities, relationships, yaml);
}

function parseSparkSchemaClient(text, modelName) {
  const schema = JSON.parse(text);
  const sparkTypeMap = { string: "string", integer: "integer", int: "integer", long: "bigint", bigint: "bigint", short: "smallint", byte: "tinyint", float: "float", double: "float", boolean: "boolean", binary: "binary", date: "date", timestamp: "timestamp", timestamp_ntz: "timestamp" };
  function mapType(t) {
    if (typeof t === "string") {
      const lower = t.toLowerCase();
      if (lower.startsWith("decimal")) return lower;
      if (lower.startsWith("varchar") || lower.startsWith("char")) return "string";
      if (lower.startsWith("array") || lower.startsWith("map") || lower.startsWith("struct")) return "json";
      return sparkTypeMap[lower] || "string";
    }
    if (typeof t === "object" && t !== null) {
      const tn = (t.type || "string").toLowerCase();
      if (["struct", "array", "map", "udt"].includes(tn)) return "json";
      return sparkTypeMap[tn] || "string";
    }
    return "string";
  }
  const tables = [];
  if (Array.isArray(schema)) {
    schema.forEach((item, idx) => {
      if (typeof item === "object") {
        const name = item.name || item.table_name || `table_${idx}`;
        const inner = item.schema || item.columns || item;
        tables.push({ name, schema: inner });
      }
    });
  } else if (typeof schema === "object") {
    if (schema.type === "struct" && schema.fields) {
      tables.push({ name: modelName, schema });
    } else if (schema.columns) {
      tables.push({ name: schema.table_name || schema.name || modelName, schema });
    } else if (schema.fields) {
      tables.push({ name: modelName, schema });
    }
  }
  const entities = tables.map(({ name, schema: tblSchema }) => {
    const rawFields = (typeof tblSchema === "object" && !Array.isArray(tblSchema))
      ? (tblSchema.fields || tblSchema.columns || [])
      : (Array.isArray(tblSchema) ? tblSchema : []);
    const fields = rawFields.filter(f => f && f.name).map(f => {
      const ftype = mapType(f.type || f.data_type || "string");
      const field = { name: f.name, type: ftype, nullable: f.nullable !== false };
      const meta = f.metadata || {};
      if (meta.comment) field.description = meta.comment;
      if (f.comment) field.description = f.comment;
      return field;
    });
    return { name: toPascal(name), type: "table", fields };
  });
  return buildResult(entities, [], buildYaml(modelName, entities, []));
}

function parseDBMLClient(text, modelName) {
  const entities = [];
  const relationships = [];
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const tm = line.match(/^table\s+([\w"]+)\s*\{/i);
    if (tm) { current = { name: toPascal(tm[1]), type: "table", fields: [] }; entities.push(current); continue; }
    if (line === "}") { current = null; continue; }
    if (current) {
      const fm = line.match(/^([A-Za-z_]\w*)\s+(\S+)(?:\s*\[(.*?)\])?$/);
      if (fm) {
        const attrs = (fm[3] || "").toLowerCase();
        current.fields.push({ name: fm[1], type: fm[2].toLowerCase(), nullable: !attrs.includes("not null"), primary_key: attrs.includes("pk") || undefined });
      }
    }
  }
  return buildResult(entities, relationships, buildYaml(modelName, entities, relationships));
}

function buildYaml(modelName, entities, relationships) {
  let y = `model:\n  name: ${modelName}\n  version: '1.0.0'\n  domain: imported\n  owners:\n    - data-team@example.com\n  state: draft\n`;
  y += `entities:\n`;
  for (const e of entities) {
    y += `  - name: ${e.name}\n    type: ${e.type}\n`;
    if (e.description) y += `    description: ${e.description}\n`;
    y += `    fields:\n`;
    for (const f of e.fields || []) {
      y += `      - name: ${f.name}\n        type: ${f.type}\n        nullable: ${f.nullable}\n`;
      if (f.primary_key) y += `        primary_key: true\n`;
      if (f.description) y += `        description: ${f.description}\n`;
    }
  }
  if (relationships.length) {
    y += `relationships:\n`;
    for (const r of relationships) y += `  - name: ${r.name}\n    from: ${r.from}\n    to: ${r.to}\n    cardinality: ${r.cardinality}\n`;
  }
  return y;
}

function buildResult(entities, relationships, yaml) {
  const fieldCount = entities.reduce((s, e) => s + (e.fields || []).length, 0);
  return { success: true, entityCount: entities.length, fieldCount, relationshipCount: relationships.length, indexCount: 0, yaml };
}

export default function ImportPanel() {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const { activeProjectId, loadImportedYaml } = useWorkspaceStore();
  const { addToast, setBottomPanelTab } = useUiStore();

  const handleFile = useCallback(async (file) => {
    setError(null);
    setImportResult(null);

    const format = selectedFormat || detectFormat(file.name);
    if (!format) {
      setError(`Could not detect format for "${file.name}". Please select a format first.`);
      return;
    }

    setImporting(true);
    try {
      const text = await file.text();
      const modelName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();

      // Try API server first, fall back to client-side parsing
      let data = null;
      try {
        const resp = await fetch("http://localhost:3001/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format, content: text, filename: file.name, modelName }),
        });
        if (resp.ok) {
          data = await resp.json();
        }
      } catch (_) {
        // API server not available — use client-side parsing
      }

      if (!data) {
        data = parseClientSide(format, text, modelName);
      }

      setImportResult(data);

      // Auto-load into editor so user sees the diagram
      if (data.yaml) {
        loadImportedYaml(modelName, data.yaml);
        setBottomPanelTab("properties");
      }

      addToast?.({ message: `Imported ${file.name} → ${data.entityCount || 0} entities`, type: "success" });
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }, [selectedFormat, addToast, loadImportedYaml, setBottomPanelTab]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFile(files[0]);
  }, [handleFile]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setDragOver(false), []);

  const onFileSelect = useCallback((e) => {
    const files = e.target.files;
    if (files && files.length > 0) handleFile(files[0]);
    // Reset so the same file can be re-selected
    e.target.value = "";
  }, [handleFile]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border-primary bg-bg-secondary/50 shrink-0">
        <Upload size={12} className="text-accent-blue" />
        <span className="text-xs font-semibold text-text-primary">Import Schema</span>
        <span className="text-[10px] text-text-muted">Drag & drop or browse files</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Format selector */}
        <div>
          <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1.5">
            Supported Formats
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {SUPPORTED_FORMATS.map((fmt) => {
              const Icon = fmt.icon;
              const isSelected = selectedFormat === fmt.id;
              return (
                <button
                  key={fmt.id}
                  onClick={() => {
                    setSelectedFormat(fmt.id);
                    setError(null);
                    setImportResult(null);
                    // Set accept filter and open file picker
                    if (fileInputRef.current) {
                      fileInputRef.current.accept = fmt.extensions.join(",");
                      fileInputRef.current.click();
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-left transition-colors text-[11px] ${
                    isSelected
                      ? "border-accent-blue bg-accent-blue/10 text-accent-blue"
                      : "border-border-primary bg-bg-primary text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  <Icon size={12} className="shrink-0" />
                  <div>
                    <div className="font-semibold">{fmt.label}</div>
                    <div className="text-[9px] text-text-muted">{fmt.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Drop zone */}
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
            dragOver
              ? "border-accent-blue bg-accent-blue/5"
              : "border-border-primary hover:border-accent-blue/50 hover:bg-bg-hover"
          }`}
        >
          {importing ? (
            <Loader2 size={20} className="animate-spin text-accent-blue" />
          ) : (
            <Upload size={20} className={dragOver ? "text-accent-blue" : "text-text-muted"} />
          )}
          <div className="text-xs text-text-secondary text-center">
            {importing ? "Importing..." : (
              <>
                <span className="font-semibold">Drop a file here</span> or click to browse
                <br />
                <span className="text-[10px] text-text-muted">
                  .sql, .dbml, .json{selectedFormat ? ` (${selectedFormat} mode)` : ""}
                </span>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".sql,.dbml,.json"
            onChange={onFileSelect}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
            <AlertCircle size={12} className="text-red-500 mt-0.5 shrink-0" />
            <div className="text-[11px] text-red-700">
              {error}
              <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">
                <X size={10} />
              </button>
            </div>
          </div>
        )}

        {/* Result */}
        {importResult && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
              <CheckCircle2 size={12} />
              Import Successful
            </div>
            <div className="text-[11px] text-green-800 space-y-0.5">
              <div><strong>Entities:</strong> {importResult.entityCount || 0}</div>
              <div><strong>Fields:</strong> {importResult.fieldCount || 0}</div>
              <div><strong>Relationships:</strong> {importResult.relationshipCount || 0}</div>
              {importResult.indexCount > 0 && (
                <div><strong>Indexes:</strong> {importResult.indexCount}</div>
              )}
            </div>
            {importResult.yaml && (
              <details className="mt-1">
                <summary className="text-[10px] text-green-600 cursor-pointer hover:underline">
                  View generated YAML
                </summary>
                <pre className="mt-1 p-2 bg-white rounded border border-green-200 text-[10px] font-mono text-text-primary overflow-x-auto max-h-48 overflow-y-auto">
                  {importResult.yaml}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
