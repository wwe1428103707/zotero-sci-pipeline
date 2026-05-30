# 独立论文标题翻译模块 — 使用操作文档

## 功能简介

从 Zotero 文献库中筛选出所有未设置中文标题（shortTitle）的学术论文，自动调用翻译接口将其原标题翻译为规范的中文标题，并将翻译结果写入 Zotero 的 shortTitle 字段。支持三种触发方式，不依赖完整管线。

---

## 一、前置条件

### 1.1 环境要求

| 项目 | 要求 |
|------|------|
| Node.js | >= 18 (原生 fetch 支持) |
| Zotero | 已运行，Zotero MCP 插件已启用 (Streamable HTTP) |
| 翻译 API | 在 `.env` 中配置 TITLE_TRANSLATION_API_KEY 等参数 |

### 1.2 配置文件

**标题翻译配置**: `config/title_translation.config.json`

```json
{
  "model": "deepseek-v4-flash",    // 被 .env 中 TITLE_TRANSLATION_MODEL 覆盖
  "temperature": 0.2,
  "batch_size": 10,
  "fallback_to_english": true
}
```

**.env 环境变量** (优先级高于配置文件):

```env
TITLE_TRANSLATION_API_KEY=sk-xxxxx
TITLE_TRANSLATION_ENDPOINT=https://api.deepseek.com/chat/completions
TITLE_TRANSLATION_MODEL=deepseek-v4-flash
```

**翻译提示模板**: `prompts/title_translation.md` — 使用 `${sourceText}` 占位符

---

## 二、三种触发方式

### 方式 1: CLI 命令行（推荐用于批量/自动化）

```bash
# 扫描并翻译所有未翻译条目
node tools/standalone_title_translation.mjs

# 预览模式：仅扫描，不写入 Zotero
node tools/standalone_title_translation.mjs --dry-run

# 限制处理数量（如只处理前 10 篇）
node tools/standalone_title_translation.mjs --dry-run --limit=10

# 重试上次失败的条目（从 pipeline/standalone_translation_failures.json 读取）
node tools/standalone_title_translation.mjs --retry-failures

# 指定自定义集合（默认：文献池）
node tools/standalone_title_translation.mjs --collection=文献池
```

**可用参数**:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--dry-run` | flag | false | 预览模式，仅扫描不写入 |
| `--limit=N` | number | 0 (不限) | 限制处理的条目数 |
| `--retry-failures` | flag | false | 重试上次失败的条目 |
| `--collection=NAME` | string | 文献池 | 指定 Zotero 集合名称 |

### 方式 2: Web 配置界面

1. 启动配置网页服务器: `node tools/config_server.mjs`
2. 浏览器访问: http://localhost:3456
3. 左侧导航点击「翻译配置」
4. 在「独立翻译运行」区域设置参数:
   - **目标集合**: 默认为「文献池」
   - **处理上限**: 默认为「全部处理」
   - **仅扫描**: 勾选后为预览模式
   - **重试失败**: 勾选后重试上次失败条目
5. 点击「开始翻译」或「预览扫描」

### 方式 3: 通过完整管线的 `--translation-only` 模式

```bash
# 跳过所有前置流程，仅执行翻译
node tools/run_zotero_literature_filter.mjs --translation-only
```

此模式会绕过 Stage1(入库分级)、Stage2(Zotero写回)、Stage4(Excel导出)，仅触发独立翻译模块。

---

## 三、工作流程

```
CLI / Web UI / Orchestrator
        │
        ▼
  ┌─────────────────────────────┐
  │ 1. Zotero MCP 就绪检查      │
  │    (ensureZoteroMcpReady)   │
  └─────────┬───────────────────┘
            │ 通过
            ▼
  ┌─────────────────────────────┐
  │ 2. 扫描文献池/目标集合       │
  │    (scanItemsNeedingTranslation) │
  │    ├─ 遍历所有子集合条目     │
  │    ├─ 检查 shortTitle/title │
  │    │   (isTitleAlreadyChinese)  │
  │    ├─ 标题合法性校验         │
  │    │   (looksLikeTitle)      │
  │    └─ 源语言检测             │
  │       (detectSourceLanguage) │
  └─────────┬───────────────────┘
            │ 返回待翻译列表
            ▼
  ┌─────────────────────────────┐
  │ 3. 逐条调用翻译 API         │
  │    (translateOne → DeepSeek)│
  │    ├─ 调用翻译服务           │
  │    ├─ 翻译质量校验           │
  │    │   (validateTranslationQuality) │
  │    │   ├─ 非空检查           │
  │    │   ├─ 中文内容检查       │
  │    │   ├─ 与原文不重复检查   │
  │    │   └─ 归一化后不重复检查 │
  │    └─ 失败记录到 failures    │
  └─────────┬───────────────────┘
            │ 翻译成功
            ▼
  ┌─────────────────────────────┐
  │ 4. 写入 Zotero              │
  │    (write_metadata)         │
  │    ├─ shortTitle = 中文翻译  │
  │    └─ 原标题保持不变 (title) │
  └─────────┬───────────────────┘
            │ 完成
            ▼
  ┌─────────────────────────────┐
  │ 5. 生成运行报告              │
  │    ├─ standalone_translation │
  │    │   _report.json          │
  │    └─ standalone_translation │
  │        _failures.json        │
  └─────────────────────────────┘
```

---

## 四、输出文件说明

所有输出文件位于 `research_os/pipeline/` 目录下：

| 文件 | 说明 |
|------|------|
| `standalone_translation_report.json` | 本次运行完整报告，含扫描、翻译、回写、错误详情 |
| `standalone_translation_failures.json` | 失败条目列表（供 `--retry-failures` 使用） |

### 报告结构示例

```json
{
  "started_at": "2026-05-30T04:16:22.759Z",
  "dry_run": false,
  "limit": "unlimited",
  "retry_failures": false,
  "collection": "文献池",
  "scan": {
    "total_in_pool": 150,
    "candidates_found": 120,
    "skipped_already_chinese": 20,
    "skipped_invalid_title": 10
  },
  "translation": {
    "attempted": 120,
    "success": 118,
    "quality_failed": 1,
    "api_failed": 1
  },
  "writeback": {
    "attempted": 118,
    "success": 118,
    "failed": 0,
    "mcp_errors": []
  },
  "failures": [
    {
      "itemKey": "ABC123",
      "title": "...",
      "translated": "...",
      "reason": "translation_not_chinese",
      "stage": "quality_check"
    }
  ],
  "status": "completed_with_failures",
  "duration_ms": 45000
}
```

---

## 五、标题筛选逻辑详解

### 5.1 标题已有中文判断 (`isTitleAlreadyChinese`)

```
shortTitle 含中文? → 是 → 跳过（已有中文标题）
      ↓否
title 含中文? → 是 → 跳过
      ↓否
需要翻译
```

### 5.2 标题合法性校验 (`looksLikeTitle`)

| 拒绝条件 | 示例 |
|---------|------|
| 空字符串 | "" |
| 少于 4 字符 | "Hi" |
| 超过 600 字符 | 极长文本 |
| 看起来像 URL | "https://..." |
| 非标题文本 | "Abstract", "Table 1" |

### 5.3 翻译质量校验 (`validateTranslationQuality`)

| 拒绝条件 | 说明 |
|---------|------|
| 翻译为空 | API 返回空文本 |
| 翻译非中文 | 结果不含中文字符 |
| 与原文完全相同 | 翻译结果未做任何改变 |
| 归一化后雷同 | 去符号后与原文一致 |

### 5.4 源语言检测 (`detectSourceLanguage`)

- **检测范围**: 中文 (zh)、日文 (ja)、韩文 (ko)、英文 (en)、其他 (other)
- **英文判定**: 基于非拉丁字符比例，纯拉丁字符自动判定为 en

---

## 六、错误处理与重试

### 失败分类

| 失败类型 | stage 字段 | 处理方式 |
|---------|-----------|---------|
| API 调用失败 | `translation` | 记录到 failures，继续处理下一条 |
| 翻译质量不合格 | `quality_check` | 记录到 failures，继续处理下一条 |
| Zotero 写入失败 | `writeback` | 记录到 failures + mcp_errors |

### 重试机制

```bash
# 重试所有上次失败的条目
node tools/standalone_title_translation.mjs --retry-failures
```

重试时会从 `standalone_translation_failures.json` 读取失败记录，重新执行翻译和写入，但会跳过质量校验失败中明确无意义的条目。

### 幂等性

- 已翻译的条目不会重复翻译（`isTitleAlreadyChinese` 跳过）
- 失败条目不清除原有 shortTitle（无副作用）
- 报告覆盖写入（每次运行生成新报告）

---

## 七、与完整管线的兼容性

| 场景 | 行为 |
|------|------|
| 完整管线 (stage1→stage2→stage3→stage4) | Stage3 继续使用 `mcp_translation_backfill.mjs`，不变 |
| `--translation-only` 模式 | 跳过所有前置/后置流程，仅执行翻译 |
| 独立 CLI 调用 | 不依赖任何管线状态，独立运行 |
| Web UI 调用 | 通过 config_server 的 POST 端点触发 |

改造不影响原有管线的任何功能：Stage3 的翻译逻辑保持独立，`--translation-only` 仅添加了新入口，不修改原有执行路径。

---

## 八、快速参考

```bash
# 1. 预览（推荐先执行）
node tools/standalone_title_translation.mjs --dry-run --limit=20

# 2. 正式运行（处理全部）
node tools/standalone_title_translation.mjs

# 3. 查看报告
cat research_os/pipeline/standalone_translation_report.json | node -e "process.stdin.resume();process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"

# 4. 重试失败
node tools/standalone_title_translation.mjs --retry-failures

# 5. 通过 orchestrator 触发
node tools/run_zotero_literature_filter.mjs --translation-only

# 6. 运行测试
node tools/test_standalone_translation.mjs
```
