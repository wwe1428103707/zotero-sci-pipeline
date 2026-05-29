function normalizeAdapterResult(result = {}, fallbackConfig = {}) {
  return {
    items: Array.isArray(result.items) ? result.items : [],
    failed: Array.isArray(result.failed) ? result.failed : [],
    config: result.config || fallbackConfig,
  };
}

export function createSourceAdapters({ sourcePlan, handlers } = {}) {
  const plan = sourcePlan || {};
  const runtimeHandlers = handlers || {};
  const defs = [
    { id: "rss", config: plan.rss, handler: runtimeHandlers.rss },
    { id: "pubmed", config: plan.pubmed, handler: runtimeHandlers.pubmed },
    { id: "crossref", config: plan.crossref, handler: runtimeHandlers.crossref },
    { id: "cnki_import", config: plan.cnki_import, handler: runtimeHandlers.cnki_import },
    { id: "arxiv", config: plan.arxiv, handler: runtimeHandlers.arxiv },
    { id: "semantic_scholar", config: plan.semantic_scholar, handler: runtimeHandlers.semantic_scholar },
    { id: "dblp", config: plan.dblp, handler: runtimeHandlers.dblp },
  ];
  return defs.map((entry) => ({
    ...entry,
    enabled: Boolean(entry.config?.enabled),
  }));
}

export async function executeSourcePlan(adapters = []) {
  const result = {};
  const allItems = [];
  const allFailures = [];
  for (const adapter of adapters) {
    if (!adapter.enabled || typeof adapter.handler !== "function") {
      result[adapter.id] = { items: [], failed: [], config: adapter.config || {} };
      continue;
    }
    const payload = normalizeAdapterResult(await adapter.handler(adapter.config), adapter.config);
    result[adapter.id] = payload;
    allItems.push(...payload.items);
    allFailures.push(...payload.failed.map((entry) => ({ stage: adapter.id, ...entry })));
  }
  return {
    ...result,
    all_items: allItems,
    all_failures: allFailures,
  };
}
