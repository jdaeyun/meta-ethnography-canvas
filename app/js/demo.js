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
    s.src = 'app/demo/demo-data.js?v=' + encodeURIComponent((window.ME_CANVAS && window.ME_CANVAS.version) || '');
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

async function clearDemoStores() {
  for (const st of ['docs', 'pdf_binaries', 'annotations', 'clusters', 'logs', 'meta']) await dbClear(st);
}

// Loads the demo the first time, and again whenever the demo content has changed since this browser last got it
// (the demo database lives in the browser, so an older copy would otherwise stay for ever).
async function seedDemoIfEmpty() {
  const banner = document.getElementById('demoBanner');
  if (banner) { banner.classList.remove('hidden'); banner.classList.add('flex'); }
  try {
    const demo = await loadDemoScript();
    const existing = await dbGetAll('docs');
    const outdated = existing.length > 0 && lsGet('me_demo_build') !== demo.build;
    if (existing.length > 0 && !outdated) return; // keep the visitor's own edits to the demo
    if (outdated) { await clearDemoStores(); showSnackbar('The demo was updated to its latest version.'); }
    const data = demo.project;
    // One quiet transaction: loading the demo is not an edit, so no "not backed up" mark
    const ops = [];
    for (const d of data.docs) {
      const doc = normalizeDoc({ ...d, hasBinary: !!demo.pdfs[d.name] });
      if (demo.pdfs[d.name]) ops.push({ store: 'pdf_binaries', put: { id: doc.id, data: base64ToArrayBuffer(demo.pdfs[d.name]) } });
      ops.push({ store: 'docs', put: doc });
    }
    data.annotations.forEach(a => ops.push({ store: 'annotations', put: a }));
    data.clusters.forEach(c => ops.push({ store: 'clusters', put: c }));
    data.logs.forEach(l => ops.push({ store: 'logs', put: l }));
    ops.push({ store: 'meta', put: { ...data.loa, id: 'loa_main' } });
    await dbBatch(ops, { quiet: true });
    lsSet('me_reviewer_id', data.reviewerId);
    lsSet('me_project_code', data.projectCode);
    lsRemove('me_hidden_studies');
    lsSet('me_demo_build', demo.build);
  } catch (err) {
    console.error('Demo could not be loaded:', err);
    showSnackbar('The demo could not be loaded: ' + err.message);
  }
}

document.getElementById('demoResetBtn')?.addEventListener('click', async () => {
  const ok = await askChoice({ title: 'Reset the demo?', body: 'The demo goes back to its original state; changes you made in the demo are lost. Your own projects are not affected.', choices: [{ value: 'reset', tone: 'danger', label: 'Reset the demo' }] });
  if (!ok) return;
  await clearDemoStores();
  ['me_reviewer_id', 'me_project_code', 'me_hidden_studies', 'me_demo_build'].forEach(lsRemove);
  location.reload();
});
