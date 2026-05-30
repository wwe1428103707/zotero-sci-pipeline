import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { buildRuntimeConfig } from "./lib/runtime_config.mjs";
import XLSX from "xlsx";

const RUNTIME = buildRuntimeConfig();
const TODAY = new Date();

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function yyMd(d) {
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
}
function weekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}
function weekLabel(d) {
  return `${String(d.getFullYear()).slice(2)} Week${weekNumber(d)}`;
}
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const wn = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(wn).padStart(2, "0")}`;
}
function parseDateFromDir(dirName) {
  const m = String(dirName).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  try {
    return new Date(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } catch {
    return null;
  }
}

function makeBold(wb, ws, rows) {
  if (!ws || !rows.length) return;
  for (let c = 0; c < (rows[0] || []).length; c++) {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[ref]) {
      ws[ref].s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1F4E78" } } };
    }
  }
}

function autoColWidths(headers) {
  return headers.map((h) => ({ wch: Math.max(12, String(h).length * 2 + 4) }));
}

function collectStopWords() {
  return new Set([
    "this", "that", "with", "from", "using", "based", "method", "approach", "model",
    "data", "learning", "paper", "results", "study", "propose", "novel", "new",
    "experimental", "analysis", "performance", "system", "approach", "method",
    "algorithm", "network", "application", "frame", "work", "show", "also",
    "can", "well", "two", "one", "first", "proposed", "different", "effective",
    "efficient", "improve", "existing", "developed", "present", "introduce",
    "实验", "方法", "模型", "研究", "算法", "系统", "网络", "数据", "分析",
    "基于", "提出", "方法", "一种", "技术", "框架", "性能", "结果", "应用",
    "有效", "改进", "新型", "方法", "问题", "方案", "优化", "设计", "实现",
    "融合", "特征", "分类", "识别", "预测", "检测", "评估", "比较",
  ]);
}

function extractKeywords(titles, topN = 30) {
  const stopWords = collectStopWords();
  const freq = {};
  for (const t of titles) {
    const text = String(t || "");
    const enWords = text.toLowerCase().match(/[a-z]{4,}/g) || [];
    const zhWords = text.match(/[\u4e00-\u9fff]{2,6}/g) || [];
    for (const w of [...enWords, ...zhWords]) {
      if (!stopWords.has(w)) freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ 关键词: word, 出现次数: count }));
}

function buildGradeDistributionRows(items) {
  const gradeCounts = { A: 0, B: 0, C: 0, D: 0 };
  for (const it of items) {
    const g = (it.grade || it["推荐等级"] || "").charAt(0);
    if (gradeCounts[g] !== undefined) gradeCounts[g]++;
  }
  return [
    { 等级: "A 核心相关", 数量: gradeCounts.A, 占比: `${((gradeCounts.A / Math.max(1, items.length)) * 100).toFixed(1)}%` },
    { 等级: "B 专题相关", 数量: gradeCounts.B, 占比: `${((gradeCounts.B / Math.max(1, items.length)) * 100).toFixed(1)}%` },
    { 等级: "C 背景相关", 数量: gradeCounts.C, 占比: `${((gradeCounts.C / Math.max(1, items.length)) * 100).toFixed(1)}%` },
    { 等级: "D 低相关", 数量: gradeCounts.D, 占比: `${((gradeCounts.D / Math.max(1, items.length)) * 100).toFixed(1)}%` },
  ];
}

function buildSourceBreakdownRows(items) {
  const srcMap = {};
  for (const it of items) {
    const src = it.source_channel || it.source_platform || "other";
    const g = (it.grade || it["推荐等级"] || "").charAt(0);
    if (!srcMap[src]) srcMap[src] = { total: 0, A: 0, B: 0, C: 0, D: 0 };
    srcMap[src].total++;
    if (srcMap[src][g] !== undefined) srcMap[src][g]++;
  }
  return Object.entries(srcMap)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([src, counts]) => ({
      来源: src,
      总计: counts.total,
      A: counts.A,
      B: counts.B,
      C: counts.C,
      D: counts.D,
      A率: `${((counts.A / Math.max(1, counts.total)) * 100).toFixed(0)}%`,
    }));
}

function buildTrendRows(researchRoot) {
  const pipelineRoot = path.join(researchRoot, "pipeline");
  let dirs = [];
  try {
    dirs = fs.readdirSync(pipelineRoot).filter((d) => /^\d+\.\d+\.\d+$/.test(d)).sort();
  } catch {
    return [];
  }
  const rows = [];
  for (const dir of dirs) {
    const reportPath = path.join(pipelineRoot, dir, "run_report.json");
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      const gc = report.counts?.grade_counts || {};
      rows.push({
        日期: report.date || dir,
        A: gc.A || 0,
        B: gc.B || 0,
        C: gc.C || 0,
        D: gc.D || 0,
        总数: (gc.A || 0) + (gc.B || 0) + (gc.C || 0) + (gc.D || 0),
        A率: `${((((gc.A || 0) / Math.max(1, (gc.A || 0) + (gc.B || 0) + (gc.C || 0) + (gc.D || 0)))) * 100).toFixed(0)}%`,
      });
    } catch {}
  }
  return rows;
}

function collectPreviousDayFingerprints(researchRoot, currentDay) {
  const pipelineRoot = path.join(researchRoot, "pipeline");
  let dirs = [];
  try {
    dirs = fs.readdirSync(pipelineRoot).filter((d) => /^\d+\.\d+\.\d+$/.test(d) && d !== currentDay).sort();
  } catch {
    return new Set();
  }

  const fingerprints = new Set();
  for (let i = dirs.length - 1; i >= Math.max(0, dirs.length - 14); i--) {
    const dir = dirs[i];
    const triagedPath = path.join(pipelineRoot, dir, "triaged_items.json");
    try {
      const items = JSON.parse(fs.readFileSync(triagedPath, "utf8"));
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        const doi = (it.doi || "").trim().toLowerCase();
        if (doi) fingerprints.add(`doi:${doi}`);
        const pmid = (it.pmid || "").trim();
        if (pmid) fingerprints.add(`pmid:${pmid}`);
        const pmcid = (it.pmcid || "").trim();
        if (pmcid) fingerprints.add(`pmcid:${pmcid}`);
        const title = (it.title || "").trim().toLowerCase().replace(/\s+/g, " ");
        if (title && title.length > 20) {
          const fp = title.replace(/[^a-z0-9\u4e00-\u9fff]/g, "").slice(0, 60);
          if (fp.length > 15) fingerprints.add(`title:${fp}`);
        }
      }
    } catch {}
  }
  return fingerprints;
}

function applyCrossDayDedup(items, fingerprints, currentDayDir) {
  if (!fingerprints || fingerprints.size === 0) return { items, removed: 0 };
  const matched = [];
  const kept = [];
  for (const it of items) {
    const doi = (it.doi || "").trim().toLowerCase();
    const pmid = (it.pmid || "").trim();
    const pmcid = (it.pmcid || "").trim();
    const title = (it.title || "").trim().toLowerCase().replace(/\s+/g, " ");
    const fp = title.replace(/[^a-z0-9\u4e00-\u9fff]/g, "").slice(0, 60);
    let isDuplicate = false;
    if (doi && fingerprints.has(`doi:${doi}`)) isDuplicate = true;
    else if (pmid && fingerprints.has(`pmid:${pmid}`)) isDuplicate = true;
    else if (pmcid && fingerprints.has(`pmcid:${pmcid}`)) isDuplicate = true;
    else if (fp.length > 15 && fingerprints.has(`title:${fp}`)) isDuplicate = true;

    if (isDuplicate) {
      matched.push(it);
    } else {
      kept.push(it);
    }
  }
  return { items: kept, removed: matched.length };
}

export async function generateDailyXlsx(options = {}) {
  const now = options.date ? new Date(options.date) : TODAY;
  const dateStr = options.dateStr || fmtDate(now);
  const day = options.dayStr || yyMd(now);
  const week = options.weekLabel || weekLabel(now);
  const weekIso = options.weekIso || isoWeek(now);
  const researchRoot = options.researchRoot || RUNTIME.researchRoot;
  const reviewRoot = options.reviewRoot || RUNTIME.reviewRoot;
  const pipelineDir = options.pipelineDir || path.join(researchRoot, "pipeline", day);
  const reviewDayDir = path.join(reviewRoot, week, day);
  const reviewWeekDir = path.join(reviewRoot, week);

  const sourcePath = path.join(pipelineDir, "desktop_daily_review_source.json");
  const backfillPath = path.join(pipelineDir, "abc_translation_backfill.json");
  const dailyOutputPath = path.join(reviewDayDir, "隔日报.xlsx");
  const biweeklyOutputPath = path.join(reviewWeekDir, "双周报.xlsx");

  const sourceData = JSON.parse(await fsp.readFile(sourcePath, "utf8"));
  const backfillData = JSON.parse(await fsp.readFile(backfillPath, "utf8"));

  const backfillMap = new Map();
  if (backfillData?.updated_items) {
    for (const item of backfillData.updated_items) {
      backfillMap.set(item.itemKey, item.shortTitle);
    }
  }

  const banned = new Set(["D", "D无关"]);
  let allItems = sourceData.triaged || [];

  const fingerprints = collectPreviousDayFingerprints(researchRoot, day);
  if (fingerprints.size > 0 && allItems.length > 0) {
    const dedupResult = applyCrossDayDedup(allItems, fingerprints, day);
    allItems = dedupResult.items;
  }

  const abcItems = allItems.filter((it) => !banned.has(String(it?.grade || "")) && !banned.has(String(it?.["推荐等级"] || "")));

  const dailyRows = abcItems.map((it) => {
    const itemKey = it.itemKey || it["条目Key"] || "";
    const translated = it["标题翻译"] || it["中文标题"] || it.shortTitle || backfillMap.get(itemKey) || it.title || "";
    const source = String(it.journal || it.source_platform || it.source || "").replace("ScienceDirect Publication:", "").trim();
    return {
      "英文标题": it.title || "",
      "标题翻译": translated,
      "推荐等级": it["推荐等级"] || it.grade_label || "",
      "期刊/来源": source,
      "来源等级": "abstract_only",
      "feedback": "",
      "comment": "",
    };
  });

  const wb = XLSX.utils.book_new();

  const dailyHeaders = ["英文标题", "标题翻译", "推荐等级", "期刊/来源", "来源等级", "feedback", "comment"];
  const dailyWs = XLSX.utils.json_to_sheet(dailyRows, { header: dailyHeaders });
  dailyWs["!cols"] = [
    { wch: 60 }, { wch: 40 }, { wch: 12 }, { wch: 30 },
    { wch: 14 }, { wch: 12 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, dailyWs, "每日反馈");

  const biweeklyWs = XLSX.utils.aoa_to_sheet([
    [`双周报 — ${weekIso} (${week})`, "", "", "", "", "", ""],
    ["", "", "", "", "", "", ""],
  ]);
  XLSX.utils.book_append_sheet(wb, biweeklyWs, "双周趋势");
  makeBold(wb, biweeklyWs, [["双周报占位"]]);

  const gradeDistRows = buildGradeDistributionRows(allItems);
  const gradeWs = XLSX.utils.json_to_sheet(gradeDistRows, { header: ["等级", "数量", "占比"] });
  gradeWs["!cols"] = [{ wch: 18 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, gradeWs, "本次分级分布");

  const sourceRows = buildSourceBreakdownRows(allItems);
  if (sourceRows.length) {
    const srcWs = XLSX.utils.json_to_sheet(sourceRows, { header: ["来源", "总计", "A", "B", "C", "D", "A率"] });
    srcWs["!cols"] = [{ wch: 20 }, { wch: 8 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, srcWs, "来源分布");
  }

  const abTitles = allItems
    .filter((it) => {
      const g = (it.grade || it["推荐等级"] || "").charAt(0);
      return g === "A" || g === "B";
    })
    .map((it) => `${it.title || ""} ${it["中文标题"] || it["标题翻译"] || ""}`);
  const keywordRows = extractKeywords(abTitles, 40);
  if (keywordRows.length) {
    const kwWs = XLSX.utils.json_to_sheet(keywordRows, { header: ["关键词", "出现次数"] });
    kwWs["!cols"] = [{ wch: 28 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, kwWs, "关键词频率");
  }

  await fsp.mkdir(reviewDayDir, { recursive: true });
  XLSX.writeFile(wb, dailyOutputPath, { bookType: "xlsx", type: "file" });

  const trendRows = buildTrendRows(researchRoot);
  const wbWeekly = XLSX.utils.book_new();

  const weeklyTitle = `双周报 — ${weekIso} (${week})`;
  const weeklyMeta = [
    ["双周报", weeklyTitle],
    ["生成时间", new Date().toISOString()],
    ["", ""],
  ];
  const metaWs = XLSX.utils.aoa_to_sheet(weeklyMeta);
  XLSX.utils.book_append_sheet(wbWeekly, metaWs, "概况");

  if (trendRows.length >= 1) {
    const trendWs = XLSX.utils.json_to_sheet(trendRows, { header: ["日期", "A", "B", "C", "D", "总数", "A率"] });
    trendWs["!cols"] = [{ wch: 14 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 8 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wbWeekly, trendWs, "历史趋势");
  }

  if (gradeDistRows.length) {
    const gdWs = XLSX.utils.json_to_sheet(gradeDistRows, { header: ["等级", "数量", "占比"] });
    gdWs["!cols"] = [{ wch: 18 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wbWeekly, gdWs, "本次分级分布");
  }

  if (sourceRows.length) {
    const srcWs = XLSX.utils.json_to_sheet(sourceRows, { header: ["来源", "总计", "A", "B", "C", "D", "A率"] });
    srcWs["!cols"] = [{ wch: 20 }, { wch: 8 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wbWeekly, srcWs, "来源分布");
  }

  const topItems = abcItems.slice(0, 20);
  if (topItems.length) {
    const topRows = topItems.map((it, i) => ({
      序号: i + 1,
      英文标题: it.title || "",
      标题翻译: it["中文标题"] || it["标题翻译"] || "",
      推荐等级: it["推荐等级"] || it.grade_label || "",
      来源: it.journal || it.source_platform || "",
    }));
    const topWs = XLSX.utils.json_to_sheet(topRows, { header: ["序号", "英文标题", "标题翻译", "推荐等级", "来源"] });
    topWs["!cols"] = [{ wch: 6 }, { wch: 60 }, { wch: 40 }, { wch: 12 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wbWeekly, topWs, "Top文献");
  }

  if (keywordRows.length) {
    const kwWs = XLSX.utils.json_to_sheet(keywordRows, { header: ["关键词", "出现次数"] });
    kwWs["!cols"] = [{ wch: 28 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wbWeekly, kwWs, "关键词频率");
  }

  await fsp.mkdir(reviewWeekDir, { recursive: true });
  XLSX.writeFile(wbWeekly, biweeklyOutputPath, { bookType: "xlsx", type: "file" });

  return {
    ok: true,
    daily_output: dailyOutputPath,
    biweekly_output: biweeklyOutputPath,
    daily_rows: dailyRows.length,
    biweekly_sheets: wbWeekly.SheetNames,
    method: "node_fallback",
    grade_distribution: gradeDistRows,
    source_breakdown: sourceRows,
    trend_count: trendRows.length,
    keyword_count: keywordRows.length,
    date: dateStr,
    week,
    day,
  };
}

async function main() {
  const result = await generateDailyXlsx({
    dateStr: fmtDate(TODAY),
    dayStr: yyMd(TODAY),
    weekLabel: weekLabel(TODAY),
    weekIso: isoWeek(TODAY),
  });
  console.log(JSON.stringify(result, null, 2));
}

const isMainScript = process.argv[1] && (
  process.argv[1].replace(/\\/g, "/").endsWith("generate_daily_xlsx.mjs") ||
  process.argv[1].replace(/\\/g, "/").endsWith("generate_daily_xlsx")
);
if (isMainScript) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
