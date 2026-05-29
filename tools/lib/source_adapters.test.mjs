import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildCrossrefWorksUrl,
  loadCrossrefSearchConfig,
  loadCnkiImportConfig,
  loadSourcePlan,
  readCnkiImportItems,
} from "./literature_config.mjs";

function makeRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zotero-sci-sources-"));
  const configDir = path.join(root, "config");
  fs.mkdirSync(configDir, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    if (name.startsWith("config/")) {
      const filePath = path.join(root, name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
      continue;
    }
    fs.writeFileSync(path.join(configDir, name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
  return root;
}

test("profile.default_sources 驱动默认来源集合", () => {
  const root = makeRoot({
    "research_profile.json": {
      profile_id: "engineering_general",
      domain: "engineering",
      default_sources: ["rss", "crossref", "cnki_import"],
    },
  });

  const plan = loadSourcePlan({ root });

  assert.deepEqual(plan.active_sources, ["rss", "crossref", "cnki_import"]);
  assert.equal(plan.crossref.enabled, true);
  assert.equal(plan.cnki_import.enabled, true);
});

test("Crossref 默认配置可构造 works 查询 URL", () => {
  const root = makeRoot({
    "research_profile.json": {
      profile_id: "engineering_general",
      domain: "engineering",
      default_sources: ["crossref"],
    },
  });
  const cfg = loadCrossrefSearchConfig({ root, now: new Date("2026-05-29T00:00:00.000Z") });
  const url = buildCrossrefWorksUrl(cfg);

  assert.equal(cfg.enabled, true);
  assert.match(url, /^https:\/\/api\.crossref\.org\/works\?/);
  assert.match(url, /rows=/);
  assert.match(url, /from-pub-date%3A/);
});

test("CNKI import 可以从本地 CSV 导入并标准化字段", async () => {
  const root = makeRoot({
    "research_profile.json": {
      profile_id: "engineering_general",
      domain: "engineering",
      default_sources: ["cnki_import"],
    },
    "cnki_import.json": {
      enabled: true,
      paths: ["imports/cnki_sample.csv"],
    },
    "config/imports/cnki_sample.csv": [
      "Title,Abstract,Keywords,Journal,Year,URL",
      "\"轴承故障诊断方法研究\",\"提出一种基于传感器融合的诊断框架\",\"故障诊断;状态监测\",\"机械工程学报\",\"2026\",\"https://example.com/cnki/1\"",
    ].join("\n"),
  });

  const cfg = loadCnkiImportConfig({ root });
  const items = await readCnkiImportItems({ root, config: cfg });

  assert.equal(cfg.enabled, true);
  assert.equal(cfg.paths.length, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].source_platform, "cnki_import");
  assert.equal(items[0].source_channel, "cnki_import");
  assert.equal(items[0].journal, "机械工程学报");
  assert.match(items[0].title, /轴承故障诊断/);
});
