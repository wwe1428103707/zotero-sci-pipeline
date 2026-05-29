import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildSkillAlignmentMatrix } from "./lib/research_os_exports.mjs";
import { buildFinalExportPayload, buildStage4ExportAudit } from "./lib/finalize_exports_support.mjs";
import { buildPaperAssetPayload, writePaperAssets } from "./lib/paper_export_support.mjs";
import {
  EXPORT_METHODS,
  detectSpreadsheetsSkillAvailability,
  exportAllResearchOsXlsxWithSpreadsheetsSkill,
} from "./lib/spreadsheet_adapter.mjs";
import { loadTranslationCache } from "./lib/title_translation_support.mjs";
import { buildRuntimeConfig } from "./lib/runtime_config.mjs";
import { loadResearchProfile } from "./lib/literature_config.mjs";

const RUNTIME = buildRuntimeConfig();
const ROOT = RUNTIME.projectRoot;
const RESEARCH_ROOT = RUNTIME.researchRoot;
const REVIEW_ROOT = RUNTIME.reviewRoot;
const DESKTOP_REVIEW_ROOT = RUNTIME.legacyDesktopReviewRoot;
const RUNTIME_STATE_PATH = path.join(RESEARCH_ROOT, "runtime_state.json");
const TODAY = new Date();

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function yyMd(d) {
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
}
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
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

export async function finalizeResearchOsExports() {
  const stageStarted = Date.now();
  const dateStr = fmtDate(TODAY);
  const week = isoWeek(TODAY);
  const day = yyMd(TODAY);
  const pipelineDir = path.join(RESEARCH_ROOT, "pipeline", day);
  const reviewWeekDir = path.join(REVIEW_ROOT, weekLabel(TODAY));
  const reviewDayDir = path.join(REVIEW_ROOT, weekLabel(TODAY), day);

  const runReportPath = path.join(pipelineDir, "run_report.json");
  const writebackReadyPath = path.join(pipelineDir, "writeback_ready_items.json");
  const backfillPath = path.join(pipelineDir, "abc_translation_backfill.json");
  const sourcePath = path.join(pipelineDir, "desktop_daily_review_source.json");
  const writebackSummaryPath = path.join(pipelineDir, "mcp_writeback_summary.json");
  const preferenceAuditPath = path.join(pipelineDir, "preference_learning_audit.json");
  const requestedOutputPath = path.join(reviewDayDir, "隔日报.xlsx");

  const runReport = JSON.parse(await fs.readFile(runReportPath, "utf8"));
  const failures = Array.isArray(runReport?.failures) ? runReport.failures : [];
  const hasStage2Failure = failures.some((f) => String(f?.stage || "").includes("stage2") || String(f?.reason || "").includes("MCP_NOT_READY"));
  const hasStage3Failure = failures.some((f) => String(f?.stage || "").includes("stage3") || String(f?.reason || "").includes("MCP_NOT_READY"));
  if (hasStage2Failure || hasStage3Failure) {
    throw new Error(`UPSTREAM_STAGE_FAILED: stage2_failed=${hasStage2Failure} stage3_failed=${hasStage3Failure}`);
  }

  const writebackReady = JSON.parse(await fs.readFile(writebackReadyPath, "utf8"));
  const backfillReport = JSON.parse(await fs.readFile(backfillPath, "utf8"));
  const writebackSummary = JSON.parse(await fs.readFile(writebackSummaryPath, "utf8"));
  let preferenceLearningAudit = {};
  try {
    preferenceLearningAudit = JSON.parse(await fs.readFile(preferenceAuditPath, "utf8"));
  } catch {
    preferenceLearningAudit = {};
  }
  const translationCache = await loadTranslationCache(RUNTIME.translationCachePath);
  const researchProfile = loadResearchProfile({ root: ROOT }).config;

  const finalPayload = buildFinalExportPayload({
    writebackReady,
    writebackSummary,
    backfillReport,
    translationCache,
    reportContext: {
      triggerMode: runReport.triggerMode || runReport.trigger_mode || "",
      feedbackLearning: runReport.steps.feedback_learning,
      preferenceLearningAudit,
      connector: runReport.steps.connector,
      counts: runReport.counts,
      failures: runReport.failures,
      translation: runReport.steps.translation,
      skillAlignment: buildSkillAlignmentMatrix({
        feedbackLearning: runReport.steps.feedback_learning,
        dailyExport: {
          rssCount: runReport.counts.rss_raw,
          databaseCount: runReport.counts.db_raw,
          mergedCount: runReport.counts.merged,
          exportedCount: runReport.counts.daily_export,
          excludesD: true,
          translationFailuresTracked: true,
        },
        weeklyAssets: { updated: false },
        zoteroWriteback: { mcpOnly: true, tagCleanupUsesWriteTag: true, migrationTracked: true },
      }),
    },
  });
  const paperPayload = buildPaperAssetPayload({
    date: dateStr,
    triaged: finalPayload.triaged,
    reportContext: finalPayload.reportContext,
  });

  await fs.mkdir(reviewDayDir, { recursive: true });
  await fs.writeFile(sourcePath, JSON.stringify({ date: dateStr, triaged: finalPayload.triaged, reportContext: finalPayload.reportContext }, null, 2), "utf8");
  const paperAssetOutputs = await writePaperAssets({
    outputDir: reviewDayDir,
    payload: paperPayload,
    options: {
      profile: researchProfile.output_profiles?.[0] || "sci_generic_engineering",
      paperTitleZh: `${dateStr} 工科论文写作草稿`,
      paperTitleEn: `${dateStr} Engineering Research Draft`,
    },
  });

  const skillAvailability = await detectSpreadsheetsSkillAvailability();
  const fallbackChain = [EXPORT_METHODS.SPREADSHEETS_SKILL, EXPORT_METHODS.NODE_FALLBACK, EXPORT_METHODS.PYTHON_SPAWN_LEGACY, EXPORT_METHODS.MANUAL_REQUIRED];
  const exportInputFiles = [writebackReadyPath, backfillPath, writebackSummaryPath, runReportPath, sourcePath];
  const exportGeneratedAt = new Date().toISOString();

  let exportAudit;
  if (skillAvailability.available) {
    const res = await exportAllResearchOsXlsxWithSpreadsheetsSkill({
      sourcePath,
      reviewRootDir: REVIEW_ROOT,
      reviewWeekDir,
      reviewDayDir,
      dateStr,
      weekLabel: week,
      dayLabel: day,
    });
    if (!Array.isArray(res.daily_workbook_sheets) || res.daily_workbook_sheets.length !== 1 || res.daily_workbook_sheets[0] !== "每日反馈") {
      throw new Error("DAILY_FEEDBACK_SHEET_EXPORT_INCOMPLETE");
    }
    exportAudit = buildStage4ExportAudit({
      mode: "success",
      reviewRoot: REVIEW_ROOT,
      requestedOutputPath,
      exportInputFiles,
      writebackSummary,
      backfillReport,
      runReport,
      fallbackChain,
      generatedAt: exportGeneratedAt,
      paperAssetOutputs,
      result: res,
    });
  } else {
    exportAudit = buildStage4ExportAudit({
      mode: "manual_required",
      reviewRoot: REVIEW_ROOT,
      requestedOutputPath,
      exportInputFiles,
      writebackSummary,
      backfillReport,
      runReport,
      fallbackChain,
      generatedAt: exportGeneratedAt,
      paperAssetOutputs,
      skillAvailability,
    });
    throw new Error(`SPREADSHEETS_SKILL_UNAVAILABLE: ${skillAvailability.reason}`);
  }

  runReport.steps = runReport.steps || {};
  runReport.steps.stage4_export_audit = exportAudit;
  runReport.steps.med_weekly_synthesis = {
    ok: true,
    completed: true,
    date: dateStr,
    export_policy: "spreadsheets_skill_first_for_daily_and_biweekly_xlsx",
    report_label: "隔日报",
    synthesis_label: "双周报",
    outputs: exportAudit.export_outputs || { every_other_day_report: requestedOutputPath },
  };
  runReport.stage_timings = runReport.stage_timings || {};
  runReport.stage_timings.excel_export = {
    status: "completed",
    ms: Date.now() - stageStarted,
    method: exportAudit.export_method,
  };

  await fs.writeFile(path.join(pipelineDir, "skill_alignment.json"), JSON.stringify(runReport.steps.skill_alignment || finalPayload.reportContext.skillAlignment, null, 2), "utf8");
  await fs.writeFile(runReportPath, JSON.stringify(runReport, null, 2), "utf8");
  await fs.writeFile(RUNTIME_STATE_PATH, JSON.stringify({ last_successful_full_run_at: new Date().toISOString() }, null, 2), "utf8");

  console.log(JSON.stringify({ ok: true, stage: "finalize_exports", export: exportAudit }, null, 2));
}

export async function markFinalizeExportsFailure(err) {
  try {
    const week = isoWeek(TODAY);
    const day = yyMd(TODAY);
    const runReportPath = path.join(RESEARCH_ROOT, "pipeline", day, "run_report.json");
    const runReport = JSON.parse(await fs.readFile(runReportPath, "utf8"));
    runReport.failures = Array.isArray(runReport.failures) ? runReport.failures : [];
    runReport.failures.push({ stage: "stage4_weekly_synthesis_export", reason: String(err?.message || err), at: new Date().toISOString() });
    runReport.steps = runReport.steps || {};
    runReport.steps.med_weekly_synthesis = {
      ok: false,
      completed: false,
      date: fmtDate(TODAY),
      downgrade_reason: String(err?.message || err),
      export_policy: "spreadsheets_skill_first_for_daily_and_biweekly_xlsx",
    };
    await fs.writeFile(runReportPath, JSON.stringify(runReport, null, 2), "utf8");
  } catch {}
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  finalizeResearchOsExports().catch(async (err) => {
    await markFinalizeExportsFailure(err);
    console.error(err);
    process.exit(1);
  });
}
