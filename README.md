# zotero-sci-pipeline — 科研文献自动筛选管线

> 让 Zotero + AI 帮你自动发现、筛选、分级、整理文献，每天几分钟，告别手动翻期刊、筛标题。

---

## 🤖 AI Agent 快捷指令集

以下指令可直接复制给 AI 助手（Trae、Cursor、Claude Code、GitHub Copilot 等）。按使用场景分为四大类，不同使用层级的用户都能快速找到所需指令。

---

### 📋 基础操作指令

面向初次接触的用户，覆盖从部署到日常运行的核心操作。

**初次部署与运行**
> 请帮我部署并运行 zotero-sci-pipeline。项目路径是 `D:\zotero-med-pipeline`。
> 1. 检查 Node.js ≥18：`node --version`
> 2. 检查 pwsh ≥7.0：`pwsh --version`
> 3. 检查 .env 是否存在，没有则从 .env.example 复制
> 4. 编辑 config/database_sources.json 确认至少有一个检索源已启用
> 5. 确认 Zotero 已开启且已安装 Zotero MCP 插件
> 6. 运行完整管线：`node tools/run_zotero_literature_filter.mjs`

**日常运行管线**
> 帮我运行 zotero-sci-pipeline。确认 Zotero 已打开且 MCP 插件正常，然后执行完整管线。

**运行完整管线（含 PDF 自动下载）**
> 帮我运行完整管线，包含文献筛选、翻译、PDF 下载全套流程。项目路径 `D:\zotero-med-pipeline`，Zotero 已就绪。

**启动配置网页**
> 请帮我启动 zotero-sci-pipeline 的配置网页服务器。运行 `node tools/config_server.mjs`，然后访问 http://localhost:3456。

**查看运行结果**
> 帮我查看 zotero-sci-pipeline 的最新运行结果。打开 `research_os/文献评价` 目录，找到最新的 `隔日报.xlsx`。

---

### 🎯 进阶场景化指令

面向熟悉基础操作的用户，覆盖特定功能模块的精确调用。

**修改研究方向与搜索关键词**
> 我的研究方向是「[填写你的研究方向]」。请帮我修改 zotero-sci-pipeline 的关键词配置，同步更新以下文件：
> - `config/database_sources.json`（各数据库搜索关键词）
> - `config/workflow_rules.json`（A/B/C/D 分级权重）
> - `config/rss_sources.json`（RSS 订阅检索词）
> - `research_os/文献评价/screening_standards.md`（筛选标准文本）

**运行 PDF 自动下载**
> 帮我运行 PDF 下载模块，处理最新批次中 A 级论文，最多下载 5 篇：`node tools/paper_downloader.mjs --grade=A --limit=5`
>
> 更多参数：`--grade=B`（B 级）、`--grade=A+B`（A+B 级）、`--grade=A+B+C`（全部）、`--dry-run`（预览不下载）、`--scihub=https://sci-hub.se`（指定镜像）

**独立运行标题翻译**
> 帮我运行标题翻译模块，默认处理最新批次：`node tools/standalone_title_translation.mjs --limit=30`
>
> 预览模式：`node tools/standalone_title_translation.mjs --dry-run`
> 重试失败条目：`node tools/standalone_title_translation.mjs --retry-failures`

**配置网络代理**
> 请帮我配置 zotero-sci-pipeline 的网络代理。打开配置网页 http://localhost:3456，进入「代理设置」页面填写代理信息。支持 HTTP/HTTPS/SOCKS5 协议及用户名密码认证。或手动编辑 `config/proxy.config.json`。

**选择 Zotero 目标集合**
> 打开配置网页 http://localhost:3456，在翻译或下载页面点击「浏览 Zotero 目录」，从树状列表中选择要处理的目标集合。默认为最新日期批次。

**生成双周报**
> 帮我生成 zotero-sci-pipeline 的双周趋势分析报表。确认 Zotero 已打开，运行完整管线（系统自动判断间隔，满 14 天生成双周报）。

**历史反馈归档**
> 执行历史反馈归档预览（不实际移动）：`node tools/archive_history_by_feedback.mjs`
> 确认无误后实际执行：`node tools/archive_history_by_feedback.mjs --apply`

**执行分级修正**
> 帮我修正 zotero-sci-pipeline 的历史分级。运行：`node tools/zotero_feedback_collection_corrections.mjs`（需要已标注 feedback 的工作簿数据）

**运行测试套件**
> 帮我运行 zotero-sci-pipeline 的模块测试：`node tools/test_paper_downloader.mjs` 和 `node tools/test_standalone_translation.mjs`

---

### ⚠️ 异常处理指令

面向遇到运行错误的用户，覆盖常见故障的排查与恢复。

**MCP 连接失败**
> zotero-sci-pipeline 报 Zotero MCP 连接失败。请检查：
> 1. Zotero 是否已打开
> 2. 工具 → Zotero MCP 是否已启动（显示「MCP 服务器运行中」）
> 3. 如果仍未解决，重启 Zotero 后再运行

**文献池不存在**
> 运行时报「文献池不存在」。请在 Zotero 大纲栏右键 → 新建集合，命名为「文献池」，然后重新运行管线。

**PDF 下载扫描结果为空**
> PDF 下载时报 `no_items_in_zotero_matching_grade`。请先运行一次完整管线将论文写入 Zotero，或在配置网页下载页面选择其他 Zotero 集合。

**翻译失败**
> 翻译报错，请逐一排查：
> 1. 检查 `.env` 中 `TITLE_TRANSLATION_API_KEY` 是否正确填写
> 2. 如需代理，在配置网页开启代理设置
> 3. 检查 `config/title_translation.config.json` 中的模型名称
> 4. 重试失败条目：`node tools/standalone_title_translation.mjs --retry-failures`

**分级不准确**
> 分级结果与预期不符。请按以下顺序排查：
> 1. 检查筛选标准：编辑 `research_os/文献评价/screening_standards.md`
> 2. 在最新 `隔日报.xlsx` 的 `feedback` 列标注 keep/drop/upgrade/downgrade
> 3. 检查 `config/database_sources.json` 的关键词是否覆盖研究方向
> 4. 编辑 `config/workflow_rules.json` 调整各等级关键词权重

**Excel 导出失败**
> 隔日报.xlsx 导出失败。确认 Zotero 已打开，运行备用导出：`node tools/generate_daily_xlsx.mjs`

**PowerShell 找不到**
> 报错 `pwsh: command not found`。请安装 PowerShell 7：https://github.com/PowerShell/PowerShell/releases（下载 `*-x64.msi`），安装后确认 `pwsh --version` 正常。

**Node 版本不满足**
> Node.js 版本过低。请升级到 Node.js 18 LTS 或更新版本：https://nodejs.org（推荐 22 LTS）

---

### ⚡ 效率提升类定制指令

面向进阶用户，通过参数和配置实现个性化调优。

**强制立即运行（跳过间隔检查）**
> 帮我强制运行管线，跳过每 2 天的间隔检查。在 `.env` 中设置 `FORCE_RESEARCH_OS_RUN=true`，然后运行。
> 或一次性命令：`$env:FORCE_RESEARCH_OS_RUN="true"; node tools/run_zotero_literature_filter.mjs`

**切换 Sci-Hub 镜像**
> 使用指定 Sci-Hub 镜像下载 PDF：`node tools/paper_downloader.mjs --scihub=https://sci-hub.se --grade=A`
> 常用镜像地址：sci-hub.se、sci-hub.ru、sci-hub.st

**关闭特定数据库或检索源**
> 请帮我关闭 [PubMed/arXiv/Semantic Scholar/Crossref] 的检索。编辑 `config/database_sources.json`，将对应源的 `"enabled"` 设为 `false`。

**调整运行间隔**
> 将管线运行间隔改为 N 天。编辑 `.env`，设置 `RESEARCH_OS_RUN_INTERVAL_DAYS=N`。例如 1 为每天运行，3 为每 3 天运行一次。

**指定分级过滤**
> 只处理 A 和 B 级文献（跳过 C 级）：在配置网页的管线运行中选择分级过滤，或通过 `config/workflow_rules.json` 提高 C 级阈值。

**限定处理数量**
> 限制每次处理的条目数：
> - 检索上限：编辑 `config/database_sources.json` 中各源的 `max_results`
> - PDF 下载上限：`node tools/paper_downloader.mjs --limit=10`
> - 翻译上限：`node tools/standalone_title_translation.mjs --limit=50`

**切换翻译模型**
> 更换翻译模型。编辑 `config/title_translation.config.json` 中的 `model` 字段，或在 `.env` 中设置 `TITLE_TRANSLATION_MODEL=模型名称`。支持 DeepSeek、OpenAI、硅基流动等兼容 API。

---

## 📖 项目介绍

一个自动化的**文献筛选助手**，每天帮你完成这些事：

1. **自动找文献** — 从 RSS 订阅、arXiv、Semantic Scholar、Crossref、PubMed 等多个来源拉取最新论文
2. **AI 自动分级** — 按你的研究方向把文献分为 A（核心相关）、B（专题相关）、C（背景相关）、D（无关）
3. **存入 Zotero** — 分级结果自动写入 Zotero，归类到每日文件夹
4. **翻译中文标题** — A/B/C 级文献的标题自动翻译成中文
5. **PDF 自动下载** — 支持通过 Sci-Hub / arXiv 自动下载 PDF 并同步附件到 Zotero
6. **生成 Excel 报表** — 一份表格看清楚所有文献，可以直接在上面标反馈

**你只需要做三件事：**
- 配一次关键词（让 AI 帮你配，几分钟搞定）
- 看 Excel 报表标反馈（keep/drop，让系统越用越准）
- 把 PDF 拖进 Zotero 精读

### 能做什么 + 不能做什么

| ✅ 能做 | ❌ 不能做 |
|---------|----------|
| RSS 自动抓取最新论文 | 访问需要付费的数据库 |
| 多个数据库同时检索（arXiv、Crossref、Semantic Scholar、PubMed 等） | 直接下载付费墙后的 PDF |
| AI 按你的研究方向自动分级 | 替代你阅读论文（分级仅供参考） |
| 自动写入 Zotero 并分类 | 修改你的 Zotero 已有条目 |
| 自动翻译中文标题 | 翻译整篇论文 |
| 通过 Sci-Hub / arXiv 自动下载 PDF | 保证 100% 下载成功（部分论文需要手动获取） |
| 从你的反馈中学习偏好 | 理解你没有明确说出来的需求 |
| 导出带反馈列的 Excel 报表 | 替代正式的学术评审 |

### 数据流

```
RSS 订阅 ──┐
            ├──→ 去重合并 → AI 分级(A/B/C/D) → 写回 Zotero → 翻译标题 → 导出 Excel
数据库检索 ──┘                              ↓
                                       你打开 Excel 标反馈
                                              ↓
                                       下次运行学习你的偏好
```

---

## ⚙️ 环境依赖与版本要求

### 系统要求

| 依赖 | 最低版本 | 推荐版本 | 获取方式 |
|------|---------|---------|---------|
| **操作系统** | Windows 10 64-bit | Windows 11 | — |
| **Node.js** | 18 LTS | 22 LTS | [nodejs.org](https://nodejs.org) |
| **PowerShell** | 7.0.0 | 7.4+ | [GitHub Releases](https://github.com/PowerShell/PowerShell/releases) (`*-x64.msi`) |
| **Zotero** | 7.0 | 7.x | [zotero.org](https://www.zotero.org/) |
| **Zotero MCP 插件** | 最新版 | 最新版 | [cookjohn/zotero-mcp](https://github.com/cookjohn/zotero-mcp) |
| **翻译 API Key** | — | — | DeepSeek / OpenAI / 硅基流动等平台注册 |

### 版本确认命令

```bash
node --version      # 应输出 v18.x.x 或更高
pwsh --version      # 应输出 7.x.x（不能是 5.x）
```

---

## ⚡ 快速部署（10 分钟）

### 第 1 步：获取项目

```bash
git clone https://github.com/wwe1428103707/zotero-sci-pipeline.git
cd zotero-sci-pipeline
```

或者直接下载 ZIP 解压。

### 第 2 步：配置环境变量

```bash
copy .env.example .env
```

用记事本打开 `.env`，至少填入翻译 API 密钥：

```ini
TITLE_TRANSLATION_API_KEY=sk-your-api-key-here
```

其他可选配置（偏好学习、通知等）保持默认即可。

> 💡 **没有 API 密钥？** 推荐去 [DeepSeek](https://platform.deepseek.com/) 或 [硅基流动](https://cloud.siliconflow.cn/) 注册获取。如果实在没有，管线也能跑，只是不翻译标题、不做偏好学习。

### 第 3 步：配置搜索关键词

编辑 `config/database_sources.json`，找到 `keyword_groups.required`：

```json
{
  "arxiv": {
    "enabled": true,
    "max_results": 100,
    "keyword_groups": {
      "required": [
        ["deep learning", "transformer"],
        ["medical imaging"]
      ]
    }
  }
}
```

- `required` 每组内用 **OR** 连接（含任意一个就算），组间用 **AND** 连接（必须每组都有）
- `negative` 里的关键词出现就排除

> 💡 **让 AI 帮你配：** 把「我的研究方向是 [填写你的研究方向]，请帮我配置搜索关键词」告诉你的 AI 助手，它会自动修改 `database_sources.json`、`workflow_rules.json` 和 `screening_standards.md`。

### 第 4 步：运行管线

```bash
node tools/run_zotero_literature_filter.mjs
```

> ⚠️ **首次运行报错「文献池不存在」？** 去 Zotero 里手动创建一个名为「文献池」的根级集合（大纲栏右键 → 新建集合），然后重新运行。

### 第 5 步：查看结果

运行完成后：

- 打开 `research_os/文献评价/` 目录，找到最新的 `隔日报.xlsx`
- 打开 Zotero，你会看到「文献池」集合下多了当天日期的文件夹，里面按 A/B/C 分类好了
- A 级文献标题已翻译成中文

---

## 🔄 基础功能使用指南

### 日常工作流

每隔 2 天重复以下步骤：

```
运行管线 → 打开 Excel → 标反馈 → 下次运行自动学习
```

1. **运行管线**（参考上面第 4 步）
2. **打开 Excel** — `research_os/文献评价/` 下最新的 `隔日报.xlsx`
3. **标反馈** — 在 Excel 的 `feedback` 列填入方向：
   - `keep` — 保留当前分级
   - `drop` — 降低优先级
   - `upgrade` — 升级等级
   - `downgrade` — 降级等级
4. **下次运行** — 系统自动学习你的反馈，筛选越来越准

### 配置网页（可视化操作）

如果你不想编辑 JSON 文件，可以用配置网页：

```bash
node tools/config_server.mjs
```

然后浏览器访问 http://localhost:3456

网页上可以完成所有操作：
- 编辑所有配置文件（实时保存）
- 运行管线各阶段
- 运行 PDF 下载和标题翻译
- 配置网络代理
- 查看环境变量

### PDF 自动下载

通过 Sci-Hub 或 arXiv 自动下载已分级论文的 PDF 并同步附件到 Zotero。

```bash
# 预览模式：扫描候选论文，不实际下载
node tools/paper_downloader.mjs --dry-run --grade=A

# 实际下载（仅处理最新批次中 A 级论文，最多 5 篇）
node tools/paper_downloader.mjs --grade=A --limit=5
```

操作说明详见 [docs/paper_downloader_operation.md](docs/paper_downloader_operation.md)，或通过配置网页的「下载配置」页面操作。

### 独立标题翻译

单独运行翻译模块，不需要经过完整管线：

```bash
# 预览模式
node tools/standalone_title_translation.mjs --dry-run

# 实际翻译（默认处理最新批次，最多 30 篇）
node tools/standalone_title_translation.mjs --limit=30
```

操作说明详见 [docs/standalone_translation_operation.md](docs/standalone_translation_operation.md)，或通过配置网页的「下载配置」页面操作。

---

## ⚙️ 高级配置

### 文件与配置一览

```
zotero-sci-pipeline/
├── .env                        ← API 密钥、翻译/通知等环境变量
├── screening_standards.md       ← 筛选标准（决定 A/B/C/D 分级质量）
│
├── config/                      ← 所有配置文件
│   ├── database_sources.json    ← 各数据库的开关和关键词（必配）
│   ├── rss_sources.json         ← RSS 订阅源（可选，按需添加）
│   ├── workflow_rules.json      ← A/B/C/D 分级权重和阈值（AI 自动生成）
│   ├── research_profile.json    ← 研究画像（自动维护）
│   ├── title_translation.config.json  ← 翻译参数
│   ├── preference_learning.config.json ← 偏好学习参数
│   ├── crossref_search.json     ← Crossref 检索配置
│   ├── pubmed_pmc_search.json   ← PubMed/PMC 检索配置
│   ├── pdf_download.config.json ← PDF 下载参数
│   ├── proxy.config.json        ← 网络代理配置（含密码，已 .gitignore）
│   └── cnki_import.json         ← 知网导入配置
│
├── tools/                       ← 脚本文件
│   ├── run_zotero_literature_filter.mjs  ← 主入口脚本
│   ├── run_research_os_pipeline.mjs      ← 内部流水线调度
│   ├── config_server.mjs        ← 配置网页服务器
│   ├── paper_downloader.mjs     ← PDF 自动下载模块
│   ├── standalone_title_translation.mjs  ← 独立标题翻译模块
│   ├── generate_daily_xlsx.mjs  ← Excel 备用导出
│   ├── mcp_bulk_writeback.mjs   ← Zotero 批量写回
│   ├── mcp_translation_backfill.mjs ← 翻译回填
│   ├── check_zotero_mcp_ready.mjs  ← MCP 就绪检查
│   ├── archive_history_by_feedback.mjs ← 历史反馈归档
│   ├── zotero_feedback_collection_corrections.mjs ← 分级修正
│   └── test_*.mjs              ← 测试脚本
│
├── research_os/                 ← 运行结果
│   └── 文献评价/                ← Excel 报表输出目录
│       └── YYYY-MM-DD/
│           └── 隔日报.xlsx
│
└── docs/                        ← 操作文档
    ├── paper_downloader_operation.md
    ├── standalone_translation_operation.md
    └── test_report.md
```

### 网络代理配置

当 Sci-Hub 下载、翻译 API 或外部检索需要代理时，可通过配置网页的「代理设置」页面配置。

支持 HTTP / HTTPS / SOCKS5 / SOCKS5h 协议，可填写用户名和密码认证。启用后，所有外部 HTTP 请求（Sci-Hub、arXiv、LLM API、Webhook 通知等）自动走代理，本地请求（Zotero MCP、配置网页）自动绕过。

配置文件：`config/proxy.config.json`（含密码，已加入 .gitignore 不提交）。

```bash
# 命令行指定 Sci-Hub 镜像（不依赖代理配置）
node tools/paper_downloader.mjs --scihub=https://sci-hub.ru --dry-run
```

### 管线调度参数

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `FORCE_RESEARCH_OS_RUN` | `false` | 设为 `true` 强制跳过间隔检查立即运行 |
| `RESEARCH_OS_RUN_INTERVAL_DAYS` | `2` | 管线运行间隔天数 |
| `RESEARCH_OS_SYNTHESIS_INTERVAL_DAYS` | `14` | 双周报合成间隔 |

### 默认行为说明

- **翻译和下载默认仅处理最近一批次**（即最新日期集合，如 `2026-05-30`），不会扫描整个文献池
- 如需指定其他 Zotero 集合，可在配置网页的下载/翻译页面点击「浏览 Zotero 目录」按钮选择

---

## 🔧 常见问题排查

### 运行报错

| 问题 | 原因 | 解决方法 |
|------|------|---------|
| `pwsh` 找不到 | PowerShell 7 未安装或不在 PATH | 下载安装 [PowerShell 7](https://github.com/PowerShell/PowerShell/releases)，确认 `pwsh --version` 正常 |
| `文献池` 找不到 | Zotero 中缺少根集合 | 在 Zotero 大纲栏右键 → 新建集合，命名为「文献池」 |
| Zotero MCP 连接失败 | Zotero 未运行或 MCP 插件未启用 | 确认 Zotero 已打开，MCP 插件已安装并启动（Zotero 菜单 → 工具 → Zotero MCP） |
| `no_items_in_zotero_matching_grade` | PDF 下载时扫描不到分级论文 | 先运行一次完整管线写入 Zotero；或手动创建分级集合放入条目 |
| Excel 导出报错 | 导出工具依赖异常 | 管线已正常运行（Stage 1-3 成功），备用导出：`node tools/generate_daily_xlsx.mjs` |
| 翻译失败 | API Key 无效或网络不通 | 检查 `.env` 中的 `TITLE_TRANSLATION_API_KEY`；如需代理请开启代理设置 |

### 功能问题

| 问题 | 说明 |
|------|------|
| **没有 API 密钥能否用？** | 可以，管线跳过翻译步骤，其他功能正常。推荐注册 [DeepSeek](https://platform.deepseek.com/) 或 [硅基流动](https://cloud.siliconflow.cn/) |
| **能否每天运行？** | 默认每 2 天一次。在 `.env` 加 `FORCE_RESEARCH_OS_RUN=true` 可强制运行 |
| **分级不准？** | 1. 检查 `screening_standards.md` 的规则；2. 检查 `database_sources.json` 的关键词；3. 在 Excel 标 feedback 让系统学习；4. 编辑 `workflow_rules.json` 的关键词权重 |
| **如何关掉 PubMed？** | 在 `database_sources.json` 把 `pubmed` 和 `pmc` 的 `enabled` 设为 `false` |
| **PDF 下载失败？** | 尝试更换 Sci-Hub 镜像（`--scihub=https://sci-hub.ru`）；arXiv 论文会优先从 arXiv 下载 |
| **如何切换 Sci-Hub 镜像？** | 配置网页的下载页面可直接修改；CLI 用 `--scihub=URL` 参数 |

---

## 📜 许可证与维护

### 开源协议

MIT License © 2026. 详见 [LICENSE](LICENSE) 文件。

### 项目维护

- **维护者**: [@wwe1428103707](https://github.com/wwe1428103707)
- **项目地址**: [github.com/wwe1428103707/zotero-sci-pipeline](https://github.com/wwe1428103707/zotero-sci-pipeline)
- **问题反馈**: 通过 GitHub Issues 提交

### 贡献指南

欢迎提交 Issue 和 Pull Request。提交前请确保：

1. 运行 `node --check` 语法检查通过所有 `.mjs` 文件
2. 运行 `node tools/test_paper_downloader.mjs` 测试通过
3. 运行 `node tools/test_standalone_translation.mjs` 测试通过

### 学术使用提醒

- 仅供文献检索、资料整理和学术写作辅助
- **不替代**导师审核、同行评议或正式学术结论
- AI 分级结果仅供参考，最终判断请以人工复核为准
- 所有文献数据来自公开来源
