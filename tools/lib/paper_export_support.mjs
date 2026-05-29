import fs from "node:fs/promises";
import path from "node:path";

function toText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeXml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function zipStore(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(String(entry.content), "utf8");
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function slugFragment(value) {
  return toText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join("");
}

function buildCitationKey(item = {}, index = 0) {
  const base = slugFragment(item.title) || `ref${index + 1}`;
  const year = toText(item.year) || "n.d.";
  return `${base}${year}`.replace(/[^a-z0-9.]+/gi, "");
}

function pickTitle(item = {}) {
  return toText(item["标题翻译"] || item["中文标题"] || item.title);
}

function dedupeKeywords(text = "") {
  return Array.from(new Set(
    toText(text)
      .split(/[;,，；]/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));
}

function buildSectionEvidence(items = [], heading, matcher) {
  return {
    heading,
    items: items.filter(matcher).map((item) => ({
      citationKey: item.citationKey,
      title: item.title,
      translatedTitle: pickTitle(item),
      summary: toText(item.abstract),
      rationale: toText(item["推荐理由"] || item.grade_reason || ""),
    })),
  };
}

export function buildPaperAssetPayload({ date = "", triaged = [], reportContext = {} } = {}) {
  const references = (triaged || []).map((item, index) => ({
    ...item,
    citationKey: buildCitationKey(item, index),
    displayTitle: pickTitle(item),
    keywordsList: dedupeKeywords(item.keywords || item["关键词"] || ""),
  }));

  const sections = [
    buildSectionEvidence(references, "题目与摘要素材", () => true),
    buildSectionEvidence(references, "引言", (item) => /A|B/.test(toText(item["推荐等级"] || ""))),
    buildSectionEvidence(references, "相关工作", () => true),
    buildSectionEvidence(references, "方法", (item) => /方法|diagnosis|monitoring|optimization|digital twin|fusion/i.test(`${item.title} ${item.abstract}`)),
    buildSectionEvidence(references, "实验与结果", (item) => /experiment|benchmark|validation|test|评估|验证/i.test(`${item.title} ${item.abstract} ${item["推荐理由"]}`)),
    buildSectionEvidence(references, "结论与展望", () => true),
  ];

  return {
    date: toText(date),
    reportContext,
    references,
    sections,
  };
}

function renderSectionItems(section = {}) {
  if (!Array.isArray(section.items) || !section.items.length) {
    return "- 暂无已筛选素材，可在后续运行中补充。\n";
  }
  return section.items.map((item) => {
    const summary = item.summary ? `：${item.summary}` : "";
    const rationale = item.rationale ? `  推荐理由：${item.rationale}` : "";
    return `- [@${item.citationKey}] ${item.translatedTitle || item.title}${summary}${rationale}`;
  }).join("\n") + "\n";
}

function paragraphXml(text, { heading = false } = {}) {
  const style = heading ? '<w:pStyle w:val="Heading1"/>' : "";
  return `<w:p><w:pPr>${style}</w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function buildPaperDocxBuffer(payload = {}, options = {}) {
  const profile = toText(options.profile || "sci_generic_engineering");
  const paperTitleEn = toText(options.paperTitleEn || "Engineering Research Draft");
  const paperTitleZh = toText(options.paperTitleZh || "工科论文写作草稿");
  const references = Array.isArray(payload.references) ? payload.references : [];
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const parts = [
    paragraphXml(paperTitleEn, { heading: true }),
    paragraphXml(`中文题名：${paperTitleZh}`),
    paragraphXml(`输出配置：${profile}`),
    paragraphXml(`生成日期：${toText(payload.date) || "未记录"}`),
    paragraphXml(`参考文献数：${references.length}`),
    ...sections.flatMap((section) => {
      const rows = [paragraphXml(section.heading, { heading: true })];
      if (!Array.isArray(section.items) || !section.items.length) {
        rows.push(paragraphXml("暂无已筛选素材，可在后续运行中补充。"));
        return rows;
      }
      for (const item of section.items) {
        const line = `${item.translatedTitle || item.title} ${item.summary ? `：${item.summary}` : ""}${item.rationale ? ` 推荐理由：${item.rationale}` : ""}`;
        rows.push(paragraphXml(line));
      }
      return rows;
    }),
    paragraphXml("参考文献素材", { heading: true }),
    ...references.map((item) => paragraphXml(`[${item.citationKey}] ${item.title} (${toText(item.year) || "n.d."}), ${toText(item.journal) || "Unknown Venue"}`)),
  ];

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`;
  return zipStore([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/document.xml", content: documentXml },
    { name: "word/styles.xml", content: stylesXml },
  ]);
}

export function renderPaperMarkdown(payload = {}, options = {}) {
  const profile = toText(options.profile || "sci_generic_engineering");
  const paperTitleEn = toText(options.paperTitleEn || "Engineering Research Draft");
  const paperTitleZh = toText(options.paperTitleZh || "工科论文写作草稿");
  const references = Array.isArray(payload.references) ? payload.references : [];
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const abstractBullets = references.slice(0, 3).map((item) => `- ${item.displayTitle}: ${toText(item.abstract) || "待补摘要。"} `).join("\n");
  const keywords = Array.from(new Set(references.flatMap((item) => item.keywordsList || []))).slice(0, 8);

  return [
    `# ${paperTitleEn}`,
    "",
    "## 中文题名",
    "",
    paperTitleZh,
    "",
    "## 导出配置",
    "",
    `- 输出配置：${profile}`,
    `- 生成日期：${toText(payload.date) || "未记录"}`,
    `- 参考文献数：${references.length}`,
    "",
    "## 摘要素材",
    "",
    abstractBullets || "- 待补摘要素材。",
    "",
    "## 关键词素材",
    "",
    keywords.length ? keywords.map((item) => `- ${item}`).join("\n") : "- 待补关键词。",
    "",
    ...sections.flatMap((section) => [
      `## ${section.heading}`,
      "",
      renderSectionItems(section).trimEnd(),
      "",
    ]),
    "## 参考文献素材",
    "",
    references.length
      ? references.map((item) => `- [@${item.citationKey}] ${item.title} (${toText(item.year) || "n.d."}), ${toText(item.journal) || "Unknown Venue"}`).join("\n")
      : "- 暂无参考文献素材。",
    "",
  ].join("\n");
}

export function renderReferencesBib(references = []) {
  return (references || []).map((item, index) => {
    const citationKey = item.citationKey || buildCitationKey(item, index);
    const fields = [
      ["title", toText(item.title)],
      ["author", toText(item.authors || item.author || "")],
      ["journal", toText(item.journal)],
      ["year", toText(item.year)],
      ["doi", toText(item.doi)],
      ["url", toText(item.url)],
      ["abstract", toText(item.abstract)],
    ].filter(([, value]) => value);
    const body = fields.map(([name, value]) => `  ${name} = {${value}}`).join(",\n");
    return `@article{${citationKey},\n${body}\n}`;
  }).join("\n\n");
}

export async function writePaperAssets({ outputDir, payload, options = {} } = {}) {
  const paperMarkdown = renderPaperMarkdown(payload, options);
  const referencesBib = renderReferencesBib(payload?.references || []);
  const paperDocx = buildPaperDocxBuffer(payload, options);
  await fs.mkdir(outputDir, { recursive: true });
  const paperMarkdownPath = path.join(outputDir, "paper.md");
  const referencesBibPath = path.join(outputDir, "references.bib");
  const paperDocxPath = path.join(outputDir, "paper.docx");
  await fs.writeFile(paperMarkdownPath, `${paperMarkdown.trimEnd()}\n`, "utf8");
  await fs.writeFile(referencesBibPath, `${referencesBib.trimEnd()}\n`, "utf8");
  await fs.writeFile(paperDocxPath, paperDocx);
  return {
    paper_markdown: paperMarkdownPath,
    references_bib: referencesBibPath,
    paper_docx: paperDocxPath,
  };
}
