const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
const MIN_VALID_TITLE_LENGTH = 4;
const MAX_TITLE_LENGTH = 600;
const NON_TITLE_RE = /^(abstract|introduction|conclusion|methods?|results?|discussion|references?|table\s+\d+|figure\s+\d+)$/i;
const URL_RE = /^https?:\/\//i;

export function isChineseText(text) {
  return CJK_RE.test(String(text || ""));
}

export function looksLikeTitle(text) {
  const s = String(text || "").trim();
  if (!s) return { valid: false, reason: "empty" };
  if (s.length < MIN_VALID_TITLE_LENGTH) return { valid: false, reason: "too_short" };
  if (s.length > MAX_TITLE_LENGTH) return { valid: false, reason: "too_long" };
  if (URL_RE.test(s)) return { valid: false, reason: "looks_like_url" };
  if (NON_TITLE_RE.test(s)) return { valid: false, reason: "non_title_text" };
  return { valid: true, reason: "" };
}

export function isTitleAlreadyChinese(title, shortTitle) {
  if (shortTitle && isChineseText(shortTitle)) return true;
  if (title && isChineseText(title)) return true;
  return false;
}

export function validateTranslationQuality(original, translated) {
  const t = String(translated || "").trim();
  if (!t) return { ok: false, reason: "empty_translation" };
  if (!isChineseText(t)) return { ok: false, reason: "translation_not_chinese" };
  const orig = String(original || "").trim().toLowerCase();
  const tranLower = t.toLowerCase();
  if (tranLower === orig) return { ok: false, reason: "translation_identical_to_original" };
  const origNormalized = orig.replace(/[^a-z0-9\s]/g, "").trim();
  const tranNormalized = tranLower.replace(/[^a-z0-9\u4e00-\u9fff\s]/g, "").trim();
  if (origNormalized && tranNormalized && origNormalized === tranNormalized) {
    return { ok: false, reason: "translation_identical_after_normalization" };
  }
  return { ok: true, reason: "" };
}

export function detectSourceLanguage(title) {
  const s = String(title || "").trim();
  if (!s) return "unknown";
  if (isChineseText(s)) return "zh";
  const jpKanaRe = /[\u3040-\u309f\u30a0-\u30ff]/;
  if (jpKanaRe.test(s)) return "ja";
  const koRe = /[\uac00-\ud7af]/;
  if (koRe.test(s)) return "ko";
  const latinRatio = (s.replace(/[a-zA-Z\s.,;:!?()\-'"]/g, "").length / s.length);
  if (latinRatio === 0) return "en";
  if (latinRatio < 0.3) return "other";
  return "en";
}
