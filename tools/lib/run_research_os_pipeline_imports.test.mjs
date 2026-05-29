import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("run_research_os_pipeline 导入所有实际使用的来源配置 helper", () => {
  const orchestrator = fs.readFileSync(
    path.resolve("d:/zotero-med-pipeline/tools/run_research_os_pipeline.mjs"),
    "utf8",
  );
  const literatureImport = orchestrator.match(
    /import\s*\{[\s\S]*?\}\s*from\s*"\.\/lib\/literature_config\.mjs";/,
  )?.[0] || "";

  assert.match(orchestrator, /loadCrossrefSearchConfig/);
  assert.match(orchestrator, /loadCnkiImportConfig/);
  assert.match(literatureImport, /loadCrossrefSearchConfig/);
  assert.match(literatureImport, /loadCnkiImportConfig/);
});
