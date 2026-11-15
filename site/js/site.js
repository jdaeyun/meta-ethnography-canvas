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
  // Every Zenodo DOI link on the page points to the concept DOI ("all versions", resolves to the latest)
  each('a[href*="doi.org/10.5281/zenodo."]', function (el) { el.href = doiUrl; });
})();
