import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function configPath(root, name) {
  return path.join(root || repoRoot(), "config", name);
}

function readJsonConfig(filePath, fallback) {
  if (!fs.existsSync(filePath)) return { config: fallback, path: filePath, warnings: ["config_missing_using_default"] };
  try {
    return { config: JSON.parse(fs.readFileSync(filePath, "utf8")), path: filePath, warnings: [] };
  } catch (error) {
    throw new Error(`CONFIG_PARSE_ERROR ${filePath}: ${error.message}`);
  }
}

function defaultTriageDefaults() {
  return {
    version: "2026-05-21-v2",
    labels: { A: "A核心相关", B: "B主题相关", C: "C背景相关", D: "D低相关" },
    source_labels: { rss: "RSS", pubmed: "PubMed", pmc: "PMC", crossref: "Crossref", cnki_import: "CNKI Import", arxiv: "arXiv", semantic_scholar: "Semantic Scholar", dblp: "DBLP", other: "other" },
    terms: {
      pollutant: ["fault diagnosis", "condition monitoring", "predictive maintenance", "optimization", "optimal control", "control", "scheduling", "detection", "estimation", "simulation", "modeling"],
      core_topic: ["bearing", "rotating machinery", "gearbox", "sensor fusion", "digital twin", "finite element", "manufacturing", "robot", "energy management", "structural health monitoring"],
      mechanism: ["benchmark", "validation", "experiment", "ablation", "prototype", "field test", "comparative study", "error analysis", "controller", "algorithm", "model"],
    },
    journal_whitelist: ["ieee transactions on industrial electronics", "ieee transactions on industrial informatics", "mechanical systems and signal processing", "reliability engineering & system safety", "engineering applications of artificial intelligence", "control engineering practice", "applied energy", "journal of manufacturing systems", "composite structures", "automation in construction"],
    weights: { pollutant: 1.6, core_topic: 1.5, mechanism: 0.7, journal_quality: 1.2, feedback_positive: 0.6, feedback_negative: -1.0 },
    thresholds: { A_score: 6.0, A_min_pollutant_hits: 2, A_min_core_hits: 2, B_score: 3.4, C_score: 1.4, B_uncertain_below: 4.2, C_uncertain_below: 2.3 },
    grade_reasons: { A: "直接命中当前核心工程问题、关键对象与方法验证信号。", B: "与当前主题或邻近应用明显相关，可作为方法、数据或场景参考。", C: "与所在研究背景相关，但距离当前核心问题较远，低优先级保留。", D: "与当前研究目标相关性不足，仅保留审计记录。" },
  };
}

function configDir(root) {
  return path.join(root || repoRoot(), "config");
}

function normalizeSourceList(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean)));
}

function resolveConfigRelativePath(root, value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (path.isAbsolute(raw)) return raw;
  return path.join(configDir(root), raw);
}

export function loadCrossrefSearchConfig({ root, now = new Date() } = {}) {
  const filePath = configPath(root, "crossref_search.json");
  const profile = loadResearchProfile({ root }).config;
  const daysBack = Math.max(1, Number(process.env.CROSSREF_DAYS_BACK || 30) || 30);
  const dateRange = buildDateRangeFromDaysBack(now, daysBack);
  const fallback = {
    enabled: profile.default_sources?.includes("crossref"),
    query: profile.domain === "engineering" ? "engineering" : "",
    rows: 100,
    sort: "published",
    order: "desc",
    filter: {
      from_pub_date: dateRange.minDate.replaceAll("/", "-"),
      until_pub_date: dateRange.maxDate.replaceAll("/", "-"),
      type: "journal-article",
    },
    select: ["DOI", "title", "URL", "abstract", "published-print", "published-online", "container-title", "author"],
  };
  const loaded = readJsonConfig(filePath, fallback);
  const config = loaded.config || {};
  return {
    path: loaded.path,
    enabled: config.enabled !== false,
    query: String(config.query ?? fallback.query).trim(),
    rows: safePositiveInteger(config.rows, fallback.rows, loaded.warnings, "crossref_rows"),
    sort: String(config.sort || fallback.sort).trim() || fallback.sort,
    order: String(config.order || fallback.order).trim() || fallback.order,
    filter: {
      ...fallback.filter,
      ...(config.filter || {}),
    },
    select: Array.isArray(config.select) && config.select.length ? config.select : fallback.select,
    warnings: loaded.warnings,
  };
}

export function buildCrossrefWorksUrl(cfg = {}) {
  const params = new URLSearchParams();
  params.set("rows", String(cfg.rows || 100));
  if (cfg.query) params.set("query.bibliographic", cfg.query);
  if (cfg.sort) params.set("sort", cfg.sort);
  if (cfg.order) params.set("order", cfg.order);
  if (Array.isArray(cfg.select) && cfg.select.length) params.set("select", cfg.select.join(","));
  const filters = [];
  if (cfg.filter?.from_pub_date) filters.push(`from-pub-date:${cfg.filter.from_pub_date}`);
  if (cfg.filter?.until_pub_date) filters.push(`until-pub-date:${cfg.filter.until_pub_date}`);
  if (cfg.filter?.type) filters.push(`type:${cfg.filter.type}`);
  if (filters.length) params.set("filter", filters.join(","));
  return `https://api.crossref.org/works?${params.toString()}`;
}

export function loadCnkiImportConfig({ root } = {}) {
  const filePath = configPath(root, "cnki_import.json");
  const profile = loadResearchProfile({ root }).config;
  const fallback = {
    enabled: profile.default_sources?.includes("cnki_import"),
    paths: ["imports/cnki_import.csv"],
    format_hint: "auto",
  };
  const loaded = readJsonConfig(filePath, fallback);
  const config = loaded.config || {};
  return {
    path: loaded.path,
    enabled: config.enabled !== false,
    format_hint: String(config.format_hint || fallback.format_hint),
    paths: (Array.isArray(config.paths) ? config.paths : fallback.paths)
      .map((entry) => resolveConfigRelativePath(root, entry))
      .filter(Boolean),
    warnings: loaded.warnings,
  };
}

export function loadDatabaseSourcesConfig({ root } = {}) {
  const filePath = configPath(root, "database_sources.json");
  const fallback = {
    version: 2,
    sources: {
      arxiv: { enabled: false, max_results: 100, days_back: 30, keyword_groups: { required: [], optional: [], negative: [] } },
      semantic_scholar: { enabled: false, limit: 100, days_back: 30, keyword_groups: { required: [], optional: [], negative: [] } },
      dblp: { enabled: false, hits_per_page: 100, days_back: 30, keyword_groups: { required: [], optional: [], negative: [] } },
    },
  };
  const { config, path: resolvedPath, warnings } = readJsonConfig(filePath, fallback);
  return { path: resolvedPath, sources: config.sources || {}, warnings };
}

function buildKeywordQueryString(keywordGroups = {}) {
  const normalized = normalizePubMedKeywordGroups(keywordGroups);
  const parts = normalized.required
    .filter((group) => group.length)
    .map((group) => `(${group.map((t) => `"${t}"`).join(" OR ")})`);
  if (normalized.optional.length) parts.push(`(${normalized.optional.map((t) => `"${t}"`).join(" OR ")})`);
  return parts.join(" AND ");
}

export function buildArxivUrl(cfg = {}) {
  const kw = cfg.keyword_groups || {};
  const query = String(cfg.query || buildKeywordQueryString(kw)).trim();
  if (!query) return "";
  const maxResults = Math.min(Math.max(1, Number(cfg.max_results) || 100), 500);
  const params = new URLSearchParams({
    search_query: `all:${query}`,
    start: "0",
    max_results: String(maxResults),
    sortBy: cfg.sort_by || "submittedDate",
    sortOrder: cfg.sort_order || "descending",
  });
  return `https://export.arxiv.org/api/query?${params.toString()}`;
}

export function buildSemanticScholarUrl(cfg = {}) {
  const kw = cfg.keyword_groups || {};
  const query = String(cfg.query || buildKeywordQueryString(kw)).trim();
  if (!query) return "";
  const limit = Math.min(Math.max(1, Number(cfg.limit) || 100), 500);
  const fields = (cfg.fields || ["title", "abstract", "externalIds", "venue", "publicationDate", "url", "authors"]).join(",");
  return `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`;
}

export function buildDblpUrl(cfg = {}) {
  const kw = cfg.keyword_groups || {};
  const query = String(cfg.query || buildKeywordQueryString(kw)).trim();
  if (!query) return "";
  const hpp = Math.min(Math.max(1, Number(cfg.hits_per_page) || 100), 500);
  return `https://dblp.org/search/publ/api?q=${encodeURIComponent(query)}&h=${hpp}&format=json`;
}

export function loadSourcePlan({ root, now = new Date() } = {}) {
  const profile = loadResearchProfile({ root }).config;
  const requested = normalizeSourceList(profile.default_sources || ["rss", "pubmed"]);
  const rss = loadRssSources({ root });
  const pubmed = loadPubMedPmcSearchConfig({ root, now });
  const crossref = loadCrossrefSearchConfig({ root, now });
  const cnkiImport = loadCnkiImportConfig({ root });
  const dbUnified = loadDatabaseSourcesConfig({ root });
  const arxivCfg = dbUnified.sources.arxiv || {};
  const semanticScholarCfg = dbUnified.sources.semantic_scholar || {};
  const dblpCfg = dbUnified.sources.dblp || {};
  const active = requested.filter((source) => {
    if (source === "rss") return true;
    if (source === "pubmed" || source === "pmc" || source === "database") return true;
    if (source === "crossref") return crossref.enabled;
    if (source === "cnki_import") return cnkiImport.enabled;
    if (source === "arxiv") return arxivCfg.enabled !== false;
    if (source === "semantic_scholar") return semanticScholarCfg.enabled !== false;
    if (source === "dblp") return dblpCfg.enabled !== false;
    return false;
  });
  return {
    profile,
    active_sources: active,
    rss: { ...rss, enabled: active.includes("rss") },
    pubmed: { ...pubmed, enabled: active.includes("pubmed") || active.includes("pmc") || active.includes("database") },
    crossref,
    cnki_import: cnkiImport,
    arxiv: {
      enabled: active.includes("arxiv"),
      max_results: Math.min(Math.max(1, Number(arxivCfg.max_results) || 100), 500),
      days_back: Math.max(1, Number(arxivCfg.days_back) || arxivCfg.days_back || 30),
      sort_by: String(arxivCfg.sort_by || "submittedDate"),
      sort_order: String(arxivCfg.sort_order || "descending"),
      query: String(arxivCfg.query || "").trim(),
      keyword_groups: arxivCfg.keyword_groups || { required: [], optional: [], negative: [] },
    },
    semantic_scholar: {
      enabled: active.includes("semantic_scholar"),
      limit: Math.min(Math.max(1, Number(semanticScholarCfg.limit) || 100), 500),
      days_back: Math.max(1, Number(semanticScholarCfg.days_back) || semanticScholarCfg.days_back || 30),
      query: String(semanticScholarCfg.query || "").trim(),
      keyword_groups: semanticScholarCfg.keyword_groups || { required: [], optional: [], negative: [] },
      fields: Array.isArray(semanticScholarCfg.fields) && semanticScholarCfg.fields.length
        ? semanticScholarCfg.fields
        : ["title", "abstract", "externalIds", "venue", "publicationDate", "url", "authors"],
    },
    dblp: {
      enabled: active.includes("dblp"),
      hits_per_page: Math.min(Math.max(1, Number(dblpCfg.hits_per_page) || 100), 500),
      days_back: Math.max(1, Number(dblpCfg.days_back) || dblpCfg.days_back || 30),
      query: String(dblpCfg.query || "").trim(),
      keyword_groups: dblpCfg.keyword_groups || { required: [], optional: [], negative: [] },
    },
  };
}

function parseDelimitedLine(line, delimiter = ",") {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values.map((entry) => entry.trim());
}

function pickField(record, names) {
  for (const name of names) {
    const value = record[name];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizeCnkiRecord(record = {}) {
  const title = pickField(record, ["Title", "title", "篇名", "标题"]);
  if (!title) return null;
  return {
    source_channel: "cnki_import",
    source_platform: "cnki_import",
    item_type_hint: "journalArticle",
    title,
    abstract: pickField(record, ["Abstract", "abstract", "摘要"]),
    keywords: pickField(record, ["Keywords", "keywords", "关键词"]),
    journal: pickField(record, ["Journal", "journal", "刊名", "来源"]),
    year: pickField(record, ["Year", "year", "发表时间", "出版年"]),
    url: pickField(record, ["URL", "url", "链接"]),
    doi: pickField(record, ["DOI", "doi"]),
  };
}

function parseCnkiCsv(text = "") {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = parseDelimitedLine(lines[0], delimiter);
  return lines.slice(1).map((line) => {
    const cols = parseDelimitedLine(line, delimiter);
    return headers.reduce((acc, header, index) => {
      acc[header] = cols[index] ?? "";
      return acc;
    }, {});
  });
}

export async function readCnkiImportItems({ root, config } = {}) {
  const cfg = config || loadCnkiImportConfig({ root });
  if (!cfg.enabled) return [];
  const items = [];
  for (const filePath of cfg.paths) {
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf8");
    const ext = path.extname(filePath).toLowerCase();
    let records = [];
    if (ext === ".json") {
      const parsed = JSON.parse(raw);
      records = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
    } else {
      records = parseCnkiCsv(raw);
    }
    for (const record of records) {
      const normalized = normalizeCnkiRecord(record);
      if (normalized) items.push(normalized);
    }
  }
  return items;
}

function mergeObject(base = {}, override = {}) {
  return { ...base, ...(override || {}) };
}

function buildTriageDefaultsFromProfile(profile = {}) {
  const base = defaultTriageDefaults();
  const triageDefaults = profile?.triage_defaults || {};
  return {
    ...base,
    ...triageDefaults,
    labels: mergeObject(base.labels, mergeObject(profile?.triage_labels, triageDefaults.labels)),
    source_labels: mergeObject(base.source_labels, triageDefaults.source_labels),
    terms: mergeObject(base.terms, triageDefaults.terms),
    weights: mergeObject(base.weights, triageDefaults.weights),
    thresholds: mergeObject(base.thresholds, triageDefaults.thresholds),
    grade_reasons: mergeObject(base.grade_reasons, triageDefaults.grade_reasons),
    journal_whitelist: Array.isArray(triageDefaults.journal_whitelist) && triageDefaults.journal_whitelist.length
      ? triageDefaults.journal_whitelist
      : base.journal_whitelist,
  };
}

export function loadResearchProfile({ root } = {}) {
  const filePath = configPath(root, "research_profile.json");
  const triageDefaults = defaultTriageDefaults();
  const fallback = {
    version: 1,
    profile_id: "engineering_general",
    domain: "engineering",
    default_sources: ["rss", "crossref", "cnki_import"],
    paper_type: "engineering_research_paper",
    language_mode: "zh_en_bilingual",
    citation_style: "ieee",
    output_profiles: ["sci_generic_engineering", "cnki_generic_academic"],
    bibliography_backend: "zotero_mcp",
    triage_labels: {
      A: "A核心相关",
      B: "B主题相关",
      C: "C背景相关",
      D: "D低相关",
    },
    triage_defaults: triageDefaults,
    screening_defaults: {
      overview: "当前优先关注与核心工程问题直接相关、具有方法创新、实验验证、仿真对照或工程落地价值的研究，并对缺乏验证、缺乏数据支撑或偏离当前研究边界的论文降权。",
      positive: [
        "优先关注与当前核心工程对象、系统或应用场景直接相关的研究。",
        "优先关注同时具备方法设计、实验验证、仿真对照、基准测试或消融分析的论文。",
        "优先关注故障诊断、状态监测、优化控制、建模仿真、传感融合、数字孪生、材料性能评估、制造过程优化等可复用的方法研究。",
        "优先关注给出公开数据集、明确评价指标、误差分析、对比实验或工程实现细节的论文。",
        "优先关注兼具理论分析和工程应用价值的研究，包括原型系统、样机实验、台架实验、现场测试或工业案例。",
      ],
      negative: [
        "降权只有概念描述、缺乏实验验证、缺乏对照组或评价指标不清晰的论文。",
        "降权仅做表面性能罗列、没有误差分析、参数解释或适用边界说明的论文。",
        "降权与当前研究对象距离较远的泛综述、资料汇编或没有明确技术结论的调研文献。",
        "降权只有单一仿真结果、没有实验或公开基准支撑的理论建模研究。",
        "降权数据规模过小、样本代表性不足、实验设置不完整或复现实验缺失的论文。",
      ],
      exclude: [
        "排除与当前研究主题完全无关、且无法提供方法借鉴或背景支持的论文。",
        "排除没有方法细节、没有数据支撑、没有实验结果或没有明确技术结论的内容。",
        "排除纯宣传、产品介绍、新闻稿、项目通告或无法形成学术证据链的材料。",
      ],
      uncertain: [
        "对只有仿真或理论推导、暂时缺乏实验验证的研究，需要结合方法质量进一步判断。",
        "对综述型论文，只有在其直接服务于当前研究背景、评价体系或方法比较时才保留较高优先级。",
        "对跨领域迁移研究，需要结合问题设置、数据条件和验证方式判断其可借鉴程度。",
        "对工具链、平台或数据集类论文，需要结合复现价值、适配难度和工程贡献判断优先级。",
      ],
      notes: [
        "不要因为论文属于方法类、仿真类或工具类就一概降权，关键要看验证质量和工程可用性。",
        "只要研究与当前工程对象、系统约束、评价指标或实现路径直接相关，就可以进入优先范围。",
        "对纯理论论文的降权仅适用于缺乏验证或缺乏可落地结论的场景，不应泛化到整个方向。",
        "对跨学科论文，应优先判断其是否能提供可迁移的方法、模型、指标或实验设计。",
        "如果论文给出了清晰的实验设计、误差分析、对比实验和边界条件，方法类研究通常值得保留。",
      ],
      writing_requirements: [
        "优先保留能直接支撑引言、相关工作、方法、实验、结果与结论章节写作的论文。",
        "优先保留图表、公式、实验设置、评价指标和误差分析信息完整的论文。",
        "记录可复用的术语、缩写、数据集名称、模型名称和评价指标，便于后续生成论文资产。",
      ],
      format_preferences: [
        "默认同时考虑 SCI 通用工科论文与 CNKI 学术论文写作需求，保留中英文题名、摘要和关键词素材。",
        "优先保留可生成 Markdown、DOCX、PDF 与 LaTeX 的结构化信息，如章节层级、图表题注和参考文献字段。",
        "对格式要求不明确的文献，至少保留题录、摘要、关键词、方法要点与实验结论摘要。",
      ],
    },
  };
  return readJsonConfig(filePath, fallback);
}

function enabled(entry) {
  return entry?.enabled !== false;
}

export function loadRssSources({ root } = {}) {
  const filePath = configPath(root, "rss_sources.json");
  const { config, path: resolvedPath, warnings } = readJsonConfig(filePath, { sources: [] });
  const rawSources = Array.isArray(config) ? config : Array.isArray(config.sources) ? config.sources : [];
  const sources = rawSources
    .map((entry) => typeof entry === "string" ? { url: entry, enabled: true } : entry)
    .filter((entry) => enabled(entry) && String(entry?.url || "").trim())
    .map((entry) => ({ name: String(entry.name || entry.url).trim(), url: String(entry.url).trim() }));
  return { path: resolvedPath, sources, warnings, raw_count: rawSources.length, enabled_count: sources.length };
}

function safePositiveInteger(value, fallback, warnings, field) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  warnings.push(`${field}_invalid_using_default_${fallback}`);
  return fallback;
}

function uniq(values) {
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
}

function normalizeRequiredGroups(value) {
  if (!Array.isArray(value)) return [];
  if (value.every((entry) => typeof entry === "string")) return [uniq(value)];
  return value
    .map((group) => uniq(Array.isArray(group) ? group : [group]))
    .filter((group) => group.length);
}

export function normalizePubMedKeywordGroups(value = {}) {
  return {
    required: normalizeRequiredGroups(value.required),
    optional: uniq(value.optional || []),
    negative: uniq(value.negative || []),
  };
}

function stripOuterParens(value) {
  let out = String(value || "").trim();
  while (out.startsWith("(") && out.endsWith(")")) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

export function parsePubMedQueryKeywordGroups(query = "") {
  const raw = String(query || "").trim();
  if (!raw) return normalizePubMedKeywordGroups();
  const notMatch = raw.match(/\s+NOT\s+\(([^)]*)\)\s*$/i);
  const negative = notMatch ? uniq(notMatch[1].split(/\s+OR\s+/i)) : [];
  const positiveRaw = notMatch ? raw.slice(0, notMatch.index).trim() : raw;
  const required = positiveRaw
    .split(/\s+AND\s+/i)
    .map((part) => uniq(stripOuterParens(part).split(/\s+OR\s+/i)))
    .filter((group) => group.length);
  return normalizePubMedKeywordGroups({ required, optional: [], negative });
}

export function buildPubMedQueryFromKeywordGroups(groups = {}) {
  const normalized = normalizePubMedKeywordGroups(groups);
  const positive = normalized.required
    .filter((group) => group.length)
    .map((group) => `(${group.join(" OR ")})`);
  const negative = normalized.negative.length ? `NOT (${normalized.negative.join(" OR ")})` : "";
  return [...positive, negative].filter(Boolean).join(" AND ").replace(/\s+AND\s+NOT\s+/i, " NOT ");
}

export function loadPubMedKeywordGroupsFromConfig(config = {}) {
  if (config.keyword_groups && typeof config.keyword_groups === "object") {
    return normalizePubMedKeywordGroups(config.keyword_groups);
  }
  return parsePubMedQueryKeywordGroups(config.query || "");
}

function removeTerms(groups, terms) {
  const removeSet = new Set(uniq(terms).map((term) => term.toLowerCase()));
  if (!removeSet.size) return groups;
  return {
    required: groups.required.map((group) => group.filter((term) => !removeSet.has(term.toLowerCase()))).filter((group) => group.length),
    optional: groups.optional.filter((term) => !removeSet.has(term.toLowerCase())),
    negative: groups.negative.filter((term) => !removeSet.has(term.toLowerCase())),
  };
}

export function applyKeywordModifications(groups = {}, modifications = {}) {
  let next = normalizePubMedKeywordGroups(groups);
  next = removeTerms(next, modifications.keywords_removed || []);
  const added = modifications.keywords_added || {};
  const requiredAdds = normalizeRequiredGroups(added.required || []);
  next.required = [...next.required, ...requiredAdds].map(uniq).filter((group) => group.length);
  next.optional = uniq([...next.optional, ...(Array.isArray(added.optional) ? added.optional : [])]);
  next.negative = uniq([
    ...next.negative,
    ...(Array.isArray(added.negative) ? added.negative : []),
    ...(Array.isArray(modifications.negative_keywords_added) ? modifications.negative_keywords_added : []),
  ]);
  return normalizePubMedKeywordGroups(next);
}

export function updatePubMedPmcKeywordGroups(filePath, modifications = {}) {
  const raw = readJsonConfig(filePath, {}).config;
  const beforeGroups = loadPubMedKeywordGroupsFromConfig(raw);
  const queryBefore = String(raw.query || buildPubMedQueryFromKeywordGroups(beforeGroups));
  const nextGroups = applyKeywordModifications(beforeGroups, modifications);
  const queryAfter = buildPubMedQueryFromKeywordGroups(nextGroups);
  const nextConfig = {
    ...raw,
    keyword_groups: nextGroups,
    query: queryAfter,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  return {
    config: nextConfig,
    keyword_groups_before: beforeGroups,
    keyword_groups_after: nextGroups,
    query_before: queryBefore,
    query_after: queryAfter,
  };
}

export function formatNcbiDate(date) {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

export function buildDateRangeFromDaysBack(now = new Date(), daysBack = 7) {
  const max = new Date(now);
  const min = new Date(now);
  min.setDate(max.getDate() - daysBack);
  return { minDate: formatNcbiDate(min), maxDate: formatNcbiDate(max) };
}

export function loadPubMedPmcSearchConfig({ root, now = new Date() } = {}) {
  const filePath = configPath(root, "pubmed_pmc_search.json");
  const fallback = {
    databases: ["pubmed"],
    days_back: 7,
    retmax: 300,
    sort: "date",
    datetype: "pdat",
    query: "(microplastic OR PFAS OR PM2.5 OR pollutant OR exposure) AND (neurotoxicity OR microglia OR neuroinflammation OR brain)",
  };
  const { config, path: resolvedPath, warnings } = readJsonConfig(filePath, fallback);
  const daysBack = safePositiveInteger(config.days_back, 7, warnings, "days_back");
  const retmax = safePositiveInteger(config.retmax, 300, warnings, "retmax");
  const databases = (Array.isArray(config.databases) ? config.databases : fallback.databases)
    .map((db) => String(db || "").trim().toLowerCase())
    .filter((db) => db === "pubmed" || db === "pmc");
  if (!databases.length) {
    warnings.push("databases_invalid_using_pubmed");
    databases.push("pubmed");
  }
  const keywordGroups = loadPubMedKeywordGroupsFromConfig(config);
  const query = String(config.query || buildPubMedQueryFromKeywordGroups(keywordGroups) || fallback.query).trim() || fallback.query;
  const dateRange = buildDateRangeFromDaysBack(now, daysBack);
  return {
    path: resolvedPath,
    databases,
    days_back: daysBack,
    retmax,
    sort: String(config.sort || fallback.sort),
    datetype: String(config.datetype || fallback.datetype),
    query,
    keyword_groups: keywordGroups,
    ...dateRange,
    warnings,
  };
}

export function buildNcbiESearchUrl(cfg, database = "pubmed") {
  const params = new URLSearchParams({
    db: database,
    retmode: "json",
    retmax: String(cfg.retmax || 300),
    sort: cfg.sort || "date",
    datetype: cfg.datetype || "pdat",
    mindate: cfg.minDate,
    maxdate: cfg.maxDate,
    term: cfg.query,
  });
  return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params.toString()}`;
}

export function loadWorkflowRules({ root } = {}) {
  const filePath = configPath(root, "workflow_rules.json");
  const profile = loadResearchProfile({ root }).config;
  const triageDefaults = buildTriageDefaultsFromProfile(profile);
  const fallback = { triage: triageDefaults };
  const loaded = readJsonConfig(filePath, fallback);
  const triage = loaded.config?.triage || {};
  return {
    ...loaded,
    config: {
      ...loaded.config,
      triage: {
        ...triageDefaults,
        ...triage,
        labels: mergeObject(triageDefaults.labels, triage.labels),
        source_labels: mergeObject(triageDefaults.source_labels, triage.source_labels),
        terms: mergeObject(triageDefaults.terms, triage.terms),
        weights: mergeObject(triageDefaults.weights, triage.weights),
        thresholds: mergeObject(triageDefaults.thresholds, triage.thresholds),
        grade_reasons: mergeObject(triageDefaults.grade_reasons, triage.grade_reasons),
        journal_whitelist: Array.isArray(triage.journal_whitelist) && triage.journal_whitelist.length
          ? triage.journal_whitelist
          : triageDefaults.journal_whitelist,
      },
    },
  };
}
