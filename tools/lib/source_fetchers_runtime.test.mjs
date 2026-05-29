import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  parseRssItems,
  parseCrossrefItems,
  extractCrossrefDate,
  createRuntimeSourceHandlers,
} from "./source_fetchers.mjs";

test("来源专属解析函数下沉到独立模块", () => {
  const orchestrator = fs.readFileSync(path.resolve("d:/zotero-med-pipeline/tools/run_research_os_pipeline.mjs"), "utf8");

  assert.doesNotMatch(orchestrator, /function parseRssItems/);
  assert.doesNotMatch(orchestrator, /function parseCrossrefItems/);
  assert.doesNotMatch(orchestrator, /async function fetchRssAll/);
  assert.doesNotMatch(orchestrator, /async function fetchPubMed/);
});

test("source_fetchers 模块提供统一 runtime handlers", () => {
  const handlers = createRuntimeSourceHandlers({
    root: "D:/mock-root",
    helpers: {
      fetchTextWithRetry: async () => "",
      fetchText: async () => "",
      fetchJson: async () => ({ message: { items: [] } }),
      loadRssSources: () => ({ path: "rss.json", sources: [] }),
      loadPubMedPmcSearchConfig: () => ({ path: "pubmed.json", databases: [] }),
      loadCrossrefSearchConfig: () => ({ path: "crossref.json", enabled: true }),
      loadCnkiImportConfig: () => ({ path: "cnki.json", enabled: true, paths: [] }),
      buildNcbiESearchUrl: () => "https://example.com",
      buildCrossrefWorksUrl: () => "https://api.crossref.org/works",
      readCnkiImportItems: async () => [],
      cleanText: (value) => String(value || "").trim(),
    },
  });

  assert.deepEqual(Object.keys(handlers).sort(), ["cnki_import", "crossref", "pubmed", "rss"]);
});

test("source_fetchers 保持 RSS 与 Crossref 解析行为", () => {
  const rssItems = parseRssItems(`
    <rss><channel><title>Journal Feed</title>
    <item><title>Example Title</title><link>https://example.com/a</link><description>DOI 10.1000/xyz123</description></item>
    </channel></rss>
  `, "https://feed.example.com");
  const crossrefItems = parseCrossrefItems([{
    title: ["Crossref Title"],
    URL: "https://doi.org/10.1000/abc",
    DOI: "10.1000/abc",
    "container-title": ["Crossref Journal"],
    "published-online": { "date-parts": [[2026, 5, 29]] },
  }], (value) => String(value || "").trim());

  assert.equal(rssItems[0].source_platform, "rss");
  assert.equal(crossrefItems[0].source_platform, "crossref");
  assert.equal(extractCrossrefDate({ "published-online": { "date-parts": [[2026, 5, 29]] } }), "2026-05-29");
});
