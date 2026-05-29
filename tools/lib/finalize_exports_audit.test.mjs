import test from "node:test";
import assert from "node:assert/strict";

import { buildStage4ExportAudit } from "./finalize_exports_support.mjs";

const EXPORT_METHODS = {
  SPREADSHEETS_SKILL: "spreadsheets_skill",
  NODE_FALLBACK: "node_fallback",
  MANUAL_REQUIRED: "manual_required",
};

const PAPER_ASSET_OUTPUTS = {
  paper_markdown: "D:/tmp/paper.md",
  references_bib: "D:/tmp/references.bib",
  paper_docx: "D:/tmp/paper.docx",
};

test("Stage4 成功导出 audit 会登记 paper.docx", () => {
  const audit = buildStage4ExportAudit({
    mode: "success",
    reviewRoot: "D:/review",
    requestedOutputPath: "D:/review/day/隔日报.xlsx",
    exportInputFiles: ["run_report.json"],
    writebackSummary: { failures: [] },
    backfillReport: { failure_count: 0 },
    runReport: { counts: { d_skipped: 1 } },
    fallbackChain: [EXPORT_METHODS.SPREADSHEETS_SKILL, EXPORT_METHODS.NODE_FALLBACK],
    generatedAt: "2026-05-29T00:00:00.000Z",
    result: {
      outputs: {
        every_other_day_report: "D:/review/day/隔日报.xlsx",
        biweekly_report: "D:/review/week/双周报.xlsx",
      },
      rows_count: 2,
      excluded_d_count: 1,
      daily_workbook_sheets: ["每日反馈"],
      standard_summary_sheet_exported: false,
      standard_summary_sheet_name: "",
      standard_summary_sheet_schema: "",
      standard_summary_generated: false,
      standard_summary_generated_from_fallback: false,
      standard_summary_unavailable: false,
      standard_summary_user_feedback_columns_present: false,
    },
    paperAssetOutputs: PAPER_ASSET_OUTPUTS,
  });

  assert.equal(audit.export_method, EXPORT_METHODS.SPREADSHEETS_SKILL);
  assert.equal(audit.paper_asset_outputs.paper_docx, PAPER_ASSET_OUTPUTS.paper_docx);
  assert.equal(audit.export_outputs.paper_docx, PAPER_ASSET_OUTPUTS.paper_docx);
});

test("Stage4 降级 audit 也会登记 paper.docx", () => {
  const audit = buildStage4ExportAudit({
    mode: "manual_required",
    reviewRoot: "D:/review",
    requestedOutputPath: "D:/review/day/隔日报.xlsx",
    exportInputFiles: ["run_report.json"],
    writebackSummary: { failures: [{ reason: "x" }] },
    backfillReport: { failure_count: 2 },
    runReport: { counts: { d_skipped: 3 } },
    fallbackChain: [EXPORT_METHODS.SPREADSHEETS_SKILL, EXPORT_METHODS.MANUAL_REQUIRED],
    generatedAt: "2026-05-29T00:00:00.000Z",
    skillAvailability: { reason: "missing" },
    paperAssetOutputs: PAPER_ASSET_OUTPUTS,
  });

  assert.equal(audit.export_method, EXPORT_METHODS.MANUAL_REQUIRED);
  assert.equal(audit.paper_asset_outputs.paper_docx, PAPER_ASSET_OUTPUTS.paper_docx);
  assert.equal(audit.export_outputs.paper_docx, PAPER_ASSET_OUTPUTS.paper_docx);
});
