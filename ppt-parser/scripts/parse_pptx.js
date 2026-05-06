#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: true,
  trimValues: true,
});

const EMU_PER_INCH = 914400;
const CM_PER_INCH = 2.54;

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function localDateStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeJoin(root, archivePath) {
  const normalized = archivePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return path.join(root, ...normalized);
}

function classifyFile(archivePath) {
  if (archivePath.endsWith(".rels")) return "relationship";
  if (archivePath === "[Content_Types].xml") return "content-types";
  if (archivePath === "ppt/presentation.xml") return "presentation";
  if (/^ppt\/slides\/slide\d+\.xml$/i.test(archivePath)) return "slide";
  if (/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/i.test(archivePath)) return "slide-rels";
  if (/^ppt\/slideLayouts\/slideLayout\d+\.xml$/i.test(archivePath)) return "layout";
  if (/^ppt\/slideLayouts\/_rels\/slideLayout\d+\.xml\.rels$/i.test(archivePath)) return "layout-rels";
  if (/^ppt\/slideMasters\/slideMaster\d+\.xml$/i.test(archivePath)) return "master";
  if (/^ppt\/slideMasters\/_rels\/slideMaster\d+\.xml\.rels$/i.test(archivePath)) return "master-rels";
  if (/^ppt\/theme\/theme\d+\.xml$/i.test(archivePath)) return "theme";
  if (/^ppt\/charts\/chart\d+\.xml$/i.test(archivePath)) return "chart";
  if (/^ppt\/diagrams\//i.test(archivePath)) return "diagram";
  if (/^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(archivePath)) return "notes";
  if (/^ppt\/comments\//i.test(archivePath)) return "comments";
  if (/^ppt\/media\//i.test(archivePath) && /\.(png|jpe?g|gif|svg|emf|wmf|bmp|tiff?)$/i.test(archivePath)) return "image";
  if (/^ppt\/media\//i.test(archivePath)) return "media";
  if (/\.xml$/i.test(archivePath)) return "xml";
  return "other";
}

function parseXml(text) {
  if (!text) return null;
  try {
    return parser.parse(text);
  } catch {
    return null;
  }
}

function readZipText(zip, archivePath) {
  return zip.files[archivePath]?.async("string");
}

function relBasePath(relsPath) {
  if (relsPath === "_rels/.rels") return "";
  return relsPath
    .replace(/\/_rels\/([^/]+)\.rels$/i, "/$1")
    .replace(/^_rels\/\.rels$/i, "");
}

function normalizeTarget(baseFile, target) {
  if (!target) return "";
  if (/^[a-z]+:/i.test(target)) return target;
  const baseDir = path.posix.dirname(baseFile || "");
  return path.posix.normalize(path.posix.join(baseDir === "." ? "" : baseDir, target)).replace(/^\.\//, "");
}

function parseRelationships(xmlText, relsPath) {
  const obj = parseXml(xmlText);
  const rels = asArray(obj?.Relationships?.Relationship);
  const baseFile = relBasePath(relsPath);
  return rels.map((rel) => ({
    id: rel["@_Id"] || "",
    type: rel["@_Type"] || "",
    target: rel["@_Target"] || "",
    targetMode: rel["@_TargetMode"] || "",
    resolvedTarget: normalizeTarget(baseFile, rel["@_Target"] || ""),
  }));
}

function extractText(obj) {
  const texts = [];
  function walk(node) {
    if (node == null) return;
    if (typeof node === "string" || typeof node === "number") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node["a:t"] != null) texts.push(String(node["a:t"]));
    for (const value of Object.values(node)) walk(value);
  }
  walk(obj);
  return texts;
}

function collectIds(obj, keyName) {
  const ids = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node[keyName]) ids.push(node[keyName]);
    for (const value of Object.values(node)) walk(value);
  }
  walk(obj);
  return [...new Set(ids.filter(Boolean))];
}

function collectBlipIds(obj) {
  const ids = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const blip = node["a:blip"];
    if (blip?.["@_r:embed"]) ids.push(blip["@_r:embed"]);
    if (blip?.["@_r:link"]) ids.push(blip["@_r:link"]);
    for (const value of Object.values(node)) walk(value);
  }
  walk(obj);
  return [...new Set(ids)];
}

function extractPresentationInfo(presentationObj) {
  const pres = presentationObj?.["p:presentation"];
  const sldSz = pres?.["p:sldSz"];
  const slideIds = asArray(pres?.["p:sldIdLst"]?.["p:sldId"]);
  const slideMasters = asArray(pres?.["p:sldMasterIdLst"]?.["p:sldMasterId"]);
  return {
    slideCount: slideIds.length,
    slideSize: sldSz ? {
      cx: Number(sldSz["@_cx"] || 0),
      cy: Number(sldSz["@_cy"] || 0),
      widthCm: Number(((Number(sldSz["@_cx"] || 0) / EMU_PER_INCH) * CM_PER_INCH).toFixed(2)),
      heightCm: Number(((Number(sldSz["@_cy"] || 0) / EMU_PER_INCH) * CM_PER_INCH).toFixed(2)),
      type: sldSz["@_type"] || "",
    } : null,
    slideIds: slideIds.map((slide, index) => ({
      index: index + 1,
      id: slide["@_id"] || "",
      relId: slide["@_r:id"] || "",
    })),
    masterIds: slideMasters.map((master) => ({
      id: master["@_id"] || "",
      relId: master["@_r:id"] || "",
    })),
  };
}

function relationshipLookup(relationships) {
  const bySource = {};
  for (const item of relationships) bySource[item.source] = item.relationships;
  return bySource;
}

function relById(rels, id) {
  return rels.find((rel) => rel.id === id) || null;
}

function copyAsset(rawPath, outputDir, archivePath, type) {
  const targetDir = path.join(outputDir, type === "image" ? "images" : "media");
  ensureDir(targetDir);
  const base = path.basename(archivePath);
  const target = path.join(targetDir, base);
  if (!fs.existsSync(target)) fs.copyFileSync(rawPath, target);
  return target;
}

async function parsePptx(pptxPath) {
  const absolutePath = path.resolve(pptxPath);
  if (!fs.existsSync(absolutePath)) throw new Error(`File not found: ${absolutePath}`);

  const templateName = path.basename(absolutePath, path.extname(absolutePath));
  const date = localDateStamp();
  const outputBaseName = `${templateName}_${date}`;
  const outputDir = path.join(path.dirname(absolutePath), outputBaseName);
  const rawDir = path.join(outputDir, "raw");
  ensureDir(rawDir);

  const zip = await JSZip.loadAsync(fs.readFileSync(absolutePath));
  const archivePaths = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
  const manifest = {
    version: 2,
    sourcePptx: absolutePath,
    templateName,
    date,
    outputBaseName,
    outputDir,
    files: [],
    relationships: [],
    indexes: {
      slides: [],
      layouts: [],
      masters: [],
      themes: [],
      charts: [],
      diagrams: [],
      notes: [],
      images: [],
      media: [],
    },
  };

  for (const archivePath of archivePaths) {
    const rawPath = safeJoin(rawDir, archivePath);
    ensureDir(path.dirname(rawPath));
    const data = await zip.files[archivePath].async("nodebuffer");
    fs.writeFileSync(rawPath, data);
    const type = classifyFile(archivePath);
    const fileEntry = {
      path: archivePath,
      rawPath,
      type,
      size: data.length,
    };
    if (type === "image" || type === "media") {
      fileEntry.assetPath = copyAsset(rawPath, outputDir, archivePath, type);
    }
    manifest.files.push(fileEntry);
    if (type === "slide") manifest.indexes.slides.push(archivePath);
    if (type === "layout") manifest.indexes.layouts.push(archivePath);
    if (type === "master") manifest.indexes.masters.push(archivePath);
    if (type === "theme") manifest.indexes.themes.push(archivePath);
    if (type === "chart") manifest.indexes.charts.push(archivePath);
    if (type === "diagram") manifest.indexes.diagrams.push(archivePath);
    if (type === "notes") manifest.indexes.notes.push(archivePath);
    if (type === "image") manifest.indexes.images.push(archivePath);
    if (type === "media") manifest.indexes.media.push(archivePath);
  }

  for (const relFile of manifest.files.filter((file) => file.type === "relationship" || file.type.endsWith("-rels"))) {
    const relText = fs.readFileSync(relFile.rawPath, "utf8");
    manifest.relationships.push({
      source: relBasePath(relFile.path),
      relsPath: relFile.path,
      relationships: parseRelationships(relText, relFile.path),
    });
  }

  const relLookup = relationshipLookup(manifest.relationships);
  const presentationObj = parseXml(await readZipText(zip, "ppt/presentation.xml"));
  const presentation = extractPresentationInfo(presentationObj);
  const presentationRels = relLookup["ppt/presentation.xml"] || [];
  const slides = [];

  for (const slideInfo of presentation.slideIds) {
    const slideRel = relById(presentationRels, slideInfo.relId);
    const slidePath = slideRel?.resolvedTarget || `ppt/slides/slide${slideInfo.index}.xml`;
    const slideObj = parseXml(await readZipText(zip, slidePath));
    const slideRels = relLookup[slidePath] || [];
    const texts = extractText(slideObj);
    const imageRelIds = collectBlipIds(slideObj);
    const chartRelIds = collectIds(slideObj, "@_r:id").filter((id) => {
      const rel = relById(slideRels, id);
      return rel?.type.includes("/chart");
    });
    const layoutRel = slideRels.find((rel) => rel.type.includes("/slideLayout")) || null;
    const notesRel = slideRels.find((rel) => rel.type.includes("/notesSlide")) || null;
    slides.push({
      index: slideInfo.index,
      slideId: slideInfo.id,
      relId: slideInfo.relId,
      path: slidePath,
      relsPath: `ppt/slides/_rels/${path.posix.basename(slidePath)}.rels`,
      layout: layoutRel,
      notes: notesRel,
      textPreview: texts.join(" ").replace(/\s+/g, " ").trim().slice(0, 500),
      textLength: texts.join("").length,
      imageRefs: imageRelIds.map((id) => ({ id, relationship: relById(slideRels, id) })),
      chartRefs: chartRelIds.map((id) => ({ id, relationship: relById(slideRels, id) })),
    });
  }

  const summary = {
    version: 2,
    sourcePptx: absolutePath,
    templateName,
    date,
    outputBaseName,
    outputDir,
    manifestFile: path.join(outputDir, `${outputBaseName}_manifest.json`),
    presentation,
    slides,
    counts: {
      archiveFiles: manifest.files.length,
      slides: slides.length,
      layouts: manifest.indexes.layouts.length,
      masters: manifest.indexes.masters.length,
      themes: manifest.indexes.themes.length,
      charts: manifest.indexes.charts.length,
      diagrams: manifest.indexes.diagrams.length,
      notes: manifest.indexes.notes.length,
      images: manifest.indexes.images.length,
      media: manifest.indexes.media.length,
      relationships: manifest.relationships.length,
    },
    specialContent: {
      hasNotes: manifest.indexes.notes.length > 0,
      hasComments: manifest.files.some((file) => file.type === "comments"),
      hasMedia: manifest.indexes.media.length > 0,
      hasCustomXml: manifest.files.some((file) => file.path.startsWith("customXml/") || file.path.startsWith("ppt/customXml/")),
      hasVba: manifest.files.some((file) => /vbaProject\.bin$/i.test(file.path) || file.path.startsWith("ppt/vba")),
    },
  };

  const summaryLines = [
    "=== PPT PARSER SUMMARY ===",
    `Source: ${absolutePath}`,
    `Output: ${outputDir}`,
    `Slides: ${summary.counts.slides}`,
    `Layouts: ${summary.counts.layouts}`,
    `Masters: ${summary.counts.masters}`,
    `Themes: ${summary.counts.themes}`,
    `Charts: ${summary.counts.charts}`,
    `Images: ${summary.counts.images}`,
    `Media: ${summary.counts.media}`,
    "",
    "=== OUTPUT FILES ===",
    `${outputBaseName}_manifest.json`,
    `${outputBaseName}_summary.json`,
    `${outputBaseName}_summary.txt`,
    "",
    "=== SLIDE TEXT PREVIEW ===",
    ...slides.map((slide) => `Slide ${slide.index}: ${slide.textPreview || "(empty)"}`),
  ];

  const manifestPath = path.join(outputDir, `${outputBaseName}_manifest.json`);
  const summaryJsonPath = path.join(outputDir, `${outputBaseName}_summary.json`);
  const summaryTextPath = path.join(outputDir, `${outputBaseName}_summary.txt`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(summaryTextPath, summaryLines.join("\n"), "utf8");

  console.log(summaryLines.join("\n"));
  console.log(`\nDone. Parsed output saved to: ${outputDir}`);
}

const args = process.argv.slice(2);
if (!args[0]) {
  console.error("Usage: node scripts/parse_pptx.js <path-to-pptx-file>");
  process.exit(1);
}

parsePptx(args[0]).catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
