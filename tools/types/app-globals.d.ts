// Type declarations for `npm run typecheck` (tsc --checkJs over app/js). Nothing here is loaded by the app.
//
// The app reads .value / .checked / .dataset … from elements it looks up by id or selector, and from event targets.
// Typing each lookup would take hundreds of casts for little gain, so DOM nodes accept any property here. What the check is
// for is the app's own code: names that do not exist (a misspelt function or global), wrong numbers of arguments, and
// fields of the project data that do not exist.
interface EventTarget { [key: string]: any }
interface Node { [key: string]: any }
interface Element { [key: string]: any }

// Set by app/version.js, app/demo/demo-data.js and app.js
interface Window {
  ME_CANVAS: { version: string; released: string; conceptDoi: string };
  ME_DEMO: any;
  growTextareasNow: (root: Element) => void;
}

// Bundled libraries (app/vendor), loaded by <script> before the app
declare const pdfjsLib: any;
declare const docx: any;
