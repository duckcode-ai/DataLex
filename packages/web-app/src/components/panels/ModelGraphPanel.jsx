import React, { useState, useEffect, useMemo } from "react";
import {
  Network,
  FileText,
  ArrowRight,
  ExternalLink,
  Package,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import { fetchModelGraph } from "../../lib/api";

const MODEL_COLORS = [
  { bg: "bg-blue-50", border: "border-blue-300", text: "text-blue-700", dot: "bg-blue-500" },
  { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-700", dot: "bg-emerald-500" },
  { bg: "bg-purple-50", border: "border-purple-300", text: "text-purple-700", dot: "bg-purple-500" },
  { bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-700", dot: "bg-amber-500" },
  { bg: "bg-rose-50", border: "border-rose-300", text: "text-rose-700", dot: "bg-rose-500" },
  { bg: "bg-cyan-50", border: "border-cyan-300", text: "text-cyan-700", dot: "bg-cyan-500" },
];

export default function ModelGraphPanel() {
  const { activeProjectId, offlineMode, projectFiles } = useWorkspaceStore();
  const { openFile } = useWorkspaceStore();
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadGraph = async () => {
    if (!activeProjectId || offlineMode) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchModelGraph(activeProjectId);
      setGraphData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGraph();
  }, [activeProjectId]);

  const colorMap = useMemo(() => {
    if (!graphData?.models) return {};
    const map = {};
    graphData.models.forEach((m, i) => {
      map[m.name] = MODEL_COLORS[i % MODEL_COLORS.length];
    });
    return map;
  }, [graphData]);

  const handleOpenFile = (filePath) => {
    const file = projectFiles.find((f) => f.fullPath === filePath);
    if (file) {
      openFile(file);
    }
  };

  if (offlineMode) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-xs p-4">
        <AlertCircle size={12} className="mr-1" />
        Model graph requires API server connection
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-xs p-4">
        <RefreshCw size={12} className="mr-1 animate-spin" />
        Loading model graph...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted text-xs p-4 gap-2">
        <span className="text-red-500">{error}</span>
        <button
          onClick={loadGraph}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-accent-blue hover:bg-accent-blue/10"
        >
          <RefreshCw size={10} />
          Retry
        </button>
      </div>
    );
  }

  if (!graphData || !graphData.models || graphData.models.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-xs p-4">
        No model files found in this project
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-primary bg-bg-secondary/50">
        <div className="flex items-center gap-1.5">
          <Network size={12} className="text-accent-blue" />
          <span className="text-xs font-semibold text-text-primary">Model Graph</span>
          <span className="text-[10px] text-text-muted">
            ({graphData.model_count} models, {graphData.total_entities} entities)
          </span>
        </div>
        <button
          onClick={loadGraph}
          className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Models */}
        {graphData.models.map((model) => {
          const colors = colorMap[model.name] || MODEL_COLORS[0];
          return (
            <div
              key={model.name}
              className={`rounded-lg border ${colors.border} ${colors.bg} p-2.5`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                  <span className={`text-xs font-semibold ${colors.text}`}>
                    {model.name}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {model.entity_count} entities
                  </span>
                </div>
                {model.file && (
                  <button
                    onClick={() => handleOpenFile(model.file)}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] text-text-muted hover:text-accent-blue hover:bg-white/50 transition-colors"
                    title={`Open ${model.path || model.file}`}
                  >
                    <ExternalLink size={9} />
                    Open
                  </button>
                )}
              </div>

              {/* Imports */}
              {model.imports && model.imports.length > 0 && (
                <div className="flex items-center gap-1 mb-1.5 ml-3.5">
                  <Package size={9} className="text-text-muted shrink-0" />
                  <span className="text-[10px] text-text-muted">imports:</span>
                  {model.imports.map((imp) => {
                    const impColors = colorMap[imp] || MODEL_COLORS[0];
                    return (
                      <span
                        key={imp}
                        className={`px-1.5 py-0 rounded text-[9px] font-medium ${impColors.bg} ${impColors.text} border ${impColors.border}`}
                      >
                        {imp}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Entities */}
              <div className="flex flex-wrap gap-1 ml-3.5">
                {model.entities.map((entity) => (
                  <span
                    key={entity}
                    className="px-1.5 py-0.5 rounded bg-white/60 border border-white/80 text-[10px] text-text-secondary font-mono"
                  >
                    {entity}
                  </span>
                ))}
              </div>
            </div>
          );
        })}

        {/* Cross-model relationships */}
        {graphData.cross_model_relationships &&
          graphData.cross_model_relationships.length > 0 && (
            <div>
              <label className="text-[10px] text-text-muted uppercase tracking-wider font-semibold flex items-center gap-1 mb-1.5">
                <ArrowRight size={10} />
                Cross-Model Relationships ({graphData.cross_model_relationships.length})
              </label>
              <div className="space-y-1">
                {graphData.cross_model_relationships.map((rel, i) => {
                  const fromColors = colorMap[rel.from_model] || MODEL_COLORS[0];
                  const toColors = colorMap[rel.to_model] || MODEL_COLORS[0];
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 px-2 py-1.5 bg-bg-primary border border-border-primary rounded-md text-[11px]"
                    >
                      <span className={`px-1 py-0 rounded text-[9px] font-semibold ${fromColors.bg} ${fromColors.text}`}>
                        {rel.from_model}
                      </span>
                      <code className="text-text-secondary">{rel.from_entity}</code>
                      <ArrowRight size={10} className="text-text-muted shrink-0" />
                      <span className={`px-1 py-0 rounded text-[9px] font-semibold ${toColors.bg} ${toColors.text}`}>
                        {rel.to_model}
                      </span>
                      <code className="text-text-secondary">{rel.to_entity}</code>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
