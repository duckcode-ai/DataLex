import React from "react";
import {
  X,
  Plus,
  Trash2,
  Key,
  Fingerprint,
  Tag,
  FileText,
  ArrowRightLeft,
  Shield,
  Database,
  User,
  Clock,
  ListOrdered,
  AlertTriangle,
} from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";
import useWorkspaceStore from "../../stores/workspaceStore";
import {
  updateEntityMeta,
  updateEntityTags,
  updateFieldProperty,
  addField,
  removeField,
} from "../../lib/yamlRoundTrip";

export default function EntityPanel() {
  const { selectedEntity, selectedEntityId, clearSelection, model } = useDiagramStore();
  const { activeFileContent, updateContent } = useWorkspaceStore();

  if (!selectedEntity) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-xs p-4">
        Select an entity in the diagram to view properties
      </div>
    );
  }

  const classifications = model?.governance?.classification || {};
  const imports = model?.model?.imports || [];
  const localEntityNames = new Set((model?.entities || []).map((e) => e.name));
  const relationships = (model?.relationships || []).filter((r) => {
    const fromEntity = r.from?.split(".")[0];
    const toEntity = r.to?.split(".")[0];
    return fromEntity === selectedEntityId || toEntity === selectedEntityId;
  });

  const applyMutation = (mutatorFn, ...args) => {
    const result = mutatorFn(activeFileContent, ...args);
    if (!result.error) updateContent(result.yaml);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-primary bg-bg-secondary/50">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary truncate">{selectedEntity.name}</h3>
          <span className="text-[10px] text-text-muted uppercase tracking-wider">
            {selectedEntity.type || "table"}
          </span>
        </div>
        <button
          onClick={clearSelection}
          className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Description */}
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
            <FileText size={10} />
            Description
          </label>
          <textarea
            value={selectedEntity.description || ""}
            onChange={(e) => applyMutation(updateEntityMeta, selectedEntityId, "description", e.target.value)}
            className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue resize-none"
            rows={2}
            placeholder="Entity description..."
          />
        </div>

        {/* Tags */}
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
            <Tag size={10} />
            Tags (comma separated)
          </label>
          <input
            value={(selectedEntity.tags || []).join(", ")}
            onChange={(e) => applyMutation(updateEntityTags, selectedEntityId, e.target.value)}
            className="w-full bg-bg-primary border border-border-primary rounded-md px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
            placeholder="PII, GOLD, ..."
          />
        </div>

        {/* v2 Entity Properties */}
        {(selectedEntity.schema || selectedEntity.database || selectedEntity.subject_area || selectedEntity.owner || selectedEntity.sla) && (
          <div>
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
              <Database size={10} />
              Properties
            </label>
            <div className="space-y-1 text-[11px]">
              {selectedEntity.schema && (
                <div className="flex items-center gap-2 px-2 py-1 bg-bg-primary border border-border-primary rounded-md">
                  <span className="text-text-muted">Schema</span>
                  <span className="ml-auto text-text-primary font-mono">{selectedEntity.schema}</span>
                </div>
              )}
              {selectedEntity.database && (
                <div className="flex items-center gap-2 px-2 py-1 bg-bg-primary border border-border-primary rounded-md">
                  <span className="text-text-muted">Database</span>
                  <span className="ml-auto text-text-primary font-mono">{selectedEntity.database}</span>
                </div>
              )}
              {selectedEntity.subject_area && (
                <div className="flex items-center gap-2 px-2 py-1 bg-bg-primary border border-border-primary rounded-md">
                  <span className="text-text-muted">Subject Area</span>
                  <span className="ml-auto text-text-primary">{selectedEntity.subject_area}</span>
                </div>
              )}
              {selectedEntity.owner && (
                <div className="flex items-center gap-2 px-2 py-1 bg-bg-primary border border-border-primary rounded-md">
                  <User size={10} className="text-text-muted shrink-0" />
                  <span className="text-text-muted">Owner</span>
                  <span className="ml-auto text-text-primary">{selectedEntity.owner}</span>
                </div>
              )}
              {selectedEntity.sla && (
                <div className="flex items-center gap-2 px-2 py-1 bg-bg-primary border border-border-primary rounded-md">
                  <Clock size={10} className="text-text-muted shrink-0" />
                  <span className="text-text-muted">SLA</span>
                  <span className="ml-auto text-text-primary">
                    {selectedEntity.sla.freshness && `Freshness: ${selectedEntity.sla.freshness}`}
                    {selectedEntity.sla.freshness && selectedEntity.sla.quality_score != null && " · "}
                    {selectedEntity.sla.quality_score != null && `Quality: ${selectedEntity.sla.quality_score}%`}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Fields */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1">
              <Key size={10} />
              Fields ({(selectedEntity.fields || []).length})
            </label>
            <button
              onClick={() => applyMutation(addField, selectedEntityId)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              <Plus size={10} />
              Add
            </button>
          </div>

          <div className="border border-border-primary rounded-md overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-bg-secondary/50">
                  <th className="text-left px-2 py-1 text-text-muted font-medium">Name</th>
                  <th className="text-left px-2 py-1 text-text-muted font-medium">Type</th>
                  <th className="text-center px-1 py-1 text-text-muted font-medium">PK</th>
                  <th className="text-center px-1 py-1 text-text-muted font-medium">UQ</th>
                  <th className="text-center px-1 py-1 text-text-muted font-medium">NN</th>
                  <th className="px-1 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {(selectedEntity.fields || []).map((field) => (
                  <tr key={field.name} className="border-t border-border-primary/50 hover:bg-bg-hover/30">
                    <td className="px-2 py-1">
                      <code className="text-text-primary font-mono">{field.name}</code>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={field.type || ""}
                        onChange={(e) => applyMutation(updateFieldProperty, selectedEntityId, field.name, "type", e.target.value)}
                        className="w-full bg-transparent border-b border-transparent hover:border-border-primary focus:border-accent-blue text-text-secondary font-mono outline-none text-[11px] py-0.5"
                      />
                    </td>
                    <td className="text-center px-1 py-1">
                      <input
                        type="checkbox"
                        checked={Boolean(field.primary_key)}
                        onChange={(e) => applyMutation(updateFieldProperty, selectedEntityId, field.name, "primary_key", e.target.checked)}
                        className="w-3 h-3 rounded accent-yellow-500"
                      />
                    </td>
                    <td className="text-center px-1 py-1">
                      <input
                        type="checkbox"
                        checked={Boolean(field.unique)}
                        onChange={(e) => applyMutation(updateFieldProperty, selectedEntityId, field.name, "unique", e.target.checked)}
                        className="w-3 h-3 rounded accent-cyan-500"
                      />
                    </td>
                    <td className="text-center px-1 py-1">
                      <input
                        type="checkbox"
                        checked={field.nullable === false}
                        onChange={(e) => applyMutation(updateFieldProperty, selectedEntityId, field.name, "nullable", !e.target.checked)}
                        className="w-3 h-3 rounded accent-red-500"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <button
                        onClick={() => applyMutation(removeField, selectedEntityId, field.name)}
                        className="p-0.5 rounded hover:bg-red-50 text-text-muted hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={10} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Relationships */}
        {relationships.length > 0 && (
          <div>
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
              <ArrowRightLeft size={10} />
              Relationships ({relationships.length})
            </label>
            <div className="space-y-1">
              {relationships.map((rel) => {
                const fromEntity = rel.from?.split(".")[0] || "";
                const toEntity = rel.to?.split(".")[0] || "";
                const isCrossModel =
                  (fromEntity && !localEntityNames.has(fromEntity)) ||
                  (toEntity && !localEntityNames.has(toEntity));
                return (
                  <div
                    key={rel.name}
                    className={`flex items-center gap-2 px-2 py-1.5 border rounded-md text-[11px] ${
                      isCrossModel
                        ? "bg-indigo-50 border-indigo-200"
                        : "bg-bg-primary border-border-primary"
                    }`}
                  >
                    <span className="text-text-primary font-medium">{rel.name}</span>
                    <span className="text-text-muted">
                      {rel.from} → {rel.to}
                    </span>
                    {isCrossModel && (
                      <span className="px-1 py-0 rounded text-[8px] font-semibold bg-indigo-100 text-indigo-600">
                        CROSS-MODEL
                      </span>
                    )}
                    <span className={`ml-auto px-1.5 py-0 rounded text-[9px] font-semibold ${
                      rel.cardinality === "one_to_one" ? "bg-green-50 text-green-700" :
                      rel.cardinality === "one_to_many" ? "bg-blue-50 text-blue-700" :
                      rel.cardinality === "many_to_one" ? "bg-purple-50 text-purple-700" :
                      "bg-orange-50 text-orange-700"
                    }`}>
                      {rel.cardinality?.replace(/_/g, ":")}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Indexes */}
        {(model?.indexes || []).filter((idx) => idx.entity === selectedEntityId).length > 0 && (
          <div>
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
              <ListOrdered size={10} />
              Indexes ({(model?.indexes || []).filter((idx) => idx.entity === selectedEntityId).length})
            </label>
            <div className="space-y-1">
              {(model?.indexes || []).filter((idx) => idx.entity === selectedEntityId).map((idx) => (
                <div
                  key={idx.name}
                  className="flex items-center gap-2 px-2 py-1.5 bg-bg-primary border border-border-primary rounded-md text-[11px]"
                >
                  <code className="text-text-primary font-mono">{idx.name}</code>
                  <span className="text-text-muted">{(idx.fields || []).join(", ")}</span>
                  {idx.unique && (
                    <span className="ml-auto px-1.5 py-0 rounded text-[9px] font-semibold bg-cyan-50 text-cyan-700">UNIQUE</span>
                  )}
                  {idx.type && idx.type !== "btree" && (
                    <span className="px-1.5 py-0 rounded text-[9px] font-semibold bg-slate-100 text-slate-600">{idx.type}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Governance */}
        {Object.keys(classifications).some((k) => k.startsWith(`${selectedEntityId}.`)) && (
          <div>
            <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
              <Shield size={10} />
              Governance
            </label>
            <div className="space-y-1">
              {Object.entries(classifications)
                .filter(([k]) => k.startsWith(`${selectedEntityId}.`))
                .map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 px-2 py-1 bg-red-50 border border-red-200 rounded-md text-[11px]">
                    <code className="text-text-secondary">{key.split(".")[1]}</code>
                    <span className="ml-auto text-red-600 font-semibold">{value}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
