import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { INITIAL_SCREENING_STANDARDS_ZH, buildInitialScreeningStandards } from "./screening_standards_file.mjs";
import { parseScreeningStandards, classifyItem } from "./triage_policy.mjs";
import { buildFeedbackSemanticSamples } from "./preference_refinement.mjs";
import { loadResearchProfile } from "./literature_config.mjs";

test("默认筛选标准转向通用工科研究", () => {
  assert.match(INITIAL_SCREENING_STANDARDS_ZH, /工科|工程|实验验证/);
  assert.doesNotMatch(INITIAL_SCREENING_STANDARDS_ZH, /小胶质|神经炎症|肠道菌群|补体/);
});

test("默认 research profile 为 engineering_general", () => {
  const profile = loadResearchProfile().config;

  assert.equal(profile.profile_id, "engineering_general");
  assert.equal(profile.domain, "engineering");
  assert.ok(profile.default_sources.includes("crossref"));
  assert.ok(profile.default_sources.includes("cnki_import"));
});

test("默认筛选标准模板包含写作与格式约束章节", () => {
  const text = buildInitialScreeningStandards(loadResearchProfile().config);

  assert.match(text, /## 论文写作要求/);
  assert.match(text, /## 格式偏好与投稿约束/);
  assert.match(text, /SCI|CNKI/);
});

test("工科方法论文不会被默认规则直接判为低相关", () => {
  const standards = parseScreeningStandards(INITIAL_SCREENING_STANDARDS_ZH);
  const result = classifyItem({
    title: "Transformer-based bearing fault diagnosis with sensor fusion for rotating machinery condition monitoring",
    abstract: "This study proposes a fault diagnosis framework for rotating machinery using multisensor fusion, benchmark experiments, and ablation validation.",
    journal: "mechanical systems and signal processing",
    source_platform: "rss",
    source_channel: "rss",
  }, {}, standards);

  assert.equal(result.hard_excluded, false);
  assert.notEqual(result.grade, "D");
  assert.ok(result.scoring_detail.core_hits.length > 0);
});

test("偏好提炼可以识别工程主题和验证语义", () => {
  const [sample] = buildFeedbackSemanticSamples({
    signals: [
      {
        row: 2,
        feedback: "keep",
        comment: "这类故障诊断和状态监测研究值得保留，实验验证充分。",
        english_title: "Bearing fault diagnosis with sensor fusion and benchmark validation",
        title_translation: "基于传感器融合和基准验证的轴承故障诊断",
      },
    ],
  }, "test.xlsx", { generatedAt: "2026-05-29T00:00:00.000Z" });

  assert.ok(sample.topic_tags.includes("fault_diagnosis"));
  assert.ok(sample.scope_tags.includes("engineering_validation"));
  assert.ok(sample.extracted_terms.some((term) => /fault diagnosis|engineering validation/i.test(term)));
});

test("仓库内 screening_standards 示例文件不再保留占位符", () => {
  const filePath = path.resolve("d:/zotero-med-pipeline/screening_standards.md");
  const text = fs.readFileSync(filePath, "utf8");

  assert.doesNotMatch(text, /\[你的研究方向|\[你想降低优先级|\[你想直接排除/);
  assert.match(text, /论文写作要求/);
});
