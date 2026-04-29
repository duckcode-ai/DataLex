/* validationStatus — derive a single red / yellow / green pill from the
 * active file's findings so the Validation tab can show severity at a
 * glance, without the user having to click through.
 *
 * Pure function. Same lint passes that ValidationPanel uses, just rolled
 * up into a status dot. Cheap on small files; memoize on the call site.
 */
import yaml from "js-yaml";
import { runModelChecks } from "../modelQuality.js";
import { lintDoc, lintMeshInterfaces } from "./dbtLint.js";
import { scanDangling } from "./danglingScan.js";

export const VALIDATION_STATUS = Object.freeze({
  CLEAN: "green",
  WARN: "yellow",
  BLOCK: "red",
});

const TONE_LABEL = {
  red: "blockers",
  yellow: "warnings",
  green: "clean",
};

export function computeValidationStatus(activeFileContent, activeFile) {
  if (!activeFileContent) {
    return { status: null, blockers: 0, warnings: 0, infos: 0, label: "" };
  }
  const filePath = activeFile?.path || activeFile?.fullPath || activeFile?.name || "";

  let parsedDoc = null;
  try { parsedDoc = yaml.load(activeFileContent); } catch (_err) { parsedDoc = null; }

  const native = runModelChecks(activeFileContent);
  const dbtFindings = parsedDoc && typeof parsedDoc === "object"
    ? lintDoc(parsedDoc, { filePath })
    : [];
  const interfaceFindings = parsedDoc && typeof parsedDoc === "object"
    ? lintMeshInterfaces(parsedDoc, { filePath })
    : [];
  const dangling = scanDangling(activeFileContent);

  // DBT_SCHEMA_DETECTED is an advisory ("DataLex skips native validation
  // for dbt YAML, run dbt-aware checks instead"), not a substantive
  // finding. Don't let it light up the status pill.
  const isAdvisory = (f) => f && (f.code === "DBT_SCHEMA_DETECTED");
  const all = [
    ...(native?.errors || []).filter((f) => !isAdvisory(f)),
    ...(native?.warnings || []).filter((f) => !isAdvisory(f)),
    ...dbtFindings,
    ...interfaceFindings,
  ];
  let blockers = (native?.errors || []).filter((f) => !isAdvisory(f)).length + dangling.length;
  let warnings = 0;
  let infos = 0;
  for (const f of all) {
    if (f?.severity === "error") {
      blockers += 1;
    } else if (f?.severity === "info") {
      infos += 1;
    } else if (f?.severity) {
      warnings += 1;
    }
  }
  // runModelChecks errors were also added to `all`, so they were counted
  // a second time above. Remove the double-count.
  blockers -= (native?.errors || []).filter((f) => !isAdvisory(f)).length;

  const status = blockers > 0
    ? VALIDATION_STATUS.BLOCK
    : warnings > 0
      ? VALIDATION_STATUS.WARN
      : VALIDATION_STATUS.CLEAN;

  return {
    status,
    blockers,
    warnings,
    infos,
    label: TONE_LABEL[status] || "",
  };
}
