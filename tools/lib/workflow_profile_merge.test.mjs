import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadWorkflowRules } from "./literature_config.mjs";

function makeRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zotero-sci-profile-"));
  const configDir = path.join(root, "config");
  fs.mkdirSync(configDir, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    fs.writeFileSync(path.join(configDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
  return root;
}

test("workflow_rules 缺省字段时回退到 research_profile 默认值", () => {
  const root = makeRoot({
    "research_profile.json": {
      profile_id: "engineering_general",
      domain: "engineering",
      triage_labels: { A: "A核心相关", B: "B主题相关", C: "C背景相关", D: "D低相关" },
      triage_defaults: {
        terms: {
          pollutant: ["fault diagnosis"],
          core_topic: ["bearing"],
          mechanism: ["validation"]
        },
        journal_whitelist: ["mechanical systems and signal processing"],
        weights: { pollutant: 2.1, core_topic: 1.8, mechanism: 0.9, journal_quality: 1.0, feedback_positive: 0.5, feedback_negative: -0.7 },
        thresholds: { A_score: 5.1, A_min_pollutant_hits: 1, A_min_core_hits: 1, B_score: 3.0, C_score: 1.0, B_uncertain_below: 3.8, C_uncertain_below: 1.9 },
        grade_reasons: { A: "profile-A", B: "profile-B", C: "profile-C", D: "profile-D" }
      }
    },
    "workflow_rules.json": {
      version: 2,
      triage: {
        version: "test-v1"
      }
    }
  });

  const triage = loadWorkflowRules({ root }).config.triage;
  assert.equal(triage.labels.A, "A核心相关");
  assert.deepEqual(triage.terms.pollutant, ["fault diagnosis"]);
  assert.equal(triage.weights.pollutant, 2.1);
  assert.equal(triage.grade_reasons.A, "profile-A");
});

test("workflow_rules 显式字段优先覆盖 research_profile 默认值", () => {
  const root = makeRoot({
    "research_profile.json": {
      profile_id: "engineering_general",
      domain: "engineering",
      triage_labels: { A: "A核心相关", B: "B主题相关", C: "C背景相关", D: "D低相关" },
      triage_defaults: {
        terms: {
          pollutant: ["fault diagnosis"],
          core_topic: ["bearing"],
          mechanism: ["validation"]
        },
        weights: { pollutant: 2.1, core_topic: 1.8, mechanism: 0.9, journal_quality: 1.0, feedback_positive: 0.5, feedback_negative: -0.7 }
      }
    },
    "workflow_rules.json": {
      version: 2,
      triage: {
        terms: {
          pollutant: ["custom-term"]
        },
        weights: {
          pollutant: 3.3
        }
      }
    }
  });

  const triage = loadWorkflowRules({ root }).config.triage;
  assert.deepEqual(triage.terms.pollutant, ["custom-term"]);
  assert.equal(triage.weights.pollutant, 3.3);
  assert.deepEqual(triage.terms.core_topic, ["bearing"]);
});
