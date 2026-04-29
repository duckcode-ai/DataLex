import test from "node:test";
import assert from "node:assert/strict";
import {
  aiProposalPath,
  isPatchYamlProposal,
  proposalChangeFromYaml,
  proposalEditableYaml,
  proposalEditorTitle,
} from "../src/components/ai/aiProposalYaml.js";

test("patch_yaml proposals preserve exact target path and edit JSON Patch ops", () => {
  const change = {
    type: "patch_yaml",
    path: "models/metrics/fct_orders.yml",
    targetPointer: "/metrics/0/expression",
    ops: [{ op: "add", path: "/metrics/0/expression", value: "order_total" }],
  };

  assert.equal(isPatchYamlProposal(change), true);
  assert.equal(aiProposalPath(change, "diagram"), "models/metrics/fct_orders.yml");
  assert.equal(proposalEditorTitle(change, 0), "1. models/metrics/fct_orders.yml");

  const draft = proposalEditableYaml(change);
  assert.match(draft, /\/metrics\/0\/expression/);

  const normalized = proposalChangeFromYaml(change, draft);
  assert.equal(normalized.type, "patch_yaml");
  assert.equal(normalized.path, "models/metrics/fct_orders.yml");
  assert.deepEqual(normalized.patch, change.ops);
  assert.equal(Object.hasOwn(normalized, "content"), false);
});

test("patch_yaml proposals are not converted into diagram update files", () => {
  const change = {
    type: "patch_yaml",
    path: "models/metrics/fct_orders.yml",
    patch: [{ op: "replace", path: "/metrics/0/type", value: "simple" }],
  };

  const normalized = proposalChangeFromYaml(change, proposalEditableYaml(change));
  assert.equal(normalized.type, "patch_yaml");
  assert.equal(normalized.path, "models/metrics/fct_orders.yml");
  assert.notEqual(normalized.path, "metrics/Conceptual/0.diagram.yaml");
});
