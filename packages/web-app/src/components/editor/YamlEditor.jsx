import React, { useCallback, useRef, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { EditorView } from "@codemirror/view";
import { autocompletion } from "@codemirror/autocomplete";
import { linter, lintGutter } from "@codemirror/lint";
import useWorkspaceStore from "../../stores/workspaceStore";
import { runModelChecks } from "../../modelQuality";

const lightTheme = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "#0f172a",
    fontSize: "13px",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', monospace",
  },
  ".cm-content": {
    caretColor: "#2563eb",
    padding: "8px 0",
  },
  ".cm-cursor": {
    borderLeftColor: "#2563eb",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgba(59, 130, 246, 0.15) !important",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(59, 130, 246, 0.06)",
  },
  ".cm-gutters": {
    backgroundColor: "#f8fafc",
    color: "#94a3b8",
    border: "none",
    borderRight: "1px solid #e2e8f0",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    color: "#475569",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 12px",
    minWidth: "40px",
  },
  ".cm-foldGutter": {
    width: "12px",
  },
  ".cm-matchingBracket": {
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    outline: "1px solid rgba(59, 130, 246, 0.3)",
  },
});

// Schema-aware YAML completions
const SCHEMA_KEYWORDS = {
  root: ["model:", "entities:", "relationships:", "indexes:", "governance:", "glossary:"],
  model: ["name:", "version:", "domain:", "owners:", "state:", "description:", "spec_version:", "imports:"],
  entity: ["name:", "type:", "description:", "fields:", "tags:", "schema:", "database:", "subject_area:", "owner:", "sla:"],
  field: ["name:", "type:", "nullable:", "primary_key:", "unique:", "foreign_key:", "default:", "check:", "computed:", "computed_expression:", "sensitivity:", "description:", "deprecated:", "deprecated_message:", "examples:"],
  relationship: ["name:", "from:", "to:", "cardinality:", "on_update:", "description:"],
  index: ["name:", "entity:", "fields:", "unique:"],
  types: ["string", "integer", "bigint", "float", "decimal", "boolean", "date", "timestamp", "datetime", "uuid", "json", "text", "varchar"],
  cardinalities: ["one_to_one", "one_to_many", "many_to_one", "many_to_many"],
  states: ["draft", "approved", "deprecated"],
  entityTypes: ["table", "view", "materialized_view", "external_table", "snapshot"],
  sensitivity: ["public", "internal", "confidential", "restricted"],
};

function yamlCompletions(context) {
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);
  const indent = textBefore.search(/\S/);
  const trimmed = textBefore.trim();

  // After "type: " suggest types
  if (/type:\s*$/.test(textBefore)) {
    if (indent <= 6) return { from: context.pos, options: SCHEMA_KEYWORDS.entityTypes.map(t => ({ label: t, type: "enum" })) };
    return { from: context.pos, options: SCHEMA_KEYWORDS.types.map(t => ({ label: t, type: "type" })) };
  }
  if (/cardinality:\s*$/.test(textBefore)) return { from: context.pos, options: SCHEMA_KEYWORDS.cardinalities.map(t => ({ label: t, type: "enum" })) };
  if (/state:\s*$/.test(textBefore)) return { from: context.pos, options: SCHEMA_KEYWORDS.states.map(t => ({ label: t, type: "enum" })) };
  if (/sensitivity:\s*$/.test(textBefore)) return { from: context.pos, options: SCHEMA_KEYWORDS.sensitivity.map(t => ({ label: t, type: "enum" })) };
  if (/nullable:\s*$/.test(textBefore) || /primary_key:\s*$/.test(textBefore) || /unique:\s*$/.test(textBefore) || /foreign_key:\s*$/.test(textBefore) || /deprecated:\s*$/.test(textBefore) || /computed:\s*$/.test(textBefore))
    return { from: context.pos, options: [{ label: "true", type: "keyword" }, { label: "false", type: "keyword" }] };

  // Determine context by indentation
  const word = context.matchBefore(/[\w-]*/);
  if (!word && !trimmed.endsWith("-")) return null;
  const from = word ? word.from : context.pos;

  let options;
  if (indent <= 0) options = SCHEMA_KEYWORDS.root;
  else if (indent <= 2) options = SCHEMA_KEYWORDS.model;
  else if (indent <= 6 && trimmed.startsWith("- ")) options = SCHEMA_KEYWORDS.entity;
  else if (indent <= 6) options = SCHEMA_KEYWORDS.entity;
  else if (indent <= 10) options = SCHEMA_KEYWORDS.field;
  else options = SCHEMA_KEYWORDS.field;

  return { from, options: options.map(k => ({ label: k, type: "property" })) };
}

// Inline validation linter
function yamlLinter(view) {
  const text = view.state.doc.toString();
  if (!text.trim()) return [];
  const check = runModelChecks(text);
  const diagnostics = [];
  for (const issue of check.issues || []) {
    const path = issue.path || "";
    const msg = issue.message || "";
    const severity = issue.severity === "error" ? "error" : "warning";
    // Try to find the line matching the path
    let line = 1;
    if (path.includes("/entities")) {
      const entityMatch = path.match(/\/entities\/(\d+)/);
      if (entityMatch) {
        const idx = parseInt(entityMatch[1]);
        let count = -1;
        for (let i = 1; i <= view.state.doc.lines; i++) {
          const lt = view.state.doc.line(i).text;
          if (/^\s+-\s+name:/.test(lt) || /^entities:/.test(lt.trim())) {
            count++;
            if (count === idx) { line = i; break; }
          }
        }
      }
    }
    const lineObj = view.state.doc.line(Math.min(line, view.state.doc.lines));
    diagnostics.push({ from: lineObj.from, to: lineObj.to, severity, message: `${path}: ${msg}` });
  }
  return diagnostics;
}

const schemaAutocompletion = autocompletion({ override: [yamlCompletions] });
const validationLinter = linter(yamlLinter, { delay: 800 });

const editorExtensions = [
  yaml(),
  lightTheme,
  EditorView.lineWrapping,
  schemaAutocompletion,
  lintGutter(),
  validationLinter,
];

export default function YamlEditor() {
  const { activeFileContent, updateContent, activeFile } = useWorkspaceStore();
  const editorRef = useRef(null);

  const onChange = useCallback((value) => {
    updateContent(value);
  }, [updateContent]);

  if (!activeFile) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        <div className="text-center">
          <p className="mb-2">No file open</p>
          <p className="text-xs">Select a file from the sidebar or create a new one</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden">
      <CodeMirror
        ref={editorRef}
        value={activeFileContent}
        onChange={onChange}
        extensions={editorExtensions}
        theme="light"
        height="100%"
        style={{ height: "100%" }}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          foldGutter: true,
          bracketMatching: true,
          indentOnInput: true,
          autocompletion: true,
          closeBrackets: true,
          tabSize: 2,
        }}
      />
    </div>
  );
}
