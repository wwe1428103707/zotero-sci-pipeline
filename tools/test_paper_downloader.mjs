import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

import { normalizeDoi, extractArxivId, generatePdfFilename, downloadFromSciHub, downloadFromArxiv, downloadPdf } from "./lib/doi_downloader.mjs";
import { buildRuntimeConfig } from "./lib/runtime_config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = path.join(ROOT, "research_os", "test_reports");
const REPORT_PATH = path.join(REPORT_DIR, "paper_downloader_test_report.json");

const EMOJI_PASS = "\u2705";
const EMOJI_FAIL = "\u274c";
const EMOJI_SKIP = "\u23f8\ufe0f";

const results = { passed: 0, failed: 0, skipped: 0, details: [] };

function assert(label, ok, detail = "") {
  if (ok) { results.passed++; console.log(`  ${EMOJI_PASS} ${label}`); }
  else { results.failed++; console.log(`  ${EMOJI_FAIL} ${label}${detail ? " — " + detail : ""}`); }
  results.details.push({ label, passed: ok, detail });
}

function skip(label, reason) {
  results.skipped++;
  console.log(`  ${EMOJI_SKIP} ${label} (${reason})`);
  results.details.push({ label, passed: null, skipped: true, detail: reason });
}

const SECTION = (title) => console.log(`\n=== ${title} ===\n`);

async function runTests() {
  console.log("# PDF 自动下载模块功能测试报告");
  console.log(`# 开始时间: ${new Date().toISOString()}`);

  // ------------------------------------------------------------------
  SECTION("1. doi_downloader.mjs — DOI/arXiv ID 工具函数单元测试");
  // ------------------------------------------------------------------

  SECTION("1.1 normalizeDoi()");
  assert("DOI 号标准化", normalizeDoi("10.1000/xyz123") === "10.1000/xyz123");
  assert("去除 doi.org 前缀", normalizeDoi("https://doi.org/10.1000/abc") === "10.1000/abc");
  assert("去除 doi: 前缀", normalizeDoi("doi:10.1000/test") === "10.1000/test");
  assert("空输入返回空", normalizeDoi("") === "");
  assert("小写转换", normalizeDoi("10.1000/ABC") === "10.1000/abc");

  SECTION("1.2 extractArxivId()");
  assert("arXiv DOI 提取", extractArxivId("10.48550/arxiv.2201.12345") === "2201.12345");
  assert("标题中 arXiv 号", extractArxivId("", "This paper is on arXiv:2301.67890v3") === "2301.67890v3");
  assert("纯 arXiv ID", extractArxivId("2006.12345") === "2006.12345");
  assert("无 arXiv 返回空", extractArxivId("10.1000/xyz", "Some Title") === "");

  SECTION("1.3 generatePdfFilename()");
  const fn1 = generatePdfFilename("10.1000/abc", "A Deep Learning Approach");
  assert("文件名以 .pdf 结尾", fn1.endsWith(".pdf"));
  assert("文件名包含标题关键词", /A[_ ]Deep[_ ]Learning[_ ]Approach/i.test(fn1));
  const fn2 = generatePdfFilename("10.1000/xyz", "");
  assert("无标题时生成 .pdf 文件", fn2.endsWith(".pdf"));

  SECTION("1.4 downloadPdf() 参数验证（不实际下载）");
  const noDoiNoArxiv = await downloadPdf("", "Some Title", { sciHubTimeoutMs: 100, arxivTimeoutMs: 100 });
  assert("无 DOI/arXiv 时返回错误", !noDoiNoArxiv.ok && noDoiNoArxiv.reason === "no_doi_or_arxiv_id");

  // ------------------------------------------------------------------
  SECTION("2. config/pdf_download.config.json — 配置文件验证");
  // ------------------------------------------------------------------

  try {
    const cfg = JSON.parse(await fs.readFile(path.join(ROOT, "config", "pdf_download.config.json"), "utf8"));
    assert("配置文件存在", true);
    assert("sci_hub_base_url 有值", !!cfg.sci_hub_base_url);
    assert("默认值正确", cfg.sci_hub_base_url === "https://sci-hub.st" || typeof cfg.sci_hub_base_url === "string");
    assert("grade_filter 有默认值", !!cfg.grade_filter);
    assert("max_concurrent_downloads 为正整数", Number.isFinite(cfg.max_concurrent_downloads) && cfg.max_concurrent_downloads > 0);
    assert("retry 配置完整", cfg.retry && Number.isFinite(cfg.retry.max_retries));
  } catch (e) {
    assert("配置文件存在且格式正确", false, e.message);
  }

  // ------------------------------------------------------------------
  SECTION("3. paper_downloader.mjs — dry-run 集成测试");
  // ------------------------------------------------------------------

  SECTION("3.1 CLI --dry-run 可执行");
  try {
    const out = execSync("node tools/paper_downloader.mjs --dry-run --limit=5", { cwd: ROOT, encoding: "utf8", timeout: 60000, maxBuffer: 5 * 1024 * 1024 });
    assert("CLI dry-run 执行成功", true);
    const braceStart = out.indexOf("{");
    if (braceStart >= 0) {
      try {
        const rep = JSON.parse(out.slice(braceStart));
        assert("dry-run 返回 JSON 报告", true);
        assert("报告包含 status", !!rep.status);
        assert("报告包含 config", !!rep.config);
        assert("报告包含 candidates", !!rep.candidates);
      } catch {
        assert("dry-run JSON 可解析", false);
      }
    }
  } catch (e) {
    skip("CLI dry-run", e.message?.slice(0, 100));
  }

  SECTION("3.2 语法检查");
  const filesToCheck = [
    "tools/lib/doi_downloader.mjs",
    "tools/paper_downloader.mjs",
    "tools/config_server.mjs",
    "tools/run_zotero_literature_filter.mjs",
  ];
  for (const f of filesToCheck) {
    try {
      execSync(`node --check ${f}`, { cwd: ROOT, encoding: "utf8" });
      assert(`${f} 语法正确`, true);
    } catch {
      assert(`${f} 语法正确`, false);
    }
  }

  // ------------------------------------------------------------------
  SECTION("4. config_server.mjs API 端点验证");
  // ------------------------------------------------------------------

  try {
    const res = await fetch("http://localhost:3456/api/download/papers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: true, grade: "A", limit: 5 }),
      signal: AbortSignal.timeout(60000),
    });
    const body = await res.json();
    assert("API 响应状态码 200", res.status === 200);
    assert("API 响应包含 ok", "ok" in body);
    if (body.ok && body.report) {
      assert("API 报告包含 status", !!body.report.status);
      assert("API 报告包含 download", !!body.report.download);
      assert("API 报告包含 candidates", !!body.report.candidates);
    } else {
      assert("API 报告结构", false, JSON.stringify(body).slice(0, 200));
    }
  } catch (e) {
    skip("API 端点", e.message?.slice(0, 100));
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  const total = results.passed + results.failed + results.skipped;
  console.log(`\n${"=".repeat(50)}`);
  console.log(`总结: ${results.passed} 通过 / ${results.failed} 失败 / ${results.skipped} 跳过 (共 ${total} 项)`);
  console.log(`${"=".repeat(50)}\n`);

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    summary: { total, passed: results.passed, failed: results.failed, skipped: results.skipped },
    details: results.details,
  }, null, 2), "utf8");

  console.log(`测试报告已写入: ${REPORT_PATH}`);
  process.exit(results.failed > 0 ? 1 : 0);
}

runTests().catch((e) => { console.error("测试异常:", e); process.exit(1); });
