/* MermaidERD — render a mermaid `erDiagram` block from parsed YAML entities.
 *
 * Builds the mermaid source string client-side from the entity list (same
 * shape produced by the docs_export Python module on the backend), then
 * hands it to mermaid.js for SVG rendering. Re-renders whenever `entities`
 * changes — so AI-driven YAML mutations show up live without a page reload.
 */
import React, { useEffect, useMemo, useRef } from "react";
import mermaid from "mermaid";
import { buildErdSource } from "../../lib/mermaidErdSource";

let _mermaidInitialized = false;
function ensureMermaidInitialized() {
  if (_mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "strict",
    er: { useMaxWidth: true },
  });
  _mermaidInitialized = true;
}

export default function MermaidERD({ entities }) {
  const ref = useRef(null);
  const source = useMemo(() => buildErdSource(entities), [entities]);

  useEffect(() => {
    if (!ref.current) return;
    if (!source) {
      ref.current.innerHTML = "";
      return;
    }
    ensureMermaidInitialized();
    let cancelled = false;
    const id = `dlx-erd-${Math.random().toString(36).slice(2, 10)}`;
    mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
      })
      .catch((err) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = `<pre style="color:var(--text-tertiary);font-size:11px;white-space:pre-wrap;">Mermaid render failed:\n${String(err?.message || err)}</pre>`;
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (!source) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-tertiary)", fontStyle: "italic" }}>
        No entities to draw.
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--border-default)",
        borderRadius: 8,
        padding: 14,
        overflowX: "auto",
      }}
    />
  );
}
