(async () => {
  // =========================
  // Keys / Defaults / Limits
  // =========================
  const POS_KEY = "civitai_dl_pos_v33";
  const SIZE_KEY = "civitai_dl_size_v33";
  const SETTINGS_KEY = "civitai_dl_settings_v33";

  const DEFAULT_SETTINGS = {
    concurrency: 3,
    keepVisible: true,
    wallpaper: null,           // data URL (compressed)
    wallpaperAlpha: 0.35,
    keepWallpaperVisible: true // enforce min height cap so top of portrait is visible
  };

  // visual sizing defaults
  const DEFAULT_SIZE = { width: 345, height: 340 }; // width is 15px less than before
  const MIN_HEIGHT = 260;
  const MAX_AUTO_HEIGHT_MAIN = 520;   // max when auto-adjusting
  const MAX_AUTO_HEIGHT_SETTINGS = 640;
  const SETTINGS_MARGIN = 20;

  // =================================
  // State
  // =================================
  let settings = loadSettings();
  let isPaused = false;
  let currentControllers = new Set();
  let finishedIndicatorShown = false;
  let savedMainHeight = (loadSize().height || DEFAULT_SIZE.height);

  // =================================
  // Helpers
  // =================================
  function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const cleanUrl = (u) => u.replace(/\/anim=.*?\/|,optimized=true|,width=\d+/g, "/").split("?")[0];

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      return s ? { ...DEFAULT_SETTINGS, ...s } : { ...DEFAULT_SETTINGS };
    } catch { return { ...DEFAULT_SETTINGS }; }
  }
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      console.warn("⚠️ Settings too large, not saved:", err);
    }
  }
  function loadSize() {
    try { return JSON.parse(localStorage.getItem(SIZE_KEY)) || DEFAULT_SIZE; }
    catch { return DEFAULT_SIZE; }
  }
  function saveSize() {
    const r = box.getBoundingClientRect();
    localStorage.setItem(SIZE_KEY, JSON.stringify({ width: r.width, height: r.height }));
  }
  function restorePosition() {
    try {
      const s = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (s) { box.style.left = s.left + "px"; box.style.top = s.top + "px"; }
      else { box.style.right = "20px"; box.style.bottom = "45px"; }
    } catch { box.style.right = "20px"; box.style.bottom = "45px"; }
  }

  // compress + base64 the wallpaper to fit localStorage
  async function fileToBase64Compressed(file) {
    // Use createImageBitmap for faster decode when available
    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch {
      // fallback to Image
      bmp = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
    }
    const canvas = document.createElement("canvas");
    // limit max dims so dataURL stays small
    const maxW = 1280, maxH = 720;
    const scale = Math.min(maxW / bmp.width, maxH / bmp.height, 1);
    canvas.width = Math.max(1, Math.floor(bmp.width * scale));
    canvas.height = Math.max(1, Math.floor(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    try { bmp.close && bmp.close(); } catch {}
    // compress to jpeg (smaller than png/webp typically)
    return canvas.toDataURL("image/jpeg", 0.8);
  }

  // =================================
  // UI: Shell
  // =================================
  const box = document.createElement("div");
  const savedSize = loadSize();
  Object.assign(box.style, {
    position: "fixed",
    zIndex: "999999",
    width: savedSize.width + "px",
    height: savedSize.height + "px",
    minWidth: "300px",
    minHeight: MIN_HEIGHT + "px",
    color: "#0f0",
    fontSize: "15px",
    fontFamily: "Times New Roman, serif",
    borderRadius: "12px",
    overflow: "hidden",
    resize: "both",
    background: "rgba(0,0,0,0.85)",
    boxShadow: "0 0 14px rgba(0,0,0,0.6)",
    userSelect: "none",
    backdropFilter: "blur(4px)",
  });
  restorePosition();

  // wallpaper layer (top anchored)
  const bg = document.createElement("div");
  Object.assign(bg.style, {
    position: "absolute",
    inset: "0",
    backgroundSize: "cover",
    backgroundPosition: "top center",
    opacity: settings.wallpaperAlpha,
    zIndex: "-1",
    transition: "opacity 0.3s ease",
  });
  function applyWallpaper() {
    if (settings.wallpaper) bg.style.backgroundImage = `url(${settings.wallpaper})`;
    else bg.style.backgroundImage = "";
    bg.style.opacity = settings.wallpaperAlpha;
  }
  applyWallpaper();
  box.appendChild(bg);

  // header (drag handle)
  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px 4px",
    background: "rgba(0,0,0,0.75)",
    cursor: "move",
  });
  const title = document.createElement("div");
  title.textContent = "Civitai Downloader";
  Object.assign(title.style, { fontWeight: "700", color: "#9f9", flex: "1 1 auto" });
  const gearBtn = iconBtn("⚙️", "Settings");
  const closeBtn = iconBtn("✖", "Close");
  header.append(title, gearBtn, closeBtn);

  // main view
  const mainView = document.createElement("div");
  const settingsView = document.createElement("div");
  settingsView.style.display = "none";

  const controls = document.createElement("div");
  Object.assign(controls.style, { display: "flex", gap: "8px", margin: "8px 10px", flexWrap: "wrap" });
  const restartBtn = pillBtn("Restart");
  const stopBtn = pillBtn("Stop");
  const resumeBtn = pillBtn("Resume");
  resumeBtn.style.display = "none";
  controls.append(restartBtn, stopBtn, resumeBtn);

  const body = document.createElement("div");
  Object.assign(body.style, { whiteSpace: "pre-line", lineHeight: "1.25", padding: "0 10px" });

  const barsWrap = document.createElement("div");
  Object.assign(barsWrap.style, {
    display: "grid",
    gap: "6px",
    marginTop: "6px",
    padding: "0 10px",
  });

  const statusLine = document.createElement("div");
  Object.assign(statusLine.style, { margin: "6px 10px 0", color: "#cfc" });

  const credit = document.createElement("div");
  Object.assign(credit.style, {
    fontSize: "12px",
    color: "#9f9",
    textAlign: "center",
    padding: "4px",
    borderTop: "1px solid rgba(255,255,255,0.15)",
  });
  credit.textContent = "Made by Mia Iceberg — v3.3";

  mainView.append(controls, body, barsWrap, statusLine, credit);

  // settings view
  const backRow = document.createElement("div");
  Object.assign(backRow.style, { display: "flex", alignItems: "center", gap: "8px", margin: "8px" });
  const backBtn = pillBtn("← Back");
  const settingsTitle = document.createElement("div");
  settingsTitle.textContent = "Settings";
  Object.assign(settingsTitle.style, { color: "#9f9", fontWeight: "700" });
  backRow.append(backBtn, settingsTitle);

  const settingsForm = document.createElement("div");
  Object.assign(settingsForm.style, { display: "grid", gap: "10px", padding: "0 10px" });

  const concRow = labelField("Parallel downloads (1–10):", "number", settings.concurrency);
  const keepRow = checkboxField("Keep popup visible (no auto-close)", settings.keepVisible);
  const visRow = checkboxField("Keep wallpaper fully visible (auto-adjust height)", settings.keepWallpaperVisible);

  // wallpaper picker
  const wallRow = document.createElement("div");
  wallRow.style.color = "#dfd";
  wallRow.innerHTML = `<div>Select wallpaper image:</div>`;
  const wallInput = document.createElement("input");
  wallInput.type = "file"; wallInput.accept = "image/*";
  const clearWallBtn = pillBtn("Clear");

  wallInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const base64 = await fileToBase64Compressed(file);
    settings.wallpaper = base64;
    saveSettings();
    applyWallpaper();
  };
  clearWallBtn.onclick = () => {
    settings.wallpaper = null;
    saveSettings();
    applyWallpaper();
  };
  wallRow.append(wallInput, clearWallBtn);

  // wallpaper opacity
  const alphaRow = document.createElement("div");
  alphaRow.style.color = "#dfd";
  const alphaLbl = document.createElement("div");
  alphaLbl.textContent = "Background transparency:";
  const alphaSlider = document.createElement("input");
  alphaSlider.type = "range"; alphaSlider.min = "0"; alphaSlider.max = "1"; alphaSlider.step = "0.05";
  alphaSlider.value = settings.wallpaperAlpha;
  alphaSlider.oninput = () => { settings.wallpaperAlpha = +alphaSlider.value; applyWallpaper(); saveSettings(); };
  alphaRow.append(alphaLbl, alphaSlider);

  const restoreBtn = pillBtn("Restore Defaults");
  const saveBtn = pillBtn("Save");

  settingsForm.append(concRow.row, keepRow.row, visRow.row, wallRow, alphaRow, restoreBtn, saveBtn);
  settingsView.append(backRow, settingsForm);

  // mount
  box.append(header, mainView, settingsView);
  document.body.append(box);

  // =================================
  // UI Interactions
  // =================================
  initDrag(header);
  initResize();

  gearBtn.onclick = () => {
    savedMainHeight = parseFloat(box.style.height) || savedMainHeight;
    autoGrowForSettings();
  };
  backBtn.onclick = () => {
    setView("main");
    const target = clamp(savedMainHeight, MIN_HEIGHT, MAX_AUTO_HEIGHT_MAIN);
    box.style.height = target + "px";
  };
  closeBtn.onclick = () => (box.style.display = "none");

  saveBtn.onclick = () => {
    settings.concurrency = clamp(+concRow.input.value, 1, 10);
    settings.keepVisible = keepRow.input.checked;
    settings.keepWallpaperVisible = visRow.input.checked;
    saveSettings();
    setView("main");
    const target = clamp(savedMainHeight, MIN_HEIGHT, MAX_AUTO_HEIGHT_MAIN);
    box.style.height = target + "px";
  };

  restoreBtn.onclick = () => {
    localStorage.removeItem(POS_KEY);
    localStorage.removeItem(SIZE_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    box.remove();
    alert("Defaults restored. Click the extension again to reopen.");
  };

  restartBtn.onclick = () => { isPaused = false; runAll(); };
  stopBtn.onclick = () => { stopAllActive(); isPaused = true; };
  resumeBtn.onclick = () => { isPaused = false; runAll(); };

  function setView(v) { mainView.style.display = v === "settings" ? "none" : ""; settingsView.style.display = v === "settings" ? "" : "none"; }
  function autoGrowForSettings() {
    // show to measure
    settingsView.style.display = "";
    const headerH = header.getBoundingClientRect().height;
    const desired = Math.min(
      Math.max(MIN_HEIGHT, Math.ceil(settingsView.scrollHeight + headerH + SETTINGS_MARGIN)),
      Math.min(MAX_AUTO_HEIGHT_SETTINGS, window.innerHeight - 20)
    );
    box.style.height = desired + "px";
    setView("settings");
  }
  function iconBtn(txt, title) {
    const b = document.createElement("button");
    b.textContent = txt;
    Object.assign(b.style, {
      width: "26px", height: "26px", borderRadius: "8px", border: "1px solid #2a2",
      background: "transparent", color: "#8f8", cursor: "pointer",
    });
    b.title = title; return b;
  }
  function pillBtn(txt) {
    const b = document.createElement("button");
    b.textContent = txt;
    Object.assign(b.style, {
      padding: "6px 10px", fontSize: "13px", cursor: "pointer",
      borderRadius: "10px", border: "1px solid #2a2",
      background: "rgba(0,0,0,0.4)", color: "#9f9"
    });
    return b;
  }
  function labelField(lbl, type, val) {
    const row = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = lbl;
    Object.assign(label.style, { color: "#dfd", display: "block" });
    const input = Object.assign(document.createElement("input"), { type, value: val });
    Object.assign(input.style, {
      padding: "4px", borderRadius: "6px",
      border: "1px solid #2a2", background: "#111",
      color: "#9f9", width: "80px"
    });
    row.append(label, input);
    return { row, input };
  }
  function checkboxField(lbl, val) {
    const row = document.createElement("div");
    Object.assign(row.style, { color: "#dfd", display: "flex", alignItems: "center", gap: "8px" });
    const input = document.createElement("input");
    input.type = "checkbox"; input.checked = val;
    const span = document.createElement("span"); span.textContent = lbl;
    row.append(input, span);
    return { row, input };
  }

  // drag (position persists)
  function initDrag(h) {
    let drag = false, dx = 0, dy = 0;
    h.addEventListener("mousedown", e => {
      if (e.target.tagName === "BUTTON") return;
      drag = true;
      const r = box.getBoundingClientRect();
      box.style.left = r.left + "px"; box.style.top = r.top + "px"; box.style.right = "auto"; box.style.bottom = "auto";
      dx = e.clientX - r.left; dy = e.clientY - r.top; e.preventDefault();
    });
    window.addEventListener("mousemove", e => {
      if (!drag) return;
      const l = Math.max(4, Math.min(window.innerWidth - box.offsetWidth - 4, e.clientX - dx));
      const t = Math.max(4, Math.min(window.innerHeight - 40, e.clientY - dy));
      box.style.left = l + "px"; box.style.top = t + "px";
    });
    window.addEventListener("mouseup", () => {
      if (!drag) return;
      drag = false;
      const r = box.getBoundingClientRect();
      localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
    });
  }

  // resize (size persists + min/max for wallpaper visibility)
  function initResize() {
    new ResizeObserver(() => {
      saveSize();
      if (settings.keepWallpaperVisible) {
        const h = parseFloat(box.style.height) || box.getBoundingClientRect().height;
        if (h < MIN_HEIGHT + 0.5) box.style.height = MIN_HEIGHT + "px";
        if (h > MAX_AUTO_HEIGHT_SETTINGS + 0.5) box.style.height = MAX_AUTO_HEIGHT_SETTINGS + "px";
      }
    }).observe(box);
  }

  // =================================
  // Logging / Status
  // =================================
  const log = (m, c = "#0f0") => { body.style.color = c; body.textContent = m; };
  const setStatus = (t) => (statusLine.textContent = t);

  // =================================
  // Progress bars (on-demand, fade out)
  // =================================
  const workerBars = new Map(); // i -> {row,label,fill}
  function createWorkerBar(i) {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "grid",
      gap: "3px",
      opacity: "0",
      maxHeight: "0px",
      transition: "opacity 200ms ease, max-height 200ms ease",
    });

    const label = document.createElement("div");
    Object.assign(label.style, { color: "#cfc", fontSize: "13px" });
    label.textContent = "starting…";

    const track = document.createElement("div");
    Object.assign(track.style, {
      width: "100%", height: "9px", borderRadius: "6px",
      background: "#212121", overflow: "hidden",
    });
    const fill = document.createElement("div");
    Object.assign(fill.style, { height: "100%", width: "0%", background: "#33ff88", transition: "width 80ms linear" });
    track.append(fill);

    row.append(label, track);
    barsWrap.append(row);

    requestAnimationFrame(() => { row.style.opacity = "1"; row.style.maxHeight = "50px"; });

    workerBars.set(i, { row, label, fill });
    return workerBars.get(i);
  }
  function setWorkerProgress(i, pct, text) {
    const b = workerBars.get(i) || createWorkerBar(i);
    const v = Math.max(0, Math.min(100, pct | 0));
    b.fill.style.width = v + "%";
    b.label.textContent = text || "";
  }
  function hideWorkerBar(i) {
    const b = workerBars.get(i);
    if (!b) return;
    b.row.style.opacity = "0";
    b.row.style.maxHeight = "0px";
    setTimeout(() => {
      if (barsWrap.contains(b.row)) barsWrap.removeChild(b.row);
      workerBars.delete(i);
    }, 220);
  }
  function hideAllWorkerBars() {
    [...workerBars.keys()].forEach(hideWorkerBar);
  }

  // =================================
  // Auto-Scroll Gallery
  // =================================
  async function loadAllGalleryImages(gallery) {
    const nextBtn = gallery.querySelector("button svg.tabler-icon-chevron-right")?.closest("button");
    if (!nextBtn) {
      log("ℹ️ No next button — static gallery");
      return;
    }
    log("➡️ Auto-scrolling gallery…");
    let prevCount = 0, sameCount = 0;
    for (let i = 0; i < 300; i++) {
      const imgs = gallery.querySelectorAll('img[src*="image.civitai.com"]');
      if (imgs.length > prevCount) {
        prevCount = imgs.length;
        sameCount = 0;
        log(`➡️ Loaded ${imgs.length} images…`);
      } else if (++sameCount > 5) break;
      nextBtn.click();
      await sleep(80);
    }
    log(`✅ Gallery fully loaded (${prevCount} images)`);
  }

  // =================================
  // Collectors (scoped to main gallery only)
  // =================================
  function collectGallery() {
    return document.querySelector('[class*="ModelVersionDetails_mainSection__"]');
  }
  function collectImages(gallery) {
    const s = new Set();
    return [...gallery.querySelectorAll('img[src*="image.civitai.com"]')]
      .map(i => cleanUrl(i.src))
      .filter(u => u && u.startsWith("https") && !/\.webp(\?|$)/i.test(u) && !s.has(u) && s.add(u));
  }
  function collectVideos(gallery) {
    const s = new Set();
    return [...gallery.querySelectorAll('video source[type="video/mp4"]')]
      .map(v => v.src?.split("?")[0])
      .filter(u => u && u.startsWith("https") && !s.has(u) && s.add(u));
  }

  // =================================
  // Network helpers
  // =================================
  function stopAllActive() {
    for (const c of currentControllers) { try { c.abort(); } catch {} }
    currentControllers.clear();
  }
  async function fetchWithProgress(url, timeoutMs, workerIndex, label) {
    const controller = new AbortController();
    currentControllers.add(controller);
    const { signal } = controller;
    const to = setTimeout(() => { try { controller.abort(); } catch {} }, timeoutMs);

    const res = await fetch(url, { signal, cache: "no-store" });
    clearTimeout(to);
    currentControllers.delete(controller);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const total = +res.headers.get("content-length") || 0;
    const reader = res.body?.getReader();
    if (!reader) {
      const b = await res.blob();
      setWorkerProgress(workerIndex, 100, `${label} (100%)`);
      return b;
    }

    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total > 0) {
        const pct = (received / total) * 100;
        setWorkerProgress(workerIndex, pct, `${label} (${pct.toFixed(0)}%)`);
      } else {
        // pulse when unknown content-length
        const cycle = (received % (512 * 1024)) / (512 * 1024);
        setWorkerProgress(workerIndex, cycle * 100, `${label} (stream)`);
      }
      if (isPaused) throw new Error("Paused");
    }
    const type = res.headers.get("content-type") || "";
    return new Blob(chunks, { type });
  }
  async function saveBlob(blob, filename) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise(r => requestAnimationFrame(r));
    URL.revokeObjectURL(u);
  }

  // =================================
  // Parallel Queue
  // =================================
  async function runQueue(items, kind) {
    if (!items.length) return;

    let nextIndex = 0;
    let completed = 0;
    const total = items.length;
    setStatus(`${kind}: 0/${total}`);

    const workers = Array.from({ length: settings.concurrency }, (_, i) => worker(i));
    async function worker(i) {
      while (true) {
        if (isPaused) return; // paused → stop loop

        const idx = nextIndex++;
        if (idx >= total) { hideWorkerBar(i); return; }

        const it = items[idx];
        try {
          setWorkerProgress(i, 0, `${kind.slice(0, -1)} ${idx + 1}/${total}`);
          const blob = await fetchWithProgress(it.url, it.timeout, i, `${kind.slice(0, -1)} ${idx + 1}/${total}`);
          await saveBlob(blob, it.name(blob));
          completed++;
          setStatus(`${kind}: ${completed}/${total}`);
          setWorkerProgress(i, 100, `Saved ${idx + 1}`);
        } catch (e) {
          if (e.name === "AbortError" || e.message === "Paused") {
            hideWorkerBar(i);
            return;
          } else {
            setWorkerProgress(i, 0, `fail ${idx + 1}`);
          }
        }
        // smooth fade out of bar
        setTimeout(() => hideWorkerBar(i), 180);
        await new Promise(r => requestAnimationFrame(r));
        await sleep(kind === "images" ? 200 : 340);
      }
    }
    await Promise.all(workers);
  }

  // =================================
  // Main Flow
  // =================================
  async function runAll() {
    finishedIndicatorShown = false;
    body.textContent = "";
    setStatus("—");
    isPaused = false;
    hideAllWorkerBars();

    log("🟢 Starting image downloader…");
    const gallery = collectGallery();
    if (!gallery) {
      log("❌ Gallery not found", "#f55");
      return;
    }

    // auto-scroll to load all
    await loadAllGalleryImages(gallery);

    // IMAGES
    const imgs = collectImages(gallery);
    const imgItems = imgs.map((url, idx) => ({
      url,
      timeout: 15000,
      name: (b) => {
        const t = (b.type || "").toLowerCase();
        let ext = "jpg";
        if (t.includes("png")) ext = "png";
        else if (t.includes("gif")) ext = "gif";
        else if (t.includes("webp")) ext = "webp";
        return `civitai_image_${idx + 1}.${ext}`;
      }
    }));
    await runQueue(imgItems, "images");
    log("🟢 Images done! Preparing videos…");
    await sleep(400);

    // VIDEOS
    const vids = collectVideos(gallery);
    if (!vids.length) {
      log("⚠️ No MP4 videos on page", "#f55");
      setTimeout(() => {
        if (!settings.keepVisible) box.remove();
        else body.textContent = ""; // clear notice if keeping visible
      }, 2500);
      return;
    }
    log(`🎞 Found ${vids.length} videos`);
    const vidItems = vids.map((url, idx) => ({
      url,
      timeout: 20000,
      name: () => `civitai_video_${idx + 1}.mp4`
    }));
    await runQueue(vidItems, "videos");

    showFinished();
  }

  function showFinished() {
    if (finishedIndicatorShown) return;
    finishedIndicatorShown = true;
    title.textContent = "✅ Downloads complete!";
    title.style.color = "#8f8";
    setTimeout(() => { title.textContent = "Civitai Downloader"; title.style.color = "#9f9"; }, 4000);
    body.textContent = "";
    if (!settings.keepVisible) setTimeout(() => box.remove(), 3000);
  }

  // =================================
  // Start
  // =================================
  await runAll();

})();