import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { translateOne } from "./lib/title_translation_support.mjs";
import { ensureZoteroMcpReady } from "./lib/ensure_zotero_mcp_ready.mjs";
import { buildRuntimeConfig } from "./lib/runtime_config.mjs";
import { looksLikeTitle, isTitleAlreadyChinese, validateTranslationQuality, detectSourceLanguage } from "./lib/title_validation.mjs";

const RUNTIME = buildRuntimeConfig();
const ROOT = RUNTIME.projectRoot;
const RESEARCH_ROOT = RUNTIME.researchRoot;
const MCP_URL = process.env.ZOTERO_MCP_URL || process.env.MCP_URL || "http://127.0.0.1:23120/mcp";
const DEFAULT_POOL_COLLECTION = "文献池";
const FAILURES_LOG_PATH = path.join(RESEARCH_ROOT, "pipeline", "standalone_translation_failures.json");
const REPORT_PATH = path.join(RESEARCH_ROOT, "pipeline", "standalone_translation_report.json");

let _mcpCallId = 500000;

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
      try {
        return JSON.parse(part.text);
      } catch {
        return part.text;
      }
    }
  }
  return result;
}

async function ensureMcpReady() {
  return ensureZoteroMcpReady({
    mcpProbe: async (attempt) => {
      await mcpToolCall("get_collections", { mode: "minimal", limit: 1 }, 900000 + attempt);
    },
  });
}

async function findTargetCollection(poolName) {
  if (poolName.match(/^[A-Za-z0-9]{8}$/)) {
    return { collectionKey: poolName, key: poolName };
  }
  const result = parseToolText(await mcpToolCall("get_collections", { mode: "complete", limit: 500 }, 500010));
  const collections = Array.isArray(result) ? result : (result?.collections || []);
  const pool = collections.find((c) => c.name === poolName || c.data?.name === poolName);
  if (pool) return pool;
  const fallback = collections.find((c) => /pool|文献|paper/i.test(c.name || c.data?.name || ""));
  return fallback || null;
}

async function getLatestDateCollection() {
  const result = parseToolText(await mcpToolCall("get_collections", { mode: "complete", limit: 500 }, 500011));
  const collections = Array.isArray(result) ? result : (result?.collections || []);
  const pool = collections.find((c) => c.name === "文献池" || c.name === "Literature Pool");
  if (!pool) return null;
  const poolKey = pool.collectionKey || pool.key;
  const subTree = parseToolText(await mcpToolCall("get_subcollections", { collectionKey: poolKey, recursive: false }, 500012));
  const dateCollections = Array.isArray(subTree) ? subTree.filter(
    (n) => /^\d{4}-\d{2}-\d{2}$/.test(n.name)
  ).sort((a, b) => b.name.localeCompare(a.name)) : [];
  if (dateCollections.length === 0) return null;
  return { key: dateCollections[0].collectionKey || dateCollections[0].key, name: dateCollections[0].name };
}

async function getCollectionItemKeys(collectionKey, idBase) {
  const keys = [];
  let offset = 0;
  const l = 500;
  while (true) {
    const items = parseToolText(await mcpToolCall("get_collection_items", { collectionKey, limit: l, offset }, idBase + offset));
    if (!Array.isArray(items) || !items.length) break;
    for (const it of items) {
      if (it?.key) keys.push(it.key);
    }
    if (items.length < l) break;
    offset += l;
  }
  return keys;
}

async function getAllCollectionItemKeys(rootCollectionKey, idBase) {
  const allKeys = new Set();
  const rootKeys = await getCollectionItemKeys(rootCollectionKey, idBase);
  for (const k of rootKeys) allKeys.add(k);
  const tree = parseToolText(await mcpToolCall("get_subcollections", { collectionKey: rootCollectionKey, recursive: true }, idBase + 1000));
  const subKeys = [];
  if (Array.isArray(tree)) {
    for (const node of tree) {
      const ck = node.collectionKey || node.key;
      if (ck) subKeys.push(ck);
    }
  }
  for (let si = 0; si < subKeys.length; si++) {
    const ck = subKeys[si];
    try {
      const keys = await getCollectionItemKeys(ck, idBase + 2000 + si * 100);
      for (const k of keys) allKeys.add(k);
    } catch { continue; }
  }
  return [...allKeys];
}

async function scanItemsNeedingTranslation({ collectionName = DEFAULT_POOL_COLLECTION, limit = 0, collectionKey = null } = {}) {
  let targetCollection;
  if (collectionKey) {
    targetCollection = { collectionKey, key: collectionKey };
  } else if (collectionName && !collectionName.match(/^[A-Za-z0-9]{8}$/)) {
    // Default: find the latest date collection
    const latest = await getLatestDateCollection();
    if (latest) {
      targetCollection = { collectionKey: latest.key, key: latest.key };
      collectionName = latest.name;
    } else {
      targetCollection = await findTargetCollection(collectionName);
    }
  } else {
    targetCollection = await findTargetCollection(collectionName);
  }
  if (!targetCollection) throw new Error(`集合未找到: "${collectionName}"`);

  const poolKey = targetCollection.collectionKey || targetCollection.key;
  console.error(`[scan] 扫描集合 key=${poolKey}`);
  const allKeys = await getAllCollectionItemKeys(poolKey, 500100);
  console.error(`[scan] 共获取到 ${allKeys.length} 个条目 key`);
  const candidates = [];

  for (let i = 0; i < allKeys.length; i++) {
    const itemKey = allKeys[i];
    try {
      const detail = parseToolText(await mcpToolCall("get_item_details", { itemKey, mode: "preview" }, 500200 + i));
      const title = detail?.title || detail?.data?.title || "";
      const shortTitle = detail?.shortTitle || detail?.data?.shortTitle || "";

      if (!title) continue;

      if (isTitleAlreadyChinese(title, shortTitle)) continue;

      const validation = looksLikeTitle(title);
      if (!validation.valid) continue;

      const sourceLang = detectSourceLanguage(title);
      candidates.push({ itemKey, title, shortTitle, sourceLang });

      if (limit > 0 && candidates.length >= limit) break;
    } catch (err) {
      continue;
    }
  }

  return candidates;
}

async function loadPreviousFailures() {
  try {
    const raw = JSON.parse(await fs.readFile(FAILURES_LOG_PATH, "utf8"));
    return Array.isArray(raw.failures) ? raw.failures : [];
  } catch {
    return [];
  }
}

export async function runStandaloneTitleTranslation({
  dryRun = false,
  limit = 0,
  retryFailures = false,
  collectionName = DEFAULT_POOL_COLLECTION,
  collectionKey = null,
} = {}) {
  const startedAt = Date.now();
  const report = {
    started_at: new Date().toISOString(),
    dry_run: dryRun,
    limit: limit || "unlimited",
    retry_failures: retryFailures,
    collection: collectionName,
    scan: { total_in_pool: 0, candidates_found: 0, skipped_already_chinese: 0, skipped_invalid_title: 0 },
    translation: { attempted: 0, success: 0, quality_failed: 0, api_failed: 0, skipped_from_cache: 0 },
    writeback: { attempted: 0, success: 0, failed: 0, mcp_errors: [] },
    failures: [],
    completed_at: null,
    duration_ms: 0,
  };

  await ensureMcpReady();

  let itemsToTranslate = [];

  if (retryFailures) {
    const prevFailures = await loadPreviousFailures();
    itemsToTranslate = prevFailures.map((f) => ({
      itemKey: f.itemKey,
      title: f.title,
      shortTitle: "",
      sourceLang: detectSourceLanguage(f.title),
      isRetry: true,
    }));
    report.retry_count = itemsToTranslate.length;
  } else {
    const candidates = await scanItemsNeedingTranslation({ collectionName, limit, collectionKey });
    itemsToTranslate = candidates.map((c) => ({ ...c, isRetry: false }));
    report.scan.total_in_pool = 0;
    report.scan.candidates_found = itemsToTranslate.length;
  }

  if (itemsToTranslate.length === 0) {
    report.completed_at = new Date().toISOString();
    report.duration_ms = Date.now() - startedAt;
    report.status = "no_items_needing_translation";
    await writeReport(report);
    return report;
  }

  if (dryRun) {
    report.translation.attempted = 0;
    report.translation.success = 0;
    report.completed_at = new Date().toISOString();
    report.duration_ms = Date.now() - startedAt;
    report.status = "dry_run_completed";
    report.dry_run_candidates = itemsToTranslate.map((i) => ({
      itemKey: i.itemKey,
      title: i.title,
      sourceLang: i.sourceLang,
    }));
    await writeReport(report);
    return report;
  }

  for (let idx = 0; idx < itemsToTranslate.length; idx++) {
    const item = itemsToTranslate[idx];
    const progressPct = Math.round((idx + 1) / itemsToTranslate.length * 100);
    const progressMsg = `[PROGRESS] ${idx + 1}/${itemsToTranslate.length} ${progressPct}% 翻译中: ${item.title.slice(0, 50)}...`;
    console.error(progressMsg);
    console.error(`[PROGRESS_JSON]${JSON.stringify({ current: idx + 1, total: itemsToTranslate.length, pct: progressPct, stage: "translation", itemKey: item.itemKey, title: item.title.slice(0, 50) })}`);
    report.translation.attempted++;
    try {
      const translated = await translateOne(item.title);
      if (!translated?.ok) {
        report.translation.api_failed++;
        report.failures.push({
          itemKey: item.itemKey,
          title: item.title,
          reason: translated?.reason || "translation_api_failed",
          stage: "translation",
        });
        continue;
      }

      const quality = validateTranslationQuality(item.title, translated.zh);
      if (!quality.ok) {
        report.translation.quality_failed++;
        report.failures.push({
          itemKey: item.itemKey,
          title: item.title,
          translated: translated.zh,
          reason: quality.reason,
          stage: "quality_check",
        });
        continue;
      }

      report.translation.success++;
      const shortTitle = translated.zh.trim();

      report.writeback.attempted++;
      try {
        await mcpToolCall("write_metadata", { itemKey: item.itemKey, fields: { shortTitle } }, 500300 + report.writeback.attempted);
        report.writeback.success++;
      } catch (writeErr) {
        report.writeback.failed++;
        report.writeback.mcp_errors.push(String(writeErr?.message || writeErr).slice(0, 200));
        report.failures.push({
          itemKey: item.itemKey,
          title: item.title,
          translated: shortTitle,
          reason: `writeback_failed: ${String(writeErr?.message || writeErr).slice(0, 150)}`,
          stage: "writeback",
        });
      }
    } catch (err) {
      report.translation.api_failed++;
      report.failures.push({
        itemKey: item.itemKey,
        title: item.title,
        reason: `unexpected_error: ${String(err?.message || err).slice(0, 200)}`,
        stage: "translation",
      });
    }
  }

  report.completed_at = new Date().toISOString();
  report.duration_ms = Date.now() - startedAt;
  report.status = report.failures.length > 0 ? "completed_with_failures" : "completed";

  await fs.writeFile(FAILURES_LOG_PATH, JSON.stringify({
    generated_at: report.completed_at,
    failure_count: report.failures.length,
    failures: report.failures,
  }, null, 2), "utf8");

  await writeReport(report);
  return report;
}

async function writeReport(report) {
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

function parseCliArgs(argv) {
  const args = { dryRun: false, limit: 0, retryFailures: false, collectionName: DEFAULT_POOL_COLLECTION, collectionKey: null };
  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "--dryrun") args.dryRun = true;
    if (arg.startsWith("--limit=")) args.limit = Number(arg.split("=")[1]) || 0;
    if (arg === "--retry-failures" || arg === "--retry") args.retryFailures = true;
    if (arg.startsWith("--collection=")) args.collectionName = arg.split("=")[1];
    if (arg.startsWith("--collection-key=")) args.collectionKey = arg.split("=")[1];
  }
  return args;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseCliArgs(process.argv.slice(2));
  runStandaloneTitleTranslation(args).catch((err) => {
    console.error(JSON.stringify({ error: String(err?.message || err), stack: err?.stack }, null, 2));
    process.exit(1);
  });
}
