import React from "react";
import { Database } from "lucide-react";

export default function SubjectAreaGroup({ data }) {
  const color = data?.color || { text: "#475569", border: "rgba(100,116,139,0.3)" };
  return (
    <div className="w-full h-full relative">
      <div
        className="absolute top-2 left-3 flex items-center gap-1.5 px-2 py-1 rounded-md"
        style={{ backgroundColor: color.bg || "rgba(100,116,139,0.08)" }}
      >
        <Database size={11} style={{ color: color.text }} />
        <span
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: color.text }}
        >
          {data?.label || ""}
        </span>
      </div>
    </div>
  );
}
