import { resolveCachedTranslation } from "./title_translation_support.mjs";

export function buildFinalExportPayload({
  writebackReady = [],
  writebackSummary = {},
  backfillReport = {},
  reportContext = {},
  translationCache = null,
} = {}) {
  const successfulWritebackItems = Array.isArray(writebackSummary?.writeback_items) ? writebackSummary.writeback_items : [];
  const summaryKey = (item) => [item.title || "", item.source_channel || "", item.grade || item["推荐等级"] || ""].join("||");
  const itemKeyByStage1Key = new Map(
    successfulWritebackItems.map((item) => [
      [item.title || "", item.source_channel || "", item.grade || item.grade_label || ""].join("||"),
      item.itemKey,
    ]),
  );
  const translatedByKey = new Map(
    (backfillReport.updated_items || []).map((item) => [item.itemKey, item.shortTitle]),
  );

  const baseItems = successfulWritebackItems.length ? successfulWritebackItems : writebackReady;
  const triaged = baseItems.map((item) => {
    const itemKey = item.itemKey || itemKeyByStage1Key.get(summaryKey(item));
    const cacheTranslation = resolveCachedTranslation(translationCache, item.title);
    const translatedTitle = translatedByKey.get(itemKey) || cacheTranslation || item["标题翻译"] || item["中文标题"] || item.title || "";
    return {
      ...item,
      itemKey,
      标题翻译: translatedTitle,
      中文标题: translatedTitle,
      写回状态: itemKey ? "已写回" : "待核对",
    };
  });

  return {
    triaged,
    reportContext: {
      ...reportContext,
      translation: {
        failed_count: backfillReport.failure_count || 0,
        failed_samples: backfillReport.failures || [],
        stage: "completed_after_writeback",
        ...(reportContext.translation || {}),
      },
    },
  };
}

export function buildStage4ExportAudit({
  mode = "success",
  reviewRoot = "",
  requestedOutputPath = "",
  exportInputFiles = [],
  writebackSummary = {},
  backfillReport = {},
  runReport = {},
  fallbackChain = [],
  generatedAt = new Date().toISOString(),
  paperAssetOutputs = {},
  result = {},
  skillAvailability = {},
  nodeError = "",
} = {}) {
  const writebackFailuresCount = Array.isArray(writebackSummary?.failures) ? writebackSummary.failures.length : 0;
  const translationFailuresCount = Number(backfillReport?.failure_count || 0);
  const excludedDCount = Number(runReport?.counts?.d_skipped || result?.excluded_d_count || 0);

  if (mode === "node_fallback") {
    return {
      stage4_export_status: "success",
      export_method: "node_fallback",
      export_skill: null,
      spreadsheets_skill_available: false,
      spreadsheets_skill_unavailable_reason: skillAvailability?.reason || null,
      export_output_path: requestedOutputPath,
      export_root: reviewRoot,
      requested_output_path: requestedOutputPath,
      actual_output_path: result?.daily_output || null,
      desktop_export_disabled: true,
      export_input_files: exportInputFiles,
      export_rows_count: result?.daily_rows || 0,
      export_excluded_d_count: excludedDCount,
      export_writeback_failures_count: writebackFailuresCount,
      export_translation_failures_count: translationFailuresCount,
      export_error: null,
      export_degraded: true,
      export_degrade_reason: "spreadsheets_skill_unavailable_fallback_node",
      export_fallback_chain: fallbackChain,
      final_xlsx_outputs: ["隔日报.xlsx", "双周报.xlsx"],
      paper_asset_outputs: paperAssetOutputs,
      export_generated_at: generatedAt,
      manual_required: false,
      export_outputs: {
        every_other_day_report: result?.daily_output || requestedOutputPath,
        biweekly_report: result?.biweekly_output || null,
        ...paperAssetOutputs,
      },
      daily_workbook_sheets: ["每日反馈", "本次分级分布", "来源分布", "关键词频率"],
      standard_summary_sheet_exported: false,
      standard_summary_sheet_name: "",
      standard_summary_sheet_schema: "",
      standard_summary_generated: false,
      standard_summary_generated_from_fallback: false,
      standard_summary_unavailable: false,
      standard_summary_user_feedback_columns_present: false,
      node_fallback_details: {
        trend_count: result?.trend_count || 0,
        source_breakdown_count: result?.source_breakdown?.length || 0,
        keyword_count: result?.keyword_count || 0,
        biweekly_sheets: result?.biweekly_sheets || [],
        grade_distribution: result?.grade_distribution || [],
      },
    };
  }

  if (mode === "manual_required") {
    return {
      stage4_export_status: "failed",
      export_method: "manual_required",
      export_skill: null,
      spreadsheets_skill_available: false,
      spreadsheets_skill_unavailable_reason: skillAvailability.reason,
      export_output_path: null,
      export_root: reviewRoot,
      requested_output_path: requestedOutputPath,
      actual_output_path: null,
      desktop_export_disabled: true,
      export_input_files: exportInputFiles,
      export_rows_count: 0,
      export_excluded_d_count: excludedDCount,
      export_writeback_failures_count: writebackFailuresCount,
      export_translation_failures_count: translationFailuresCount,
      export_error: "Spreadsheets skill unavailable",
      export_degraded: true,
      export_degrade_reason: "spreadsheets_skill_unavailable",
      export_fallback_chain: fallbackChain,
      final_xlsx_outputs: ["隔日报.xlsx", "双周报.xlsx"],
      paper_asset_outputs: paperAssetOutputs,
      export_generated_at: generatedAt,
      manual_required: true,
      export_outputs: {
        ...paperAssetOutputs,
      },
      manual_steps: [
        "Ensure @oai/artifact-tool is available in the active AI workspace runtime.",
        "Rerun: node tools/finalize_research_os_exports.mjs",
      ],
      node_fallback_error: nodeError || null,
    };
  }

  return {
    stage4_export_status: "success",
    export_method: "spreadsheets_skill",
    export_skill: "Spreadsheets",
    spreadsheets_skill_available: true,
    export_root: reviewRoot,
    requested_output_path: requestedOutputPath,
    actual_output_path: result?.outputs?.every_other_day_report || null,
    desktop_export_disabled: true,
    export_input_files: exportInputFiles,
    export_rows_count: result?.rows_count,
    export_excluded_d_count: excludedDCount,
    export_writeback_failures_count: writebackFailuresCount,
    export_translation_failures_count: translationFailuresCount,
    export_error: null,
    export_degraded: false,
    export_fallback_chain: fallbackChain,
    final_xlsx_outputs: ["隔日报.xlsx", "双周报.xlsx"],
    paper_asset_outputs: paperAssetOutputs,
    export_generated_at: generatedAt,
    manual_required: false,
    export_outputs: {
      ...(result?.outputs || {}),
      ...paperAssetOutputs,
    },
    daily_workbook_sheets: result?.daily_workbook_sheets || ["每日反馈"],
    standard_summary_sheet_exported: Boolean(result?.standard_summary_sheet_exported),
    standard_summary_sheet_name: result?.standard_summary_sheet_name || "当前筛选标准摘要",
    standard_summary_sheet_schema: result?.standard_summary_sheet_schema || "",
    standard_summary_generated: Boolean(result?.standard_summary_generated),
    standard_summary_generated_from_fallback: Boolean(result?.standard_summary_generated_from_fallback),
    standard_summary_unavailable: Boolean(result?.standard_summary_unavailable),
    standard_summary_user_feedback_columns_present: Boolean(result?.standard_summary_user_feedback_columns_present),
  };
}
