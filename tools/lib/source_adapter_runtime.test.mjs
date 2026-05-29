import test from "node:test";
import assert from "node:assert/strict";

import { createSourceAdapters, executeSourcePlan } from "./source_adapters.mjs";

test("createSourceAdapters 根据 sourcePlan 生成统一 adapter 列表", () => {
  const adapters = createSourceAdapters({
    sourcePlan: {
      active_sources: ["rss", "crossref", "cnki_import"],
      rss: { enabled: true, path: "rss.json" },
      pubmed: { enabled: false, path: "pubmed.json" },
      crossref: { enabled: true, path: "crossref.json" },
      cnki_import: { enabled: true, path: "cnki_import.json" },
    },
    handlers: {
      rss: async () => ({ items: [], failed: [] }),
      pubmed: async () => ({ items: [], failed: [] }),
      crossref: async () => ({ items: [], failed: [] }),
      cnki_import: async () => ({ items: [], failed: [] }),
    },
  });

  assert.deepEqual(adapters.map((adapter) => adapter.id), ["rss", "pubmed", "crossref", "cnki_import"]);
  assert.equal(adapters[0].enabled, true);
  assert.equal(adapters[1].enabled, false);
  assert.equal(adapters[2].enabled, true);
  assert.equal(adapters[3].enabled, true);
});

test("executeSourcePlan 统一汇总各 adapter 结果", async () => {
  const adapters = createSourceAdapters({
    sourcePlan: {
      active_sources: ["rss", "crossref"],
      rss: { enabled: true, path: "rss.json" },
      pubmed: { enabled: false, path: "pubmed.json" },
      crossref: { enabled: true, path: "crossref.json" },
      cnki_import: { enabled: false, path: "cnki_import.json" },
    },
    handlers: {
      rss: async (config) => ({ items: [{ title: "rss-item", source_platform: "rss" }], failed: [], config }),
      pubmed: async (config) => ({ items: [{ title: "db-item", source_platform: "pubmed" }], failed: [], config }),
      crossref: async (config) => ({ items: [{ title: "crossref-item", source_platform: "crossref" }], failed: [{ source: "crossref", error: "timeout" }], config }),
      cnki_import: async (config) => ({ items: [{ title: "cnki-item", source_platform: "cnki_import" }], failed: [], config }),
    },
  });

  const result = await executeSourcePlan(adapters);

  assert.equal(result.rss.items.length, 1);
  assert.equal(result.pubmed.items.length, 0);
  assert.equal(result.crossref.failed.length, 1);
  assert.equal(result.cnki_import.items.length, 0);
  assert.deepEqual(result.all_items.map((item) => item.source_platform), ["rss", "crossref"]);
  assert.deepEqual(result.all_failures.map((entry) => entry.stage), ["crossref"]);
});
