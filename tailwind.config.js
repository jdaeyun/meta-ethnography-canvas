// Tailwind CSS v3 build for the app. Tailwind reads these files, finds every class name used,
// and writes only those styles to app/vendor/tailwind/tailwind.css (run: npm run css).
// Re-run the build whenever you add a Tailwind class that was not used anywhere before.
module.exports = {
  content: ['./me_canvas.html', './app/js/**/*.js'],
  theme: { extend: {} },
  plugins: []
};
