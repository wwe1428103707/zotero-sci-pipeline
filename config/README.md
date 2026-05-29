# 用户可编辑配置

这里集中放置用户可直接修改的配置、规则和参数。

- `rss_sources.json`: RSS 订阅源列表。
- `research_profile.json`: 顶层研究 profile，定义默认领域、分级标签、默认来源、triage 默认值和筛选标准模板。
- `crossref_search.json`: Crossref 检索配置，供 `crossref` 来源读取。
- `cnki_import.json`: CNKI 本地导入配置，声明待导入文件路径列表。
- `pubmed_pmc_search.json`: 数据库检索条件，当前沿用兼容文件名，默认 `days_back` 为 7。
- `workflow_rules.json`: 文献分级规则覆盖层；未显式填写的 triage 默认值会回退到 `research_profile.json`。
- `title_translation.config.json`: 标题翻译的非密钥参数。
- `preference_learning.config.json`: `screening_standards.docx` 中文评价理解的非密钥参数；密钥优先读 `PREFERENCE_LEARNING_API_KEY`，缺省回退到 `TITLE_TRANSLATION_API_KEY`。

长期筛选标准正文位于 `research_os/文献评价/screening_standards.md`。`screening_standards.docx` 是人工入口，包含偏好规则、检索关键词和评价三部分。
