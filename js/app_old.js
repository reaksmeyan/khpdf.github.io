/* ==========================================================================
   PDF Workbench — client-side PDF page organizer
   Uses pdf.js (rendering) and pdf-lib (PDF writing). Everything runs
   locally in the browser; no files are ever uploaded anywhere.
   ========================================================================== */

(function () {
  "use strict";

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  /* ---------------------------------------------------------------------
     State
     --------------------------------------------------------------------- */

  /** sourceId -> { name, rawBytes: Uint8Array, pdfjsDoc, pdfLibDocPromise, numPages } */
  const sources = Object.create(null);

  /** ordered list of { uid, sourceId, pageIndex, rotationDelta, _thumb? } */
  let pages = [];

  /** Set of selected page uids */
  const selected = new Set();

  let uidCounter = 0;
  function makeUid() {
    uidCounter += 1;
    return "p" + uidCounter + "-" + Math.random().toString(36).slice(2, 7);
  }

  let draggedUid = null;

  /* ---------------------------------------------------------------------
     DOM references
     --------------------------------------------------------------------- */

  const heroSection = document.getElementById("hero-section");
  const workspaceSection = document.getElementById("workspace-section");

  const dropzone = document.getElementById("dropzone");
  const dropzoneSpinner = document.getElementById("dropzone-spinner");
  const fileInput = document.getElementById("file-input");

  const gridEl = document.getElementById("page-grid");
  const docMetaEl = document.getElementById("doc-meta");

  const btnAddPdf = document.getElementById("btn-add-pdf");
  const btnSelectAll = document.getElementById("btn-select-all");
  const btnSelectNone = document.getElementById("btn-select-none");
  const btnRotateLeft = document.getElementById("btn-rotate-left");
  const btnRotateRight = document.getElementById("btn-rotate-right");
  const btnDuplicate = document.getElementById("btn-duplicate");
  const btnDelete = document.getElementById("btn-delete");
  const btnSplit = document.getElementById("btn-split");
  const btnExportJpg = document.getElementById("btn-export-jpg");
  const btnDownload = document.getElementById("btn-download");

  const splitModal = document.getElementById("split-modal");
  const splitPageCountEl = document.getElementById("split-page-count");
  const splitChunkSizeInput = document.getElementById("split-chunk-size");
  const splitRangesInput = document.getElementById("split-ranges");
  const splitConfirmBtn = document.getElementById("split-confirm");

  const jpgModal = document.getElementById("jpg-modal");
  const jpgAllCountEl = document.getElementById("jpg-all-count");
  const jpgSelectedCountEl = document.getElementById("jpg-selected-count");
  const jpgQualityInput = document.getElementById("jpg-quality");
  const jpgQualityLabel = document.getElementById("jpg-quality-label");
  const jpgConfirmBtn = document.getElementById("jpg-confirm");

  const toastEl = document.getElementById("toast");
  let toastTimer = null;

  /* ---------------------------------------------------------------------
     Toast helper
     --------------------------------------------------------------------- */

  function toast(message, isError) {
    toastEl.textContent = message;
    toastEl.classList.toggle("toast--error", !!isError);
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 4000);
  }

  /* ---------------------------------------------------------------------
     File loading
     --------------------------------------------------------------------- */

  async function handleFiles(fileList, insertAt) {
    const files = Array.from(fileList || []).filter(
      (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)
    );
    if (files.length === 0) {
      toast("Please choose one or more PDF files.", true);
      return;
    }

    dropzoneSpinner.hidden = false;
    const newPages = [];

    try {
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const rawBytes = new Uint8Array(buf);
        let pdfDoc;
        try {
          pdfDoc = await pdfjsLib.getDocument({ data: rawBytes.slice() }).promise;
        } catch (err) {
          console.error(err);
          toast(`Could not open "${file.name}". It may be encrypted or corrupted.`, true);
          continue;
        }
        const sourceId = makeUid();
        sources[sourceId] = {
          name: file.name,
          rawBytes: rawBytes,
          pdfjsDoc: pdfDoc,
          pdfLibDocPromise: null,
          numPages: pdfDoc.numPages,
        };
        for (let i = 0; i < pdfDoc.numPages; i++) {
          newPages.push({ uid: makeUid(), sourceId: sourceId, pageIndex: i, rotationDelta: 0 });
        }
      }

      if (newPages.length === 0) return;

      if (insertAt === undefined || insertAt === null || insertAt >= pages.length) {
        pages.push(...newPages);
      } else {
        pages.splice(insertAt, 0, ...newPages);
      }

      updateWorkspaceVisibility();
      renderGrid();
    } finally {
      dropzoneSpinner.hidden = true;
    }
  }

  /* ---------------------------------------------------------------------
     Page operations
     --------------------------------------------------------------------- */

  function rotatePages(uids, delta) {
    if (uids.length === 0) return;
    const set = new Set(uids);
    pages.forEach((p) => {
      if (set.has(p.uid)) {
        p.rotationDelta = ((p.rotationDelta + delta) % 360 + 360) % 360;
      }
    });
    renderGrid();
  }

  function duplicatePages(uids) {
    if (uids.length === 0) return;
    const set = new Set(uids);
    const next = [];
    pages.forEach((p) => {
      next.push(p);
      if (set.has(p.uid)) {
        next.push({
          uid: makeUid(),
          sourceId: p.sourceId,
          pageIndex: p.pageIndex,
          rotationDelta: p.rotationDelta,
        });
      }
    });
    pages = next;
    renderGrid();
  }

  function deletePages(uids) {
    if (uids.length === 0) return;
    const set = new Set(uids);
    pages = pages.filter((p) => !set.has(p.uid));
    uids.forEach((u) => selected.delete(u));
    updateWorkspaceVisibility();
    renderGrid();
  }

  function insertAfter(uid) {
    const idx = pages.findIndex((p) => p.uid === uid);
    const position = idx === -1 ? pages.length : idx + 1;
    const tempInput = document.createElement("input");
    tempInput.type = "file";
    tempInput.accept = "application/pdf";
    tempInput.multiple = true;
    tempInput.hidden = true;
    tempInput.addEventListener("change", () => {
      handleFiles(tempInput.files, position);
      tempInput.remove();
    });
    document.body.appendChild(tempInput);
    tempInput.click();
  }

  function reorderPages(fromUid, targetUid, before) {
    const fromIdx = pages.findIndex((p) => p.uid === fromUid);
    if (fromIdx === -1) return;
    const [item] = pages.splice(fromIdx, 1);
    let toIdx = pages.findIndex((p) => p.uid === targetUid);
    if (toIdx === -1) {
      pages.push(item);
      return;
    }
    if (!before) toIdx += 1;
    pages.splice(toIdx, 0, item);
  }

  function toggleSelect(uid) {
    if (selected.has(uid)) selected.delete(uid);
    else selected.add(uid);
    renderGrid();
  }

  function selectAll() {
    pages.forEach((p) => selected.add(p.uid));
    renderGrid();
  }

  function selectNone() {
    selected.clear();
    renderGrid();
  }

  /* ---------------------------------------------------------------------
     Rendering
     --------------------------------------------------------------------- */

  function updateWorkspaceVisibility() {
    const has = pages.length > 0;
    heroSection.hidden = has;
    workspaceSection.hidden = !has;
  }

  function updateDocMeta() {
    const distinctSources = new Set(pages.map((p) => p.sourceId)).size;
    let text = pages.length + (pages.length === 1 ? " page" : " pages");
    if (distinctSources > 1) text += " from " + distinctSources + " files";
    docMetaEl.textContent = text;
  }

  function updateToolbarState() {
    const hasSelection = selected.size > 0;
    [btnRotateLeft, btnRotateRight, btnDuplicate, btnDelete].forEach((b) => {
      b.disabled = !hasSelection;
    });
    btnSelectNone.hidden = !hasSelection;

    const hasPages = pages.length > 0;
    [btnDownload, btnSplit, btnExportJpg].forEach((b) => {
      b.disabled = !hasPages;
    });
    updateDocMeta();
  }

  const ICONS = {
    check: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M6.2 11.9 2.8 8.5l1.1-1.1 2.3 2.3 5.9-5.9 1.1 1.1z"/></svg>',
    insert: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 3a.9.9 0 0 1 .9.9v3.2h3.2a.9.9 0 1 1 0 1.8H8.9v3.2a.9.9 0 1 1-1.8 0V8.9H3.9a.9.9 0 1 1 0-1.8h3.2V3.9A.9.9 0 0 1 8 3z"/></svg>',
    rotateLeft: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M7 2a6 6 0 1 1-5.3 3.2l1.5.9A4.3 4.3 0 1 0 7 3.7V2zM1.5 2v3.3h3.3L1.5 2z"/></svg>',
    rotateRight: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M9 2a6 6 0 1 0 5.3 3.2l-1.5.9A4.3 4.3 0 1 1 9 3.7V2zm5.5 0v3.3h-3.3L14.5 2z"/></svg>',
    duplicate: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M5.5 1.5h6.7A1.8 1.8 0 0 1 14 3.3v6.7h-1.5V3.3a.3.3 0 0 0-.3-.3H5.5V1.5zM2.5 4.5h6.7a1.8 1.8 0 0 1 1.8 1.8v6.7a1.8 1.8 0 0 1-1.8 1.8H2.5a1.8 1.8 0 0 1-1.8-1.8V6.3a1.8 1.8 0 0 1 1.8-1.8zm0 1.5a.3.3 0 0 0-.3.3v6.7a.3.3 0 0 0 .3.3h6.7a.3.3 0 0 0 .3-.3V6.3a.3.3 0 0 0-.3-.3H2.5z"/></svg>',
    trash: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M6.5 1h3a.9.9 0 0 1 .9.9v.6h3.1v1.4H2.5V2.5h3.1v-.6a.9.9 0 0 1 .9-.9zM3.4 4.4h9.2l-.8 8.8a1.8 1.8 0 0 1-1.8 1.6H6a1.8 1.8 0 0 1-1.8-1.6l-.8-8.8zm3 2v6.4h1.1V6.4H6.4zm3.2 0v6.4h1.1V6.4H9.6z"/></svg>',
  };

  function renderGrid() {
    updateToolbarState();
    gridEl.innerHTML = "";

    const multiSource = new Set(pages.map((p) => p.sourceId)).size > 1;
    const frag = document.createDocumentFragment();

    pages.forEach((p, idx) => {
      frag.appendChild(makeCard(p, idx, multiSource));
    });
    gridEl.appendChild(frag);

    // kick off thumbnail rendering for anything missing/invalidated
    const toRender = pages.filter((p) => !p._thumb || p._thumb.key !== p.rotationDelta);
    runPool(toRender, renderPageThumb, 3);
  }

  function makeCard(p, idx, showSource) {
    const card = document.createElement("div");
    card.className = "page-card" + (selected.has(p.uid) ? " is-selected" : "");
    card.draggable = true;
    card.dataset.uid = p.uid;

    const check = document.createElement("button");
    check.type = "button";
    check.className = "page-card__check";
    check.setAttribute("aria-label", "Select page " + (idx + 1));
    check.innerHTML = ICONS.check;
    card.appendChild(check);

    const ops = document.createElement("div");
    ops.className = "page-card__ops";
    ops.appendChild(makeOpButton("insert", "Insert a PDF after this page", ICONS.insert, "op-insert"));
    ops.appendChild(makeOpButton("rotate-left", "Rotate left", ICONS.rotateLeft));
    ops.appendChild(makeOpButton("rotate-right", "Rotate right", ICONS.rotateRight));
    ops.appendChild(makeOpButton("duplicate", "Duplicate page", ICONS.duplicate));
    ops.appendChild(makeOpButton("delete", "Delete page", ICONS.trash, "op-danger"));
    card.appendChild(ops);

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "page-card__thumb-wrap";
    if (p._thumb && p._thumb.key === p.rotationDelta) {
      thumbWrap.appendChild(p._thumb.canvas);
    } else {
      const spinner = document.createElement("span");
      spinner.className = "spinner";
      thumbWrap.appendChild(spinner);
    }
    card.appendChild(thumbWrap);

    const footer = document.createElement("div");
    footer.className = "page-card__footer";
    const num = document.createElement("span");
    num.className = "page-card__num";
    num.textContent = String(idx + 1).padStart(2, "0");
    footer.appendChild(num);
    if (showSource) {
      const src = document.createElement("span");
      src.className = "page-card__source";
      src.title = sources[p.sourceId].name;
      src.textContent = sources[p.sourceId].name;
      footer.appendChild(src);
    }
    card.appendChild(footer);

    return card;
  }

  function makeOpButton(action, label, iconHtml, extraClass) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "page-card__op" + (extraClass ? " " + extraClass : "");
    btn.dataset.action = action;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = iconHtml;
    return btn;
  }

  /* ---------------------------------------------------------------------
     Thumbnail rendering (pdf.js)
     --------------------------------------------------------------------- */

  async function runPool(items, worker, concurrency) {
    let idx = 0;
    async function next() {
      if (idx >= items.length) return;
      const item = items[idx];
      idx += 1;
      try {
        await worker(item);
      } catch (err) {
        console.error(err);
      }
      return next();
    }
    const starters = [];
    for (let i = 0; i < Math.min(concurrency, items.length); i++) starters.push(next());
    await Promise.all(starters);
  }

  async function renderPageThumb(p) {
    const src = sources[p.sourceId];
    if (!src) return;
    const pdfjsPage = await src.pdfjsDoc.getPage(p.pageIndex + 1);
    const rotation = ((pdfjsPage.rotate + p.rotationDelta) % 360 + 360) % 360;

    const targetWidth = 300;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const unscaled = pdfjsPage.getViewport({ scale: 1, rotation: rotation });
    const scale = (targetWidth / unscaled.width) * dpr;
    const viewport = pdfjsPage.getViewport({ scale: scale, rotation: rotation });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = Math.ceil(viewport.width / dpr) + "px";
    canvas.style.height = Math.ceil(viewport.height / dpr) + "px";
    const ctx = canvas.getContext("2d");
    await pdfjsPage.render({ canvasContext: ctx, viewport: viewport }).promise;

    p._thumb = { key: p.rotationDelta, canvas: canvas };

    const wrap = gridEl.querySelector('[data-uid="' + p.uid + '"] .page-card__thumb-wrap');
    if (wrap) {
      wrap.innerHTML = "";
      wrap.appendChild(canvas);
    }
  }

  /* ---------------------------------------------------------------------
     PDF building / downloads
     --------------------------------------------------------------------- */

  function triggerDownload(data, filename, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function buildPdfBytes(positions) {
    const doc = await PDFLib.PDFDocument.create();
    for (const pos of positions) {
      const p = pages[pos];
      const src = sources[p.sourceId];
      if (!src.pdfLibDocPromise) {
        src.pdfLibDocPromise = PDFLib.PDFDocument.load(src.rawBytes.slice());
      }
      const srcDoc = await src.pdfLibDocPromise;
      const [copied] = await doc.copyPages(srcDoc, [p.pageIndex]);
      const rot = ((copied.getRotation().angle + p.rotationDelta) % 360 + 360) % 360;
      copied.setRotation(PDFLib.degrees(rot));
      doc.addPage(copied);
    }
    return doc.save();
  }

  async function downloadPdf() {
    if (pages.length === 0) return;
    btnDownload.disabled = true;
    try {
      const positions = pages.map((_, i) => i);
      const bytes = await buildPdfBytes(positions);
      triggerDownload(bytes, "document.pdf", "application/pdf");
      toast("PDF downloaded.");
    } catch (err) {
      console.error(err);
      toast("Something went wrong while building the PDF.", true);
    } finally {
      btnDownload.disabled = pages.length === 0;
    }
  }

  /* ---------------------------------------------------------------------
     Split
     --------------------------------------------------------------------- */

  function parsePositionRanges(text, max) {
    const out = new Set();
    if (!text || !text.trim()) return [];
    text.split(",").forEach((part) => {
      part = part.trim();
      if (!part) return;
      if (part.indexOf("-") !== -1) {
        let [a, b] = part.split("-").map((s) => parseInt(s.trim(), 10));
        if (isNaN(a) || isNaN(b)) return;
        if (a > b) [a, b] = [b, a];
        for (let n = a; n <= b; n++) {
          if (n >= 1 && n <= max) out.add(n - 1);
        }
      } else {
        const n = parseInt(part, 10);
        if (!isNaN(n) && n >= 1 && n <= max) out.add(n - 1);
      }
    });
    return Array.from(out).sort((a, b) => a - b);
  }

  async function performSplit() {
    const mode = document.querySelector('input[name="split-mode"]:checked').value;
    const max = pages.length;
    let groups = [];

    if (mode === "chunks") {
      const size = parseInt(splitChunkSizeInput.value, 10);
      if (!size || size < 1) {
        toast("Enter a valid chunk size.", true);
        return;
      }
      for (let i = 0; i < max; i += size) {
        groups.push(Array.from({ length: Math.min(size, max - i) }, (_, k) => i + k));
      }
    } else {
      const raw = splitRangesInput.value.split(";");
      raw.forEach((segment) => {
        const idxs = parsePositionRanges(segment, max);
        if (idxs.length) groups.push(idxs);
      });
      if (groups.length === 0) {
        toast("Enter at least one valid range, e.g. 1-3;4-6", true);
        return;
      }
    }

    splitConfirmBtn.disabled = true;
    splitConfirmBtn.textContent = "Working\u2026";
    try {
      if (groups.length === 1) {
        const bytes = await buildPdfBytes(groups[0]);
        triggerDownload(bytes, "document-part1.pdf", "application/pdf");
      } else {
        const zip = new JSZip();
        for (let i = 0; i < groups.length; i++) {
          const bytes = await buildPdfBytes(groups[i]);
          zip.file("document-part" + (i + 1) + ".pdf", bytes);
        }
        const blob = await zip.generateAsync({ type: "blob" });
        triggerDownload(blob, "split-pages.zip", "application/zip");
      }
      closeModal(splitModal);
      toast("Created " + groups.length + (groups.length === 1 ? " file." : " files."));
    } catch (err) {
      console.error(err);
      toast("Something went wrong while splitting.", true);
    } finally {
      splitConfirmBtn.disabled = false;
      splitConfirmBtn.textContent = "Split & download .zip";
    }
  }

  /* ---------------------------------------------------------------------
     Export as JPG
     --------------------------------------------------------------------- */

  async function renderPageToJpegBlob(p, scale) {
    const src = sources[p.sourceId];
    const pdfjsPage = await src.pdfjsDoc.getPage(p.pageIndex + 1);
    const rotation = ((pdfjsPage.rotate + p.rotationDelta) % 360 + 360) % 360;
    const viewport = pdfjsPage.getViewport({ scale: scale, rotation: rotation });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    await pdfjsPage.render({ canvasContext: ctx, viewport: viewport }).promise;
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  }

  async function performExportJpg() {
    const scope = document.querySelector('input[name="jpg-scope"]:checked').value;
    const qualityStep = parseInt(jpgQualityInput.value, 10);
    const scaleMap = { 1: 1.4, 2: 2.2, 3: 3.2 };
    const scale = scaleMap[qualityStep] || 2.2;

    const targets = pages
      .map((p, i) => ({ p: p, index: i }))
      .filter((t) => scope === "all" || selected.has(t.p.uid));

    if (targets.length === 0) {
      toast("No pages to export.", true);
      return;
    }

    jpgConfirmBtn.disabled = true;
    jpgConfirmBtn.textContent = "Working\u2026";
    try {
      if (targets.length === 1) {
        const blob = await renderPageToJpegBlob(targets[0].p, scale);
        triggerDownload(blob, "page-" + (targets[0].index + 1) + ".jpg", "image/jpeg");
      } else {
        const zip = new JSZip();
        for (const t of targets) {
          const blob = await renderPageToJpegBlob(t.p, scale);
          zip.file("page-" + (t.index + 1) + ".jpg", blob);
        }
        const blob = await zip.generateAsync({ type: "blob" });
        triggerDownload(blob, "pdf-pages.zip", "application/zip");
      }
      closeModal(jpgModal);
      toast("Exported " + targets.length + (targets.length === 1 ? " image." : " images."));
    } catch (err) {
      console.error(err);
      toast("Something went wrong while exporting images.", true);
    } finally {
      jpgConfirmBtn.disabled = false;
      jpgConfirmBtn.textContent = "Export";
    }
  }

  /* ---------------------------------------------------------------------
     Modals
     --------------------------------------------------------------------- */

  function openModal(el) {
    el.hidden = false;
  }
  function closeModal(el) {
    el.hidden = true;
  }

  function wireModalDismiss(backdrop, closeBtn, cancelBtn) {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal(backdrop);
    });
    closeBtn.addEventListener("click", () => closeModal(backdrop));
    if (cancelBtn) cancelBtn.addEventListener("click", () => closeModal(backdrop));
  }

  /* ---------------------------------------------------------------------
     Drag and drop reordering
     --------------------------------------------------------------------- */

  function clearDropIndicators() {
    gridEl.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
  }

  gridEl.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".page-card");
    if (!card) return;
    draggedUid = card.dataset.uid;
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", draggedUid);
    } catch (err) {
      /* some browsers require this to not throw; ignore */
    }
    requestAnimationFrame(() => card.classList.add("is-dragging"));
  });

  gridEl.addEventListener("dragover", (e) => {
    const card = e.target.closest(".page-card");
    if (!card || card.dataset.uid === draggedUid) return;
    e.preventDefault();
    clearDropIndicators();
    const rect = card.getBoundingClientRect();
    const before = e.clientX - rect.left < rect.width / 2;
    card.classList.add("is-drop-target");
    card.dataset.dropBefore = before ? "1" : "0";
  });

  gridEl.addEventListener("drop", (e) => {
    const card = e.target.closest(".page-card");
    e.preventDefault();
    if (!card || !draggedUid) return;
    const before = card.dataset.dropBefore === "1";
    reorderPages(draggedUid, card.dataset.uid, before);
    draggedUid = null;
    renderGrid();
  });

  gridEl.addEventListener("dragend", () => {
    clearDropIndicators();
    gridEl.querySelectorAll(".is-dragging").forEach((el) => el.classList.remove("is-dragging"));
    draggedUid = null;
  });

  /* ---------------------------------------------------------------------
     Grid click delegation (checkbox + per-card ops)
     --------------------------------------------------------------------- */

  gridEl.addEventListener("click", (e) => {
    const card = e.target.closest(".page-card");
    if (!card) return;
    const uid = card.dataset.uid;

    if (e.target.closest(".page-card__check")) {
      toggleSelect(uid);
      return;
    }

    const opBtn = e.target.closest(".page-card__op");
    if (opBtn) {
      const action = opBtn.dataset.action;
      if (action === "rotate-left") rotatePages([uid], -90);
      else if (action === "rotate-right") rotatePages([uid], 90);
      else if (action === "duplicate") duplicatePages([uid]);
      else if (action === "delete") deletePages([uid]);
      else if (action === "insert") insertAfter(uid);
    }
  });

  /* ---------------------------------------------------------------------
     Dropzone (initial upload)
     --------------------------------------------------------------------- */

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-dragover");
    });
  });
  ["dragleave", "dragend"].forEach((evt) => {
    dropzone.addEventListener(evt, () => dropzone.classList.remove("is-dragover"));
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-dragover");
    handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", (e) => {
    handleFiles(e.target.files);
    e.target.value = "";
  });

  /* ---------------------------------------------------------------------
     Toolbar wiring
     --------------------------------------------------------------------- */

  btnAddPdf.addEventListener("click", () => fileInput.click());
  btnSelectAll.addEventListener("click", selectAll);
  btnSelectNone.addEventListener("click", selectNone);
  btnRotateLeft.addEventListener("click", () => rotatePages(Array.from(selected), -90));
  btnRotateRight.addEventListener("click", () => rotatePages(Array.from(selected), 90));
  btnDuplicate.addEventListener("click", () => duplicatePages(Array.from(selected)));
  btnDelete.addEventListener("click", () => deletePages(Array.from(selected)));
  btnDownload.addEventListener("click", downloadPdf);

  btnSplit.addEventListener("click", () => {
    splitPageCountEl.textContent = String(pages.length);
    openModal(splitModal);
  });
  btnExportJpg.addEventListener("click", () => {
    jpgAllCountEl.textContent = String(pages.length);
    jpgSelectedCountEl.textContent = String(selected.size);
    const selectedRadio = jpgModal.querySelector('input[name="jpg-scope"][value="selected"]');
    const allRadio = jpgModal.querySelector('input[name="jpg-scope"][value="all"]');
    if (selected.size === 0) {
      selectedRadio.disabled = true;
      allRadio.checked = true;
    } else {
      selectedRadio.disabled = false;
    }
    openModal(jpgModal);
  });

  wireModalDismiss(splitModal, document.getElementById("split-modal-close"), document.getElementById("split-cancel"));
  wireModalDismiss(jpgModal, document.getElementById("jpg-modal-close"), document.getElementById("jpg-cancel"));

  splitModal.querySelectorAll('input[name="split-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = document.querySelector('input[name="split-mode"]:checked').value;
      splitChunkSizeInput.disabled = mode !== "chunks";
      splitRangesInput.disabled = mode !== "ranges";
    });
  });
  splitConfirmBtn.addEventListener("click", performSplit);

  const qualityLabels = { 1: "Draft", 2: "Standard", 3: "High" };
  jpgQualityInput.addEventListener("input", () => {
    jpgQualityLabel.textContent = qualityLabels[jpgQualityInput.value] || "Standard";
  });
  jpgConfirmBtn.addEventListener("click", performExportJpg);

  /* ---------------------------------------------------------------------
     Init
     --------------------------------------------------------------------- */

  updateWorkspaceVisibility();
  updateToolbarState();
})();
