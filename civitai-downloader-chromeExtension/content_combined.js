// content_combined.js

// =======================
// Single-instance control
// =======================
if (window.__CIVITAI_DL_ACTIVE__) {
  console.warn("[CivitAI Script] Cleaning up existing instance before start.");
  try {
    window.__CIVITAI_DL_ACTIVE__.abort?.();
    document.querySelector("#civitai-dl-popup")?.remove();
  } catch {}
}
window.__CIVITAI_DL_ACTIVE__ = new AbortController();
const __stopSignal = window.__CIVITAI_DL_ACTIVE__.signal;


// ===================================
// Auto stop previous instance + delay
// ===================================
(async () => {
  try { __CIVITAI_STOP(); } catch {}
  await new Promise(r => setTimeout(r, 300));
})();
// Add a shared stop function
function __CIVITAI_STOP() {
  console.warn("[CivitAI Script] Manual stop triggered.");
  window.__CIVITAI_DL_ACTIVE__?.abort?.();
  document.querySelector("#civitai-dl-popup")?.remove();
}


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
  const DEFAULT_SIZE = { width: 345, height: 340 };
  const MIN_HEIGHT = 260;
  const MAX_AUTO_HEIGHT_MAIN = 520;
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

  // More permissive cleaner for Civitai image CDN URLs
  function cleanUrl(u) {
  if (!u) return "";

  let out = u
    // remove flags like /anim=false,width=450,optimized=true/
    .replace(/\/anim=[^/]*,?[^/]*,?[^/]*\//g, "/")
    .replace(/,optimized=true/g, "")
    .replace(/,width=\d+/g, "")
    .replace(/,height=\d+/g, "")
    .split("?")[0];

  // collapse any "//" that appear *after* the domain name but not the protocol
  out = out.replace(/(^https?:\/\/[^/]+)\/+/i, "$1/"); // keep single slash after domain
  out = out.replace(/([^:])\/{2,}/g, "$1/");           // collapse leftover double slashes in path

  // if the URL accidentally ends with a slash before the file name, remove it
  out = out.replace(/\/([A-Za-z0-9_-]+\.(?:jpe?g|png|gif|webp))$/i, "/$1");

  return out;
}


  function getImgUrl(imgEl) {
    // prefer currentSrc when <picture> is used
    const u = imgEl.currentSrc || imgEl.src || "";
    return cleanUrl(u);
  }

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
    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch {
      bmp = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
    }
    const canvas = document.createElement("canvas");
    const maxW = 1280, maxH = 720;
    const scale = Math.min(maxW / bmp.width, maxH / bmp.height, 1);
    canvas.width = Math.max(1, Math.floor(bmp.width * scale));
    canvas.height = Math.max(1, Math.floor(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    try { bmp.close && bmp.close(); } catch {}
    return canvas.toDataURL("image/jpeg", 0.8);
  }

  // =================================
  // UI: Shell
  // =================================
  const box = document.createElement("div");
  
  box.id = "civitai-dl-popup";
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
  credit.textContent = "Made by Mia Iceberg — v3.6.0";

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

  restartBtn.onclick = () => { stopAllActive(); isPaused = false; hideAllWorkerBars(); runAll(); };
  stopBtn.onclick = () => { stopAllActive(); isPaused = true; };
  resumeBtn.onclick = () => { isPaused = false; runAll(); };

  function setView(v) { mainView.style.display = v === "settings" ? "none" : ""; settingsView.style.display = v === "settings" ? "" : "none"; }
  function autoGrowForSettings() {
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
  
    __lastProgressTime = Date.now();}
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
  // Auto-Scroll Gallery (with page fallback)
  // =================================
  async function loadAllGalleryImages(gallery) {
    // Try the carousel "next" button first
    const nextBtn = gallery.querySelector("button svg.tabler-icon-chevron-right")?.closest("button");
    if (nextBtn) {
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
      log("⏳ Waiting for images to finish rendering…");

      let stable = 0, lastCount = 0;
      for (let i = 0; i < 30; i++) {
        const imgs = gallery.querySelectorAll('img[src*="image.civitai.com"]');
        if (imgs.length === lastCount) stable++;
        else { stable = 0; lastCount = imgs.length; }
        if (stable >= 3) break; // stop after stable count for ~300ms
        await sleep(100);
      }
      log("✅ DOM stabilized — starting downloads…");
      return;
    }

    // Fallback: scroll the whole page to trigger lazy loads
    log("➡️ Scrolling page to trigger lazy image loads…");
    let lastSeen = 0, stable = 0;
    for (let i = 0; i < 400; i++) {
      window.scrollBy(0, Math.max(200, window.innerHeight - 120));
      await sleep(80);
      const imgs = document.querySelectorAll('img[src*="image.civitai.com"], img[data-src*="image.civitai.com"]');
      if (imgs.length > lastSeen) {
        lastSeen = imgs.length;
        stable = 0;
        log(`➡️ Discovered ${imgs.length} images…`);
      } else if (++stable > 8) {
        break;
      }
    }
    // small bounce up to catch images loading near the top/center
    window.scrollTo({ top: 0, behavior: "instant" });
    await sleep(120);
    log(`✅ Page scroll complete (roughly ${lastSeen} images discovered)`);
  }

  // =================================
  // Gallery detection + Collectors
  // =================================
  function findFirstGalleryRoot() {
    // 1) Prefer the main section (your original logic)
    const preferred = document.querySelector('[class*="ModelVersionDetails_mainSection__"]');
    if (preferred) return preferred;

    // 2) Heuristic: choose the first container with >= 3 civitai images
    const candidates = Array.from(document.querySelectorAll("main, section, div"))
      .filter(el => {
        // avoid nav/headers
        const role = el.getAttribute("role") || "";
        if (/banner|navigation/i.test(role)) return false;
        const imgs = el.querySelectorAll('img[src*="image.civitai.com"], img[data-src*="image.civitai.com"]');
        return imgs.length >= 3;
      });
    if (candidates.length) return candidates[0];

    // 3) Fallback to body (we’ll still filter out avatars/cards later)
    return document.body;
  }

  function collectImages(scopeEl) {
    const s = new Set();
    // Filter out UI/avatars/cards/logos/small invisibles
    const isBadContainer = (el) => {
      const c = el.closest([
        '[class*="CreatorCard_"]',
        '[class*="mantine-Avatar"]',
        '[class*="Header_"]',
        '[class*="Footer_"]',
        '[class*="Logo"]',
      ].join(",")); 
      return !!c;
    };

    const allImgs = Array.from(scopeEl.querySelectorAll('img[src*="image.civitai.com"], img[data-src*="image.civitai.com"]'));
    return allImgs
      .map(i => ({ i, url: getImgUrl(i) }))
      .filter(({ i, url }) => {
        if (!url || !/^https?:\/\//i.test(url)) return false;
        if (isBadContainer(i)) return false;
        if (!i.getBoundingClientRect) return false;
        const r = i.getBoundingClientRect();
        // must be visible-ish and not tiny UI img
        if (r.width < 50 || r.height < 50) return false;
        if (getComputedStyle(i).visibility === "hidden" || getComputedStyle(i).display === "none") return false;
        return true;
      })
      .map(({ url }) => url)
      .filter(u => !/\.webp(\?|$)/i.test(u)) // stick to jpeg/png/gif
      .filter(u => !s.has(u) && s.add(u));
  }

  function collectVideos(scopeEl) {
  const s = new Set();
  const badVideo = (el) => {
    if (!el) return true;
    // Skip uploader/profile videos directly or nested inside creator card areas
    if (el.matches('[class*="EdgeVideo_iosScroll_"], [class*="CreatorCard_"], [class*="CreatorCard_profileDetailsContainer"]'))
      return true;
    if (el.closest('[class*="EdgeVideo_iosScroll_"], [class*="CreatorCard_"], [class*="CreatorCard_profileDetailsContainer"]'))
      return true;
    if (el.closest('[class*="mantine-Avatar"], [class*="Header_"], [class*="Footer_"], [class*="Logo"]'))
      return true;
    return false;
  };

  const sources = Array.from(scopeEl.querySelectorAll('video source'))
    .concat(Array.from(document.querySelectorAll('video source')));

  const list = sources
    .map(v => ({ el: v.closest('video'), url: (v.src || v.getAttribute('src') || '').split('?')[0] }))
    .filter(({ el, url }) => {
      if (!url || !/^https?:\/\//i.test(url)) return false;
      if (badVideo(el)) return false;
      const r = el?.getBoundingClientRect?.() || { width: 0, height: 0 };
      if (r.width < 300 || r.height < 200) return false;
      return true;
    });

  return list.map(({ url }) => url).filter(u => !s.has(u) && s.add(u));
}


  // =================================
  // Network helpers
  // =================================
  function stopAllActive() {
    for (const c of currentControllers) { try { c.abort(); } catch {} }
    currentControllers.clear();
  }
  
async function fetchWithProgress(url, timeoutMs, workerIndex, label) {
  let attempt = 0;
  const maxAttempts = 3;
  while (attempt < maxAttempts) {
    attempt++;
    const controller = new AbortController();
    currentControllers.add(controller);
    const { signal } = controller;
    const hardTimeout = setTimeout(() => {
      console.warn(`[CivitAI Script] Hard timeout after ${timeoutMs}ms for ${label}, aborting...`);
      try { controller.abort(); } catch {}
    }, timeoutMs);

    try {
      const res = await fetch(url, { signal, cache: "no-store" });
      clearTimeout(hardTimeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const total = +res.headers.get("content-length") || 0;
      const reader = res.body?.getReader();
      if (!reader) {
        const b = await res.blob();
        setWorkerProgress(workerIndex, 100, `${label} (100%)`);
        currentControllers.delete(controller);
        return b;
      }

      const chunks = [];
      let received = 0;
      let lastChunkTime = Date.now();
      const checkInterval = setInterval(() => {
        if (Date.now() - lastChunkTime > 10000) {
          console.warn(`[CivitAI Script] Timeout: no data from ${label} for 10s, aborting`);
          try { controller.abort(); } catch {}
        }
      }, 2000);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        lastChunkTime = Date.now();
        if (total > 0) {
          const pct = (received / total) * 100;
          setWorkerProgress(workerIndex, pct, `${label} (${pct.toFixed(0)}%)`);
        } else {
          const cycle = (received % (512 * 1024)) / (512 * 1024);
          setWorkerProgress(workerIndex, cycle * 100, `${label} (stream)`);
        }
        if (isPaused) throw new Error("Paused");
      }
      clearInterval(checkInterval);
      currentControllers.delete(controller);
      const type = res.headers.get("content-type") || "";
      return new Blob(chunks, { type });
    } catch (e) {
      clearTimeout(hardTimeout);
      currentControllers.delete(controller);
      if (attempt < maxAttempts && (e.name === "AbortError" || /timeout|network|fetch/i.test(e.message))) {
        console.warn(`[CivitAI Script] Retry ${attempt}/${maxAttempts} for ${label} due to: ${e.message}`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      } else {
        console.warn(`[CivitAI Script] Failed ${label}: ${e.message}`);
        throw e;
      }
    }
  }
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
        if (isPaused) return;

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
    const gallery = findFirstGalleryRoot();
    if (!gallery) {
      log("❌ No suitable gallery root found", "#f55");
      return;
    }

    // auto-scroll/page-scroll to load everything
    await loadAllGalleryImages(gallery);

    // IMAGES
    const imgs = collectImages(gallery);
    if (!imgs.length) {
      // second-chance: collect page-wide (handles hero EdgeImage-only pages)
      const pageWide = collectImages(document.body);
      if (pageWide.length) {
        log(`ℹ️ Using page-wide image fallback (${pageWide.length} imgs)…`);
        await downloadImages(pageWide);
      } else {
        log("⚠️ No images found", "#f55");
      }
    } else {
      setStatus(`images: 0/${imgs.length}`);
      await downloadImages(imgs);
    }

    log("🟢 Images done! Preparing videos…");
    await sleep(400);

    // VIDEOS (page-wide to catch embeds)
    const vids = collectVideos(gallery);
    if (!vids.length) {
      log("⚠️ No MP4 videos on page");
      showFinished();
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

  async function downloadImages(urls) {
    const imgItems = urls.map((url, idx) => ({
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



  // ===================================
  // Watchdog for stalled progress (auto-restart) — v3.5.8 (load-safe)
  // ===================================
  (async function initWatchdog() {
    // Wait until main functions exist
    while (typeof setWorkerProgress !== "function" || typeof runQueue !== "function" || typeof stopAllActive !== "function") {
      await new Promise(r => setTimeout(r, 500));
    }

    if (window.__watchdogActive) return;
    window.__watchdogActive = true;

    window.__lastProgressTime = Date.now();
    window.__restartCount = 0;
    window.__maxRestarts = 5;
    window.__queueState = { phase: "idle", total: 0, completed: 0 };

    // Hook into progress updates safely
    if (!window.__hookedProgress) {
      window.__hookedProgress = true;
      window._origSetWorkerProgress = window._origSetWorkerProgress || setWorkerProgress;
      setWorkerProgress = function(i, pct, text) {
        window.__lastProgressTime = Date.now();
        if (window.__restartCount > 0) {
          console.log(`[CivitAI Script] Progress resumed after restart (retries so far: ${window.__restartCount})`);
          window.__restartCount = 0;
        }
        return window._origSetWorkerProgress(i, pct, text);
      };
    }

    // Wrap runQueue safely
    if (!window.__hookedRunQueue) {
      window.__hookedRunQueue = true;
      window._origRunQueue = window._origRunQueue || runQueue;
      runQueue = async function(items, kind) {
        window.__queueState.phase = kind;
        window.__queueState.total = (items && items.length) || 0;
        window.__queueState.completed = 0;

        window._origSetStatus = window._origSetStatus || setStatus;
        setStatus = function(t) {
          const m = String(t || '').match(/(\d+)\s*\/\s*(\d+)/);
          if (m) {
            window.__queueState.completed = parseInt(m[1], 10);
            window.__queueState.total = parseInt(m[2], 10);
          }
          return window._origSetStatus(t);
        };

        try {
          await window._origRunQueue(items, kind);
        } finally {
          window.__queueState.phase = "idle";
        }
      };
    }

    window.__civitaiAbortAll = () => { try { stopAllActive(); } catch{} };
    window.__civitaiRunAll = () => runAll();
    window.__civitaiProgress = () => ({ ...window.__queueState, active: currentControllers.size });

    // Periodic stall monitor
    (async function __stallWatchdog() {
      while (true) {
        await new Promise(r => setTimeout(r, 1000));
        const elapsed = Date.now() - window.__lastProgressTime;
        const remaining = Math.max(0, (window.__queueState.total || 0) - (window.__queueState.completed || 0));
        const active = currentControllers.size;

        if (remaining > 0 && elapsed > 7000) {
          if (window.__restartCount < window.__maxRestarts) {
            console.warn(`[CivitAI Script] Detected stall >7s (active:${active}, remaining:${remaining}). Restarting… (${window.__restartCount + 1}/${window.__maxRestarts})`);
            window.__restartCount++;
            try { stopAllActive(); hideAllWorkerBars(); } catch {}
            try { await runAll(); } catch (e) { console.warn("Restart failed:", e); }
            window.__lastProgressTime = Date.now();
          } else {
            console.warn(`[CivitAI Script] Gave up after ${window.__maxRestarts} restarts, but ${remaining} item(s) still remain.`);
            window.__lastProgressTime = Date.now();
          }
        }
      }
    })();
  })();

