import { loadResearchProfile, loadWorkflowRules } from "./literature_config.mjs";

import { readScreeningStandardsFileSync } from "./screening_standards_file.mjs";

const WORKFLOW_RULES = loadWorkflowRules().config;
const TRIAGE_RULES = WORKFLOW_RULES.triage || {};
const RESEARCH_PROFILE = loadResearchProfile().config;
const PROFILE_LABELS = RESEARCH_PROFILE.triage_labels || {};

export const TRIAGE_VERSION = TRIAGE_RULES.version || "2026-05-21-v2";

export const LABELS = {
  A: TRIAGE_RULES.labels?.A || PROFILE_LABELS.A || "A核心相关",
  B: TRIAGE_RULES.labels?.B || PROFILE_LABELS.B || "B主题相关",
  C: TRIAGE_RULES.labels?.C || PROFILE_LABELS.C || "C背景相关",
  D: TRIAGE_RULES.labels?.D || PROFILE_LABELS.D || "D低相关",
};

export const SOURCE_LABELS = {
  rss: TRIAGE_RULES.source_labels?.rss || "RSS",
  pubmed: TRIAGE_RULES.source_labels?.pubmed || "PubMed",
  pmc: TRIAGE_RULES.source_labels?.pmc || "PMC",
  crossref: TRIAGE_RULES.source_labels?.crossref || "Crossref",
  cnki_import: TRIAGE_RULES.source_labels?.cnki_import || "CNKI Import",
  arxiv: TRIAGE_RULES.source_labels?.arxiv || "arXiv",
  semantic_scholar: TRIAGE_RULES.source_labels?.semantic_scholar || "Semantic Scholar",
  dblp: TRIAGE_RULES.source_labels?.dblp || "DBLP",
  other: TRIAGE_RULES.source_labels?.other || "other",
};

const POLLUTANT_TERMS = TRIAGE_RULES.terms?.pollutant || [
  "fault diagnosis", "condition monitoring", "predictive maintenance", "optimization", "optimal control",
  "control", "scheduling", "detection", "estimation", "simulation", "modeling",
];
const CORE_TOPIC_TERMS = TRIAGE_RULES.terms?.core_topic || [
  "bearing", "rotating machinery", "gearbox", "sensor fusion", "digital twin",
  "finite element", "manufacturing", "robot", "energy management", "structural health monitoring",
];
const MECHANISM_TERMS = TRIAGE_RULES.terms?.mechanism || [
  "benchmark", "validation", "experiment", "ablation", "prototype", "field test",
  "comparative study", "error analysis", "controller", "algorithm", "model",
];
const JOURNAL_WHITELIST = new Set(TRIAGE_RULES.journal_whitelist || [
  "ieee transactions on industrial electronics",
  "ieee transactions on industrial informatics",
  "mechanical systems and signal processing",
  "reliability engineering & system safety",
  "engineering applications of artificial intelligence",
  "control engineering practice",
  "applied energy",
  "journal of manufacturing systems",
  "composite structures",
  "automation in construction",
]);
const WEIGHTS = {
  pollutant: Number(TRIAGE_RULES.weights?.pollutant ?? 1.6),
  core_topic: Number(TRIAGE_RULES.weights?.core_topic ?? 1.5),
  mechanism: Number(TRIAGE_RULES.weights?.mechanism ?? 0.7),
  journal_quality: Number(TRIAGE_RULES.weights?.journal_quality ?? 1.2),
  feedback_positive: Number(TRIAGE_RULES.weights?.feedback_positive ?? 0.6),
  feedback_negative: Number(TRIAGE_RULES.weights?.feedback_negative ?? -1.0),
};
const THRESHOLDS = {
  A_score: Number(TRIAGE_RULES.thresholds?.A_score ?? 6.0),
  A_min_pollutant_hits: Number(TRIAGE_RULES.thresholds?.A_min_pollutant_hits ?? 2),
  A_min_core_hits: Number(TRIAGE_RULES.thresholds?.A_min_core_hits ?? 2),
  B_score: Number(TRIAGE_RULES.thresholds?.B_score ?? 3.4),
  C_score: Number(TRIAGE_RULES.thresholds?.C_score ?? 1.4),
  B_uncertain_below: Number(TRIAGE_RULES.thresholds?.B_uncertain_below ?? 4.2),
  C_uncertain_below: Number(TRIAGE_RULES.thresholds?.C_uncertain_below ?? 2.3),
};
const GRADE_REASONS = TRIAGE_RULES.grade_reasons || {};

function cleanText(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normTitle(t) {
  return cleanText(t)
    .normalize("NFKC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
}

function normalizeIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

function countHits(text, terms) {
  return terms.filter((term) => text.includes(term));
}

function sourceLabel(sourcePlatform, sourceChannel) {
  const normalized = String(sourcePlatform || sourceChannel || "").trim().toLowerCase();
  if (normalized === "rss") return SOURCE_LABELS.rss;
  if (normalized === "pubmed") return SOURCE_LABELS.pubmed;
  if (normalized === "pmc") return SOURCE_LABELS.pmc;
  if (normalized === "crossref") return SOURCE_LABELS.crossref;
  if (normalized === "cnki_import") return SOURCE_LABELS.cnki_import;
  return SOURCE_LABELS.other;
}

export function parseScreeningStandards(markdown) {
  if (!markdown || typeof markdown !== "string") return { parsed: false, error: "empty_markdown", hard_excludes: [], positive_preferences: [], negative_preferences: [], grade_rules: {}, raw_rules: [], warnings: [], topic_definition: "" };
  const sections = { topic_definition: "", positive_preferences: [], negative_preferences: [], hard_excludes: [], uncertain: [], caveats: [], raw_rules: [] };
  const lines = markdown.split("\n");
  let currentSection = "preamble";
  let preambleLines = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("## ")) {
      const heading = line.replace(/^##\s*/, "").trim();
      if (heading.includes("优先关注")) currentSection = "positive";
      else if (heading.includes("降权")) currentSection = "negative";
      else if (heading.includes("严格排除") || heading.includes("排除")) currentSection = "hard_exclude";
      else if (heading.includes("不确定")) currentSection = "uncertain";
      else if (heading.includes("注意") || heading.includes("事项")) currentSection = "caveats";
      else currentSection = "other";
      continue;
    }
    if (line.startsWith("# ")) {
      if (currentSection === "preamble") currentSection = "title";
      continue;
    }
    if (line === "---") continue;
    const bullet = line.replace(/^\*\s*/, "").trim();
    if (bullet === line && currentSection === "preamble") { preambleLines.push(bullet); continue; }
    if (currentSection === "preamble") { preambleLines.push(bullet); continue; }
    if (currentSection === "hard_exclude") sections.hard_excludes.push(bullet);
    else if (currentSection === "positive") sections.positive_preferences.push(bullet);
    else if (currentSection === "negative") sections.negative_preferences.push(bullet);
    else if (currentSection === "uncertain") sections.uncertain.push(bullet);
    else if (currentSection === "caveats") sections.caveats.push(bullet);
    else if (currentSection === "other") sections.raw_rules.push(bullet);
  }
  sections.topic_definition = preambleLines.join(" ").trim();

  const hardExcludes = [];
  for (const rule of sections.hard_excludes) {
    const lower = rule.toLowerCase();
    const keywords = [];
    if (lower.includes("无关") || lower.includes("范围外") || lower.includes("unrelated")) keywords.push("unrelated", "out of scope", "无关", "范围外");
    if (lower.includes("社科") || lower.includes("教育") || lower.includes("市场") || lower.includes("金融") || lower.includes("policy") || lower.includes("education") || lower.includes("marketing") || lower.includes("finance")) keywords.push("policy", "education", "marketing", "finance", "社科", "教育", "市场", "金融");
    if (lower.includes("没有方法") || lower.includes("没有数据") || lower.includes("没有实验") || lower.includes("no method") || lower.includes("no data") || lower.includes("no experiment")) keywords.push("no method", "no data", "no experiment", "没有方法", "没有数据", "没有实验");
    if (lower.includes("宣传") || lower.includes("新闻稿") || lower.includes("产品介绍") || lower.includes("announcement") || lower.includes("press release")) keywords.push("press release", "announcement", "产品介绍", "宣传", "新闻稿");
    if (keywords.length === 0) keywords.push(lower.slice(0, 60));
    hardExcludes.push({ rule, keywords, section: "严格排除" });
  }

  const negativePrefs = [];
  for (const rule of sections.negative_preferences) {
    const lower = rule.toLowerCase();
    const keywords = [];
    if (lower.includes("综述") || lower.includes("survey") || lower.includes("review")) keywords.push("survey", "review", "综述");
    if (lower.includes("缺乏验证") || lower.includes("没有实验") || lower.includes("validation")) keywords.push("validation", "experiment", "缺乏验证", "没有实验");
    if (lower.includes("仿真") || lower.includes("simulation")) keywords.push("simulation", "仿真");
    if (lower.includes("数据规模") || lower.includes("样本") || lower.includes("sample")) keywords.push("sample", "dataset", "样本", "数据规模");
    if (lower.includes("范围外") || lower.includes("无关")) keywords.push("unrelated", "out of scope", "范围外", "无关");
    if (keywords.length === 0) keywords.push(lower.slice(0, 50));
    negativePrefs.push({ rule, keywords, section: "相对降权" });
  }

  const positivePrefs = [];
  for (const rule of sections.positive_preferences) {
    const lower = rule.toLowerCase();
    const keywords = [];
    if (lower.includes("故障诊断") || lower.includes("fault diagnosis")) keywords.push("fault diagnosis", "故障诊断");
    if (lower.includes("状态监测") || lower.includes("condition monitoring")) keywords.push("condition monitoring", "状态监测");
    if (lower.includes("优化") || lower.includes("控制") || lower.includes("optimization") || lower.includes("control")) keywords.push("optimization", "control", "优化", "控制");
    if (lower.includes("建模") || lower.includes("仿真") || lower.includes("simulation") || lower.includes("finite element")) keywords.push("simulation", "finite element", "建模", "仿真");
    if (lower.includes("传感") || lower.includes("融合") || lower.includes("sensor fusion")) keywords.push("sensor fusion", "传感", "融合");
    if (lower.includes("实验验证") || lower.includes("benchmark") || lower.includes("prototype") || lower.includes("validation")) keywords.push("validation", "benchmark", "prototype", "实验验证");
    if (keywords.length === 0) keywords.push(lower.slice(0, 50));
    positivePrefs.push({ rule, keywords, section: "优先关注" });
  }

  return {
    parsed: true,
    topic_definition: sections.topic_definition,
    hard_excludes: hardExcludes,
    positive_preferences: positivePrefs,
    negative_preferences: negativePrefs,
    grade_rules: {
      exclude_rules: sections.hard_excludes,
      downgrade_rules: sections.negative_preferences,
      priority_rules: sections.positive_preferences,
    },
    raw_rules: sections.raw_rules,
    warnings: sections.uncertain,
    caveats: sections.caveats,
  };
}

export function loadScreeningStandards(reviewRoot) {
  try {
    const result = readScreeningStandardsFileSync(reviewRoot, { normalize: true });
    if (!result.content || !result.loaded) return { parsed: false, error: "file_not_loaded" };
    const parsed = parseScreeningStandards(result.content);
    return { ...parsed, path: result.path, loaded: true };
  } catch (err) {
    return { parsed: false, error: String(err.message || err), path: "", loaded: false };
  }
}

function checkHardExcludes(text, standards) {
  if (!standards?.parsed || !standards.hard_excludes?.length) return { excluded: false, matched_rules: [] };
  const lower = (text || "").toLowerCase();
  const matched = [];
  for (const rule of standards.hard_excludes) {
    const hits = rule.keywords.filter((kw) => lower.includes(kw.toLowerCase()));
    if (hits.length >= 1) matched.push({ rule: rule.rule, section: rule.section, keyword_hits: hits });
  }
  return { excluded: matched.length > 0, matched_rules: matched };
}

export function buildDedupeKey(item = {}) {
  const doi = normalizeIdentifier(item.doi || item.DOI);
  if (doi) return `doi:${doi}`;
  const pmid = normalizeIdentifier(item.pmid);
  if (pmid) return `pmid:${pmid}`;
  const pmcid = normalizeIdentifier(item.pmcid);
  if (pmcid) return `pmcid:${pmcid}`;
  const title = normTitle(item.title || "");
  if (title) return `title:${title}`;
  const url = normalizeIdentifier(item.url);
  return `url:${url}`;
}

export function classifyItem(item = {}, prefs = {}, standards = null) {
  const text = `${item.title || ""} ${item.abstract || ""}`.toLowerCase();
  const journal = String(item.journal || "").toLowerCase().trim();

  const hardCheck = standards?.parsed ? checkHardExcludes(text, standards) : { excluded: false, matched_rules: [] };
  const hardExcluded = hardCheck.excluded;
  const matchedStandardRules = hardCheck.matched_rules;

  const pollutantHits = countHits(text, POLLUTANT_TERMS);
  const coreHits = countHits(text, CORE_TOPIC_TERMS);
  const mechanismHits = countHits(text, MECHANISM_TERMS);
  const positiveHits = countHits(text, prefs.hardPositiveTerms || []);
  const negativeHits = countHits(text, prefs.hardNegativeTerms || []);
  const qualityHit = JOURNAL_WHITELIST.has(journal);

  let score = 0;
  score += Math.min(pollutantHits.length, 3) * WEIGHTS.pollutant;
  score += Math.min(coreHits.length, 4) * WEIGHTS.core_topic;
  score += Math.min(mechanismHits.length, 4) * WEIGHTS.mechanism;
  score += qualityHit ? WEIGHTS.journal_quality : 0;
  score += Math.min(positiveHits.length, 3) * WEIGHTS.feedback_positive;
  score += Math.min(negativeHits.length, 3) * WEIGHTS.feedback_negative;
  score = Number(score.toFixed(2));

  let grade = "D";
  let classificationReason = "";

  if (hardExcluded) {
    grade = "D";
    classificationReason = `命中严格排除规则: ${matchedStandardRules.map((r) => r.rule.slice(0, 80)).join("; ")}`;
  } else if (pollutantHits.length >= THRESHOLDS.A_min_pollutant_hits && coreHits.length >= THRESHOLDS.A_min_core_hits && score >= THRESHOLDS.A_score) {
    grade = "A";
    classificationReason = GRADE_REASONS.A || "直接命中当前核心工程问题与关键方法信号。";
  } else if ((pollutantHits.length >= 1 || coreHits.length >= 1) && (mechanismHits.length >= 1 || qualityHit) && score >= THRESHOLDS.B_score) {
    grade = "B";
    classificationReason = GRADE_REASONS.B || "与当前主题明显相关，可作为方法或应用参考。";
  } else if (score >= THRESHOLDS.C_score && text.length > 20) {
    grade = "C";
    classificationReason = GRADE_REASONS.C || "与所在研究背景相关，低优先级保留。";
  } else {
    grade = "D";
    classificationReason = GRADE_REASONS.D || "与当前研究问题和工程场景相关性不足。";
  }

  const uncertain = (grade === "B" && score < THRESHOLDS.B_uncertain_below) || (grade === "C" && score < THRESHOLDS.C_uncertain_below) || (grade === "D" && score > 0 && !hardExcluded);
  const needsReview = uncertain;

  const matchedSignals = [
    ...pollutantHits.map((term) => `pollutant:${term}`),
    ...coreHits.map((term) => `topic:${term}`),
    ...mechanismHits.map((term) => `mechanism:${term}`),
    ...positiveHits.map((term) => `feedback_positive:${term}`),
    ...negativeHits.map((term) => `feedback_negative:${term}`),
    ...(qualityHit ? [`journal:${journal}`] : []),
  ];

  const reasons = {
    A: GRADE_REASONS.A || "直接命中当前核心工程问题、关键对象与方法验证信号。",
    B: GRADE_REASONS.B || "与当前主题或邻近应用明显相关，可作为方法、数据或场景参考。",
    C: GRADE_REASONS.C || "与所在研究背景相关，但距离当前核心问题较远，低优先级保留。",
    D: GRADE_REASONS.D || "与当前研究目标相关性不足，仅保留审计记录。",
  };

  return {
    grade,
    grade_label: LABELS[grade],
    grade_reason: reasons[grade],
    classification_reason: classificationReason,
    hard_excluded: hardExcluded,
    matched_standard_rules: matchedStandardRules,
    matched_signals: matchedSignals,
    writeback_ready: grade !== "D",
    triage_version: TRIAGE_VERSION,
    standards_used: Boolean(standards?.parsed),
    flags: {
      uncertain,
      needs_review: needsReview,
    },
    score,
    source: sourceLabel(item.source_platform, item.source_channel),
    dedupe_key: buildDedupeKey(item),
    scoring_detail: {
      pollutant_hits: pollutantHits,
      core_hits: coreHits,
      mechanism_hits: mechanismHits,
      positive_hits: positiveHits,
      negative_hits: negativeHits,
      quality_hit: qualityHit,
    },
  };
}

export function summarizeGradeCounts(items = []) {
  const grade_counts = { A: 0, B: 0, C: 0, D: 0 };
  let uncertain_count = 0;
  for (const item of items) {
    if (item?.grade && grade_counts[item.grade] !== undefined) {
      grade_counts[item.grade] += 1;
    }
    if (item?.flags?.uncertain) uncertain_count += 1;
  }
  return {
    grade_counts,
    uncertain_count,
    writeback_candidate_count: grade_counts.A + grade_counts.B + grade_counts.C,
    skipped_d_count: grade_counts.D,
  };
}
