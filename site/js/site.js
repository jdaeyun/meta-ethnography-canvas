// Meta-Ethnography Canvas — documentation pages: fill in version, year and DOI from app/version.js.
// Edit app/version.js at each release; the Website workflow publishes these pages next to app/.
// The numbers written in the HTML are only a fallback shown if app/version.js cannot be loaded.
(function () {
  var M = window.ME_CANVAS;
  if (!M || !M.version) return;
  var doiUrl = 'https://doi.org/' + M.conceptDoi;
  var year = String(M.released || '').slice(0, 4);
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }
  each('[data-mec="version"]', function (el) { el.textContent = M.version; });
  each('[data-mec="year"]', function (el) { if (year) el.textContent = year; });
  each('[data-mec="doi"]', function (el) { el.textContent = M.conceptDoi; });
  // The offline ZIP of THIS version. ".../releases/latest/download/..." would skip pre-releases (e.g. 1.3.2-beta.1) and give a 404
  // while no stable release exists, so the link names the release tag (v + version). The href in the HTML is only the fallback.
  each('a[data-mec="offline-zip"]', function (el) {
    el.href = 'https://github.com/jdaeyun/meta-ethnography-canvas/releases/download/v' + M.version + '/meta-ethnography-canvas-offline.zip';
  });
  // Every Zenodo DOI link on the page points to the concept DOI ("all versions", resolves to the latest)
  each('a[href*="doi.org/10.5281/zenodo."]', function (el) { el.href = doiUrl; });
})();

// Copy buttons for the citation blocks (<pre data-copy>): copies the text as shown (version, year and DOI already filled in)
(function () {
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('pre[data-copy]'), function (pre) {
    var wrap = document.createElement('div');
    wrap.className = 'mec-copy-wrap';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mec-copy-btn';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy ' + (pre.getAttribute('data-copy') || 'text'));
    btn.addEventListener('click', function () {
      copyText(pre.innerText.trim()).then(function () { btn.textContent = 'Copied ✓'; }, function () { btn.textContent = 'Select & copy'; });
      setTimeout(function () { btn.textContent = 'Copy'; }, 2000);
    });
    wrap.appendChild(btn);
  });
})();
