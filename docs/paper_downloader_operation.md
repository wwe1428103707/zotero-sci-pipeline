# PDF 自动下载模块 — 使用操作文档

## 功能简介

从 Zotero 文献库或已分级的 JSON 候选中筛选目标论文，自动通过 Sci-Hub 或 arXiv 下载 PDF，并将附件写回 Zotero 条目。支持预览模式、分级过滤、重试机制。

---

## 一、前置条件

### 1.1 环境要求

| 项目 | 要求 |
|------|------|
| Node.js | >= 18（原生 fetch 支持） |
| Zotero | 已运行，Zotero MCP 插件已启用 (Streamable HTTP) |
| 网络 | 可访问 Sci-Hub（默认 `https://sci-hub.st`）和 arXiv |

### 1.2 配置文件

**下载配置**: `config/pdf_download.config.json`

```json
{
  "sci_hub_base_url": "https://sci-hub.st",
  "arxiv_mirror": "https://arxiv.org",
  "sci_hub_timeout_ms": 30000,
  "arxiv_timeout_ms": 15000,
  "max_concurrent_downloads": 3,
  "download_dir": "downloads/pdf_temp",
  "grade_filter": "A",
  "skip_if_pdf_attached": true,
  "retry": {
    "max_retries": 2,
    "retry_delay_ms": 3000
  }
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `sci_hub_base_url` | string | `https://sci-hub.st` | Sci-Hub 镜像地址 |
| `arxiv_mirror` | string | `https://arxiv.org` | arXiv 镜像地址 |
| `sci_hub_timeout_ms` | number | 30000 | Sci-Hub 下载超时 (ms) |
| `arxiv_timeout_ms` | number | 15000 | arXiv 下载超时 (ms) |
| `max_concurrent_downloads` | number | 3 | 最大并发数（当前串行实现） |
| `download_dir` | string | `downloads/pdf_temp` | PDF 临时存储目录 |
| `grade_filter` | string | `A` | 分级过滤（逗号分隔，如 `A,B`） |
| `skip_if_pdf_attached` | boolean | true | 跳过已有 PDF 附件的条目 |
| `retry.max_retries` | number | 2 | 下载失败最大重试次数 |
| `retry.retry_delay_ms` | number | 3000 | 重试间隔 (ms) |

---

## 二、三种触发方式

### 方式 1: CLI 命令行

```bash
# 预览模式：扫描候选，不实际下载
node tools/paper_downloader.mjs --dry-run

# 限制候选数（如只处理前 5 篇）
node tools/paper_downloader.mjs --dry-run --limit=5

# 指定分级过滤（A 级和 B 级）
node tools/paper_downloader.mjs --grade=A,B

# 使用本地分级 JSON（跳过 Zotero MCP 扫描）
node tools/paper_downloader.mjs --use-triaged --dry-run

# 指定 Sci-Hub 镜像
node tools/paper_downloader.mjs --dry-run --scihub=https://sci-hub.ru
```

**可用参数**:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--dry-run` | flag | false | 预览模式，仅扫描不下载 |
| `--limit=N` | number | 0（不限） | 限制处理的条目数 |
| `--grade=X` | string | A | 分级过滤（逗号分隔） |
| `--scihub=URL` | string | 配置值 | 临时指定 Sci-Hub 镜像 |
| `--use-triaged` | flag | false | 使用本地 triaged_items.json |

### 方式 2: Web 配置界面

1. 启动配置网页服务器：`node tools/config_server.mjs`
2. 浏览器访问：http://localhost:3456
3. 左侧导航点击「下载配置」
4. 在「PDF 自动下载」区域设置参数：
   - **分级过滤**: 默认为 A
   - **处理上限**: 默认为不限
   - **仅扫描**: 勾选后为预览模式
   - **使用本地分级**: 勾选后读取本地 triaged 数据
5. 点击「开始下载」或「预览扫描」

### 方式 3: 通过 API 接口

```bash
curl -X POST http://localhost:3456/api/download/papers \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true, "grade": "A", "limit": 5}'
```

**请求参数**:

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `dry_run` | boolean | false | 预览模式 |
| `grade` | string | A | 分级过滤 |
| `limit` | number | 0 | 处理上限 |

**成功响应示例**:

```json
{
  "ok": true,
  "report": {
    "status": "dry_run_completed",
    "candidates": { "found": 10, "with_doi": 8, "grade_matched": 5 },
    "download": { "attempted": 0, "success": 0, "failed": 0 },
    "dry_run_candidates": [
      { "itemKey": "ABC123", "title": "...", "doi": "10.xxxx/xxxxx", "grade": "A" }
    ]
  }
}
```

---

## 三、工作流程

```
CLI / Web UI / API
        │
        ▼
  ┌─────────────────────────────┐
  │ 1. Zotero MCP 就绪检查      │
  │    (ensureZoteroMcpReady)   │
  └─────────┬───────────────────┘
            │ 通过
            ▼
  ┌─────────────────────────────┐
  │ 2. 获取候选条目              │
  │    ├─ Zotero 扫描模式        │
  │    │   (findItemsByZoteroScan)  │
  │    │   ├─ 获取文献池集合树    │
  │    │   ├─ 按分级过滤子集合    │
  │    │   ├─ 检查已有 PDF 附件   │
  │    │   └─ 提取 DOI/标题      │
  │    └─ 本地 triaged 模式      │
  │        (findLatestTriagedItems) │
  └─────────┬───────────────────┘
            │ 返回候选列表
            ▼
  ┌─────────────────────────────┐
  │ 3. 逐篇下载 PDF              │
  │    (downloadPdf / downloadFile)│
  │    ├─ arXiv 优先（有 arXiv ID）│
  │    │   (downloadFromArxiv)   │
  │    ├─ Sci-Hub 备选/主路径     │
  │    │   (downloadFromSciHub)  │
  │    │   ├─ 解析 Sci-Hub HTML  │
  │    │   ├─ 提取 PDF 下载链接  │
  │    │   └─ 下载 PDF 内容      │
  │    ├─ 重试机制（最多 N 次）   │
  │    └─ 超时/验证码/空文件检测  │
  └─────────┬───────────────────┘
            │ 下载成功
            ▼
  ┌─────────────────────────────┐
  │ 4. 附件写回 Zotero           │
  │    (attachPdfToZotero)      │
  │    ├─ 方法1: MCP write_item  │
  │    │   (base64 内嵌)         │
  │    └─ 方法2: REST API 备选   │
  │       (FormData 上传)        │
  └─────────┬───────────────────┘
            │ 完成
            ▼
  ┌─────────────────────────────┐
  │ 5. 生成运行报告              │
  │    ├─ pipeline/              │
  │    │   pdf_download_report.json │
  │    └─ stdout JSON            │
  └─────────────────────────────┘
```

---

## 四、下载策略

### 4.1 DOI/arXiv ID 识别

- 优先检测 arXiv ID（匹配 `10.48550/arxiv.xxxx` 或标题中的 `arXiv:xxxx`）
- 有 arXiv ID 时优先从 arXiv 下载
- 有普通 DOI 时从 Sci-Hub 下载
- 两者皆无时跳过

### 4.2 Sci-Hub 下载流程

1. 请求 Sci-Hub HTML 页面（`{base_url}/{doi}`）
2. 从 HTML 解析 PDF 链接（`<embed>`, `<iframe>`, `<a>` 匹配）
3. 下载 PDF 并校验内容类型和大小（>=1000 字节）
4. 检测验证码拦截（`captcha` 关键字）

### 4.3 arXiv 下载

- 直接请求 `{mirror}/pdf/{arxiv_id}`
- 校验 Content-Type 是否为 PDF
- 检测 404 响应

### 4.4 容错策略

- 每个来源最多重试 N 次（配置 `retry.max_retries`）
- Sci-Hub 下载失败时，不会再回退到 arXiv（避免重复）
- 附件写回使用 MCP 优先、REST API 备选

---

## 五、输出文件

| 文件 | 说明 |
|------|------|
| `pipeline/pdf_download_report.json` | 完整运行报告 |
| `downloads/pdf_temp/*.pdf` | 下载的 PDF 临时文件（`skip_if_pdf_attached=false` 时保留） |

### 报告结构

```json
{
  "started_at": "2026-05-30T06:00:00.000Z",
  "dry_run": true,
  "config": {
    "sci_hub_base_url": "https://sci-hub.st",
    "grade_filter": ["A"],
    "max_concurrent": 3
  },
  "candidates": {
    "found": 10,
    "with_doi": 8,
    "grade_matched": 5
  },
  "download": {
    "attempted": 5,
    "success": 4,
    "failed": 1,
    "retried": 0
  },
  "attachment": {
    "attempted": 4,
    "success": 4,
    "failed": 0
  },
  "failures": [
    {
      "itemKey": "ABC123",
      "title": "Paper Title",
      "doi": "10.xxxx/xxxx",
      "reason": "pdf_url_not_found_in_scihub",
      "stage": "download"
    }
  ],
  "status": "completed_with_failures"
}
```

### 状态码说明

| 状态 | 说明 |
|------|------|
| `no_items_in_zotero_matching_grade` | Zotero 中无匹配分级条目 |
| `no_triaged_items_matching_grade` | 本地分级数据中无匹配条目 |
| `dry_run_completed` | 预览模式完成 |
| `completed` | 全部成功 |
| `completed_with_failures` | 部分条目失败 |
| `MCP_NOT_READY` | Zotero MCP 未就绪 |

### 失败原因

| 原因 | 说明 |
|------|------|
| `no_doi_or_arxiv_id` | 条目缺少 DOI 和 arXiv ID |
| `empty_doi` | DOI 为空 |
| `scihub_http_4xx/5xx` | Sci-Hub 返回错误状态码 |
| `pdf_url_not_found_in_scihub` | Sci-Hub 页面中未找到 PDF 链接 |
| `scihub_captcha_blocked` | Sci-Hub 触发验证码 |
| `pdf_too_small` | 下载文件小于 1000 字节 |
| `timeout` | 下载超时 |
| `arxiv_http_4xx` | arXiv 返回错误 |
| `arxiv_pdf_not_found` | arXiv 上未找到 PDF |
| `zotero_attach_failed` | 附件写回 Zotero 失败 |

---

## 六、常见问题

### Q: 下载队列中很多条目没有 DOI 怎么办？

A: 这些条目会被标记为 `no_doi_or_arxiv_id` 并跳过。建议先在 Zotero 中通过插件或手动补充 DOI 信息，或使用 `--use-triaged` 模式从本地分级数据中筛选（分级数据可能包含更完整的元数据）。

### Q: Sci-Hub 下载频繁超时或验证码拦截？

A: 尝试更换 Sci-Hub 镜像地址（如 `https://sci-hub.ru`）。可在配置文件中永久修改，或通过 `--scihub` 参数临时指定。

### Q: PDF 下载成功但附件写回失败？

A: 检查 Zotero MCP 是否正常运行。写回失败时 PDF 会保留在 `downloads/pdf_temp/` 目录，可通过 `localPath` 字段定位文件后手动导入 Zotero。

### Q: 如何避免重复下载已有附件的条目？

A: 配置文件中的 `skip_if_pdf_attached: true`（默认开启）会在扫描时跳过已有 PDF 附件的条目。
