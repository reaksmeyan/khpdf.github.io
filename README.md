# PDF Workbench

A static, client-side web app for organizing PDF pages — reorder, delete,
rotate, duplicate, merge, insert, split, and export pages as JPG. Everything
runs **entirely in the browser**; no file is ever uploaded to a server, which
means it can be hosted for free as a static site (e.g. GitHub Pages).

Inspired by the page-thumbnail workflow of tools like Smallpdf's
[Organize PDF](https://smallpdf.com/organize-pdf), rebuilt from scratch as a
plain HTML/CSS/JS app with its own visual identity.

## Features

- **Merge** — drop in several PDFs; their pages all land in one workspace.
- **Reorder** — drag any page thumbnail into a new position.
- **Delete / Duplicate** — per page, or in bulk via multi-select.
- **Rotate** — 90° left/right, per page or in bulk.
- **Insert** — the `+` icon on any page lets you drop another PDF's pages in
  right after it.
- **Split** — export the current page order as multiple PDFs, either every
  *N* pages or by custom ranges (e.g. `1-3;4-6;7-10`), downloaded as a `.zip`.
- **Export as JPG** — render all pages (or just the selected ones) to JPG
  images, downloaded individually or as a `.zip`.
- **Download PDF** — save the current arrangement as a single PDF.

## How it works

- [pdf.js](https://mozilla.github.io/pdf.js/) renders page thumbnails and
  full-resolution page images for JPG export.
- [pdf-lib](https://pdf-lib.js.org/) builds the output PDF files (merging,
  reordering, rotating, splitting) directly in the browser.
- [JSZip](https://stuk.github.io/jszip/) bundles multi-file exports (split
  PDFs, multiple JPGs) into a single `.zip` download.

All three are loaded from a public CDN in `index.html`; there is no build
step and no backend.

## Run locally

Because the app loads PDF files with `fetch`-like APIs, open it through a
local web server rather than double-clicking `index.html` (the `file://`
origin blocks some browser APIs used here).

```bash
# from the project folder
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, VS Code's Live Server extension, etc.).

## Deploy to GitHub Pages

1. Create a new repository on GitHub and push this folder's contents to it:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

2. On GitHub, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose the **main** branch and the **/ (root)** folder, then **Save**.
5. After a minute or two, your site will be live at
   `https://<your-username>.github.io/<your-repo>/`.

The included `.nojekyll` file tells GitHub Pages to serve the folder as-is
(skipping Jekyll processing), which isn't strictly required here but avoids
any surprises with filenames that start with an underscore.

## Notes & limitations

- Page-reordering drag-and-drop uses the HTML5 Drag and Drop API, which
  works well with a mouse; on touch devices, use the per-page rotate,
  duplicate, delete, and insert icons instead of dragging.
- Very large PDFs (hundreds of pages or large embedded images) are limited
  by your device's memory and browser performance, since all processing
  happens locally.
- Password-protected PDFs aren't supported.

## Project structure

```
pdf-workbench/
├── index.html        # markup for the hero/upload screen and the workspace
├── css/style.css      # all styling
├── js/app.js           # all application logic
├── .nojekyll
└── README.md
```
