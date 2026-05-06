# PPT Parse Analyzer Skill

A two-stage PowerPoint toolkit: lossless PPTX extraction first, template intelligence second.

## Overview

This repository provides an open-source workflow for PowerPoint template analysis.
It first unpacks a `.pptx` file into a lossless OpenXML-oriented workspace with
structured indexes, then analyzes that parsed result to generate reusable design
insights such as theme colors, typography, layout systems, placeholders, media
usage, and slide patterns.

## Repository Structure

- `ppt-parser/`: Parses PPTX archives into a deterministic analysis workspace.
- `ppt-template-analyzer/`: Analyzes parsed output and generates template reports.

## Workflow

1. Run `ppt-parser` on a `.pptx` file.
2. Review parser outputs (`manifest`, `summary`, `raw/` extraction).
3. Run `ppt-template-analyzer` on the parsed output directory.
4. Review generated Markdown and JSON reports.

## Quick Start

Run commands from each skill directory.

### 1) Parse PPTX

```bash
node scripts/parse_pptx.js <path-to-pptx-file>
```

Parser output directory naming convention:

```text
<PPT_NAME>_<YYYYMMDD>/
```

### 2) Analyze Template

```bash
node scripts/analyze_template.js <parsed-pptx-folder> [report-output.md|analysis-output.json]
```

If output names are omitted, analyzer defaults to:

```text
<PPT_NAME>_<YYYYMMDD>_template_report.md
<PPT_NAME>_<YYYYMMDD>_template_report.json
```

## Output Contract

The parsed directory should include:

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
      slides/_rels/
      slideLayouts/
      slideLayouts/_rels/
      slideMasters/
      slideMasters/_rels/
      theme/
      charts/
      diagrams/
      notesSlides/
      media/
  images/
  media/
```

Key guarantees:

- `raw/` preserves archive internal paths exactly, including `_rels`.
- `manifest.json` is machine-focused indexing metadata.
- `summary.json` is lightweight analysis handoff data.
- `images/` and `media/` are convenience copies; `raw/ppt/media/` is source of truth.

## Scope and Boundaries

- The parser focuses on extraction and indexing, not design interpretation.
- The analyzer provides structured template heuristics, not final visual judgment.
- XML relationships (`.rels`) should be treated as authoritative linkage data.

## Suggested GitHub Topics

`pptx`, `powerpoint`, `openxml`, `document-analysis`, `template-analysis`,
`presentation-template`, `design-system`, `slide-analysis`, `xml-parser`,
`asset-extraction`, `automation`, `nodejs`, `presentation-engineering`,
`content-pipeline`, `developer-tools`

## License

Add your preferred open-source license (for example, MIT) before publishing.
