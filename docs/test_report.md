# 模块测试报告

## 测试概述

| 测试套件 | 测试文件 | 通过 | 失败 | 跳过 | 总计 |
|----------|----------|------|------|------|------|
| PDF 下载模块 | `tools/test_paper_downloader.mjs` | 33 | 0 | 0 | 33 |
| 独立翻译模块 | `tools/test_standalone_translation.mjs` | 44 | 0 | 1 | 45 |

**合计**: 77 通过 / 0 失败 / 1 跳过（共 78 项）

---

## 1. PDF 下载模块测试详情

**测试时间**: 2026-05-30T06:05:49
**报告文件**: `research_os/test_reports/paper_downloader_test_report.json`

### 1.1 单元测试 — DOI/arXiv 工具函数

| 测试组 | 用例数 | 结果 |
|--------|--------|------|
| `normalizeDoi()` | 5 | 全部通过 |
| `extractArxivId()` | 4 | 全部通过 |
| `generatePdfFilename()` | 3 | 全部通过 |
| `downloadPdf()` 参数验证 | 1 | 全部通过 |

### 1.2 配置文件验证

| 测试项 | 结果 |
|--------|------|
| 配置文件存在 | 通过 |
| `sci_hub_base_url` 有值 | 通过 |
| `grade_filter` 有默认值 | 通过 |
| `max_concurrent_downloads` 正整 | 通过 |
| `retry` 配置完整 | 通过 |

### 1.3 Dry-Run 集成测试

| 测试项 | 结果 |
|--------|------|
| CLI dry-run 执行成功 | 通过 |
| dry-run 返回 JSON 报告 | 通过 |
| 报告包含 status/config/candidates | 通过 |

### 1.4 语法检查

| 文件 | 结果 |
|------|------|
| `tools/lib/doi_downloader.mjs` | 通过 |
| `tools/paper_downloader.mjs` | 通过 |
| `tools/config_server.mjs` | 通过 |
| `tools/run_zotero_literature_filter.mjs` | 通过 |

### 1.5 API 端点验证

| 测试项 | 结果 |
|--------|------|
| HTTP 状态码 200 | 通过 |
| 响应包含 `ok` 字段 | 通过 |
| 报告包含 status/download/candidates | 通过 |

---

## 2. 独立翻译模块测试详情

**测试时间**: 2026-05-30T06:06:11
**报告文件**: `research_os/test_reports/standalone_translation_test_report.json`

### 2.1 单元测试 — 标题校验工具库

| 测试组 | 用例数 | 结果 |
|--------|--------|------|
| `isChineseText()` — 中文检测 | 4 | 全部通过 |
| `looksLikeTitle()` — 标题合法性 | 5 | 全部通过 |
| `isTitleAlreadyChinese()` | 4 | 全部通过 |
| `validateTranslationQuality()` | 4 | 全部通过 |
| `detectSourceLanguage()` | 3 | 全部通过 |

### 2.2 翻译配置验证

| 测试项 | 结果 |
|--------|------|
| 配置对象已返回 | 通过 |
| endpoint 已配置 | 通过 |
| model 不为占位符 | 通过 |
| API Key 已配置 | 通过 |

### 2.3 Dry-Run 集成测试

| 测试项 | 结果 |
|--------|------|
| dry-run 返回报告 | 通过 |
| 报告含 status/scan/translation/writeback/failures | 通过 |
| 候选列表非空且包含正确字段 | 通过 |

### 2.4 API 端点验证

| 测试项 | 结果 |
|--------|------|
| HTTP 状态码 200 | 通过 |
| 响应包含 ok/report/status | 通过 |

### 2.5 输出文件检查

| 文件 | 结果 |
|------|------|
| `standalone_translation_report.json` | 存在 |
| `standalone_translation_failures.json` | 存在 |

### 2.6 语法检查

| 文件 | 结果 |
|------|------|
| `tools/lib/title_validation.mjs` | 通过 |
| `tools/standalone_title_translation.mjs` | 通过 |
| `tools/config_server.mjs` | 通过 |
| `tools/run_zotero_literature_filter.mjs` | 通过 |

---

## 3. 修复记录

### 3.1 PDF 下载模块 JSON 输出路由

**问题**: `paper_downloader.mjs` 使用 `console.error()` 输出 JSON 运行报告，导致通过 `execSync()` 调用时 stdout 为空。

**修复**: 将所有 `console.error(JSON.stringify(report, null, 2))` 改为 `console.log()`，确保 JSON 报告输出到 stdout。

### 3.2 测试脚本 JSON 提取逻辑

**问题**: 测试脚本使用 `.split("\n").filter(l => l.trim().startsWith("{"))` 提取 JSON，但漂亮打印的 JSON 只有首行以 `{` 开头。

**修复**: 改用 `out.indexOf("{")` 定位 JSON 起始位置，`out.slice(braceStart)` 提取完整 JSON。

---

## 4. 已知限制

| 限制 | 说明 |
|------|------|
| Zotero MCP 依赖 | 实际下载和翻译写回依赖 Zotero MCP 服务运行；未运行时仅 dry-run 模式可用 |
| API execSync 超时 | 通过 API 触发的 CLI 调用有 600s 超时，大数据量需注意 |
| Sci-Hub CAPTCHA | Sci-Hub 可能触发验证码拦截，需切换镜像或手动下载 |
