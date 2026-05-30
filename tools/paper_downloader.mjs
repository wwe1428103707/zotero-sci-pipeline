import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildRuntimeConfig } from "./lib/runtime_config.mjs";
import { ensureZoteroMcpReady } from "./lib/ensure_zotero_mcp_ready.mjs";
import { downloadPdf, normalizeDoi, extractArxivId, generatePdfFilename } from "./lib/doi_downloader.mjs";

const RUNTIME = buildRuntimeConfig();
const ROOT = RUNTIME.projectRoot;

const MCP_URL = process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp";

let _mcpCallId = 900000;

async function mcpToolCall(name, args, id) {
  const callId = id ?? _mcpCallId++;
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: callId,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`MCP ${name} failed: ${JSON.stringify(json.error)}`);
  return json.result;
}

function parseToolText(result) {
  if (!result) return null;
  const raw = result.content;
  if (!raw || !Array.isArray(raw)) return result;
  for (const part of raw) {
    if (part.type === "text" && part.text) {
      try { return JSON.parse(part.text); } catch { return part.text; }
    }
  }
  return result;
}

function loadConfig() {
  try {
    const cfgFile = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "pdf_download.config.json"), "utf8"));
    return {
      sciHubBaseUrl: cfgFile.sci_hub_base_url || "https://sci-hub.st",
      arxivMirror: cfgFile.arxiv_mirror || "https://arxiv.org",
      sciHubTimeoutMs: cfgFile.sci_hub_timeout_ms || 30000,
      arxivTimeoutMs: cfgFile.arxiv_timeout_ms || 15000,
      maxConcurrentDownloads: cfgFile.max_concurrent_downloads || 3,
      downloadDir: path.resolve(ROOT, cfgFile.download_dir || "downloads/pdf_temp"),
      gradeFilter: (cfgFile.grade_filter || "A").split(",").map((g) => g.trim().toUpperCase()),
      maxRetries: cfgFile.retry?.max_retries ?? 2,
      retryDelayMs: cfgFile.retry?.retry_delay_ms ?? 3000,
      skipIfPdfAttached: cfgFile.skip_if_pdf_attached !== false,
    };
  } catch {
    return {
      sciHubBaseUrl: "https://sci-hub.st",
      arxivMirror: "https://arxiv.org",
      sciHubTimeoutMs: 30000,
      arxivTimeoutMs: 15000,
      maxConcurrentDownloads: 3,
      downloadDir: path.resolve(ROOT, "downloads/pdf_temp"),
      gradeFilter: ["A"],
      maxRetries: 2,
      retryDelayMs: 3000,
      skipIfPdfAttached: true,
    };
  }
}

async function findLatestTriagedItems() {
  const researchOs = path.join(ROOT, "research_os");
  const weeks = await fs.readdir(researchOs).catch(() => []);
  let latestDir = "";
  let latestTime = 0;
  for (const week of weeks) {
    const weekPath = path.join(researchOs, week);
    try {
      const days = await fs.readdir(weekPath);
      for (const day of days) {
        const triagedPath = path.join(weekPath, day, "pipeline", "triaged_items.json");
        try {
          const stat = await fs.stat(triagedPath);
          if (stat.mtimeMs > latestTime) {
            latestTime = stat.mtimeMs;
            latestDir = path.join(weekPath, day, "pipeline");
          }
        } catch { continue; }
      }
    } catch { continue; }
  }
  if (!latestDir) return [];
  try {
    const raw = await fs.readFile(path.join(latestDir, "triaged_items.json"), "utf8");
    return JSON.parse(raw);
  } catch { return []; }
}

async function findItemsByZoteroScan({ gradeFilter, limit, skipIfPdfAttached, mcpToolCall, collectionKey = null }) {
  const pool = parseToolText(await mcpToolCall("get_collections", { mode: "complete", limit: 500 }, 900010));
  const collections = Array.isArray(pool) ? pool : (pool?.collections || []);
  const poolCollection = collections.find((c) => c.name === "文献池" || c.name === "Literature Pool");
  if (!poolCollection) return { items: [], error: "pool_collection_not_found" };

  let scanRootKey;
  if (collectionKey) {
    scanRootKey = collectionKey;
  } else {
    // Default: find the latest date collection (latest batch)
    const poolKey = poolCollection.collectionKey || poolCollection.key;
    const subTree = parseToolText(await mcpToolCall("get_subcollections", { collectionKey: poolKey, recursive: false }, 900011));
    const dateCollections = Array.isArray(subTree) ? subTree.filter(
      (n) => /^\d{4}-\d{2}-\d{2}$/.test(n.name)
    ).sort((a, b) => b.name.localeCompare(a.name)) : [];
    scanRootKey = dateCollections.length > 0 ? (dateCollections[0].collectionKey || dateCollections[0].key) : poolKey;
  }

  // Recursively scan all subcollections to find grade-matching collections at any depth
  const gradeCollections = [];
  const scannedKeys = new Set();

  async function scanSubcollections(parentKey, depth) {
    if (depth > 5 || scannedKeys.has(parentKey)) return;
    scannedKeys.add(parentKey);

    const subTree = parseToolText(await mcpToolCall("get_subcollections", { collectionKey: parentKey, recursive: false }, 900020 + depth));
    if (!Array.isArray(subTree) || !subTree.length) return;

    for (const node of subTree) {
      const ck = node.collectionKey || node.key;
      if (!ck || !node.name) continue;
      const name = node.name;

      if (gradeFilter.some((g) => name.startsWith(g) || name.includes(g))) {
        gradeCollections.push({ key: ck, name });
      } else {
        await scanSubcollections(ck, depth + 1);
      }
    }
  }

  await scanSubcollections(scanRootKey, 0);

  const candidates = [];
  for (const { key: ck, name } of gradeCollections) {
    const keys = [];
    let offset = 0;
    const pageSize = 500;
    while (true) {
      const items = parseToolText(await mcpToolCall("get_collection_items", { collectionKey: ck, limit: pageSize, offset }, 900030 + offset));
      if (!Array.isArray(items) || !items.length) break;
      for (const it of items) {
        if (it?.key) keys.push(it.key);
      }
      if (items.length < pageSize) break;
      offset += pageSize;
    }
    for (const key of keys) {
      const detail = parseToolText(await mcpToolCall("get_item_details", { itemKey: key, mode: "complete" }, 900100 + candidates.length));
      const doi = normalizeDoi(detail?.DOI || detail?.doi || detail?.data?.DOI || "");
      const url = detail?.url || "";
      const title = detail?.title || detail?.data?.title || "";
      if (!doi && !url && !title) continue;

      // Extract arXiv ID from URL when DOI is missing
      let effectiveDoi = doi;
      if (!effectiveDoi && url) {
        const arxivUrlMatch = String(url).match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5}(v\d+)?)/i);
        if (arxivUrlMatch) {
          effectiveDoi = arxivUrlMatch[1];
        }
      }

      let hasPdf = false;
      if (skipIfPdfAttached) {
        const attachments = (detail?.attachments || detail?.data?.attachments || []);
        hasPdf = Array.isArray(attachments) && attachments.some((a) => /pdf/i.test(a?.contentType || a?.contentType || a?.content_type || ""));
      }
      if (hasPdf) continue;

      candidates.push({ itemKey: key, title, doi: effectiveDoi, sourceCollection: name });
      if (limit && candidates.length >= limit) break;
    }
    if (limit && candidates.length >= limit) break;
  }
  return { items: candidates, error: null };
}

async function downloadFile(doi, title, cfg) {
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, cfg.retryDelayMs));
    }
    const result = await downloadPdf(doi, title, {
      sciHubBaseUrl: cfg.sciHubBaseUrl,
      arxivMirror: cfg.arxivMirror,
      sciHubTimeoutMs: cfg.sciHubTimeoutMs,
      arxivTimeoutMs: cfg.arxivTimeoutMs,
    });
    if (result.ok) return result;
    if (attempt < cfg.maxRetries) {
      console.error(`[download] 重试 ${attempt + 1}/${cfg.maxRetries}: ${doi} (${result.reason})`);
    }
  }
  return { ok: false, reason: "max_retries_exceeded" };
}

async function attachPdfToZotero(itemKey, pdfBuf, filename, mcpToolCall) {
  const tmpFile = path.join(RUNTIME.projectRoot, "downloads", "pdf_temp", filename);
  await fs.mkdir(path.dirname(tmpFile), { recursive: true });
  await fs.writeFile(tmpFile, pdfBuf);

  const base64 = pdfBuf.toString("base64");
  try {
    await mcpToolCall("write_item", {
      action: "create",
      itemType: "attachment",
      parentItem: itemKey,
      fields: {
        title: filename.replace(/\.pdf$/, ""),
        contentType: "application/pdf",
        content: base64,
        filename,
      },
    }, 908000);
    return { ok: true, method: "write_item_attachment" };
  } catch (writeErr) {
    console.error(`[attach] write_item 失败: ${writeErr?.message?.slice(0, 100)}`);
  }

  try {
    const zoteroRestUrl = (process.env.ZOTERO_MCP_URL || "").replace(/\/mcp$/, "");
    const apiKey = process.env.ZOTERO_API_KEY || "";
    if (zoteroRestUrl && apiKey) {
      const formData = new FormData();
      const blob = new Blob([pdfBuf], { type: "application/pdf" });
      formData.append("file", blob, filename);
      formData.append("parentItemID", itemKey);
      formData.append("contentType", "application/pdf");
      const resp = await fetch(`${zoteroRestUrl}/users/0/items`, {
        method: "POST",
        headers: { "Zotero-API-Key": apiKey },
        body: formData,
      });
      if (resp.ok) return { ok: true, method: "rest_api" };
    }
  } catch {}

  return { ok: false, reason: "zotero_attach_failed", localPath: tmpFile };
}

export async function runPaperDownloader({
  dryRun = false,
  limit = 0,
  gradeFilter = null,
  configOverride = {},
  usingTriagedItems = false,
  collectionKey = null,
} = {}) {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const cfg = { ...loadConfig(), ...configOverride };
  if (gradeFilter) cfg.gradeFilter = gradeFilter.split(",").map((g) => g.trim().toUpperCase());

  const report = {
    started_at: startedAt,
    dry_run: dryRun,
    config: { sci_hub_base_url: cfg.sciHubBaseUrl, grade_filter: cfg.gradeFilter, max_concurrent: cfg.maxConcurrentDownloads },
    candidates: { found: 0, with_doi: 0, grade_matched: 0 },
    download: { attempted: 0, success: 0, failed: 0, retried: 0 },
    attachment: { attempted: 0, success: 0, failed: 0 },
    failures: [],
    status: "running",
    completed_at: null,
    duration_ms: 0,
  };

  await ensureZoteroMcpReady({
    mcpProbe: async (attempt) => {
      await mcpToolCall("get_collections", { mode: "minimal", limit: 1 }, 900000 + attempt);
    },
  });

  let items;
  if (usingTriagedItems) {
    const triaged = await findLatestTriagedItems();
    items = [];
    for (const it of triaged) {
      const grade = (it.grade || it["推荐等级"] || "").charAt(0);
      if (!cfg.gradeFilter.includes(grade)) continue;
      const doi = normalizeDoi(it.doi || it.DOI || "");
      const title = it.title || it["中文标题"] || "";
      if (!doi && !title) continue;
      report.candidates.grade_matched++;
      if (doi) report.candidates.with_doi++;
      items.push({ ...it, doi, title });
    }
    report.candidates.found = triaged.length;
  } else {
    const scan = await findItemsByZoteroScan({ gradeFilter: cfg.gradeFilter, limit: limit || 0, skipIfPdfAttached: cfg.skipIfPdfAttached, mcpToolCall, collectionKey });
    items = scan.items;
    report.candidates.found = items.length;
    report.candidates.with_doi = items.filter((i) => i.doi).length;
  }

  if (items.length === 0) {
    report.status = usingTriagedItems ? "no_triaged_items_matching_grade" : "no_items_in_zotero_matching_grade";
    report.completed_at = new Date().toISOString();
    report.duration_ms = Date.now() - startMs;
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  if (limit > 0) items = items.slice(0, limit);
  const downloadDir = cfg.downloadDir;
  await fs.mkdir(downloadDir, { recursive: true });

  if (dryRun) {
    report.download.attempted = 0;
    report.status = "dry_run_completed";
    report.dry_run_candidates = items.map((i) => ({
      itemKey: i.itemKey || "N/A",
      title: i.title || "",
      doi: i.doi || "",
      grade: i.grade || i["推荐等级"] || "",
      source: i.sourceCollection || i.source_channel || "",
    }));
    report.completed_at = new Date().toISOString();
    report.duration_ms = Date.now() - startMs;
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const doi = item.doi;
    const title = item.title || "";
    const itemKey = item.itemKey;

    const progressMsg = `[PROGRESS] ${i + 1}/${items.length} ${Math.round((i + 1) / items.length * 100)}% 下载中: ${(doi || title).slice(0, 60)}...`;
    console.error(progressMsg);
    console.error(`[PROGRESS_JSON]${JSON.stringify({ current: i + 1, total: items.length, pct: Math.round((i + 1) / items.length * 100), stage: "download", itemKey, doi, title: title.slice(0, 60) })}`);

    report.download.attempted++;
    const dlResult = await downloadFile(doi, title, cfg);
    if (!dlResult.ok) {
      report.download.failed++;
      report.failures.push({
        itemKey, title: title.slice(0, 100), doi, reason: dlResult.reason, stage: "download",
      });
      continue;
    }
    report.download.success++;

    if (itemKey) {
      report.attachment.attempted++;
      const attachResult = await attachPdfToZotero(itemKey, dlResult.data, generatePdfFilename(doi, title), mcpToolCall);
      if (!attachResult.ok) {
        report.attachment.failed++;
        report.failures.push({
          itemKey, title: title.slice(0, 100), doi, reason: attachResult.reason, stage: "attachment",
          localPath: attachResult.localPath,
        });
      } else {
        report.attachment.success++;
      }
    }
  }

  report.status = report.failures.length > 0 ? "completed_with_failures" : "completed";
  report.completed_at = new Date().toISOString();
  report.duration_ms = Date.now() - startMs;

  const reportDir = path.join(ROOT, "research_os", "pipeline");
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(path.join(reportDir, "pdf_download_report.json"), JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify(report, null, 2));
  return report;
}

function parseCliArgs(argv) {
  const args = { dryRun: false, limit: 0, gradeFilter: null, configOverride: {}, usingTriagedItems: false, collectionKey: null };
  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "--dryrun") args.dryRun = true;
    if (arg.startsWith("--limit=")) args.limit = Number(arg.split("=")[1]) || 0;
    if (arg.startsWith("--grade=")) args.gradeFilter = arg.split("=")[1];
    if (arg.startsWith("--scihub=")) args.configOverride.sciHubBaseUrl = arg.split("=")[1];
    if (arg === "--use-triaged") args.usingTriagedItems = true;
    if (arg.startsWith("--collection-key=")) args.collectionKey = arg.split("=")[1];
  }
  return args;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseCliArgs(process.argv.slice(2));
  runPaperDownloader(args).catch((err) => {
    console.error(JSON.stringify({ error: String(err?.message || err), stack: err?.stack }, null, 2));
    process.exit(1);
  });
}
