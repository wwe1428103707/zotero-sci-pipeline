import fs from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { proxyFetch } from "./proxy_config.mjs";

const ARXIV_DOI_RE = /^10\.48550\/arxiv\./i;
const ARXIV_ID_RE = /^\d{4}\.\d{4,5}(v\d+)?$/;
const SCIHUB_REDIRECT_MARKERS = ["sci-hub", "sci-hub.se", "sci-hub.ru", "sci-hub.st"];

export function normalizeDoi(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.replace(/^https?:\/\/doi\.org\//, "").replace(/^doi:\s*/i, "").replace(/\s+/g, "").toLowerCase();
}

export function extractArxivId(doi, title) {
  if (ARXIV_DOI_RE.test(doi)) return doi.replace(ARXIV_DOI_RE, "");
  const m = String(title || "").match(/arxiv[:\s]*(\d{4}\.\d{4,5}(v\d+)?)/i);
  if (m) return m[1];
  if (ARXIV_ID_RE.test(doi)) return doi;
  return "";
}

export function looksLikeArxivUrl(url) {
  return /arxiv\.org/i.test(String(url || ""));
}

export async function downloadFromSciHub(doi, sciHubBaseUrl, { timeoutMs = 30000, signal } = {}) {
  const normalized = normalizeDoi(doi);
  if (!normalized) return { ok: false, reason: "empty_doi" };

  const sciHubUrl = `${sciHubBaseUrl.replace(/\/+$/, "")}/${normalized}`;
  const ac = new AbortController();
  const combinedSignal = signal ? anySignal([signal, ac.signal]) : ac.signal;
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const resp = await proxyFetch(sciHubUrl, {
      signal: combinedSignal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    clearTimeout(timer);

    if (!resp.ok) return { ok: false, reason: `scihub_http_${resp.status}`, url: sciHubUrl };

    const html = await resp.text();

    const embedRe = /<embed[^>]+src\s*=\s*["']([^"']+\.pdf[^"']*)["']/i;
    const iframeRe = /<iframe[^>]+src\s*=\s*["']([^"']+\.pdf[^"']*)["']/i;
    const anchorRe = /<a[^>]+href\s*=\s*["']([^"']+\.pdf[^"']*)["']/i;

    let pdfUrl = null;
    for (const re of [embedRe, iframeRe, anchorRe]) {
      const m = html.match(re);
      if (m) { pdfUrl = m[1]; break; }
    }

    if (!pdfUrl) {
      const anyPdf = html.match(/(https?:\/\/[^"'\s]+\.pdf[^"'\s]*)/i);
      if (anyPdf) pdfUrl = anyPdf[1];
    }

    if (!pdfUrl) {
      const directPdfRe = /src\s*=\s*["'](?:\/\/)?([^"']+\.pdf[^"']*)["']/i;
      const dm = html.match(directPdfRe);
      if (dm) pdfUrl = dm[1].startsWith("http") ? dm[1] : `https://${dm[1]}`;
    }

    if (!pdfUrl) return { ok: false, reason: "pdf_url_not_found_in_scihub", url: sciHubUrl };

    if (pdfUrl.startsWith("//")) pdfUrl = "https:" + pdfUrl;
    else if (pdfUrl.startsWith("/")) pdfUrl = sciHubBaseUrl.replace(/\/+$/, "") + pdfUrl;

    const pdfResp = await proxyFetch(pdfUrl, {
      signal: combinedSignal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });

    if (!pdfResp.ok) return { ok: false, reason: `pdf_download_http_${pdfResp.status}`, url: pdfUrl };
    const contentType = pdfResp.headers.get("content-type") || "";
    if (!contentType.includes("pdf") && !contentType.includes("application/octet-stream") && !contentType.includes("application/pdf")) {
      const text = await pdfResp.text().catch(() => "");
      if (text.includes("captcha") || text.includes("CAPTCHA") || text.length < 200) {
        return { ok: false, reason: "scihub_captcha_blocked", url: pdfUrl };
      }
    }
    const buf = await pdfResp.arrayBuffer();
    if (buf.byteLength < 1000) return { ok: false, reason: "pdf_too_small", size: buf.byteLength, url: pdfUrl };
    return { ok: true, data: Buffer.from(buf), size: buf.byteLength, source: "sci-hub", url: pdfUrl };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") return { ok: false, reason: "timeout", url: sciHubUrl };
    return { ok: false, reason: `fetch_error:${err?.message?.slice(0, 100)}`, url: sciHubUrl };
  }
}

export async function downloadFromArxiv(arxivId, { mirror = "https://arxiv.org", timeoutMs = 15000, signal } = {}) {
  const aid = String(arxivId || "").replace(/^arxiv[:\s]*/i, "").trim();
  if (!aid) return { ok: false, reason: "empty_arxiv_id" };

  const pdfUrl = `${mirror.replace(/\/+$/, "")}/pdf/${aid}`;
  const ac = new AbortController();
  const combinedSignal = signal ? anySignal([signal, ac.signal]) : ac.signal;
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const resp = await proxyFetch(pdfUrl, {
      signal: combinedSignal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    clearTimeout(timer);
    if (!resp.ok) return { ok: false, reason: `arxiv_http_${resp.status}`, url: pdfUrl };

    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("pdf")) {
      const text = await resp.text().catch(() => "");
      if (text.includes("Not Found") || text.includes("404")) {
        return { ok: false, reason: "arxiv_pdf_not_found", url: pdfUrl };
      }
    }

    const buf = await resp.arrayBuffer();
    if (buf.byteLength < 1000) return { ok: false, reason: "pdf_too_small", size: buf.byteLength, url: pdfUrl };
    return { ok: true, data: Buffer.from(buf), size: buf.byteLength, source: "arxiv", url: pdfUrl };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") return { ok: false, reason: "timeout", url: pdfUrl };
    return { ok: false, reason: `fetch_error:${err?.message?.slice(0, 100)}`, url: pdfUrl };
  }
}

export async function downloadPdf(doi, title, { sciHubBaseUrl = "https://sci-hub.st", arxivMirror = "https://arxiv.org", sciHubTimeoutMs = 30000, arxivTimeoutMs = 15000, signal } = {}) {
  const normalizedDoi = normalizeDoi(doi || "");
  const arxivId = extractArxivId(normalizedDoi || "", title || "");

  if (arxivId) {
    const result = await downloadFromArxiv(arxivId, { mirror: arxivMirror, timeoutMs: arxivTimeoutMs, signal });
    if (result.ok) return result;
    if (normalizedDoi) {
      const sciResult = await downloadFromSciHub(normalizedDoi, sciHubBaseUrl, { timeoutMs: sciHubTimeoutMs, signal });
      return sciResult;
    }
    return result;
  }

  if (!normalizedDoi) return { ok: false, reason: "no_doi_or_arxiv_id" };
  const result = await downloadFromSciHub(normalizedDoi, sciHubBaseUrl, { timeoutMs: sciHubTimeoutMs, signal });
  return result;
}

export function generatePdfFilename(doi, title) {
  const base = (title || doi || "paper").replace(/[<>:"/\\|?*]/g, "_").slice(0, 120);
  return `${base}.pdf`;
}

function anySignal(signals) {
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) { controller.abort(sig.reason); return controller.signal; }
    sig.addEventListener("abort", () => controller.abort(sig.reason), { once: true });
  }
  return controller.signal;
}
