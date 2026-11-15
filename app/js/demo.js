// Meta-Ethnography Canvas — Demo mode (open me_canvas.html?demo)
// MIT License · https://github.com/jdaeyun/meta-ethnography-canvas
// Loads an AI-GENERATED, fictional sample project (4 papers + a merged two-reviewer analysis) into a separate
// demo database (see DEMO_MODE in core.js). The data lives in app/demo/demo-data.js, which is built by
// tools/demo/build-demo-data.mjs. It is a script (not a fetch) so that it also works from file://.
// Loaded as a classic <script> (shared global scope); see the load order in me_canvas.html.

function loadDemoScript() {
  return new Promise((resolve, reject) => {
    if (window.ME_DEMO) { resolve(window.ME_DEMO); return; }
    const s = document.createElement('script');
    s.src = 'app/demo/demo-data.js';
    s.onload = () => (window.ME_DEMO ? resolve(window.ME_DEMO) : reject(new Error('Demo data is empty.')));
    s.onerror = () => reject(new Error('Could not load app/demo/demo-data.js.'));
    document.head.appendChild(s);
  });
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function seedDemoIfEmpty() {
  const banner = document.getElementById('demoBanner');
  if (banner) { banner.classList.remove('hidden'); banner.classList.add('flex'); }
  const existing = await dbGetAll('docs');
  if (existing.length > 0) return; // keep the visitor's own edits to the demo
  try {
    const demo = await loadDemoScript();
    const data = demo.project;
    for (const d of data.docs) {
      const doc = normalizeDoc({ ...d, hasBinary: !!demo.pdfs[d.name] });
      if (demo.pdfs[d.name]) await dbPut('pdf_binaries', { id: doc.id, data: base64ToArrayBuffer(demo.pdfs[d.name]) });
      await dbPut('docs', doc);
    }
    for (const a of data.annotations) await dbPut('annotations', a);
    for (const c of data.clusters) await dbPut('clusters', c);
    for (const l of data.logs) await dbPut('logs', l);
    await dbPut('meta', { ...data.loa, id: 'loa_main' });
    lsSet('me_reviewer_id', data.reviewerId);
    lsSet('me_project_code', data.projectCode);
  } catch (err) {
    console.error('Demo could not be loaded:', err);
    showSnackbar('The demo could not be loaded: ' + err.message);
  }
}

document.getElementById('demoResetBtn')?.addEventListener('click', async () => {
  if (!confirm('Reset the demo to its original state? Any changes you made in the demo will be lost. Your own projects are not affected.')) return;
  for (const st of ['docs', 'pdf_binaries', 'annotations', 'clusters', 'logs', 'meta']) await dbClear(st);
  ['me_reviewer_id', 'me_project_code', 'me_hidden_studies'].forEach(lsRemove);
  location.reload();
});
