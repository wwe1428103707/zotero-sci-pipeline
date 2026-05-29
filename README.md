# zotero-sci-pipeline — 科研文献自动筛选管线

> 让 Zotero + AI 帮你自动发现、筛选、分级、整理文献，每天几分钟，告别手动翻期刊、筛标题。

---

## 🚀 一键执行

> 以下内容可直接复制给 AI Agent（如 Trae、Cursor、Claude Code 等），它会自动完成全部操作。

### 初次部署

把下面这段话复制给你的 AI Agent：

> 请帮我部署并运行 zotero-sci-pipeline。项目路径是 `[你的项目路径]`，比如 `D:\zotero-med-pipeline`。
>
> 步骤：
> 1. 检查我的 Node.js 版本（需要 ≥18）和 pwsh 版本（需要 ≥7.0）
> 2. 检查 `.env` 文件是否存在，如果不存在从 `.env.example` 复制
> 3. 检查 `config/database_sources.json` 和 `config/rss_sources.json` 是否有至少一个启用的源
> 4. 检查 `screening_standards.md` 是否存在，如果不存在则创建
> 5. 检查 Zotero 是否已开启（需要 Zotero 7 + Zotero MCP 插件）
> 6. 运行完整管线：`node tools/run_zotero_literature_filter.mjs`
> 7. 如果 Excel 导出失败，使用 `node tools/generate_daily_xlsx.mjs` 备用方案生成

### 日常运行

> 帮我运行 zotero-sci-pipeline。项目路径是 `[你的项目路径]`。
> 先确认 Zotero 已打开且 MCP 插件正常运行，然后执行完整管线。

### ✏️ 修改研究关键词

> 我的研究方向是「[填写你的研究方向]」。请帮我修改 zotero-sci-pipeline 的关键词配置，让文献筛选更符合我的需求。
>
> 需要修改的文件：
> - `config/database_sources.json` — 各个数据库的检索关键词
> - `config/workflow_rules.json` — A/B/C/D 分级关键词和期刊白名单
> - `screening_standards.md` — 筛选标准
>
> 我的研究方向是：____________

### 📡 自动发现并订阅该领域顶刊

系统支持从顶级期刊/会议的 RSS 栏目自动订阅最新论文。你只需要告诉 AI 你的研究方向，它会自动查找该领域有哪些顶刊并提供对应的 RSS 地址，直接写入配置。

> 我的研究方向是「[人工智能/计算机视觉/自然语言处理/...]」。请帮我完成以下工作：
>
> 1. 列出该领域全球排名前 20 的顶级期刊和会议（含影响因子/排名参考）
> 2. 逐一查询它们是否提供 RSS 订阅地址（英文期刊通常都有）
> 3. 把找到的 RSS 地址写入 `config/rss_sources.json`，格式如下：
>    ```json
>    {
>      "name": "期刊全称",
>      "url": "期刊的 RSS 地址",
>      "enabled": true
>    }
>    ```
> 4. 在 `config/database_sources.json` 中设置该领域专用检索关键词
> 5. 在 `screening_standards.md` 中写入该领域的筛选重点和阅读优先级
>
> 我的研究方向是：____________

系统会这样自动配置 RSS 订阅：

```
研究方向：人工智能
                                              ↓
AI 自动查询顶刊 → 发现 NeurIPS/CVPR/ICML/ICLR/TPAMI 等 20+ 期刊
                                              ↓
逐个获取 RSS 地址 → 写入 config/rss_sources.json
                                              ↓
设置检索关键词 + 分级期刊白名单 → 下次运行自动拉取
```

> 💡 **找不到 RSS 地址？** 大多数顶级期刊官网主页都有 RSS 图标（📶 或橙色 Wi-Fi 图标），右键复制链接即可。你可以在「配置网页」的 RSS 源页面直接添加。

### 启动配置网页

> 请帮我启动 zotero-sci-pipeline 的配置网页服务器，项目路径是 `[你的项目路径]`。
> 运行 `node tools/config_server.mjs` 然后打开浏览器访问显示的地址。

---

## 📖 这是什么？

一个自动化的**文献筛选助手**。它每天帮你做这些事：

1. **自动找文献** — 从 RSS 订阅、arXiv、Semantic Scholar、Crossref、PubMed 等多个来源拉取最新论文
2. **AI 自动分级** — 按你的研究方向把文献分为 A（核心相关）、B（专题相关）、C（背景相关）、D（无关）
3. **存入 Zotero** — 分级结果自动写入 Zotero，归类到每日文件夹
4. **翻译中文标题** — A/B/C 级文献的标题自动翻译成中文
5. **生成 Excel 报表** — 一份表格看清楚所有文献，可以直接在上面标反馈

**你只需要做三件事：**
- 配一次关键词（让 AI 帮你配，几分钟搞定）
- 看 Excel 报表标反馈（keep/drop，让系统越用越准）
- 把 PDF 拖进 Zotero 精读

---

## 🧩 能做什么 + 不能做什么

| ✅ 能做 | ❌ 不能做 |
|---------|----------|
| RSS 自动抓取最新论文 | 帮你下载 PDF（需要手动拖入 Zotero） |
| 多个数据库同时检索（arXiv、Crossref、Semantic Scholar 等） | 访问需要付费的数据库 |
| AI 按你的研究方向自动分级 | 替代你阅读论文（分级仅供参考） |
| 自动写入 Zotero 并分类 | 修改你的 Zotero 已有条目 |
| 自动翻译中文标题 | 翻译整篇论文 |
| 从你的反馈中学习偏好 | 理解你没有明确说出来的需求 |
| 导出带反馈列的 Excel 报表 | 替代正式的学术评审 |

---

## ⚡ 快速开始（5 分钟）

### 你需要的条件

| 条件 | 说明 | 怎么获得 |
|------|------|---------|
| **一台 Windows 电脑** | 本工具目前仅支持 Windows | 你正在用的就是 |
| **Node.js** | 运行脚本的环境 | 去 [nodejs.org](https://nodejs.org) 下载 LTS 版，安装后打开命令行输入 `node --version` 确认 |
| **PowerShell 7** | 脚本执行环境 | 去 [GitHub Releases](https://github.com/PowerShell/PowerShell/releases) 下载 `*-x64.msi` 安装，完成后输入 `pwsh --version` 确认 |
| **Zotero 7** | 文献管理器 | 去 [zotero.org](https://www.zotero.org/) 下载安装 |
| **Zotero MCP 插件** | 让 AI 能读写 Zotero | 去 [cookjohn/zotero-mcp](https://github.com/cookjohn/zotero-mcp) 看安装说明 |
| **AI Agent（可选）** | 帮你自动配置和运行 | Trae、Cursor、Claude Code 等均可 |

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

用记事本打开 `.env`，填入你的 API 密钥：

```ini
# 翻译 API 密钥（必填，否则不翻译标题）
TITLE_TRANSLATION_API_KEY=sk-your-api-key-here

# 偏好学习 API 密钥（可选，不填则用翻译 key 代替）
# PREFERENCE_LEARNING_API_KEY=sk-your-api-key-here
```

> 💡 **没有 API 密钥？** 先去 DeepSeek、OpenAI 或硅基流动等平台注册，获取一个 API Key。如果实在没有，管线也能跑，只是不翻译标题。

### 第 3 步：配置搜索源

**方式一：让 AI 帮你配（推荐）**

把这一段复制给你的 AI Agent：

> 请帮我配置 zotero-sci-pipeline 的搜索源。
>
> 1. 打开 `config/database_sources.json`，把 arxiv 的 `keyword_groups.required` 改成我的研究关键词
> 2. 打开 `config/rss_sources.json`，添加我关注的期刊 RSS
> 3. 打开 `config/workflow_rules.json`，修改 `terms` 部分的关键词
> 4. 打开 `screening_standards.md`，修改筛选规则
>
> 我的研究方向是：[填写你的研究方向]

**方式二：手动配置**

编辑 `config/database_sources.json`，找到你想用的数据库，修改 `keyword_groups`：

```json
{
  "arxiv": {
    "enabled": true,
    "max_results": 100,
    "keyword_groups": {
      "required": [
        ["关键词1", "关键词2"],
        ["关键词3", "关键词4"]
      ]
    }
  }
}
```

- `required` 里的每组用 **OR** 连接（含任意一个就算），组间用 **AND** 连接（必须每组都有）
- `negative` 里的关键词出现就排除

### 第 4 步：运行

**一键运行：** 把下面这段话复制给 AI Agent：

> 请运行 zotero-sci-pipeline。先确认 Zotero 已打开，Zotero MCP 插件运行正常，然后执行完整管线。

**或者手动运行：**

```bash
node tools/run_zotero_literature_filter.mjs
```

> ⚠️ **首次运行会报「文献池不存在」？** 正常，去 Zotero 里手动创建一个名为「文献池」的根级集合，然后重新运行。

### 第 5 步：看结果

运行完成后：
- 打开 `research_os/文献评价/` 目录，找到最新的 `隔日报.xlsx`
- 打开 Zotero，你会看到「文献池」集合下多了当天日期的文件夹，里面按 A/B/C 分类好了
- A 级文献标题已翻译成中文

---

## ⚙️ 配置文件一览

以下文件都在项目根目录或 `config/` 文件夹下。

### 必须关注的文件

| 文件 | 作用 | 怎么配 |
|------|------|--------|
| **`config/database_sources.json`** | 各数据库的开关和关键词 | 让 AI 帮你填研究方向关键词 |
| **`screening_standards.md`** | 筛选标准（决定 A/B/C/D 分级） | 写你的优先关注和排除规则 |
| **`config/workflow_rules.json`** | A/B/C/D 分级权重和阈值 | AI 自动生成，一般不用改 |
| **`.env`** | API 密钥等环境变量 | 复制 `.env.example` 后填入密钥 |

### 可选调整的文件

| 文件 | 作用 | 默认值 |
|------|------|--------|
| **`config/rss_sources.json`** | RSS 订阅源列表 | 空列表（需要自己加） |
| **`config/title_translation.config.json`** | 翻译参数 | 使用默认值即可 |
| **`config/preference_learning.config.json`** | 偏好学习参数 | 使用默认值即可 |

---

## 📁 项目结构（只需要关注这些）

```
zotero-sci-pipeline/
├── README.md                       ← 你正在看的文件
├── .env / .env.example            ← API 密钥（先复制再填）
├── screening_standards.md          ← 筛选标准（决定分级质量）
├── config/                         ← 配置文件都在这里
│   ├── database_sources.json       ← 各数据库的开关和关键词
│   ├── rss_sources.json            ← RSS 订阅源
│   ├── workflow_rules.json         ← 分级规则
│   └── ...其他配置（一般不用改）
├── tools/                          ← 脚本文件（一般不用打开）
│   ├── config_server.mjs           ← 配置网页服务器
│   ├── run_zotero_literature_filter.mjs  ← 主入口脚本
│   ├── run_research_os_pipeline.mjs      ← 内部流水线
│   └── generate_daily_xlsx.mjs     ← Excel 备用导出
└── research_os/                    ← 运行结果都在这里
    └── 文献评价/                    ← Excel 报表输出目录
```

---

## 🔄 日常工作流

### 每隔 2 天做什么

1. **运行管线** — 输入上面说的"一键运行"指令给 AI Agent
2. **打开 Excel** — 在 `research_os/文献评价/` 下找到最新的 `隔日报.xlsx`
3. **标反馈** — 在 Excel 的 `feedback` 列标 `keep`（保留）/ `drop`（移除）/ `upgrade`（升级）/ `downgrade`（降级）
4. **下次运行** — 系统会自动学习你的反馈，筛选越来越准

### 配置网页（可视化操作）

如果你不想编辑 JSON 文件，可以用配置网页：

```bash
node tools/config_server.mjs
```

然后打开浏览器访问 `http://localhost:3456`，所有配置都可以在网页上修改保存。

---

## 🗺️ 数据流

```
RSS 订阅 ──┐
            ├──→ 去重合并 → AI 分级(A/B/C/D) → 写回 Zotero → 翻译标题 → 导出 Excel
数据库检索 ──┘                              ↓
                                       你打开 Excel 标反馈
                                              ↓
                                       下次运行学习你的偏好
```

---

## 🔧 常见问题

### Q: 运行报错 "pwsh" 找不到？

PowerShell 7 没安装或没加到 PATH。去 [GitHub Releases](https://github.com/PowerShell/PowerShell/releases) 下载安装。安装后在命令行输入 `pwsh --version` 确认能看到版本号。

### Q: 运行报错 "文献池" 找不到？

去 Zotero 里手动创建一个名为「文献池」的根级集合（在大纲栏右键 → 新建集合）。或者让 AI Agent 帮你创建。

### Q: Excel 导出报错？

Stage 4 的 Excel 导出依赖 AI 工作区的内部工具。如果报错，管线本身已经完成（Stage 1-3 成功），可以用备用导出：

```bash
node tools/generate_daily_xlsx.mjs
```

### Q: 没有翻译 API 密钥？

如果暂时没有 API Key，管线跳过翻译步骤，Excel 里只显示英文标题，不影响其他功能。

### Q: 可以每天运行吗？

默认每 2 天运行一次。如果想强制运行，在 `.env` 里加一行：

```ini
FORCE_RESEARCH_OS_RUN=true
```

### Q: 我没用 PubMed，怎么关掉？

在 `config/database_sources.json` 里把 `pubmed` 和 `pmc` 的 `enabled` 设为 `false`，然后在 `config/research_profile.json` 的 `default_sources` 列表里删掉 `"pubmed"`。

### Q: 分级不准怎么办？

1. 检查 `screening_standards.md` 的规则是否覆盖了你的研究方向
2. 检查 `config/database_sources.json` 的关键词是否准确
3. 在 Excel 里标 feedback，系统会学习你的偏好
4. 直接编辑 `config/workflow_rules.json` 的关键词权重

---

## ⚠️ 学术使用提醒

- 仅供文献检索、资料整理和学术写作辅助
- **不替代**导师审核、同行评议或正式学术结论
- AI 分级结果仅供参考，最终判断请以人工复核为准
- 所有文献数据来自公开来源

---

## 📜 许可证

MIT License © 2026

详见 [LICENSE](LICENSE) 文件。

---

> 💡 **小贴士**：这个 README 里的所有「复制给 AI Agent」的段落，都可以直接粘贴到 Trae、Cursor、Claude Code 等 AI 编程工具中使用。它会自动理解并执行。
