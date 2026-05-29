import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildPaperAssetPayload,
  renderPaperMarkdown,
  renderReferencesBib,
  writePaperAssets,
} from "./paper_export_support.mjs";

const TRIAGED = [
  {
    title: "Transformer-based bearing fault diagnosis with sensor fusion",
    中文标题: "基于传感器融合的轴承故障诊断",
    标题翻译: "基于传感器融合的轴承故障诊断",
    abstract: "This paper proposes a sensor-fusion framework for bearing fault diagnosis.",
    journal: "Mechanical Systems and Signal Processing",
    year: "2026",
    doi: "10.1000/abc123",
    url: "https://doi.org/10.1000/abc123",
    推荐等级: "A核心相关",
    推荐理由: "方法与验证高度相关",
    source_channel: "crossref",
  },
  {
    title: "Digital twin driven predictive maintenance for rotating machinery",
    中文标题: "面向旋转机械的数字孪生预测性维护",
    标题翻译: "面向旋转机械的数字孪生预测性维护",
    abstract: "A digital-twin framework supports predictive maintenance decisions.",
    journal: "IEEE Access",
    year: "2025",
    doi: "",
    url: "https://example.com/paper-2",
    推荐等级: "B主题相关",
    推荐理由: "可支撑相关工作与方法讨论",
    source_channel: "rss",
  },
];

test("构建论文资产载荷时会生成章节素材与参考文献键", () => {
  const payload = buildPaperAssetPayload({
    date: "2026-05-29",
    triaged: TRIAGED,
    reportContext: { counts: { daily_export: 2 } },
  });

  assert.equal(payload.references.length, 2);
  assert.equal(payload.sections.length >= 5, true);
  assert.match(payload.references[0].citationKey, /^wang|^transformer/i);
  assert.equal(payload.sections[0].heading, "题目与摘要素材");
});

test("paper.md 包含中英文题名、章节骨架和参考文献素材", () => {
  const payload = buildPaperAssetPayload({
    date: "2026-05-29",
    triaged: TRIAGED,
    reportContext: {},
  });
  const markdown = renderPaperMarkdown(payload, {
    profile: "sci_generic_engineering",
    paperTitleZh: "轴承故障诊断与预测性维护研究",
    paperTitleEn: "Research on Bearing Fault Diagnosis and Predictive Maintenance",
  });

  assert.match(markdown, /^# Research on Bearing Fault Diagnosis and Predictive Maintenance/m);
  assert.match(markdown, /## 中文题名/);
  assert.match(markdown, /## 引言/);
  assert.match(markdown, /基于传感器融合的轴承故障诊断/);
  assert.match(markdown, /## 参考文献素材/);
});

test("references.bib 生成最小可引用 BibTeX 条目", () => {
  const payload = buildPaperAssetPayload({
    date: "2026-05-29",
    triaged: TRIAGED,
    reportContext: {},
  });
  const bib = renderReferencesBib(payload.references);

  assert.match(bib, /@article\{/);
  assert.match(bib, /title = \{Transformer-based bearing fault diagnosis with sensor fusion\}/);
  assert.match(bib, /doi = \{10\.1000\/abc123\}/);
  assert.match(bib, /url = \{https:\/\/example\.com\/paper-2\}/);
});

test("writePaperAssets 会把 paper.md 与 references.bib 写到目标目录", async () => {
  const payload = buildPaperAssetPayload({
    date: "2026-05-29",
    triaged: TRIAGED,
    reportContext: {},
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-assets-"));

  const outputs = await writePaperAssets({
    outputDir,
    payload,
    options: {
      profile: "cnki_generic_academic",
      paperTitleZh: "工科研究导出测试",
      paperTitleEn: "Engineering Export Test",
    },
  });

  assert.equal(fs.existsSync(outputs.paper_markdown), true);
  assert.equal(fs.existsSync(outputs.references_bib), true);
  assert.equal(fs.existsSync(outputs.paper_docx), true);
  assert.match(fs.readFileSync(outputs.paper_markdown, "utf8"), /Engineering Export Test/);
  assert.match(fs.readFileSync(outputs.references_bib, "utf8"), /@article\{/);
  assert.equal(fs.readFileSync(outputs.paper_docx).subarray(0, 2).toString("binary"), "PK");
});
