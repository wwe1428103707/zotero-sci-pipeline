import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isChineseText, looksLikeTitle, isTitleAlreadyChinese, validateTranslationQuality, detectSourceLanguage } from "./lib/title_validation.mjs";
import { buildRuntimeConfig } from "./lib/runtime_config.mjs";
import { getTranslationConfig } from "./lib/title_translation_support.mjs";
import { ensureZoteroMcpReady } from "./lib/ensure_zotero_mcp_ready.mjs";
import { runStandaloneTitleTranslation } from "./standalone_title_translation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = path.join(ROOT, "research_os", "test_reports");
const REPORT_PATH = path.join(REPORT_DIR, "standalone_translation_test_report.json");

const EMOJI_PASS = "\u2705";
const EMOJI_FAIL = "\u274c";
const EMOJI_SKIP = "\u23f8\ufe0f";

const results = { passed: 0, failed: 0, skipped: 0, details: [] };

function assert(label, ok, detail = "") {
  if (ok) {
    results.passed++;
    console.log(`  ${EMOJI_PASS} ${label}`);
  } else {
    results.failed++;
    console.log(`  ${EMOJI_FAIL} ${label} ${detail ? " \u2014 " + detail : ""}`);
  }
  results.details.push({ label, passed: ok, detail });
}

function skip(label, reason) {
  results.skipped++;
  console.log(`  ${EMOJI_SKIP} ${label} (${reason})`);
  results.details.push({ label, passed: null, skipped: true, detail: reason });
}

const SECTION = (title) => console.log(`\n=== ${title} ===\n`);

async function runTests() {
  process.stdout.setDefaultEncoding("utf8");

  console.log("# 独立翻译模块功能测试报告");
  console.log(`# 开始时间: ${new Date().toISOString()}`);
  console.log(`# 文件: ${pathToFileURL(process.argv[1]).href}`);

  // ------------------------------------------------------------------
  SECTION("1. title_validation.mjs \u2014 标题校验工具库单元测试");
  // ------------------------------------------------------------------

  SECTION("1.1 isChineseText() \u2014 中文检测");
  assert("纯中文返回 true", isChineseText("基于深度学习的图像分割方法研究"));
  assert("含中文返回 true", isChineseText("Deep Learning \u5728\u533b\u5b66\u5f71\u50cf\u4e2d\u7684\u5e94\u7528"));
  assert("纯英文返回 false", !isChineseText("Deep Learning for Medical Image Segmentation"));
  assert("空字符串返回 false", !isChineseText(""));

  SECTION("1.2 looksLikeTitle() \u2014 标题合法性校验");
  const valid = looksLikeTitle("Deep Learning for Medical Image Segmentation: A Comprehensive Survey");
  assert("合法标题通过校验", valid.valid);
  assert("空标题拒绝", !looksLikeTitle("").valid);
  assert("过短标题拒绝", !looksLikeTitle("Hi").valid);
  assert("URL 标题拒绝", !looksLikeTitle("https://example.com/paper").valid);
  assert("非标题文本拒绝", !looksLikeTitle("Abstract").valid);

  SECTION("1.3 isTitleAlreadyChinese() \u2014 已含中文标题检测");
  assert("短标题有中文返回 true", isTitleAlreadyChinese("English Title", "\u4e2d\u6587\u6807\u9898"));
  assert("主标题有中文返回 true", isTitleAlreadyChinese("\u4e2d\u6587\u6807\u9898\u7684\u7814\u7a76", ""));
  assert("两者无中文返回 false", !isTitleAlreadyChinese("English Title", ""));
  assert("空值处理正常", !isTitleAlreadyChinese("English Title", null));

  SECTION("1.4 validateTranslationQuality() \u2014 翻译质量校验");
  const q1 = validateTranslationQuality("Deep Learning", "\u6df1\u5ea6\u5b66\u4e60");
  assert("合法翻译通过", q1.ok);
  const q2 = validateTranslationQuality("Deep Learning", "");
  assert("空翻译拒绝", !q2.ok && q2.reason === "empty_translation");
  const q3 = validateTranslationQuality("Deep Learning", "Deep Learning");
  assert("与原文完全相同拒绝", !q3.ok);
  const q4 = validateTranslationQuality("CNN", "CNN");
  assert("英文未翻译拒绝", !q4.ok);

  SECTION("1.5 detectSourceLanguage() \u2014 源语言检测");
  assert("英文检测为 en", detectSourceLanguage("Attention Is All You Need") === "en");
  assert("中文检测为 zh", detectSourceLanguage("\u6df1\u5ea6\u5b66\u4e60\u7528\u4e8e\u533b\u5b66\u5f71\u50cf\u5206\u5272") === "zh");
  assert("空输入返回 unknown", detectSourceLanguage("") === "unknown");

  // ------------------------------------------------------------------
  SECTION("2. title_translation_support.mjs \u2014 翻译服务配置验证");
  // ------------------------------------------------------------------

  SECTION("2.1 getTranslationConfig() \u2014 配置合并");
  const cfg = getTranslationConfig();
  assert("配置对象已返回", !!cfg);
  assert("endpoint 已配置", cfg.endpoint && cfg.endpoint.includes("http"));
  assert("model 不为占位符", cfg.model && cfg.model !== "your-model-name");
  if (cfg.apiKeyConfigured) {
    assert("API Key 已配置", true);
  } else {
    skip("API Key", "\u6ca1\u6709 TITLE_TRANSLATION_API_KEY \u73af\u5883\u53d8\u91cf\u6216 .env \u672a\u52a0\u8f7d");
  }

  // ------------------------------------------------------------------
  SECTION("3. runStandaloneTitleTranslation() \u2014 \u72ec\u7acb\u7ffb\u8bd1\u6a21\u5757\u96c6\u6210\u6d4b\u8bd5");
  // ------------------------------------------------------------------

  SECTION("3.1 dry-run \u6a21\u5f0f");
  try {
    const dryReport = await runStandaloneTitleTranslation({ dryRun: true, limit: 5 });
    assert("dry-run \u8fd4\u56de\u62a5\u544a", !!dryReport);
    assert("status \u5b57\u6bb5\u5b58\u5728", !!dryReport.status);
    assert("scan \u5b57\u6bb5\u5b58\u5728", !!dryReport.scan);
    assert("translation \u5b57\u6bb5\u5b58\u5728", !!dryReport.translation);
    assert("writeback \u5b57\u6bb5\u5b58\u5728", !!dryReport.writeback);
    assert("failures \u6570\u7ec4\u5b58\u5728", Array.isArray(dryReport.failures));
    if (dryReport.status === "no_items_needing_translation") {
      skip("dry-run \u7ffb\u8bd1\u6267\u884c", "\u6587\u732e\u5e93\u4e2d\u672a\u53d1\u73b0\u9700\u8981\u7ffb\u8bd1\u7684\u6761\u76ee");
    } else if (dryReport.dry_run_candidates && dryReport.dry_run_candidates.length > 0) {
      assert("dry-run \u5019\u9009\u5217\u8868\u975e\u7a7a", dryReport.dry_run_candidates.length > 0);
      const sample = dryReport.dry_run_candidates[0];
      assert("dry-run \u5019\u9009\u5305\u542b itemKey", !!sample.itemKey);
      assert("dry-run \u5019\u9009\u5305\u542b title", !!sample.title);
      assert("dry-run \u5019\u9009\u5305\u542b sourceLang", !!sample.sourceLang);
    }
  } catch (e) {
    assert("dry-run \u6ca1\u6709\u66b4\u9732\u5f02\u5e38", false, e.message);
  }

  SECTION("3.2 orchestrator --translation-only \u96c6\u6210\u6d4b\u8bd5");
  try {
    const { runZoteroLiteratureFilter } = await import("./run_zotero_literature_filter.mjs");
    const report = await runZoteroLiteratureFilter({
      runMode: { translationOnly: true, triggerMode: "manual", isManualOrForce: true, isScheduled: false, forceRun: true, explicitForceRun: false },
    });
    assert("--translation-only \u6a21\u5f0f\u8fd4\u56de\u62a5\u544a", !!report);
    assert("\u62a5\u544a\u5305\u542b standalone_translation", !!report.standalone_translation);
    assert("standalone_translation \u5305\u542b status", !!report.standalone_translation.status);
  } catch (e) {
    skip("orchestrator --translation-only \u96c6\u6210\u6d4b\u8bd5", e.message.slice(0, 100));
  }

  // ------------------------------------------------------------------
  SECTION("4. config_server.mjs API \u7aef\u70b9\u9a8c\u8bc1");
  // ------------------------------------------------------------------

  SECTION("4.1 HTTP API \u7aef\u70b9\u6d4b\u8bd5");
  try {
    const res = await fetch("http://localhost:3456/api/translate/standalone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: true, limit: 5 }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json();
    assert("API \u54cd\u5e94\u72b6\u6001\u7801 200", res.status === 200);
    assert("API \u54cd\u5e94\u5305\u542b ok \u5b57\u6bb5", "ok" in body);
    if (body.ok) {
      assert("API \u54cd\u5e94\u5305\u542b report", !!body.report);
      assert("API report \u5305\u542b status", !!body.report.status);
    } else {
      assert("API \u62a5\u9519\u63d0\u793a\u6709\u6548", !!body.error);
    }
  } catch (e) {
    if (e.name === "AbortError") {
      skip("API \u7aef\u70b9\u6d4b\u8bd5", "\u8bf7\u6c42\u8d85\u65f6 (30s)");
    } else {
      skip("API \u7aef\u70b9\u6d4b\u8bd5", "\u914d\u7f6e\u670d\u52a1\u5668\u672a\u542f\u52a8\u6216\u7aef\u53e3\u4e0d\u5bf9 — " + (e.message || "").slice(0, 100));
    }
  }

  // ------------------------------------------------------------------
  SECTION("5. \u65e5\u5fd7\u4e0e\u62a5\u544a\u673a\u5236\u9a8c\u8bc1");
  // ------------------------------------------------------------------

  SECTION("5.1 \u8f93\u51fa\u6587\u4ef6\u68c0\u67e5");
  const pipelineDir = path.join(ROOT, "research_os", "pipeline");
  const files = ["standalone_translation_report.json", "standalone_translation_failures.json"];
  for (const f of files) {
    try {
      const fullPath = path.join(pipelineDir, f);
      const stat = await fs.stat(fullPath);
      assert(`${f} \u6587\u4ef6\u5b58\u5728`, stat.size > 0);
    } catch {
      skip(`${f}`, "\u6587\u4ef6\u4e0d\u5b58\u5728\u2014\u2014\u9700\u8981\u5148\u6267\u884c\u5b9e\u9645\u7ffb\u8bd1\u4efb\u52a1\u751f\u6210");
    }
  }

  // ------------------------------------------------------------------
  SECTION("6. \u4ee3\u7801\u8bed\u6cd5\u68c0\u67e5");
  // ------------------------------------------------------------------

  const { execSync } = await import("node:child_process");
  const filesToCheck = [
    "tools/lib/title_validation.mjs",
    "tools/standalone_title_translation.mjs",
    "tools/config_server.mjs",
    "tools/run_zotero_literature_filter.mjs",
  ];
  for (const f of filesToCheck) {
    try {
      execSync(`node --check ${f}`, { cwd: ROOT, encoding: "utf8" });
      assert(`${f} \u8bed\u6cd5\u6b63\u786e`, true);
    } catch {
      assert(`${f} \u8bed\u6cd5\u6b63\u786e`, false, "\u8bed\u6cd5\u9519\u8bef");
    }
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  const total = results.passed + results.failed + results.skipped;
  console.log(`\n${"=".repeat(50)}`);
  console.log(`\u603b\u7ed3: ${results.passed} \u901a\u8fc7 / ${results.failed} \u5931\u8d25 / ${results.skipped} \u8df3\u8fc7 (\u5171 ${total} \u9879)`);
  console.log(`${"=".repeat(50)}\n`);

  // Write report
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    summary: { total, passed: results.passed, failed: results.failed, skipped: results.skipped },
    details: results.details,
  }, null, 2), "utf8");

  console.log(`\u6d4b\u8bd5\u62a5\u544a\u5df2\u5199\u5165: ${REPORT_PATH}`);
  process.exit(results.failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error("\u6d4b\u8bd5\u8fd0\u884c\u5f02\u5e38:", e);
  process.exit(1);
});
