#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readXml(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return parser.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { __parseError: error.message };
  }
}

function archiveRawPath(root, archivePath) {
  return path.join(root, "raw", ...archivePath.split("/"));
}

function findNamedFile(root, suffix) {
  const base = path.basename(root);
  const preferred = path.join(root, `${base}_${suffix}`);
  if (fs.existsSync(preferred)) return preferred;
  const candidates = fs.readdirSync(root).filter((file) => file.endsWith(`_${suffix}`) && !file.startsWith("_"));
  if (candidates.length === 0) return "";
  return path.join(root, candidates.sort()[0]);
}

function relationshipMap(manifest) {
  const map = new Map();
  for (const item of manifest.relationships || []) {
    map.set(item.source, item.relationships || []);
  }
  return map;
}

function relById(rels, id) {
  return (rels || []).find((rel) => rel.id === id) || null;
}

function emuToCm(value) {
  return Number(((Number(value || 0) / EMU_PER_INCH) * CM_PER_INCH).toFixed(2));
}

function normalizeHex(hex) {
  if (!hex) return "";
  const clean = String(hex).replace("#", "").trim();
  if (!/^[0-9a-fA-F]{3,8}$/.test(clean)) return "";
  return clean.slice(0, 6).padStart(6, "0").toUpperCase();
}

function readColorNode(node, themeColors = {}) {
  if (!node || typeof node !== "object") return {};
  if (node["a:srgbClr"]) return { hex: normalizeHex(node["a:srgbClr"]["@_val"]), source: "srgb" };
  if (node["a:schemeClr"]) {
    const scheme = node["a:schemeClr"]["@_val"] || "";
    return { hex: themeColors[scheme] || "", scheme, source: "scheme" };
  }
  if (node["a:sysClr"]) return { hex: normalizeHex(node["a:sysClr"]["@_lastClr"] || node["a:sysClr"]["@_val"]), source: "system" };
  return {};
}

function findFirstColor(node, themeColors = {}) {
  if (!node || typeof node !== "object") return {};
  const direct = readColorNode(node, themeColors);
  if (direct.hex || direct.scheme) return direct;
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      const found = findFirstColor(value, themeColors);
      if (found.hex || found.scheme) return found;
    }
  }
  return {};
}

function collectColors(node, themeColors = {}, counts = new Map()) {
  if (!node || typeof node !== "object") return counts;
  if (Array.isArray(node)) {
    node.forEach((item) => collectColors(item, themeColors, counts));
    return counts;
  }
  const color = readColorNode(node, themeColors);
  const key = color.hex || (color.scheme ? `scheme:${color.scheme}` : "");
  if (key) counts.set(key, (counts.get(key) || 0) + 1);
  for (const value of Object.values(node)) collectColors(value, themeColors, counts);
  return counts;
}

function getTheme(themeObj) {
  const theme = themeObj?.["a:theme"];
  const elements = theme?.["a:themeElements"] || {};
  const clrScheme = elements["a:clrScheme"] || {};
  const colors = {};
  for (const [key, value] of Object.entries(clrScheme)) {
    if (!key.startsWith("a:")) continue;
    const color = readColorNode(value, {});
    if (color.hex) colors[key.slice(2)] = color.hex;
  }
  const fontScheme = elements["a:fontScheme"] || {};
  const major = fontScheme["a:majorFont"] || {};
  const minor = fontScheme["a:minorFont"] || {};
  const majorCjk = asArray(major["a:font"]).find((font) => ["Hans", "Hant"].includes(font["@_script"]));
  const minorCjk = asArray(minor["a:font"]).find((font) => ["Hans", "Hant"].includes(font["@_script"]));
  return {
    name: theme?.["@_name"] || "",
    colors: Object.fromEntries(Object.entries(colors).map(([role, hex]) => [role, `#${hex}`])),
    colorMap: colors,
    fonts: {
      titleLatin: major["a:latin"]?.["@_typeface"] || "",
      bodyLatin: minor["a:latin"]?.["@_typeface"] || "",
      titleCjk: majorCjk?.["@_typeface"] || "",
      bodyCjk: minorCjk?.["@_typeface"] || "",
    },
  };
}

function getSlideSize(presentationObj, summary) {
  const sldSz = presentationObj?.["p:presentation"]?.["p:sldSz"];
  const cx = Number(sldSz?.["@_cx"] || summary?.presentation?.slideSize?.cx || 12192000);
  const cy = Number(sldSz?.["@_cy"] || summary?.presentation?.slideSize?.cy || 6858000);
  return {
    cx,
    cy,
    widthCm: emuToCm(cx),
    heightCm: emuToCm(cy),
    ratio: Math.abs(cx / cy - 16 / 9) < 0.05 ? "16:9" : `${(cx / cy).toFixed(2)}:1`,
  };
}

function getTransform(node) {
  const xfrm = node?.["p:spPr"]?.["a:xfrm"]
    || node?.["p:pic"]?.["p:spPr"]?.["a:xfrm"]
    || node?.["p:graphicFrame"]?.["p:xfrm"]
    || node?.["p:xfrm"];
  const off = xfrm?.["a:off"];
  const ext = xfrm?.["a:ext"];
  return {
    x: Number(off?.["@_x"] || 0),
    y: Number(off?.["@_y"] || 0),
    w: Number(ext?.["@_cx"] || 0),
    h: Number(ext?.["@_cy"] || 0),
  };
}

function boxInfo(box, slideSize) {
  if (!box || (!box.x && !box.y && !box.w && !box.h)) return {};
  return {
    xCm: emuToCm(box.x),
    yCm: emuToCm(box.y),
    wCm: emuToCm(box.w),
    hCm: emuToCm(box.h),
    xPct: Number(((box.x / slideSize.cx) * 100).toFixed(1)),
    yPct: Number(((box.y / slideSize.cy) * 100).toFixed(1)),
    wPct: Number(((box.w / slideSize.cx) * 100).toFixed(1)),
    hPct: Number(((box.h / slideSize.cy) * 100).toFixed(1)),
  };
}

function textRuns(txBody, themeColors) {
  const runs = [];
  for (const paragraph of asArray(txBody?.["a:p"])) {
    for (const run of asArray(paragraph?.["a:r"])) {
      const text = run?.["a:t"];
      if (text == null) continue;
      const rPr = run?.["a:rPr"] || {};
      const color = findFirstColor(rPr["a:solidFill"], themeColors);
      runs.push({
        text: String(text),
        fontSizePt: rPr["@_sz"] ? Number(rPr["@_sz"]) / 100 : null,
        fontFamily: rPr["a:latin"]?.["@_typeface"] || rPr["a:ea"]?.["@_typeface"] || "",
        color: color.hex ? `#${color.hex}` : color.scheme ? `scheme:${color.scheme}` : "",
        bold: rPr["@_b"] === "1",
        italic: rPr["@_i"] === "1",
      });
    }
    for (const field of asArray(paragraph?.["a:fld"])) {
      if (field?.["a:t"]) runs.push({ text: String(field["a:t"]), fieldType: field["@_type"] || "" });
    }
  }
  return runs;
}

function extractElements(rootNode, slideSize, themeColors, rels) {
  const elements = [];
  function addShape(sp) {
    const cNvPr = sp?.["p:nvSpPr"]?.["p:cNvPr"] || {};
    const spPr = sp?.["p:spPr"] || {};
    const runs = textRuns(sp?.["p:txBody"], themeColors);
    const fill = findFirstColor(spPr["a:solidFill"], themeColors);
    const placeholder = sp?.["p:nvSpPr"]?.["p:nvPr"]?.["p:ph"] || {};
    const box = getTransform(sp);
    elements.push({
      type: runs.length ? "text" : "shape",
      id: cNvPr["@_id"] || "",
      name: cNvPr["@_name"] || "",
      placeholderType: placeholder["@_type"] || "",
      shapeType: spPr["a:prstGeom"]?.["@_prst"] || "",
      text: runs.map((run) => run.text).join("").trim(),
      textRuns: runs,
      fill: fill.hex ? `#${fill.hex}` : fill.scheme ? `scheme:${fill.scheme}` : "",
      box,
      boxPercent: boxInfo(box, slideSize),
    });
  }
  function addPicture(pic) {
    const cNvPr = pic?.["p:nvPicPr"]?.["p:cNvPr"] || {};
    const relId = pic?.["p:blipFill"]?.["a:blip"]?.["@_r:embed"] || pic?.["p:blipFill"]?.["a:blip"]?.["@_r:link"] || "";
    const relationship = relById(rels, relId);
    const box = getTransform({ "p:pic": pic });
    elements.push({
      type: "image",
      id: cNvPr["@_id"] || "",
      name: cNvPr["@_name"] || "",
      relId,
      target: relationship?.resolvedTarget || "",
      relationship,
      box,
      boxPercent: boxInfo(box, slideSize),
    });
  }
  function addGraphic(frame) {
    const cNvPr = frame?.["p:nvGraphicFramePr"]?.["p:cNvPr"] || {};
    const graphicData = frame?.["a:graphic"]?.["a:graphicData"] || {};
    const chartRelId = graphicData["c:chart"]?.["@_r:id"] || "";
    const relationship = relById(rels, chartRelId);
    let type = "graphic";
    if (graphicData["a:tbl"]) type = "table";
    if (chartRelId) type = "chart";
    if (graphicData["dgm:relIds"]) type = "smartArt";
    const box = getTransform({ "p:graphicFrame": frame });
    elements.push({
      type,
      id: cNvPr["@_id"] || "",
      name: cNvPr["@_name"] || "",
      relId: chartRelId,
      target: relationship?.resolvedTarget || "",
      relationship,
      box,
      boxPercent: boxInfo(box, slideSize),
    });
  }
  function walk(node) {
    if (!node || typeof node !== "object") return;
    for (const sp of asArray(node["p:sp"])) addShape(sp);
    for (const pic of asArray(node["p:pic"])) addPicture(pic);
    for (const frame of asArray(node["p:graphicFrame"])) addGraphic(frame);
    for (const group of asArray(node["p:grpSp"])) walk(group);
  }
  walk(rootNode);
  return elements;
}

function classifySlide(index, total, elements) {
  const text = elements.map((element) => element.text || "").join("\n").toLowerCase();
  if (index === 1) return "cover";
  if (index === total) return "ending";
  if (/agenda|contents|overview|table of contents|\u76ee\u5f55|\u76ee\u9304/.test(text)) return "toc";
  if (elements.some((element) => element.type === "chart" || element.type === "table")) return "data";
  if (elements.filter((element) => element.type === "image").length >= 2) return "image-rich";
  return "content";
}

function summarizeLayoutLike(rootNode, slideSize, themeColors) {
  const elements = extractElements(rootNode, slideSize, themeColors, []);
  return {
    placeholders: elements.filter((element) => element.placeholderType).map((element) => ({
      name: element.name,
      type: element.placeholderType,
      box: element.boxPercent,
    })),
    persistentElements: elements.filter((element) => !element.placeholderType).slice(0, 20),
  };
}

function outputPaths(root, baseName, requested) {
  if (requested) {
    const resolved = path.resolve(requested);
    if (resolved.toLowerCase().endsWith(".json")) return { jsonPath: resolved, markdownPath: resolved.replace(/\.json$/i, ".md") };
    return { markdownPath: resolved, jsonPath: resolved.replace(/\.md$/i, "") + ".json" };
  }
  return {
    markdownPath: path.join(root, `${baseName}_template_report.md`),
    jsonPath: path.join(root, `${baseName}_template_report.json`),
  };
}

function buildMarkdown(analysis) {
  const lines = [];
  const slideTypeCounts = analysis.summary.slideTypes || {};
  const imageUse = analysis.slides.filter((slide) => slide.imageTargets.length > 0);
  const chartUse = analysis.slides.filter((slide) => slide.chartTargets.length > 0);
  const transitionUse = analysis.slides.filter((slide) => slide.transition);
  const timingUse = analysis.slides.filter((slide) => slide.timingEffectCount > 0);
  const titleFont = analysis.theme.fonts.titleCjk || analysis.theme.fonts.titleLatin || "unknown";
  const bodyFont = analysis.theme.fonts.bodyCjk || analysis.theme.fonts.bodyLatin || "unknown";

  lines.push("# PPT \u6a21\u677f\u8bed\u4e49\u5316\u5206\u6790\u62a5\u544a", "");

  lines.push("## \u57fa\u7840\u4fe1\u606f", "");
  lines.push(`- \u5f85\u5206\u6790\u76ee\u5f55: ${analysis.sourceFolder}`);
  lines.push(`- \u5e7b\u706f\u7247\u6570\u91cf: ${analysis.presentation.totalSlides}`);
  lines.push(`- \u9875\u9762\u5c3a\u5bf8: ${analysis.presentation.slideSize.widthCm} cm x ${analysis.presentation.slideSize.heightCm} cm (${analysis.presentation.slideSize.ratio})`);
  lines.push(`- \u4e3b\u9898\u6587\u4ef6: ${analysis.themeFiles.length}`);
  lines.push(`- \u7248\u5f0f\u6587\u4ef6: ${analysis.layouts.length}`);
  lines.push(`- \u6bcd\u7248\u6587\u4ef6: ${analysis.masters.length}`);
  lines.push(`- \u7ed3\u6784\u5316\u8f93\u51fa: ${path.basename(analysis.output.jsonPath)}`);
  lines.push("");

  lines.push("## \u89e3\u6790\u76ee\u5f55\u5b8c\u6574\u6027\u68c0\u67e5", "");
  lines.push(`- Manifest: ${path.basename(analysis.manifestPath)}`);
  lines.push(`- Summary: ${path.basename(analysis.summaryPath)}`);
  lines.push(`- \u5df2\u8bfb\u53d6\u5173\u952e\u8f93\u5165: ${analysis.requiredInputsRead.length}`);
  if (analysis.inputCompleteness.missingRequiredInputs.length > 0) {
    lines.push("- \u7f3a\u5931\u7684\u5fc5\u8981\u8f93\u5165:");
    for (const item of analysis.inputCompleteness.missingRequiredInputs) lines.push(`  - ${item}`);
  } else {
    lines.push("- \u5fc5\u8981\u8f93\u5165\u672a\u53d1\u73b0\u7f3a\u5931\u9879");
  }
  lines.push("- \u5df2\u8bfb\u53d6\u8def\u5f84:");
  for (const item of analysis.requiredInputsRead) lines.push(`  - ${item}`);
  lines.push("");

  lines.push("## \u4e3b\u9898\u8272\u7cfb\u7edf", "");
  if (Object.keys(analysis.theme.colors).length) {
    lines.push("| \u89d2\u8272 | \u8272\u503c |", "|---|---|");
    for (const [role, color] of Object.entries(analysis.theme.colors)) lines.push(`| ${role} | \`${color}\` |`);
  } else {
    lines.push("- \u672a\u8bc6\u522b\u5230\u4e3b\u9898\u8272\u8868");
  }
  if (analysis.summary.commonColors.length) {
    lines.push(`- \u5e7b\u706f\u7247\u9ad8\u9891\u989c\u8272: ${analysis.summary.commonColors.slice(0, 8).map((item) => item.color).join(", ")}`);
  }
  lines.push("");

  lines.push("## \u5b57\u4f53\u7cfb\u7edf", "");
  lines.push(`- \u6807\u9898\u5b57\u4f53: ${titleFont}`);
  lines.push(`- \u6b63\u6587\u5b57\u4f53: ${bodyFont}`);
  lines.push(`- \u5b9e\u9645\u4f7f\u7528\u5b57\u4f53: ${analysis.summary.commonFonts.length ? analysis.summary.commonFonts.join(", ") : "unknown"}`);
  lines.push("");

  lines.push("## \u6bcd\u7248\u4e0e\u7248\u5f0f\u7cfb\u7edf", "");
  lines.push(`- \u6bcd\u7248\u6570\u91cf: ${analysis.masters.length}`);
  lines.push(`- \u7248\u5f0f\u6570\u91cf: ${analysis.layouts.length}`);
  if (analysis.layouts.length) {
    lines.push("- \u7248\u5f0f\u6982\u89c8:");
    for (const layout of analysis.layouts.slice(0, 20)) {
      lines.push(`  - ${layout.path}${layout.name ? ` (${layout.name})` : ""}: placeholders ${layout.placeholders.length}, persistent ${layout.persistentElements.length}`);
    }
  }
  if (analysis.masters.length) {
    lines.push("- \u6bcd\u7248\u6982\u89c8:");
    for (const master of analysis.masters.slice(0, 10)) {
      lines.push(`  - ${master.path}: placeholders ${master.placeholders.length}, persistent ${master.persistentElements.length}`);
    }
  }
  lines.push("");

  lines.push("## \u9875\u9762\u7c7b\u578b\u5f52\u7eb3", "");
  if (Object.keys(slideTypeCounts).length) {
    lines.push(`- \u7c7b\u578b\u5206\u5e03: ${Object.entries(slideTypeCounts).map(([type, count]) => `${type} ${count}`).join(", ")}`);
  }
  for (const slide of analysis.slides) {
    const counts = Object.entries(slide.elementCounts).map(([key, value]) => `${key}: ${value}`).join(", ");
    lines.push(`### Slide ${slide.index} (${slide.type})`, "");
    lines.push(`- Path: ${slide.path}`);
    lines.push(`- Layout: ${slide.layout?.resolvedTarget || "unknown"}`);
    lines.push(`- Elements: ${counts || "none"}`);
    if (slide.textPreview) lines.push(`- Text: ${slide.textPreview}`);
    lines.push("");
  }

  lines.push("## \u56fe\u7247/\u56fe\u8868/\u5a92\u4f53\u4f7f\u7528", "");
  lines.push(`- \u56fe\u7247\u9875\u6570: ${imageUse.length}`);
  lines.push(`- \u56fe\u8868\u9875\u6570: ${chartUse.length}`);
  lines.push(`- Parser \u5a92\u4f53\u8ba1\u6570: ${analysis.parserCounts.media || 0}`);
  if (imageUse.length) {
    lines.push("- \u56fe\u7247\u5f15\u7528:");
    for (const slide of imageUse) lines.push(`  - Slide ${slide.index}: ${slide.imageTargets.join(", ")}`);
  }
  if (chartUse.length) {
    lines.push("- \u56fe\u8868\u5f15\u7528:");
    for (const slide of chartUse) lines.push(`  - Slide ${slide.index}: ${slide.chartTargets.join(", ")}`);
  }
  lines.push("");

  lines.push("## \u52a8\u753b\u4e0e\u8f6c\u573a", "");
  lines.push(`- \u8f6c\u573a\u9875\u6570: ${transitionUse.length}`);
  lines.push(`- Timing \u6548\u679c\u9875\u6570: ${timingUse.length}`);
  for (const slide of [...new Set([...transitionUse, ...timingUse])].sort((a, b) => a.index - b.index)) {
    lines.push(`- Slide ${slide.index}: transition ${slide.transition || "none"}, timing effects ${slide.timingEffectCount || 0}`);
  }
  lines.push("");

  lines.push("## \u6a21\u677f\u98ce\u683c\u603b\u7ed3", "");
  lines.push(`- \u6a21\u677f\u4e3b\u8981\u4f9d\u8d56 ${analysis.themeFiles.length ? "theme color/font scheme" : "slide-level styles"}`);
  lines.push(`- \u9875\u9762\u7ed3\u6784\u4ee5 ${Object.entries(slideTypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown"} \u4e3a\u4e3b`);
  lines.push(`- \u56fe\u6587\u5bc6\u5ea6: images ${imageUse.length}, charts ${chartUse.length}, data slides ${slideTypeCounts.data || 0}`);
  lines.push(`- \u89c6\u89c9\u5224\u65ad\u8bf4\u660e: \u672c\u62a5\u544a\u57fa\u4e8e PPTX XML \u7ed3\u6784\u548c rels \u5173\u7cfb\u63a8\u65ad\uff0c\u6700\u7ec8\u89c6\u89c9\u6548\u679c\u5efa\u8bae\u7ed3\u5408\u622a\u56fe\u590d\u6838`);
  lines.push("");

  lines.push("## \u53ef\u590d\u7528\u8bbe\u8ba1\u89c4\u8303\u5efa\u8bae", "");
  lines.push(`- \u5efa\u8bae\u5c06\u9875\u9762\u5c3a\u5bf8\u56fa\u5b9a\u4e3a ${analysis.presentation.slideSize.widthCm} cm x ${analysis.presentation.slideSize.heightCm} cm`);
  lines.push(`- \u5efa\u8bae\u4f18\u5148\u590d\u7528\u4e3b\u9898\u8272: ${Object.values(analysis.theme.colors).slice(0, 6).join(", ") || "not detected"}`);
  lines.push(`- \u5efa\u8bae\u4f7f\u7528\u6807\u9898\u5b57\u4f53 ${titleFont} \u548c\u6b63\u6587\u5b57\u4f53 ${bodyFont}`);
  lines.push("- \u5efa\u8bae\u4ee5\u6bcd\u7248\u548c\u7248\u5f0f\u4e2d\u7684 placeholder \u4f4d\u7f6e\u4f5c\u4e3a\u65b0\u9875\u9762\u6392\u7248\u57fa\u51c6");
  lines.push("- \u5efa\u8bae\u5bf9\u56fe\u7247\u3001\u56fe\u8868\u3001\u52a8\u753b\u9875\u9762\u8fdb\u884c\u89c6\u89c9\u622a\u56fe\u590d\u6838\uff0c\u518d\u7528\u4e8e\u6a21\u677f\u590d\u523b");
  return lines.join("\n");
}

function analyze(folderPath, requestedOutput) {
  const root = path.resolve(folderPath);
  if (!fs.existsSync(root)) throw new Error(`Folder not found: ${root}`);
  const baseName = path.basename(root);
  const manifestPath = findNamedFile(root, "manifest.json");
  const summaryPath = findNamedFile(root, "summary.json");
  if (!manifestPath) throw new Error("Named manifest file not found. Expected <PPT_NAME>_<YYYYMMDD>_manifest.json");
  if (!summaryPath) throw new Error("Named summary file not found. Expected <PPT_NAME>_<YYYYMMDD>_summary.json");

  const manifest = readJson(manifestPath);
  const summary = readJson(summaryPath);
  const rels = relationshipMap(manifest);
  const requiredInputsRead = [path.basename(manifestPath), path.basename(summaryPath)];
  const missingRequiredInputs = [];

  function readArchiveXml(archivePath) {
    const rawPath = archiveRawPath(root, archivePath);
    requiredInputsRead.push(archivePath);
    if (!fs.existsSync(rawPath)) missingRequiredInputs.push(archivePath);
    return readXml(rawPath);
  }

  const presentationObj = readArchiveXml("ppt/presentation.xml");
  readArchiveXml("ppt/_rels/presentation.xml.rels");
  const slideSize = getSlideSize(presentationObj, summary);
  const themeFiles = manifest.indexes?.themes || [];
  const themeObj = themeFiles[0] ? readArchiveXml(themeFiles[0]) : {};
  const theme = getTheme(themeObj);
  const themeColors = theme.colorMap;

  const layouts = (manifest.indexes?.layouts || []).map((layoutPath) => {
    const obj = readArchiveXml(layoutPath);
    const relPath = `ppt/slideLayouts/_rels/${path.posix.basename(layoutPath)}.rels`;
    if (fs.existsSync(archiveRawPath(root, relPath))) readArchiveXml(relPath);
    return {
      path: layoutPath,
      name: obj?.["p:sldLayout"]?.["p:cSld"]?.["@_name"] || "",
      ...summarizeLayoutLike(obj?.["p:sldLayout"]?.["p:cSld"]?.["p:spTree"], slideSize, themeColors),
    };
  });

  const masters = (manifest.indexes?.masters || []).map((masterPath) => {
    const obj = readArchiveXml(masterPath);
    const relPath = `ppt/slideMasters/_rels/${path.posix.basename(masterPath)}.rels`;
    if (fs.existsSync(archiveRawPath(root, relPath))) readArchiveXml(relPath);
    return {
      path: masterPath,
      ...summarizeLayoutLike(obj?.["p:sldMaster"]?.["p:cSld"]?.["p:spTree"], slideSize, themeColors),
    };
  });

  const slideInputs = summary.slides?.length ? summary.slides : (manifest.indexes?.slides || []).map((slidePath, index) => ({ index: index + 1, path: slidePath }));
  const slides = slideInputs.map((slideInfo, idx) => {
    const slidePath = slideInfo.path;
    const slideObj = readArchiveXml(slidePath);
    const slideRelPath = `ppt/slides/_rels/${path.posix.basename(slidePath)}.rels`;
    if (fs.existsSync(archiveRawPath(root, slideRelPath))) readArchiveXml(slideRelPath);
    const slideRels = rels.get(slidePath) || [];
    const elements = extractElements(slideObj?.["p:sld"]?.["p:cSld"]?.["p:spTree"], slideSize, themeColors, slideRels);
    const colors = [...collectColors(slideObj, themeColors).entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([color, count]) => ({ color: color.startsWith("scheme:") ? color : `#${color}`, count }));
    const transition = slideObj?.["p:sld"]?.["p:transition"];
    const timingRaw = JSON.stringify(slideObj?.["p:sld"]?.["p:timing"] || {});
    const timingEffectCount = (timingRaw.match(/presetClass|presetID/g) || []).length;
    const layout = slideInfo.layout || slideRels.find((rel) => rel.type.includes("/slideLayout")) || null;
    const imageTargets = elements.filter((element) => element.type === "image" && element.target).map((element) => element.target);
    const chartTargets = elements.filter((element) => element.type === "chart" && element.target).map((element) => element.target);
    return {
      index: slideInfo.index || idx + 1,
      path: slidePath,
      relsPath: slideRelPath,
      type: classifySlide(slideInfo.index || idx + 1, slideInputs.length, elements),
      layout,
      notes: slideInfo.notes || slideRels.find((rel) => rel.type.includes("/notesSlide")) || null,
      elementCounts: elements.reduce((acc, element) => {
        acc[element.type] = (acc[element.type] || 0) + 1;
        return acc;
      }, {}),
      imageTargets,
      chartTargets,
      colors: colors.slice(0, 12),
      transition: transition ? Object.keys(transition).find((key) => !key.startsWith("@_")) || "transition" : "",
      timingEffectCount,
      textPreview: elements.filter((element) => element.text).map((element) => element.text).join(" ").replace(/\s+/g, " ").slice(0, 300),
      elements,
    };
  });

  const output = outputPaths(root, baseName, requestedOutput);
  const analysis = {
    version: 2,
    generatedAt: new Date().toISOString(),
    sourceFolder: root,
    manifestPath,
    summaryPath,
    output,
    requiredInputsRead: [...new Set(requiredInputsRead)],
    presentation: {
      totalSlides: slides.length,
      slideSize,
      parserSummary: summary.presentation || {},
    },
    parserCounts: summary.counts || {},
    parserSpecialContent: summary.specialContent || {},
    inputCompleteness: {
      missingRequiredInputs: [...new Set(missingRequiredInputs)],
    },
    themeFiles,
    theme,
    layouts,
    masters,
    slides,
    summary: {
      slideTypes: slides.reduce((acc, slide) => {
        acc[slide.type] = (acc[slide.type] || 0) + 1;
        return acc;
      }, {}),
      commonColors: slides.flatMap((slide) => slide.colors).slice(0, 20),
      commonFonts: [...new Set(slides.flatMap((slide) => slide.elements.flatMap((element) => (element.textRuns || []).map((run) => run.fontFamily).filter(Boolean))))],
    },
  };

  fs.writeFileSync(output.jsonPath, JSON.stringify(analysis, null, 2), "utf8");
  fs.writeFileSync(output.markdownPath, buildMarkdown(analysis), "utf8");
  return analysis;
}

const args = process.argv.slice(2);
if (!args[0]) {
  console.error("Usage: node scripts/analyze_template.js <parsed-pptx-folder> [report-output.md|analysis-output.json]");
  process.exit(1);
}

try {
  const analysis = analyze(args[0], args[1]);
  console.log(`Template report saved: ${analysis.output.markdownPath}`);
  console.log(`Template analysis JSON saved: ${analysis.output.jsonPath}`);
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

module.exports = { analyze };
