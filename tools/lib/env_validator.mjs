import fs from "node:fs";
import path from "node:path";

function loadEnvFile(envPath) {
  try {
    const text = fs.readFileSync(envPath, "utf8");
    const vars = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      vars[key] = val;
    }
    return vars;
  } catch {
    return {};
  }
}

export function validateEnvironment(root = process.cwd()) {
  const issues = [];
  const warnings = [];

  const envPath = path.join(root, ".env");
  const envExists = fs.existsSync(envPath);
  if (!envExists) {
    issues.push(".env 文件不存在。请复制 .env.example 为 .env 并配置必要参数");
    return { ok: false, fatal: true, issues, warnings, env_exists: false };
  }

  const envVars = loadEnvFile(envPath);

  if (!envVars.TITLE_TRANSLATION_API_KEY || envVars.TITLE_TRANSLATION_API_KEY.trim() === "") {
    warnings.push("TITLE_TRANSLATION_API_KEY 未配置 — 标题翻译将跳过，使用英文原文");
  }

  const configDir = path.join(root, "config");
  const requiredConfigs = [
    { key: "database_sources.json", name: "数据库源配置" },
    { key: "research_profile.json", name: "研究画像" },
    { key: "workflow_rules.json", name: "分级规则" },
    { key: "rss_sources.json", name: "RSS 订阅源" },
  ];
  for (const cfg of requiredConfigs) {
    const cfgPath = path.join(configDir, cfg.key);
    if (!fs.existsSync(cfgPath)) {
      issues.push(`${cfg.name} (${cfg.key}) 不存在`);
    } else {
      try {
        const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        if (cfg.key === "database_sources.json") {
          const sources = parsed.sources || {};
          const enabledSources = Object.values(sources).filter((s) => s.enabled !== false);
          if (enabledSources.length === 0) {
            warnings.push("database_sources.json 中没有启用的数据源 — 管线将只检索 RSS");
          }
        }
        if (cfg.key === "workflow_rules.json") {
          const triage = parsed.triage || {};
          if (!triage.terms || Object.keys(triage.terms).length === 0) {
            issues.push("workflow_rules.json 中缺少 triage.terms 分级关键词规则");
          }
        }
      } catch (e) {
        issues.push(`${cfg.name} (${cfg.key}) 格式错误: ${e.message}`);
      }
    }
  }

  const crossrefPath = path.join(configDir, "crossref_search.json");
  if (fs.existsSync(crossrefPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(crossrefPath, "utf8"));
      if (parsed.query === "engineering") {
        warnings.push("crossref_search.json 使用了默认 query 'engineering'，可能需要替换为实际检索词");
      }
    } catch {}
  }

  return {
    ok: issues.length === 0,
    fatal: issues.length > 0,
    issues,
    warnings,
    env_exists: true,
    env_vars_configured: Object.keys(envVars).filter((k) => envVars[k].trim() !== "").length,
  };
}

export function printValidationResult(result) {
  const lines = [];
  if (result.ok && result.warnings.length === 0) {
    lines.push("  ✓ 环境检查通过");
    return lines.join("\n");
  }
  if (result.issues.length > 0) {
    lines.push(`  ✗ 发现 ${result.issues.length} 个问题:`);
    for (const issue of result.issues) {
      lines.push(`    · ${issue}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push(`  ⚠ 发现 ${result.warnings.length} 个警告:`);
    for (const w of result.warnings) {
      lines.push(`    · ${w}`);
    }
  }
  return lines.join("\n");
}
