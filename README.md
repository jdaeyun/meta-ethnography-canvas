# 📖 Meta-Ethnography Canvas

**Version 1.3.0** · [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.24200375.svg)](https://doi.org/10.5281/zenodo.24200375)

[![Live Workspace](https://img.shields.io/badge/Launch_Workspace-GitHub_Pages-4f46e5?style=for-the-badge&logo=googlechrome&logoColor=white)](https://jdaeyun.github.io/meta-ethnography-canvas/me_canvas.html)
[![Documentation](https://img.shields.io/badge/Docs_&_Manual-Read_Online-0d9488?style=for-the-badge&logo=readthedocs&logoColor=white)](https://jdaeyun.github.io/meta-ethnography-canvas/)
[![License: MIT](https://img.shields.io/badge/License-MIT-slate.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**Meta-Ethnography Canvas** is a free, open-source workspace for doing a **meta-ethnography** (a type of qualitative evidence synthesis). It runs in one browser window, with no server and no account. Its reports follow the **eMERGe reporting guidance** (France et al., 2019).

It puts two jobs in one place: coding full-text PDFs, and comparing studies in a synthesis matrix. It keeps 1st, 2nd and 3rd order constructs, quality appraisals, GRADE-CERQual ratings and links back to the exact PDF page together on your own computer.

> 📌 **Scope note:** This tool is for the **synthesis steps after screening** (eMERGe Phases 1 and 3–7; the Phase 1 aim and review question are saved in Project Setup). Do your database searching, duplicate removal and title/abstract screening in another tool first (for example Rayyan, Covidence or Zotero). Then bring your final included full-text PDFs here.

---

## 🚀 Live Application & Documentation

Nothing to install and no account needed. Open it in a desktop browser:

* **👉 [Launch Meta-Ethnography Canvas (`me_canvas.html`)](https://jdaeyun.github.io/meta-ethnography-canvas/me_canvas.html)**
* **🧪 [Try the demo (AI-generated sample project)](https://jdaeyun.github.io/meta-ethnography-canvas/me_canvas.html?demo)** — four fictional papers and a finished two-reviewer analysis. It uses its own storage and does not touch your projects.
* **📘 [1. Overview & Motivation](https://jdaeyun.github.io/meta-ethnography-canvas/index.html)**
* **🛠️ [2. Step-by-Step User Manual](https://jdaeyun.github.io/meta-ethnography-canvas/manual.html)**
* **🎓 [3. Meta-Ethnography 101 & eMERGe Mapping](https://jdaeyun.github.io/meta-ethnography-canvas/meta-ethnography-101.html)**

---

## ✨ How It Works (4 Tabs)

1. **Tab 1 — Extract & Context (Phases 2–3):**
   Read the PDFs and fill in each study's details. Page 1 can be read automatically for author, year and title. Record quality appraisal (`CASP`, `JBI`, `MMAT`, `ETQS`, `Dixon-Woods`, or your own tool) and how rich each study is. Highlight **1st Order** constructs (participant quotes) and **2nd Order** constructs (the authors' concepts), including across page breaks. You can also type them in by hand for scanned PDFs without text. Add an optional **Subgroup** label to each study if you want to translate group by group.
2. **Tab 2 — Synthesis Matrix, Line of Argument & CERQual (Phases 4–6):**
   Order the studies (by year or by richness) and choose the **Index Paper (#1)**. Drag 2nd Order constructs into **3rd Order Theme** rows. Mark each study's card as **Reciprocal (🤝)** or **Refutational (⚡)**, and explain why a study differs. Jump back to the exact PDF page in one click. Show one subgroup at a time, then all studies together. Build your **Line of Argument** (the concept map can be saved as `.svg`) and rate confidence with **GRADE-CERQual** (every domain starts as *Not assessed*).
3. **Tab 3 — Audit Trail & Team Comparison (Transparency & Reflexivity):**
   Your main decisions are logged automatically (changing study order, changing a theme, CERQual reasons). Add reflexive memos about your own position. Compare and merge the `.json` project files of several reviewers, each working on their own.
4. **Tab 4 — Export Tables for Your Manuscript (Phase 7):**
   Create an **eMERGe Methods Summary** with the 19-item checklist, **Table 1** (study characteristics), **Table 2** (synthesis), **Table 2b** (which study contributes to which theme, `● / ⚡`), **Table 3** (GRADE-CERQual summary and/or evidence profile) and **Appendix A** (audit trail). Copy a table, or download Markdown, CSV or a landscape **Word (`.docx`)** file.

---

## 🏗️ How It Is Built

Meta-Ethnography Canvas is a **plain HTML and JavaScript** app with **no build step needed to run it**. This keeps it easy to reproduce years later, keeps your data private, and costs nothing to host.

### 1. Your data stays on your computer
* **No uploads:** Your PDFs and notes never leave your browser. They are saved in the browser's built-in database (IndexedDB).
* **PDFs are stored separately:** The PDF files are kept apart from the notes, highlights and themes.
* **Small backup files:** A `.json` backup holds your analysis but not the PDFs. To restore a backup or share it with a co-reviewer, drop the same PDFs onto the window. They are matched by file name and the highlights reappear.
* **Project code:** Each project has a project code. If you try to load a backup with a different code, the app warns you, so two reviews are not mixed by mistake.

### 2. PDF reading
* **Fast with many papers:** PDFs are shown with `PDF.js` (`v3.11.174`). Only the pages near your screen are drawn, and pages far away are removed from memory. This keeps the browser stable with 30 or more papers.
* **Highlights at any zoom:** Highlights are saved as positions relative to the page, so they stay in the right place at any zoom (50%–300%).
* **Automatic citation details:** The app reads the PDF's own metadata and the layout of page 1 to guess the first author, year and title. You can always correct them.

### 3. Comparing reviewers (no server)
* **Fuzzy matching:** Co-reviewers can compare their `.json` backups in the browser. The app scores how similar two extracted passages are by looking at shared words, shared letter pairs (this also works for Japanese and Chinese text) and whether they are on the same page. A concept that one reviewer wrapped around a 1st Order quote is compared by the quote itself, so it can match a 2nd Order concept the other reviewer took from the same passage. Items are sorted into matched, different and single-reviewer lists for your team to discuss. No agreement statistic is calculated.

### 4. Word export in the browser
* **Word file:** `docx.js` (`v8.5.0`) builds the Word file on your computer. It holds the Methods Summary, the checklist and all tables.
* **Copy to Word or Google Docs:** The copy button puts both a formatted table and plain text on the clipboard, so you can paste straight in.

---

## 📦 Repository Structure

```text
meta-ethnography-canvas/
├── me_canvas.html        # The app page (the screens)
├── demo.html             # Opens the demo (me_canvas.html?demo); works offline too
├── app/                  # App code (js/), styles (css/), version.js, bundled libraries (vendor/), AI-generated demo data (demo/)
├── site/                 # Website pages: index, manual (with screenshots in img/), Meta-Ethnography 101
├── tools/                # Build helpers and the offline-edition readme
├── CITATION.cff          # How to cite this software
├── LICENSE               # MIT License
└── README.md             # This file
```

### Running Locally

You do not need to install anything. Download or clone the repository and double-click `me_canvas.html`. It works offline in any modern desktop browser. To serve it from a local web address instead, run `npm install` once and then `npm run serve`, or use `python3 -m http.server`.

### Offline Edition

Each release includes a ZIP file (`meta-ethnography-canvas-offline.zip`) that runs fully offline. This is useful on hospital or university networks that block websites.

### Third-Party Libraries (Bundled in `app/vendor/`)

No internet connection is needed. The libraries are included in the repository.

* [PDF.js](https://mozilla.github.io/pdf.js/) (`v3.11.174`, Apache-2.0) — shows PDFs and reads their text
* [docx](https://docx.js.org/) (`v8.5.0`, MIT) — builds the Word file
* [Tailwind CSS](https://tailwindcss.com/) (`v3.4.17`, MIT) — page styling
* [Phosphor Icons](https://phosphoricons.com/) (`v2.1.1`, MIT) — icons

## 🎓 How to Cite

If you use **Meta-Ethnography Canvas** in your systematic review, protocol registration, or dissertation, please cite it as:

**APA (7th ed.):**

> Jeong, D. Y. (2026). *Meta-Ethnography Canvas: An open-source workspace for meta-ethnography, with reporting outputs structured around eMERGe* (Version 1.3.0) \[Computer software]. Zenodo. https://doi.org/10.5281/zenodo.24200375

**BibTeX:**

```
@software{jeong2026metaethnography,
author       = {Jeong, Dae Yun},
title        = {{Meta-Ethnography Canvas: An open-source workspace for meta-ethnography, with reporting outputs structured around eMERGe}},
year         = {2026},
version      = {1.3.0},
publisher    = {Zenodo},
doi          = {10.5281/zenodo.24200375},
url          = {https://doi.org/10.5281/zenodo.24200375}
}
```

## 📄 License

Released under the [MIT License](https://mit-license.org/). Copyright © 2026 Jeong, Dae Yun.





