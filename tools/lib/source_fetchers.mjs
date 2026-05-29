import {
  buildArxivUrl,
  buildCrossrefWorksUrl,
  buildDblpUrl,
  buildNcbiESearchUrl,
  buildSemanticScholarUrl,
  loadCnkiImportConfig,
  loadCrossrefSearchConfig,
  loadPubMedPmcSearchConfig,
  loadRssSources,
  readCnkiImportItems,
} from "./literature_config.mjs";

function defaultCleanText(value) {
  return String(value || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function parseRssItems(xml, sourceUrl, cleanText = defaultCleanText) {
  const items = [];
  const channelTitle = cleanText((xml.match(/<channel[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = cleanText((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const link = cleanText((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || "");
    const desc = cleanText((block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || "");
    if (!title) continue;
    const doi = (desc.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i) || [])[0] || "";
    items.push({
      source_channel: "rss",
      source_platform: "rss",
      feed_url: sourceUrl,
      journal: channelTitle,
      item_type_hint: "journalArticle",
      title,
      url: link,
      abstract: desc,
      doi: doi.toLowerCase(),
    });
  }
  return items;
}

export function extractCrossrefDate(message = {}) {
  const candidates = [message["published-print"], message["published-online"], message.created, message.issued];
  for (const candidate of candidates) {
    const parts = candidate?.["date-parts"]?.[0];
    if (Array.isArray(parts) && parts.length) {
      const [y, m = 1, d = 1] = parts;
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return "";
}

export function parseCrossrefItems(messages = [], cleanText = defaultCleanText) {
  return (messages || []).map((message) => ({
    source_channel: "crossref",
    source_platform: "crossref",
    item_type_hint: "journalArticle",
    title: cleanText(Array.isArray(message.title) ? message.title[0] : message.title || ""),
    url: cleanText(message.URL || ""),
    abstract: cleanText(message.abstract || ""),
    doi: cleanText(message.DOI || "").toLowerCase(),
    journal: cleanText(Array.isArray(message["container-title"]) ? message["container-title"][0] : message["container-title"] || ""),
    pubdate: extractCrossrefDate(message),
  })).filter((item) => item.title);
}

async function fetchNcbiDatabase(database, cfg, helpers) {
  const { buildNcbiESearchUrl: buildUrl, fetchText, cleanText = defaultCleanText } = helpers;
  const esearchUrl = buildUrl(cfg, database);
  const txt = await fetchText(esearchUrl, 20000);
  const json = JSON.parse(txt);
  const ids = json?.esearchresult?.idlist || [];
  if (!ids.length) return { items: [], failed: [] };
  const esummaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=${encodeURIComponent(database)}&retmode=json&id=${ids.join(",")}`;
  const sumTxt = await fetchText(esummaryUrl, 20000);
  const sum = JSON.parse(sumTxt);
  const items = ids
    .map((id) => sum?.result?.[id])
    .filter(Boolean)
    .map((record, index) => ({
      source_channel: "database",
      source_platform: database,
      item_type_hint: "journalArticle",
      title: cleanText(record.title || ""),
      url: database === "pmc" ? `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${ids[index]}/` : `https://pubmed.ncbi.nlm.nih.gov/${ids[index]}/`,
      abstract: "",
      doi: "",
      pmid: database === "pubmed" ? String(ids[index]) : "",
      pmcid: database === "pmc" ? `PMC${ids[index]}` : "",
      journal: record.fulljournalname || "",
      pubdate: record.pubdate || "",
    }));
  return { items, failed: [] };
}

export function parseArxivXml(xml = "", cleanText = defaultCleanText) {
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return entries.map((block) => {
    const title = cleanText((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    if (!title) return null;
    const summary = cleanText((block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || [])[1] || "");
    const url = cleanText((block.match(/<id[^>]*>([\s\S]*?)<\/id>/i) || [])[1] || "");
    const published = cleanText((block.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || [])[1] || "");
    const arxivId = (url.match(/arxiv\.org\/(?:abs|pdf)\/(.+)/i) || [])[1] || "";
    const doi = (summary.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i) || [])[0] || "";
    const journal = cleanText((block.match(/<arxiv:journal_ref[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/i) || [])[1] || "");
    const authors = [];
    const authorMatches = block.matchAll(/<author[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi);
    for (const m of authorMatches) {
      if (m[1]) authors.push(cleanText(m[1]));
    }
    const categories = [];
    const catMatches = block.matchAll(/<category[\s]+term="([^"]*)"/gi);
    for (const m of catMatches) {
      if (m[1]) categories.push(m[1]);
    }
    return {
      source_channel: "arxiv",
      source_platform: "arxiv",
      item_type_hint: "preprint",
      title,
      abstract: summary,
      url,
      doi: doi.toLowerCase(),
      journal: journal || "arXiv",
      pubdate: published.slice(0, 10),
      arxiv_id: arxivId,
      authors,
      categories,
    };
  }).filter(Boolean);
}

export function parseSemanticScholarItems(data = {}, cleanText = defaultCleanText) {
  const papers = data?.data || [];
  return papers.map((paper) => {
    const title = cleanText(paper.title || "");
    if (!title) return null;
    const extIds = paper.externalIds || {};
    return {
      source_channel: "semantic_scholar",
      source_platform: "semantic_scholar",
      item_type_hint: "journalArticle",
      title,
      abstract: cleanText(paper.abstract || ""),
      url: cleanText(paper.url || paper.paperId || ""),
      doi: cleanText(extIds.DOI || "").toLowerCase(),
      journal: cleanText(paper.venue || ""),
      pubdate: String(paper.publicationDate || "").slice(0, 10),
      arxiv_id: extIds.ArXiv || "",
      pmid: extIds.PUBMED || "",
      corpus_id: extIds.CorpusId || "",
      authors: (paper.authors || []).map((a) => cleanText(a.name || "")).filter(Boolean),
      citation_count: paper.citationCount || 0,
      reference_count: paper.referenceCount || 0,
    };
  }).filter(Boolean);
}

export function parseDblpItems(data = {}, cleanText = defaultCleanText) {
  const hits = data?.result?.hits?.hit || [];
  return (Array.isArray(hits) ? hits : []).map((hit) => {
    const info = hit.info || {};
    const title = cleanText(info.title || "");
    if (!title) return null;
    const authors = (Array.isArray(info.authors?.author) ? info.authors.author : [info.authors?.author]).filter(Boolean).map((a) => cleanText(typeof a === "string" ? a : a.text || ""));
    return {
      source_channel: "dblp",
      source_platform: "dblp",
      item_type_hint: info.type === "Conference and Workshop Papers" ? "conferencePaper" : "journalArticle",
      title,
      abstract: cleanText(info.abstract || ""),
      url: cleanText(info.url || ""),
      doi: cleanText(info.doi || "").toLowerCase(),
      journal: cleanText(info.venue || info.booktitle || ""),
      pubdate: String(info.year || ""),
      authors,
      dblp_key: info.key || "",
    };
  }).filter(Boolean);
}

export function createRuntimeSourceHandlers({ root, helpers = {} } = {}) {
  const runtime = {
    loadRssSources,
    loadPubMedPmcSearchConfig,
    loadCrossrefSearchConfig,
    loadCnkiImportConfig,
    buildNcbiESearchUrl,
    buildCrossrefWorksUrl,
    buildArxivUrl,
    buildSemanticScholarUrl,
    buildDblpUrl,
    readCnkiImportItems,
    cleanText: defaultCleanText,
    ...helpers,
  };

  return {
    rss: async () => {
      const rssConfig = runtime.loadRssSources({ root });
      const items = [];
      const failed = [];
      await Promise.all(
        rssConfig.sources.map(async ({ url }) => {
          try {
            const xml = await runtime.fetchTextWithRetry(url, 3, 15000);
            items.push(...parseRssItems(xml, url, runtime.cleanText));
          } catch (error) {
            failed.push({ feed: url, error: String(error.message || error) });
          }
        }),
      );
      return { items, failed, config: rssConfig };
    },
    pubmed: async () => {
      const cfg = runtime.loadPubMedPmcSearchConfig({ root, now: new Date() });
      const items = [];
      const failed = [];
      for (const database of cfg.databases) {
        try {
          const result = await fetchNcbiDatabase(database, cfg, runtime);
          items.push(...result.items);
          failed.push(...(result.failed || []));
        } catch (error) {
          failed.push({ source: database, error: String(error.message || error) });
        }
      }
      return { items, failed, config: cfg };
    },
    crossref: async (cfg) => {
      if (!cfg?.enabled) return { items: [], failed: [], config: cfg };
      try {
        const json = await runtime.fetchJson(runtime.buildCrossrefWorksUrl(cfg), 20000);
        const messages = json?.message?.items || [];
        return { items: parseCrossrefItems(messages, runtime.cleanText), failed: [], config: cfg };
      } catch (error) {
        return { items: [], failed: [{ source: "crossref", error: String(error.message || error) }], config: cfg };
      }
    },
    cnki_import: async (cfg) => {
      if (!cfg?.enabled) return { items: [], failed: [], config: cfg };
      try {
        const items = await runtime.readCnkiImportItems({ root, config: cfg });
        return { items, failed: [], config: cfg };
      } catch (error) {
        return { items: [], failed: [{ source: "cnki_import", error: String(error.message || error) }], config: cfg };
      }
    },
    arxiv: async (cfg) => {
      if (!cfg?.enabled) return { items: [], failed: [], config: cfg };
      const url = runtime.buildArxivUrl(cfg);
      if (!url) return { items: [], failed: [], config: cfg };
      try {
        const xml = await runtime.fetchTextWithRetry(url, 2, 30000);
        const items = parseArxivXml(xml, runtime.cleanText);
        return { items, failed: [], config: cfg };
      } catch (error) {
        return { items: [], failed: [{ source: "arxiv", error: String(error.message || error) }], config: cfg };
      }
    },
    semantic_scholar: async (cfg) => {
      if (!cfg?.enabled) return { items: [], failed: [], config: cfg };
      const url = runtime.buildSemanticScholarUrl(cfg);
      if (!url) return { items: [], failed: [], config: cfg };
      try {
        const json = await runtime.fetchJson(url, 30000);
        const items = parseSemanticScholarItems(json, runtime.cleanText);
        return { items, failed: [], config: cfg };
      } catch (error) {
        return { items: [], failed: [{ source: "semantic_scholar", error: String(error.message || error) }], config: cfg };
      }
    },
    dblp: async (cfg) => {
      if (!cfg?.enabled) return { items: [], failed: [], config: cfg };
      const url = runtime.buildDblpUrl(cfg);
      if (!url) return { items: [], failed: [], config: cfg };
      try {
        const json = await runtime.fetchJson(url, 20000);
        const items = parseDblpItems(json, runtime.cleanText);
        return { items, failed: [], config: cfg };
      } catch (error) {
        return { items: [], failed: [{ source: "dblp", error: String(error.message || error) }], config: cfg };
      }
    },
  };
}
