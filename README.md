# 📖 Meta-Ethnography Canvas

[![Live Workspace](https://img.shields.io/badge/Launch_Workspace-GitHub_Pages-4f46e5?style=for-the-badge&logo=googlechrome&logoColor=white)](https://jdaeyun.github.io/meta-ethnography-canvas/me_canvas.html)
[![Documentation](https://img.shields.io/badge/Docs_&_Manual-Read_Online-0d9488?style=for-the-badge&logo=readthedocs&logoColor=white)](https://jdaeyun.github.io/meta-ethnography-canvas/)
[![License: MIT](https://img.shields.io/badge/License-MIT-slate.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**Meta-Ethnography Canvas** is an open-source, zero-backend, single-window browser workspace for conducting **Meta-Ethnography** qualitative evidence synthesis (QES), engineered around the **eMERGe Reporting Guideline** (France et al., 2019).

It bridges the methodological gap between full-text PDF coding and cross-study spreadsheet matrices—keeping 1st, 2nd, and 3rd order constructs, contextual appraisals, GRADE-CERQual assessments, and bidirectional PDF page links in a single local-first environment.

> 📌 **Scope Note:** This tool is designed for the **post-screening synthesis phases** (*eMERGe* Phases 3–7). Complete your database searching, deduplication, and title/abstract screening in your preferred SR tool (e.g., Rayyan, Covidence, Zotero) first, then import your final included full-text PDFs into this workspace.

---

## 🚀 Live Application & Documentation

No installation, build step, or user account required. Run directly in your desktop browser:

* **👉 [Launch Meta-Ethnography Canvas (`me_canvas.html`)](https://jdaeyun.github.io/meta-ethnography-canvas/me_canvas.html)**
* **📘 [1. Overview & Motivation](https://jdaeyun.github.io/meta-ethnography-canvas/index.html)**
* **🛠️ [2. Step-by-Step User Manual](https://jdaeyun.github.io/meta-ethnography-canvas/manual.html)**
* **🎓 [3. Meta-Ethnography 101 & eMERGe Mapping](https://jdaeyun.github.io/meta-ethnography-canvas/meta-ethnography-101.html)**
* **📋 [4. Copy-Paste Methods Templates (PROSPERO / OSF / Manuscripts)](https://jdaeyun.github.io/meta-ethnography-canvas/templates.html)**

---

## ✨ Core Workflow Summary (4-Tab Architecture)

1. **Tab 1 — Extract & Context (Phases 2–3):**
   Read primary study PDFs, auto-extract Page 1 citation metadata, record multi-framework critical appraisal (`CASP`, `JBI`, `MMAT`, `COREQ`, `ETQS`, `Dixon-Woods`) and conceptual richness, and extract **1st Order** (participant quotes) and **2nd Order** (author concepts) constructs with multi-page highlight support (plus manual entry for non-OCR scans).
2. **Tab 2 — Synthesis Matrix, Line of Argument & CERQual (Phases 4–6):**
   Order studies chronologically or by conceptual richness to designate the **Index Paper (#1)**. Map 2nd Order constructs into **3rd Order Theme** rows, toggle cell-level **Reciprocal (🤝)** vs. **Refutational (⚡)** translations, jump back to exact PDF highlights in one click, build an overarching **Line of Argument** model, and evaluate **GRADE-CERQual** confidence.
3. **Tab 3 — Audit Trail & Team Concordance (Transparency & Reflexivity):**
   Automatically log interpretive milestones (study re-ordering, construct evolution, CERQual rationales), record reflexive positionality memos, and asynchronously compare/merge `.json` project files across multiple reviewers.
4. **Tab 4 — Manuscript Table Export (Phase 7):**
   Generate **Table 1** (Study Characteristics), **Table 2** (1st/2nd/3rd Order Synthesis), **Table 2b** (Concept × Study Contribution Grid `● / ⚡`), **Table 3** (GRADE-CERQual SoQF), and **Appendix A** (Audit Trail). Export via Rich Clipboard Copy, Markdown, CSV, or native landscape **Word (`.docx`)**.

---

## 🏗️ Software Architecture & Technical Highlights

Meta-Ethnography Canvas (`me_canvas.html`) is intentionally architected as a **dependency-light, zero-build, single-file Vanilla JavaScript application** to guarantee long-term academic reproducibility, data privacy, and zero hosting maintenance.

### 1. 100% Client-Side & Privacy-First Persistence (`IndexedDB` Store Separation)
* **Zero Server Uploads:** All unpublished manuscripts, copyrighted full-text PDFs, and synthesis notes remain strictly inside the user's browser (`MetaEthnoCanvasDB`, Schema v6).
* **Binary / Metadata Decoupling:** Raw PDF `ArrayBuffer` payloads are isolated in a dedicated `pdf_binaries` object store, separate from lightweight metadata stores (`docs`, `annotations`, `clusters`, `logs`, `meta`).
* **Lightweight `.json` Snapshots & Auto-Relinking:** Exporting a project backup serializes only the analytical state (excluding heavy PDF binaries). When restoring or sharing a `.json` file with a co-reviewer, dropping the matching PDFs onto the window automatically relinks binaries to existing coordinate highlights by filename.
* **Cross-Project Contamination Guard:** Each workspace enforces a sanitized `projectCode` identifier to prevent accidental `.json` merges across different systematic review projects.

### 2. Memory-Safe PDF Virtualization & Coordinate Normalization
* **Lazy Rendering & Canvas Eviction:** Built on `PDF.js` (`v3.11.174`) with full CMap/UTF-8 font support. An `IntersectionObserver` renders only pages near the active viewport (`±600px`) and actively evicts rendered `<canvas>` and `.textLayer` DOM nodes more than 10 pages away, preventing browser out-of-memory crashes even with 30+ full-text qualitative papers loaded.
* **Resolution-Independent Highlights:** Multi-page text selections are converted into viewport-normalized bounding boxes (`[0..1]` relative coordinates) and merged via a custom line-coalescing algorithm (`mergeHighlightRects`), ensuring highlights remain pixel-accurate across any zoom level (`50%`–`300%`).
* **Hybrid Page-1 Citation Parser:** Combines PDF Info/XMP metadata inspection with spatial Y-coordinate line bucketing and font-height heuristics on Page 1 to auto-detect First Author, Publication Year, and Full Title.

### 3. Serverless Multi-Reviewer Diff & Merge Engine
* **Unicode-Aware Fuzzy Matching:** Co-reviewers working independently can compare `.json` backups in-browser. The concordance engine (`computeTextSimilarity`) combines NFC Unicode normalization, token-set overlap, and character bigram similarity (supporting both Latin and non-spaced CJK scripts) plus page-proximity weighting to match independently extracted constructs, compute inter-reviewer concordance rates, and interleave audit logs chronologically.

### 4. Client-Side OpenXML (`.docx`) Generation
* Uses `docx.js` (`v8.5.0`) to compile all five synthesis and GRADE-CERQual tables into a single landscape OpenXML Word document directly in memory, alongside `ClipboardItem` rich HTML/plain-text dual-MIME copying for one-click pasting into Word or Google Docs.

---

## 📦 Repository Structure

```text
meta-ethnography-canvas/
├── me_canvas.html              # Core single-file web application (HTML5 + Vanilla JS + IndexedDB)
├── index.html                  # Documentation Part 1: Overview & Motivation
├── manual.html                 # Documentation Part 2: Step-by-Step User Manual
├── meta-ethnography-101.html   # Documentation Part 3: Methodology Primer & eMERGe Mapping
├── templates.html              # Documentation Part 4: Copy-Paste Methods Templates
├── CITATION.cff                # GitHub academic citation metadata
├── LICENSE                     # MIT License
└── README.md                   # Technical overview & repository guide

### Running Locally

Because the application uses standard browser APIs and CDN-hosted libraries, you can run it locally simply by cloning the repository and opening `me_canvas.html` in any modern desktop browser (or serving the directory via `npx serve` . or `python3 -m http.server`).

### Third-Party Libraries (Loaded via CDN)

* [PDF.js](https://mozilla.github.io/pdf.js/) (`v3.11.174`, Apache-2.0) — PDF rendering, text layer extraction, and CMap support
* [docx](https://docx.js.org/) (`v8.5.0`, MIT) — Client-side `.docx` manuscript table generation
* [Tailwind CSS](https://tailwindcss.com/) (`v3.4.17`, MIT) — UI styling
* [Phosphor Icons](https://phosphoricons.com/) (`v2.1.1`, MIT) — Interface iconography

## 🎓 How to Cite

If you use **Meta-Ethnography Canvas** in your systematic review, protocol registration, or dissertation, please cite it as:

**APA (7th ed.):**

> Jeong, D. Y. (2026). Meta-Ethnography Canvas: An open-source, eMERGe-aligned workspace for qualitative evidence synthesis \[Computer software]. GitHub. https://github.com/jdaeyun/meta-ethnography-canvas

**BibTeX:**

```
@software{jeong2026metaethnography,
author       = {Jeong, Dae Yun},
title        = {{Meta-Ethnography Canvas: An open-source, eMERGe-aligned workspace for qualitative evidence synthesis}},
year         = {2026},
publisher    = {GitHub},
url          = {[https://github.com/jdaeyun/meta-ethnography-canvas](https://github.com/jdaeyun/meta-ethnography-canvas)}
}
```

## 📄 License

Released under the [MIT License](https://mit-license.org/). Copyright © 2026 Jeong, Dae Yun.





