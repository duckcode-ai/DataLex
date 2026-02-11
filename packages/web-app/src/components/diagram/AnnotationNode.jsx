import React, { useState, useCallback } from "react";
import { StickyNote, X, GripVertical } from "lucide-react";

const ANNOTATION_COLORS = [
  { bg: "#fef9c3", border: "#facc15", text: "#854d0e" },
  { bg: "#dbeafe", border: "#60a5fa", text: "#1e40af" },
  { bg: "#dcfce7", border: "#4ade80", text: "#166534" },
  { bg: "#fce7f3", border: "#f472b6", text: "#9d174d" },
  { bg: "#f3e8ff", border: "#c084fc", text: "#6b21a8" },
];

export default function AnnotationNode({ id, data }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(data?.text || "");
  const colorIdx = data?.colorIndex || 0;
  const color = ANNOTATION_COLORS[colorIdx % ANNOTATION_COLORS.length];
  const onDelete = data?.onDelete;
  const onUpdate = data?.onUpdate;

  const handleBlur = useCallback(() => {
    setEditing(false);
    if (onUpdate) onUpdate(id, text);
  }, [id, text, onUpdate]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Escape") {
      setEditing(false);
    }
    e.stopPropagation();
  }, []);

  return (
    <div
      className="rounded-lg shadow-sm min-w-[160px] max-w-[280px] relative group"
      style={{
        backgroundColor: color.bg,
        border: `1.5px solid ${color.border}`,
        color: color.text,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1 border-b" style={{ borderColor: color.border }}>
        <GripVertical size={10} className="opacity-40 cursor-grab" />
        <StickyNote size={10} />
        <span className="text-[9px] font-bold uppercase tracking-wider flex-1">Note</span>
        {onDelete && (
          <button
            onClick={() => onDelete(id)}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-black/10 transition-opacity"
          >
            <X size={10} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="px-2.5 py-2">
        {editing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-[11px] leading-relaxed outline-none resize-none min-h-[40px]"
            style={{ color: color.text }}
            autoFocus
            rows={3}
          />
        ) : (
          <div
            onClick={() => setEditing(true)}
            className="text-[11px] leading-relaxed cursor-text min-h-[20px] whitespace-pre-wrap"
          >
            {text || <span className="opacity-50 italic">Click to add note…</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export { ANNOTATION_COLORS };
