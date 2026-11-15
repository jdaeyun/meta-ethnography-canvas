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
