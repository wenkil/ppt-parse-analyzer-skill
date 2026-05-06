---
name: ppt-template-analyzer
description: >-
  Analyze the output folder produced by ppt-parser and extract a reusable PowerPoint template design report. Use when user needs to summarize a parsed PPTX design system, including theme colors, typography, slide dimensions, master/layout placeholders, slide element positions, images, charts, tables, transitions, timing hints, and template style patterns. This skill expects the newer ppt-parser raw/ plus named manifest/summary output structure.
---

# PPT Template Analyzer

Use this skill after `ppt-parser` has produced a parsed output directory. This skill performs design analysis and should read the parser's lossless raw XML plus structured indexes.

## Required Input Structure

The input folder must be named like:

```text
<PPT_NAME>_<YYYYMMDD>/
```

The analyzer expects these named files:

```text
<PPT_NAME>_<YYYYMMDD>_manifest.json
<PPT_NAME>_<YYYYMMDD>_summary.json
```

The parsed folder produced by `ppt-parser` should generally look like this:

```text
<PPT_NAME>_<YYYYMMDD>/
  <PPT_NAME>_<YYYYMMDD>_manifest.json
  <PPT_NAME>_<YYYYMMDD>_summary.json
  <PPT_NAME>_<YYYYMMDD>_summary.txt
  raw/
    [Content_Types].xml
    _rels/.rels
    ppt/
      presentation.xml
      _rels/presentation.xml.rels
      slides/
        slide1.xml
        slide2.xml
        ...
        _rels/
          slide1.xml.rels
          slide2.xml.rels
          ...
      slideLayouts/
        slideLayout1.xml
        ...
        _rels/
          slideLayout1.xml.rels
          ...
      slideMasters/
        slideMaster1.xml
        ...
        _rels/
          slideMaster1.xml.rels
          ...
      theme/
        theme1.xml
        ...
      charts/
        chart1.xml
        ...
      diagrams/
      notesSlides/
      media/
  images/
  media/
```

Treat this as the base analysis directory contract. Always start from the required files below. Then read optional folders only when the manifest, summary, relationships, or user request indicates that they are relevant.

## Must Read

Always read these parser outputs before summarizing:

- `<PPT_NAME>_<YYYYMMDD>_manifest.json`
- `<PPT_NAME>_<YYYYMMDD>_summary.json`
- `raw/ppt/presentation.xml`
- `raw/ppt/_rels/presentation.xml.rels`
- `raw/ppt/slides/slide*.xml`
- `raw/ppt/slides/_rels/slide*.xml.rels`
- `raw/ppt/slideLayouts/*.xml`
- `raw/ppt/slideLayouts/_rels/*.rels`
- `raw/ppt/slideMasters/*.xml`
- `raw/ppt/slideMasters/_rels/*.rels`
- `raw/ppt/theme/theme*.xml`

Read these as needed:

- `raw/ppt/charts/*.xml`
- `raw/ppt/diagrams/*`
- `raw/ppt/notesSlides/*.xml`
- `images/`
- `raw/ppt/media/`

## Command

Run from this skill directory:

```bash
node scripts/analyze_template.js <parsed-pptx-folder> [report-output.md|analysis-output.json]
```

If output is omitted, write:

```text
<PPT_NAME>_<YYYYMMDD>_template_report.md
<PPT_NAME>_<YYYYMMDD>_template_report.json
```

Do not write underscore-prefixed output files.

## Analysis Responsibilities

The analyzer should:

- resolve relationships through `.rels` files instead of reporting only raw `rId` values
- map slide order to slide XML paths through `presentation.xml.rels`
- map each slide to its layout, notes, image assets, and chart XML where available
- extract theme colors and fonts from `raw/ppt/theme/theme*.xml`
- inspect layouts and masters for placeholders, persistent elements, and repeated regions
- inspect slides for text, positions, shapes, pictures, charts, tables, transitions, and timing hints
- output both Markdown for human review and JSON for downstream automation

The Markdown report should be semantic and user-facing. Organize it with these sections:

- Basic Information
- Parsed Directory Integrity Check
- Theme Color System
- Typography System
- Master and Layout System
- Slide Type Classification
- Image/Chart/Media Usage
- Animation and Transition
- Template Style Summary
- Reusable Design Guidance

Treat design semantics as heuristics. XML is the source of structure, not a replacement for final visual review.
