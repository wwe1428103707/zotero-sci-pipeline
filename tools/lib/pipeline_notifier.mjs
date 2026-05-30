import fs from "node:fs";
import path from "node:path";

function loadEnv(root) {
  const envPath = path.join(root, ".env");
  try {
    const text = fs.readFileSync(envPath, "utf8");
    const vars = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
    return vars;
  } catch {
    return {};
  }
}

function resolveNotifierConfig(env = process.env, root = process.cwd()) {
  const fileEnv = loadEnv(root);
  const get = (key) => env[key] || fileEnv[key] || "";
  const type = (get("NOTIFICATION_TYPE") || "").trim().toLowerCase();
  const webhookUrl = (get("NOTIFICATION_WEBHOOK_URL") || "").trim();
  return {
    enabled: Boolean(type && webhookUrl),
    type,
    webhookUrl,
    pushDeerKey: (get("PUSHDEER_KEY") || "").trim(),
    serverChanKey: (get("SERVERCHAN_KEY") || "").trim(),
    notifyOnSuccess: /^(1|true|yes)$/i.test(get("NOTIFY_ON_SUCCESS") || "true"),
    notifyOnFailure: /^(1|true|yes)$/i.test(get("NOTIFY_ON_FAILURE") || "true"),
  };
}

function buildMessage(pipelineResult) {
  const status = pipelineResult.status === "completed" ? "✅ 成功" : "❌ 失败";
  const counts = pipelineResult.counts || {};
  const gradeCounts = counts.grade_counts || {};
  const failures = pipelineResult.failures || [];

  const lines = [
    `## zotero-sci-pipeline 运行${status}`,
    "",
    `| 项目 | 值 |`,
    `|------|-----|`,
    `| 运行时间 | ${pipelineResult.date || "未知"} |`,
    `| 总文献数 | ${counts.merged || 0} |`,
    `| A 核心相关 | ${gradeCounts.A || 0} |`,
    `| B 专题相关 | ${gradeCounts.B || 0} |`,
    `| C 背景相关 | ${gradeCounts.C || 0} |`,
    `| D 低相关 | ${gradeCounts.D || 0} |`,
    `| 数据源 | RSS:${counts.rss_raw || 0}, arXiv:${counts.arxiv_raw || 0}, Crossref:${counts.crossref_raw || 0} |`,
  ];

  if (failures.length > 0) {
    lines.push("", "### ⚠️ 运行告警", "");
    for (const f of failures.slice(0, 5)) {
      lines.push(`- ${f.stage || f.reason || String(f)}`);
    }
    if (failures.length > 5) lines.push(`- ... 还有 ${failures.length - 5} 条告警`);
  }

  return lines.join("\n");
}

function truncate(str, max) {
  const s = String(str || "");
  return s.length <= max ? s : s.slice(0, max) + "...";
}

async function sendWecomBot(webhookUrl, message) {
  const body = {
    msgtype: "markdown",
    markdown: { content: truncate(message, 4096) },
  };
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`wecom_bot_${res.status}`);
  return { ok: true, channel: "wecom_bot" };
}

async function sendPushDeer(pushDeerKey, message) {
  const text = message
    .replace(/## /g, "")
    .replace(/\|/g, "")
    .replace(/---/g, "")
    .split("\n").filter(Boolean).slice(0, 20).join("\n");
  const url = `https://api2.pushdeer.com/message/push?pushkey=${encodeURIComponent(pushDeerKey)}&text=${encodeURIComponent(truncate(text, 2000))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pushdeer_${res.status}`);
  return { ok: true, channel: "pushdeer" };
}

async function sendServerChan(serverChanKey, message) {
  const title = message.split("\n")[0] || "zotero-sci-pipeline 运行报告";
  const body = { title: truncate(title, 80), desp: message };
  const res = await fetch(`https://sctapi.ftqq.com/${serverChanKey}.send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`serverchan_${res.status}`);
  return { ok: true, channel: "serverchan" };
}

export async function sendPipelineNotification(pipelineResult, options = {}) {
  const cfg = resolveNotifierConfig(options.env, options.root);
  if (!cfg.enabled) {
    return { ok: false, skipped: true, reason: "notification_not_configured" };
  }

  const isFailure = pipelineResult.status !== "completed";
  if (isFailure && !cfg.notifyOnFailure) {
    return { ok: false, skipped: true, reason: "notify_on_failure_disabled" };
  }
  if (!isFailure && !cfg.notifyOnSuccess) {
    return { ok: false, skipped: true, reason: "notify_on_success_disabled" };
  }

  const message = buildMessage(pipelineResult);
  const errors = [];

  if (cfg.type === "wecom_bot" || cfg.type === "wecom") {
    try {
      return await sendWecomBot(cfg.webhookUrl, message);
    } catch (err) {
      errors.push(String(err.message || err));
    }
  }

  if (cfg.type === "pushdeer") {
    try {
      return await sendPushDeer(cfg.pushDeerKey || cfg.webhookUrl, message);
    } catch (err) {
      errors.push(String(err.message || err));
    }
  }

  if (cfg.type === "serverchan" || cfg.type === "server_chan") {
    try {
      return await sendServerChan(cfg.serverChanKey || cfg.webhookUrl, message);
    } catch (err) {
      errors.push(String(err.message || err));
    }
  }

  return { ok: false, skipped: false, errors };
}
