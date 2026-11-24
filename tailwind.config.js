// Tailwind CSS v3 build for the app. Tailwind reads these files, finds every class name used,
// and writes only those styles to app/vendor/tailwind/tailwind.css (run: npm run css).
// Re-run the build whenever you add a Tailwind class that was not used anywhere before.
module.exports = {
  content: ['./me_canvas.html', './app/js/**/*.js'],
  // shadow-2xs: the faint one-pixel shadow (Tailwind 4 has it; Tailwind 3 has no class that small)
  theme: { extend: { boxShadow: { '2xs': '0 1px rgb(0 0 0 / 0.05)' } } },
  plugins: []
};
