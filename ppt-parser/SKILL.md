---
name: ppt-parser
description: >-
  Parse PPTX files into a lossless OpenXML extraction folder plus structured manifest and summary indexes. Use when user needs to unpack a PowerPoint file for downstream analysis, inspect raw PPTX XML, preserve all relationships, or prepare input for ppt-template-analyzer. This skill does not perform design interpretation; it only extracts files, relationships, metadata, and lightweight slide indexes.
---

# PPT Parser

Use this skill to parse a `.pptx` file into a stable analysis input directory. Keep this skill focused on extraction and indexing. Do not infer template style, page roles, brand colors, or design recommendations here.

## Command

Run from this skill directory:

```bash
node scripts/parse_pptx.js <path-to-pptx-file>
```

The output directory is created beside the PPTX file:

```text
<PPT_NAME>_<YYYYMMDD>/
```

## Output Contract

Do not write underscore-prefixed report files. Use the output directory basename as the file prefix:

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

`raw/` must preserve the PPTX archive's internal paths exactly, including `_rels` directories. The `images/` and `media/` folders are convenience copies for quick inspection; `raw/ppt/media/` remains the source of truth.

## Manifest JSON

`<PPT_NAME>_<YYYYMMDD>_manifest.json` is the machine index. It must include:

- source PPTX path, template name, output directory, date, and output basename
- every archive file with original path, raw output path, type, and size
- all relationship files and parsed relationships
- indexes for slides, layouts, masters, themes, charts, diagrams, notes, images, and media

## Summary JSON

`<PPT_NAME>_<YYYYMMDD>_summary.json` is the lightweight analysis handoff. It must include:

- presentation slide count and slide size
- slide order from `ppt/presentation.xml` and `ppt/_rels/presentation.xml.rels`
- per-slide XML path, rels path, text preview, layout relationship, notes relationship, image refs, and chart refs
- counts for files, slides, layouts, masters, themes, charts, diagrams, notes, images, media, and relationships
- special-content flags for notes, comments, media, custom XML, and VBA

## Report Back

After running, tell the user:

- output directory
- generated manifest, summary JSON, and summary text paths
- slide count, image count, chart count, media count
- any special content flags, especially VBA

If parsing fails because the file is missing, corrupt, or encrypted, report the error directly.
