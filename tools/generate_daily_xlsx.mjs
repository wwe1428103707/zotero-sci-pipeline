import fs from "node:fs/promises";
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

async function main() {
  const dateStr = fmtDate(TODAY);
  const day = yyMd(TODAY);
  const week = weekLabel(TODAY);
  const pipelineDir = path.join(RUNTIME.researchRoot, "pipeline", day);
  const reviewDayDir = path.join(RUNTIME.reviewRoot, week, day);
  const sourcePath = path.join(pipelineDir, "desktop_daily_review_source.json");
  const backfillPath = path.join(pipelineDir, "abc_translation_backfill.json");
  const outputPath = path.join(reviewDayDir, "隔日报.xlsx");

  const sourceData = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  const backfillData = JSON.parse(await fs.readFile(backfillPath, "utf8"));

  const backfillMap = new Map();
  if (backfillData?.updated_items) {
    for (const item of backfillData.updated_items) {
      backfillMap.set(item.itemKey, item.shortTitle);
    }
  }

  const banned = new Set(["D", "D无关"]);
  const rows = sourceData.triaged
    .filter((it) => !banned.has(String(it?.grade || "")) && !banned.has(String(it?.["推荐等级"] || "")))
    .map((it) => {
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

  const ws = XLSX.utils.json_to_sheet(rows, { header: ["英文标题", "标题翻译", "推荐等级", "期刊/来源", "来源等级", "feedback", "comment"] });

  const colWidths = [
    { wch: 60 },
    { wch: 40 },
    { wch: 12 },
    { wch: 30 },
    { wch: 14 },
    { wch: 12 },
    { wch: 30 },
  ];
  ws["!cols"] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, "每日反馈");

  await fs.mkdir(reviewDayDir, { recursive: true });
  XLSX.writeFile(wb, outputPath, { bookType: "xlsx", type: "file" });

  console.log(JSON.stringify({
    ok: true,
    output: outputPath,
    rows: rows.length,
    method: "node_fallback",
    sheet: "每日反馈",
    date: dateStr,
    week,
    day,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
