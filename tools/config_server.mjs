import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { clearProxyCache, getProxyConfig, shouldProxy, proxyFetch } from "./lib/proxy_config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_DIR = path.join(ROOT, "config");
const ENV_PATH = path.join(ROOT, ".env");
const RESEARCH_OS = path.join(ROOT, "research_os");

// Load .env into process.env so downstream modules (e.g. title_translation_support.mjs)
// can read TITLE_TRANSLATION_API_KEY / TITLE_TRANSLATION_MODEL / etc. at runtime.
try {
  if (fs.existsSync(ENV_PATH)) {
    const envText = fs.readFileSync(ENV_PATH, "utf8");
    for (const line of envText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  }
} catch { /* .env loading is best-effort */ }

const PORT = Number(process.env.CONFIG_PORT || 3456);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const CONFIG_FILES = {
  database_sources: { title: "数据库源配置", path: path.join(CONFIG_DIR, "database_sources.json"), type: "json" },
  rss_sources: { title: "RSS 订阅源", path: path.join(CONFIG_DIR, "rss_sources.json"), type: "json" },
  research_profile: { title: "研究画像", path: path.join(CONFIG_DIR, "research_profile.json"), type: "json" },
  workflow_rules: { title: "分级规则", path: path.join(CONFIG_DIR, "workflow_rules.json"), type: "json" },
  pubmed_pmc_search: { title: "PubMed/PMC 检索", path: path.join(CONFIG_DIR, "pubmed_pmc_search.json"), type: "json" },
  title_translation: { title: "翻译配置", path: path.join(CONFIG_DIR, "title_translation.config.json"), type: "json" },
  preference_learning: { title: "偏好学习配置", path: path.join(CONFIG_DIR, "preference_learning.config.json"), type: "json" },
  screening_standards: { title: "筛选标准", path: path.join(ROOT, "screening_standards.md"), type: "markdown" },
  crossref_search: { title: "Crossref 检索", path: path.join(CONFIG_DIR, "crossref_search.json"), type: "json" },
  cnki_import: { title: "知网导入配置", path: path.join(CONFIG_DIR, "cnki_import.json"), type: "json_cnki" },
  proxy: { title: "代理设置", path: path.join(CONFIG_DIR, "proxy.config.json"), type: "json" },
};

function readJsonSafe(p) {
  try {
    if (!fs.existsSync(p)) return { ok: false, error: "文件不存在" };
    return { ok: true, data: JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function readTextSafe(p) {
  try {
    if (!fs.existsSync(p)) return { ok: false, error: "文件不存在" };
    return { ok: true, data: fs.readFileSync(p, "utf8") };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function readEnvSafe() {
  try {
    if (!fs.existsSync(ENV_PATH)) return { ok: true, data: "" };
    return { ok: true, data: fs.readFileSync(ENV_PATH, "utf8") };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function parseQuery(url) {
  const idx = url.indexOf("?");
  if (idx < 0) return {};
  return Object.fromEntries(new URLSearchParams(url.slice(idx + 1)));
}

function extractPipelineSummary(stdout) {
  try {
    const summary = {};
    const lines = stdout.split("\n").filter(Boolean);
    let depth = 0;
    let jsonStart = -1;
    for (let i = 0; i < stdout.length; i++) {
      const ch = stdout[i];
      if (ch === "{") { if (depth === 0) jsonStart = i; depth++; }
      else if (ch === "}") { depth--; if (depth === 0 && jsonStart >= 0) {
        try {
          const block = stdout.slice(jsonStart, i + 1);
          const parsed = JSON.parse(block);
          if (parsed.counts) summary.counts = parsed.counts;
          if (parsed.counters) summary.counters = parsed.counters;
          if (parsed.total != null) summary.total = parsed.total;
          if (parsed.success_count != null) summary.success_count = parsed.success_count;
          if (parsed.failure_count != null) summary.failure_count = parsed.failure_count;
          if (parsed.updated_items) summary.updated_items = Array.isArray(parsed.updated_items) ? parsed.updated_items.length : parsed.updated_items;
          if (parsed.skipped_count != null) summary.skipped_count = parsed.skipped_count;
          if (parsed.stages) summary.stages = parsed.stages.map(s => ({ name: s.name, status: s.status, exitCode: s.exitCode }));
          if (parsed.stage_timings) summary.stage_timings = Object.fromEntries(Object.entries(parsed.stage_timings).map(([k, v]) => [k, v.status || v]));
          if (parsed.api_key_configured != null) summary.api_key_configured = parsed.api_key_configured;
          if (parsed.connector_ok != null) summary.connector_ok = parsed.connector_ok;
          if (parsed.reused_existing_added_to_pool_and_current_date != null) summary.pool_duplicates = parsed.reused_existing_added_to_pool_and_current_date;
          if (parsed.added_to_current_date_collection != null) summary.new_items_in_zotero = parsed.added_to_current_date_collection;
        } catch {}
        jsonStart = -1;
      }}
    }
    const nonEmpty = Object.keys(summary).length > 0;
    return nonEmpty ? summary : { _raw_lines: lines.slice(-20) };
  } catch {
    return { _raw_tail: stdout.slice(-500) };
  }
}

function jsonResponse(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data, null, 2));
}

function sendJson(res, data) { jsonResponse(res, 200, data); }
function sendError(res, code, message) { jsonResponse(res, code, { ok: false, error: message }); }

async function handleApi(req, res, parts) {
  const method = req.method;

  if (parts[0] === "config") {
    if (method === "GET" && !parts[1]) {
      const list = {};
      for (const [key, info] of Object.entries(CONFIG_FILES)) {
        list[key] = { title: info.title, type: info.type };
      }
      return sendJson(res, { ok: true, configs: list });
    }
    if (parts[1] && CONFIG_FILES[parts[1]]) {
      const info = CONFIG_FILES[parts[1]];
      if (method === "GET") {
        if (info.type === "json" || info.type === "json_cnki") {
          // For title_translation, merge .env overrides into the file config for display,
          // so the UI shows what is actually used at runtime, not the raw file placeholder.
          if (parts[1] === "title_translation") {
            const r = readJsonSafe(info.path);
            if (!r.ok) return sendJson(res, { ok: false, error: r.error });
            const merged = { ...r.data };
            const overrideKeys = {
              TITLE_TRANSLATION_MODEL: "model",
              TITLE_TRANSLATION_ENDPOINT: "endpoint",
              TITLE_TRANSLATION_TEMPERATURE: ["temperature", Number],
              TITLE_TRANSLATION_TOP_P: ["top_p", Number],
              TITLE_TRANSLATION_BATCH_SIZE: ["batch_size", Number],
              TITLE_TRANSLATION_TIMEOUT_MS: ["timeout_ms", Number],
              TITLE_TRANSLATION_MAX_RETRIES: ["max_retries", Number],
              TITLE_TRANSLATION_STREAM: ["stream", (v) => v === "true" || v === "1"],
              TITLE_TRANSLATION_THINKING: ["thinking", (v) => v === "true" || v === "1"],
              TITLE_TRANSLATION_FALLBACK_TO_ENGLISH: ["fallback_to_english", (v) => v === "true" || v === "1"],
            };
            const appliedOverrides = {};
            for (const [envKey, cfgKey] of Object.entries(overrideKeys)) {
              const envVal = process.env[envKey];
              if (envVal !== undefined && envVal !== null && envVal !== "") {
                if (Array.isArray(cfgKey)) {
                  merged[cfgKey[0]] = cfgKey[1](envVal);
                } else {
                  merged[cfgKey] = envVal;
                }
                appliedOverrides[cfgKey] = envVal;
              }
            }
            return sendJson(res, {
              ok: true,
              data: merged,
              path: info.path,
              title: info.title,
              type: info.type,
              env_overrides: appliedOverrides,
            });
          }
          const r = readJsonSafe(info.path);
          return sendJson(res, r.ok ? { ok: true, data: r.data, path: info.path, title: info.title, type: info.type } : { ok: false, error: r.error });
        }
        const r = readTextSafe(info.path);
        return sendJson(res, r.ok ? { ok: true, data: r.data, path: info.path, title: info.title, type: "markdown" } : { ok: false, error: r.error });
      }
      if (method === "PUT") {
        let body = "";
        for await (const chunk of req) body += chunk;
        try {
          const parsed = JSON.parse(body);
          let content;
          if (info.type === "json" || info.type === "json_cnki") {
            if (!parsed.data && !parsed.content) return sendError(res, 400, "缺少 data 或 content 字段");
            const source = parsed.data || parsed.content;
            content = typeof source === "object" ? JSON.stringify(source, null, 2) + "\n" : String(source);
          } else {
            content = String(parsed.content || parsed.data || "");
          }
          await fs.promises.mkdir(path.dirname(info.path), { recursive: true });
          await fs.promises.writeFile(info.path, content, "utf8");
          if (parts[1] === "proxy") clearProxyCache();
          return sendJson(res, { ok: true, path: info.path });
        } catch (e) {
          return sendError(res, 400, `写入失败: ${e.message}`);
        }
      }
    }
    return sendError(res, 404, "未知配置项");
  }

  if (parts[0] === "proxy" && parts[1] === "test") {
    if (method === "POST") {
      const config = getProxyConfig();
      if (!config.enabled) return sendJson(res, { ok: false, error: "代理未启用" });
      const testUrl = "https://www.google.com/generate_204";
      const timeoutMs = 10000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await proxyFetch(testUrl, { method: "HEAD", signal: controller.signal });
        const status = resp.status;
        clearTimeout(timer);
        return sendJson(res, { ok: true, status, reachable: status < 500 });
      } catch (e) {
        clearTimeout(timer);
        return sendJson(res, { ok: false, error: `连接测试失败: ${e.message?.slice(0, 100) || e}` });
      }
    }
    return sendError(res, 405, "仅支持 POST");
  }

  if (parts[0] === "collections" && parts[1] === "tree" && method === "GET") {
    try {
      const mcpUrl = process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp";
      const mcpPost = async (name, args) => {
        const body = JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 900000) + 100000, method: "tools/call", params: { name, arguments: args } });
        const r = await fetch(mcpUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(10000) });
        const j = await r.json();
        if (j.error) throw new Error(JSON.stringify(j.error));
        const raw = j.result?.content?.[0]?.text;
        return raw ? JSON.parse(raw) : [];
      };
      const pool = await mcpPost("get_collections", { mode: "complete", limit: 500 });
      const allCollections = Array.isArray(pool) ? pool : (pool?.collections || []);
      const poolCollection = allCollections.find((c) => c.name === "文献池" || c.name === "Literature Pool");
      if (!poolCollection) return sendJson(res, { ok: true, collections: [], dateCollections: [], error: "pool_collection_not_found" });
      const poolKey = poolCollection.collectionKey || poolCollection.key;
      const tree = await mcpPost("get_subcollections", { collectionKey: poolKey, recursive: true });
      const allNodes = Array.isArray(tree) ? tree : [];
      const dateCollections = allNodes.filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n.name)).map((n) => ({ key: n.collectionKey || n.key, name: n.name, label: n.name }));
      const fullList = [{ key: poolKey, name: "文献池", label: "文献池（全部）" }, ...allNodes.filter((n) => n.collectionKey || n.key).map((n) => ({ key: n.collectionKey || n.key, name: n.name, label: n.name }))];
      return sendJson(res, { ok: true, collections: fullList, dateCollections: dateCollections.sort((a, b) => b.name.localeCompare(a.name)) });
    } catch (e) {
      return sendJson(res, { ok: false, error: `获取集合列表失败: ${e.message?.slice(0, 200)}` });
    }
  }

  if (parts[0] === "env") {
    if (method === "GET") {
      const r = readEnvSafe();
      return sendJson(res, r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error });
    }
    if (method === "PUT") {
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const parsed = JSON.parse(body);
        const content = String(parsed.content || parsed.data || "");
        await fs.promises.writeFile(ENV_PATH, content, "utf8");
        return sendJson(res, { ok: true });
      } catch (e) {
        return sendError(res, 400, `写入失败: ${e.message}`);
      }
    }
  }

  if (parts[0] === "pipeline" && parts[1] === "run" && method === "POST") {
    try {
      const result = execSync("node tools/run_zotero_literature_filter.mjs", { cwd: ROOT, encoding: "utf8", timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
      const summary = extractPipelineSummary(result);
      return sendJson(res, { ok: true, summary, full_output_preview: result.slice(0, 800) });
    } catch (e) {
      const summary = extractPipelineSummary(e.stdout || "");
      return sendJson(res, { ok: false, error: e.message, summary, stdout_tail: (e.stdout || "").slice(-3000), stderr: (e.stderr || "").slice(-1000) });
    }
  }

  if (parts[0] === "pipeline" && parts[1] === "stage1" && method === "POST") {
    try {
      const result = execSync("node tools/run_research_os_pipeline.mjs", { cwd: ROOT, encoding: "utf8", timeout: 120000, maxBuffer: 5 * 1024 * 1024 });
      const summary = extractPipelineSummary(result);
      return sendJson(res, { ok: true, summary, full_output_preview: result.slice(0, 800) });
    } catch (e) {
      const summary = extractPipelineSummary(e.stdout || "");
      return sendJson(res, { ok: false, error: e.message, summary, stdout_tail: (e.stdout || "").slice(-3000), stderr: (e.stderr || "").slice(-1000) });
    }
  }

  if (parts[0] === "translate" && parts[1] === "standalone" && method === "POST") {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const params = body ? JSON.parse(body) : {};
      const dryRun = Boolean(params.dry_run || params.dryRun);
      const limit = Number(params.limit || 0);
      const retryFailures = Boolean(params.retry_failures || params.retryFailures);
      const collectionName = String(params.collection || params.collectionName || "文献池");
      const collectionKey = String(params.collectionKey || params.collection_key || "");
      const cliArgs = ["node", "tools/standalone_title_translation.mjs"];
      if (dryRun) cliArgs.push("--dry-run");
      if (limit > 0) cliArgs.push(`--limit=${limit}`);
      if (retryFailures) cliArgs.push("--retry-failures");
      cliArgs.push(`--collection=${collectionName}`);
      if (collectionKey) cliArgs.push(`--collection-key=${collectionKey}`);
      const { spawnSync } = await import("node:child_process");
      const spResult = spawnSync("node", cliArgs.slice(1), { cwd: ROOT, encoding: "utf8", timeout: 600000, maxBuffer: 10 * 1024 * 1024 });
      const stdout = spResult.stdout || "";
      const stderr = spResult.stderr || "";
      let report;
      try { report = JSON.parse(stdout); } catch {
        const braceIdx = stdout.indexOf("{");
        const bracketIdx = stdout.indexOf("[");
        let jsonStart = -1;
        if (braceIdx >= 0 && (bracketIdx < 0 || braceIdx < bracketIdx)) jsonStart = braceIdx;
        else if (bracketIdx >= 0) jsonStart = bracketIdx;
        if (jsonStart >= 0) {
          try { report = JSON.parse(stdout.slice(jsonStart)); } catch { report = { _raw: stdout.slice(0, 800) }; }
        } else {
          report = { _raw: stdout.slice(0, 800) };
        }
      }
      if (stderr) report._stderr = stderr.slice(-5000);
      return sendJson(res, { ok: true, report, full_output_preview: stdout.slice(0, 1000) });
    } catch (e) {
      let partialReport = {};
      try { partialReport = JSON.parse(e.stdout || "{}"); } catch {}
      return sendJson(res, { ok: false, error: e.message, report: partialReport, stdout_tail: (e.stdout || "").slice(-3000), stderr: (e.stderr || "").slice(-1000) });
    }
  }

  if (parts[0] === "download" && parts[1] === "papers" && method === "POST") {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const params = body ? JSON.parse(body) : {};
      const dryRun = Boolean(params.dry_run || params.dryRun);
      const limit = Number(params.limit || 0);
      const gradeFilter = String(params.grade || params.gradeFilter || "A");
      const sciHubUrl = String(params.scihub_url || params.sciHubUrl || "");
      const collectionKey = String(params.collectionKey || params.collection_key || "");
      const cliArgs = ["node", "tools/paper_downloader.mjs"];
      if (dryRun) cliArgs.push("--dry-run");
      if (limit > 0) cliArgs.push(`--limit=${limit}`);
      cliArgs.push(`--grade=${gradeFilter}`);
      if (sciHubUrl) cliArgs.push(`--scihub=${sciHubUrl}`);
      if (collectionKey) cliArgs.push(`--collection-key=${collectionKey}`);
      const { spawnSync } = await import("node:child_process");
      const spResult = spawnSync("node", cliArgs.slice(1), { cwd: ROOT, encoding: "utf8", timeout: 600000, maxBuffer: 10 * 1024 * 1024 });
      const stdout = spResult.stdout || "";
      const stderr = spResult.stderr || "";
      let report;
      try { report = JSON.parse(stdout); } catch {
        const braceIdx = stdout.indexOf("{");
        if (braceIdx >= 0) {
          try { report = JSON.parse(stdout.slice(braceIdx)); } catch { report = { _raw: stdout.slice(0, 800) }; }
        } else { report = { _raw: stdout.slice(0, 800) }; }
      }
      if (stderr) report._stderr = stderr.slice(-5000);
      return sendJson(res, { ok: true, report, full_output_preview: stdout.slice(0, 1000) });
    } catch (e) {
      let partialReport = {};
      try { partialReport = JSON.parse(e.stdout || "{}"); } catch {}
      return sendJson(res, { ok: false, error: e.message, report: partialReport, stdout_tail: (e.stdout || "").slice(-3000), stderr: (e.stderr || "").slice(-1000) });
    }
  }

  if (parts[0] === "status" && method === "GET") {
    const configs = {};
    for (const [key, info] of Object.entries(CONFIG_FILES)) {
      configs[key] = { exists: fs.existsSync(info.path), title: info.title };
    }
    return sendJson(res, { ok: true, project: "zotero-sci-pipeline", root: ROOT, port: PORT, configs });
  }

  if (parts[0] === "explorer" && method === "GET") {
    const dir = parts[1] ? path.join(ROOT, ...parts.slice(1)) : ROOT;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      const files = entries.map((e) => ({
        name: e.name,
        isDir: e.isDirectory(),
        size: e.isFile() ? fs.statSync(path.join(dir, e.name)).size : 0,
      }));
      return sendJson(res, { ok: true, path: dir, files });
    } catch (e) {
      return sendError(res, 404, `目录不存在: ${e.message}`);
    }
  }

  if (parts[0] === "dashboard" && method === "GET") {
    const pipelineRoot = path.join(RESEARCH_OS, "pipeline");
    let dirs = [];
    try {
      dirs = fs.readdirSync(pipelineRoot).filter((d) => /^\d+\.\d+\.\d+$/.test(d)).sort().reverse();
    } catch { /* empty */ }

    const runs = [];
    let trendAccum = { A: [], B: [], C: [], D: [], labels: [] };
    let allKeywords = {};
    let allSourceBreakdown = {};
    let totalRunCount = 0;

    for (const dir of dirs.slice(0, 30)) {
      const reportPath = path.join(pipelineRoot, dir, "run_report.json");
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
        const c = report.counts || {};
        const gc = c.grade_counts || {};
        runs.push({
          date: report.date || dir,
          dir,
          merged: c.merged || 0,
          triaged: c.triaged || 0,
          rss_raw: c.rss_raw || 0,
          crossref_raw: c.crossref_raw || 0,
          arxiv_raw: c.arxiv_raw || 0,
          grade_counts: gc,
          total: (gc.A || 0) + (gc.B || 0) + (gc.C || 0) + (gc.D || 0),
        });
        trendAccum.labels.push(report.date || dir);
        trendAccum.A.push(gc.A || 0);
        trendAccum.B.push(gc.B || 0);
        trendAccum.C.push(gc.C || 0);
        trendAccum.D.push(gc.D || 0);
        totalRunCount++;
      } catch { /* skip */ }

      const triagedPath = path.join(pipelineRoot, dir, "triaged_items.json");
      try {
        const items = JSON.parse(fs.readFileSync(triagedPath, "utf8"));
        if (Array.isArray(items)) {
          for (const it of items) {
            const src = it.source_channel || it.source_platform || "other";
            allSourceBreakdown[src] = (allSourceBreakdown[src] || 0) + 1;
            if ((it.grade || "").charAt(0) === "A" || (it.grade || "").charAt(0) === "B") {
              const text = `${it.title || ""} ${it["中文标题"] || it["标题翻译"] || ""}`;
              const words = text.toLowerCase().match(/[a-z]{4,}/g) || [];
              const zhWords = text.match(/[\u4e00-\u9fff]{2,6}/g) || [];
              for (const w of [...words, ...zhWords]) {
                const stopWords = new Set(["this","that","with","from","using","based","method","approach","model","data","learning","paper","results","study","propose","novel","experimental","analysis","performance","system","algorithm","network","application","frame","work","show","also","can","well","two","one","first","proposed","different","effective","efficient","improve","existing","developed","present","introduce","实验","方法","模型","研究","算法","系统","网络","数据","分析","基于","提出","技术","框架","性能","结果","应用","有效","改进","新型","问题","方案","优化","设计","实现","融合","特征","分类","识别","预测","检测","评估","比较"]);
                if (!stopWords.has(w)) allKeywords[w] = (allKeywords[w] || 0) + 1;
              }
            }
          }
        }
      } catch { /* skip */ }
    }

    const topKeywords = Object.entries(allKeywords)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([word, count]) => ({ 关键词: word, 出现次数: count }));

    const sourceBreakdown = Object.entries(allSourceBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([src, count]) => ({ 来源: src, 数量: count }));

    return sendJson(res, {
      ok: true,
      total_runs: totalRunCount,
      recent_runs: runs.slice(0, 10),
      trends: {
        labels: trendAccum.labels,
        A: trendAccum.A,
        B: trendAccum.B,
        C: trendAccum.C,
        D: trendAccum.D,
      },
      keywords: topKeywords,
      source_breakdown: sourceBreakdown,
    });
  }

  sendError(res, 404, "未知 API");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    const parts = pathname.slice(5).split("/").filter(Boolean);
    return handleApi(req, res, parts);
  }

  if (pathname === "/" || pathname === "/index.html") {
    const htmlPath = path.join(ROOT, "tools", "config_ui.html");
    if (fs.existsSync(htmlPath)) {
      let html = fs.readFileSync(htmlPath, "utf8");
      html = html.replace(/\{\{PORT\}\}/g, String(PORT));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(`配置服务器运行中。请访问 http://localhost:${PORT}/ 查看配置页面。`);
  }

  const ext = path.extname(pathname);
  const filePath = path.join(ROOT, pathname.replace(/^\/+/, ""));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    return res.end(fs.readFileSync(filePath));
  }

  res.writeHead(302, { Location: "/" });
  res.end();
});

server.listen(PORT, () => {
  console.log(`\n  ✅ 配置服务器已启动`);
  console.log(`  📍 地址: http://localhost:${PORT}`);
  console.log(`  📁 项目: ${ROOT}`);
  console.log(`  🔧 按 Ctrl+C 停止服务器\n`);
});
