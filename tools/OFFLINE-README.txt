Meta-Ethnography Canvas — Offline edition
=========================================

This edition works without an internet connection. All libraries are bundled.

How to start
  1. Extract the whole ZIP file to a folder (do not open the files from inside the ZIP).
  2. Double-click  me_canvas.html  (Chrome, Edge or Firefox recommended).
  Keep me_canvas.html next to the  app/  folder; the app needs both.
  To try the AI-generated demo project first, double-click  demo.html  instead.

Your data
  - Your work is saved inside the browser on this computer (IndexedDB), exactly as in the online version.
  - The offline edition and the online version (https://jdaeyun.github.io/meta-ethnography-canvas/)
    keep SEPARATE data. To move a project between them, or to another computer or browser, use
    Backup (top bar) and Settings > Restore Project. PDFs are not stored in backups: drop the same
    PDF files back in and they reconnect by filename.
  - Clearing the browser's site data removes the project. Make a JSON backup at the end of each session.
  - Where the data lives depends on the browser. Firefox (and Safari) keep it per file location: if you
    move this folder, or open the app from another folder (for example a new version extracted next to
    the old one), the project seems to be gone. It is not lost: open the app from the old location again.
    Chrome and Edge keep one store for all local files.
  - Updating to a new version: in the old version click Backup; extract the new ZIP; open it and use
    Settings > Restore Project (then drop the PDFs in). Or keep one folder and replace its files with the
    new ones (the location, and so the data, stays the same).

Notes
  - Very large PDFs can feel slower than in the online version: when a page is opened from a file,
    browsers do not allow PDF.js to use a background thread.

Version, licence and citation
  - The version and DOI are shown in app/version.js and CITATION.cff.
  - Meta-Ethnography Canvas is MIT-licensed (LICENSE). Bundled third-party libraries keep their own
    licences: see app/vendor/THIRD_PARTY_NOTICES.md.
  - Updates: https://github.com/jdaeyun/meta-ethnography-canvas/releases
