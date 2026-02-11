import React from "react";
import { Handle, Position } from "@xyflow/react";
import { Database, Table2, Eye, ArrowRightLeft } from "lucide-react";

const SCHEMA_COLORS = [
  { bg: "from-blue-50 to-blue-100/80", border: "border-blue-300", accent: "text-blue-700", badge: "bg-blue-100 text-blue-700" },
  { bg: "from-emerald-50 to-emerald-100/80", border: "border-emerald-300", accent: "text-emerald-700", badge: "bg-emerald-100 text-emerald-700" },
  { bg: "from-purple-50 to-purple-100/80", border: "border-purple-300", accent: "text-purple-700", badge: "bg-purple-100 text-purple-700" },
  { bg: "from-amber-50 to-amber-100/80", border: "border-amber-300", accent: "text-amber-700", badge: "bg-amber-100 text-amber-700" },
  { bg: "from-rose-50 to-rose-100/80", border: "border-rose-300", accent: "text-rose-700", badge: "bg-rose-100 text-rose-700" },
  { bg: "from-cyan-50 to-cyan-100/80", border: "border-cyan-300", accent: "text-cyan-700", badge: "bg-cyan-100 text-cyan-700" },
  { bg: "from-pink-50 to-pink-100/80", border: "border-pink-300", accent: "text-pink-700", badge: "bg-pink-100 text-pink-700" },
  { bg: "from-indigo-50 to-indigo-100/80", border: "border-indigo-300", accent: "text-indigo-700", badge: "bg-indigo-100 text-indigo-700" },
];

export default function SchemaOverviewNode({ data }) {
  const colorIdx = data.colorIndex || 0;
  const colors = SCHEMA_COLORS[colorIdx % SCHEMA_COLORS.length];

  return (
    <div
      className={`w-[220px] rounded-xl border-2 ${colors.border} bg-gradient-to-br ${colors.bg} shadow-lg cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all`}
      onClick={() => data.onDrillIn?.(data.schemaName)}
    >
      <Handle type="target" position={Position.Left} className="!bg-blue-500 !border-white !w-2 !h-2" />

      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <Database size={16} className={colors.accent} />
          <h3 className={`text-sm font-bold ${colors.accent} truncate`}>{data.schemaName}</h3>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <Table2 size={11} />
              Tables
            </span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${colors.badge}`}>
              {data.tableCount || 0}
            </span>
          </div>

          {(data.viewCount || 0) > 0 && (
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
                <Eye size={11} />
                Views
              </span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700">
                {data.viewCount}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <ArrowRightLeft size={11} />
              Relationships
            </span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
              {data.relCount || 0}
            </span>
          </div>
        </div>

        <div className="mt-3 pt-2 border-t border-slate-200/60">
          <span className={`text-[10px] font-semibold ${colors.accent} uppercase tracking-wider`}>
            Click to explore {data.entityCount || 0} entities
          </span>
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!bg-blue-500 !border-white !w-2 !h-2" />
    </div>
  );
}
