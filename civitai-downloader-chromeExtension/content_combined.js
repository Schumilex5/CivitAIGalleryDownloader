// content_combined_v3.7.4.js — v3.7.2 + persistent window size/position (single IIFE, no globals)

(async () => {
  // =======================
  // Config & State (closure)
  // =======================
  const VERSION = "v3.7.6";
  const WALL_SETTINGS_KEY = "civitai_dl_wallpaper_settings";
  const WIN_STATE_KEY = "civitai_dl_window_state";
  const DEFAULTS = { concurrency: 3, keepVisible: true, wallpaper: null, alpha: 0.35 };
  let settings = { ...DEFAULTS, ...loadWallSettings() };
  let isPaused = false;
  let finishedIndicatorShown = false;

  // Progress tracking for watchdog
  let lastProgressTime = Date.now();
  let restartCount = 0;
  const maxRestarts = 5;
  const queueState = { phase: "idle", total: 0, completed: 0 };

  // Active network controllers for in-flight downloads
  const currentControllers = new Set();
  // === Duplicate-skip (temporary for this session) & filename helpers ===
  const downloadedNames = new Set();

  function sanitizeFilename(name) {
    if (!name) return "file";
    name = name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
    name = name.replace(/[.\s]+$/, "");
    return name || "file";
  }
  function extFromBlob(blob) {
    const t = String(blob?.type || "").toLowerCase();
    if (t.includes("png")) return "png";
    if (t.includes("gif")) return "gif";
    if (t.includes("webp")) return "webp";
    if (t.includes("mp4")) return "mp4";
    if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
    return "";
  }
  function filenameFromUrl(url) {
    try {
      const clean = (url || "").split("?")[0];
      const seg = clean.split("/").filter(Boolean).pop() || "";
      return seg;
    } catch { return ""; }
  }


  // =======================
  // Utilities
  // =======================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  function loadWallSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(WALL_SETTINGS_KEY) || "null");
      if (!s || typeof s !== "object") return {};
      const out = {};
      if ("wallpaper" in s) out.wallpaper = s.wallpaper;
      if ("alpha" in s) out.alpha = +s.alpha || 0;
      return out;
    } catch { return {}; }
  }
  function saveWallSettings() {
    try {
      localStorage.setItem(WALL_SETTINGS_KEY, JSON.stringify({ wallpaper: settings.wallpaper, alpha: settings.alpha }));
    } catch {}
  }

  // Window state persistence
  function loadWinState() {
    try { return JSON.parse(localStorage.getItem(WIN_STATE_KEY) || "null") || {}; } catch { return {}; }
  }
  function saveWinState(obj) {
    try { localStorage.setItem(WIN_STATE_KEY, JSON.stringify(obj)); } catch {}
  }
  function rectToObj(r) {
    return {
      left: Math.round(r.left) + "px",
      top: Math.round(r.top) + "px",
      width: Math.round(r.width) + "px",
      height: Math.round(r.height) + "px",
    };
  }

  // Normalize CivitAI CDN URLs
  function cleanUrl(u) {
    if (!u) return "";
    let out = u
      // remove flags like /anim=false,width=450,optimized=true/
      .replace(/\/anim=[^/]*,?[^/]*,?[^/]*\//g, "/")
      .replace(/,optimized=true/g, "")
      .replace(/,width=\d+/g, "")
      .replace(/,height=\d+/g, "")
      .split("?")[0];
    // collapse any '//' after domain (not protocol)
    out = out.replace(/(^https?:\/\/[^/]+)\/+/i, "$1/");
    out = out.replace(/([^:])\/{2,}/g, "$1/");
    // avoid trailing slash before filename (safety)
    out = out.replace(/\/([A-Za-z0-9_-]+\.(?:jpe?g|png|gif|webp|mp4))$/i, "/$1");
    return out;
  }

  // =======================
  // UI (no external CSS)
  // =======================
  const MIN_HEIGHT = 260;
  const MAX_HEIGHT = 640;

  const box = document.createElement("div");
  const winState = loadWinState();
  // apply saved size/pos safely
  const savedWidth = winState.width || "360px";
  const savedHeight = winState.height || "360px";
  const savedLeft = winState.left;
  const savedTop = winState.top;

  Object.assign(box.style, {
    position: "fixed", zIndex: 999999,
    width: savedWidth, height: savedHeight, minWidth: "300px", minHeight: MIN_HEIGHT + "px",
    color: "#0f0", fontSize: "14px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    borderRadius: "12px", overflow: "hidden", resize: "both",
    background: "rgba(0,0,0,0.85)", boxShadow: "0 0 14px rgba(0,0,0,0.6)", userSelect: "none",
    backdropFilter: "blur(4px)",
  });
  // default corner if no saved pos
  if (savedLeft && savedTop) {
    // clamp to viewport
    const px = (v, max) => Math.max(4, Math.min(parseInt(v,10)||0, max));
    const L = px(savedLeft, (window.innerWidth || 1200) - 320);
    const T = px(savedTop, (window.innerHeight || 800) - 60);
    box.style.left = L + "px";
    box.style.top = T + "px";
  } else {
    Object.assign(box.style, { right: "20px", bottom: "45px" });
  }
  document.body.appendChild(box);

  // Wallpaper background layer
  const bg = document.createElement("div");
  Object.assign(bg.style, {
    position: "absolute",
    inset: "0",
    backgroundSize: "cover",
    backgroundPosition: "top center",
    opacity: settings.alpha,
    zIndex: "-1",
    transition: "opacity 0.3s ease",
  });
  function applyWallpaper() {
    bg.style.backgroundImage = settings.wallpaper ? `url(${settings.wallpaper})` : "";
    bg.style.opacity = settings.alpha;
  }
  applyWallpaper();
  box.appendChild(bg);

  // header
  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "6px 10px 4px", background: "rgba(0,0,0,0.75)", cursor: "move",
  });
  const title = document.createElement("div");
  Object.assign(title.style, { fontWeight: "700", color: "#9f9", flex: "1 1 auto" });
  title.textContent = `${VERSION}`;
  const btnSettings = iconBtn("⚙️", "Settings");
  const btnRestart = pillBtn("Restart");
  const btnStop = pillBtn("Stop");
  const btnResume = pillBtn("Resume"); btnResume.style.display = "none";
  const btnClose = iconBtn("✖", "Hide");
  header.append(title, btnSettings, btnRestart, btnStop, btnResume, btnClose);
  const controlsRow = document.createElement("div");
  Object.assign(controlsRow.style, { display: "flex", gap: "8px", padding: "6px 10px 0" });
  const btnViewLog = pillBtn("View Log");
  btnViewLog.style.display = "none";
  controlsRow.append(btnViewLog);

  // body
  const body = document.createElement("div");
  Object.assign(body.style, { whiteSpace: "pre-line", lineHeight: "1.25", padding: "6px 10px", color: "#cfc" });

  // bars
  const barsWrap = document.createElement("div");
  Object.assign(barsWrap.style, { display: "grid", gap: "6px", marginTop: "6px", padding: "0 10px" });

  // footer / status
  const statusLine = document.createElement("div");
  Object.assign(statusLine.style, { margin: "6px 10px 8px", color: "#cfc" });
  const credit = document.createElement("div");
  Object.assign(credit.style, {
    fontSize: "12px", color: "#9f9", textAlign: "center",
    padding: "4px", borderTop: "1px solid rgba(255,255,255,0.15)",
  });
  credit.textContent = "";

  // Views
  const mainView = document.createElement("div");
  mainView.append(header, controlsRow, body, barsWrap, statusLine, credit);

  const settingsView = document.createElement("div");
  Object.assign(settingsView.style, { display: "none", padding: "10px", color: "#dfd" });
  const backBtn = pillBtn("← Back");
  const settingsTitle = document.createElement("div");
  settingsTitle.textContent = "Wallpaper Settings";
  Object.assign(settingsTitle.style, { fontWeight: "700", margin: "4px 0 8px" });
  const wallInput = document.createElement("input");
  wallInput.type = "file"; wallInput.accept = "image/*";
  const clearWallBtn = pillBtn("Clear");
  const alphaRow = document.createElement("div");
  const alphaLbl = document.createElement("span"); alphaLbl.textContent = "Transparency: ";
  const alphaSlider = document.createElement("input");
  alphaSlider.type = "range"; alphaSlider.min = "0"; alphaSlider.max = "1"; alphaSlider.step = "0.05";
  alphaSlider.value = settings.alpha;
  const alphaVal = document.createElement("span"); alphaVal.textContent = ` ${settings.alpha}`;
  alphaRow.append(alphaLbl, alphaSlider, alphaVal);
  settingsView.append(backBtn, settingsTitle, wallInput, clearWallBtn, alphaRow);

  // mount
  box.append(mainView, settingsView);

  // drag
  initDrag(header);
  // observe size and save
  new ResizeObserver(() => {
    const h = parseFloat(box.style.height) || box.getBoundingClientRect().height;
    if (h < MIN_HEIGHT) box.style.height = MIN_HEIGHT + "px";
    if (h > MAX_HEIGHT) box.style.height = MAX_HEIGHT + "px";
    const r = box.getBoundingClientRect();
    saveWinState(rectToObj(r));
  }).observe(box);

  // also save on mouseup (end of moves)
  window.addEventListener("mouseup", () => {
    const r = box.getBoundingClientRect();
    saveWinState(rectToObj(r));
  });

  // UI helpers
  const log = (m, c = "#cfc") => { body.style.color = c; body.textContent = m; };
  const setStatus = (t) => { statusLine.textContent = t; };
  function setView(v) {
    const showMain = v === "main";
    mainView.style.display = showMain ? "" : "none";
    settingsView.style.display = showMain ? "none" : "";
  }

  // ===== Error log & viewer =====
  const errorLog = [];
  const logPanel = document.createElement("div");
  Object.assign(logPanel.style, {
    display: "none",
    margin: "6px 10px",
    padding: "8px",
    border: "1px solid rgba(255,0,0,0.3)",
    borderRadius: "8px",
    background: "rgba(0,0,0,0.35)",
    color: "#fcc",
    fontSize: "12px",
    maxHeight: "160px",
    overflowY: "auto",
    whiteSpace: "pre-wrap"
  });
  mainView.insertBefore(logPanel, barsWrap);

  function showError(msg) {
    const stamp = new Date().toLocaleString();
    const line = `[${stamp}] ${msg}`;
    errorLog.push(line);
    body.style.color = "#f55";
    body.textContent = msg; // overwrite last visible message
    btnViewLog.style.display = "";
    logPanel.textContent = errorLog.join("\\n");
  }

  btnViewLog.onclick = () => {
    logPanel.style.display = (logPanel.style.display === "none") ? "block" : "none";
  };

  // Receive background messages (if any)
  try {
    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === "CIVITAI_ERROR" && msg.message) {
          showError(String(msg.message));
        }
      });
    }
  } catch {}

  // Also support window.postMessage
  window.addEventListener("message", (e) => {
    try {
      if (e && e.data && e.data.type === "CIVITAI_ERROR") {
        showError(String(e.data.message || "Unknown error"));
      }
    } catch {}
  });

  function iconBtn(txt, title) {
    const b = document.createElement("button");
    b.textContent = txt;
    Object.assign(b.style, {
      width: "26px", height: "26px", borderRadius: "8px", border: "1px solid #2a2",
      background: "transparent", color: "#8f8", cursor: "pointer", marginLeft: "6px",
    });
    b.title = title; return b;
  }
  function pillBtn(txt) {
    const b = document.createElement("button");
    b.textContent = txt;
    Object.assign(b.style, {
      padding: "6px 10px", fontSize: "13px", cursor: "pointer",
      borderRadius: "10px", border: "1px solid #2a2",
      background: "rgba(0,0,0,0.4)", color: "#9f9", marginLeft: "6px"
    });
    return b;
  }
  function initDrag(h) {
    let drag = false, dx = 0, dy = 0;
    h.addEventListener("mousedown", e => {
      if (e.target.tagName === "BUTTON") return;
      drag = true;
      const r = box.getBoundingClientRect();
      box.style.left = r.left + "px"; box.style.top = r.top + "px";
      box.style.right = "auto"; box.style.bottom = "auto";
      dx = e.clientX - r.left; dy = e.clientY - r.top; e.preventDefault();
    });
    window.addEventListener("mousemove", e => {
      if (!drag) return;
      const l = clamp(e.clientX - dx, 4, window.innerWidth - box.offsetWidth - 4);
      const t = clamp(e.clientY - dy, 4, window.innerHeight - 40);
      box.style.left = l + "px"; box.style.top = t + "px";
    });
    window.addEventListener("mouseup", () => {
      if (drag) {
        drag = false;
        const r = box.getBoundingClientRect();
        saveWinState(rectToObj(r));
      }
    });
  }

  // Settings interactions
  btnSettings.onclick = () => setView("settings");
  backBtn.onclick = () => setView("main");
  wallInput.onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    settings.wallpaper = await fileToBase64Compressed(f);
    saveWallSettings();
    applyWallpaper();
  };
  clearWallBtn.onclick = () => {
    settings.wallpaper = null;
    saveWallSettings();
    applyWallpaper();
  };
  alphaSlider.oninput = () => {
    settings.alpha = +alphaSlider.value;
    alphaVal.textContent = ` ${settings.alpha}`;
    saveWallSettings();
    applyWallpaper();
  };

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
    const maxW = 800, maxH = 450; // smaller to avoid Chrome localStorage bloat
    const scale = Math.min(maxW / bmp.width, maxH / bmp.height, 1);
    canvas.width = Math.max(1, Math.floor(bmp.width * scale));
    canvas.height = Math.max(1, Math.floor(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    try { bmp.close && bmp.close(); } catch {}
    return canvas.toDataURL("image/jpeg", 0.75);
  }

  // Progress bars
  const workerBars = new Map(); // i -> {row,label,fill}
  function createWorkerBar(i) {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "grid", gap: "3px", opacity: "0", maxHeight: "0px",
      transition: "opacity 200ms ease, max-height 200ms ease",
    });
    const label = document.createElement("div");
    Object.assign(label.style, { color: "#cfc", fontSize: "13px" });
    label.textContent = "starting…";
    const track = document.createElement("div");
    Object.assign(track.style, { width: "100%", height: "9px", borderRadius: "6px", background: "#212121", overflow: "hidden" });
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
    lastProgressTime = Date.now();
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

  // =======================
  // Collectors
  // =======================
  function findFirstGalleryRoot() {
    const preferred = document.querySelector('[class*="ModelVersionDetails_mainSection__"]');
    if (preferred) return preferred;
    const candidates = Array.from(document.querySelectorAll("main, section, div")).filter(el => {
      const role = el.getAttribute("role") || "";
      if (/banner|navigation/i.test(role)) return false;
      const imgs = el.querySelectorAll('img[src*="image.civitai.com"], img[data-src*="image.civitai.com"]');
      return imgs.length >= 3;
    });
    return candidates[0] || document.body;
  }

  function getImgUrl(imgEl) {
    const u = imgEl.currentSrc || imgEl.src || "";
    return cleanUrl(u);
  }

  function collectImages(scopeEl) {
    const s = new Set();
    const isBadContainer = (el) => {
      const c = el.closest([
        '[class*="CreatorCard_"]','[class*="mantine-Avatar"]','[class*="Header_"]','[class*="Footer_"]','[class*="Logo"]',
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
        if (r.width < 50 || r.height < 50) return false;
        const st = getComputedStyle(i);
        if (st.visibility === "hidden" || st.display === "none") return false;
        return true;
      })
      .map(({ url }) => url)
      .filter(u => !/\.webp(\?|$)/i.test(u))
      .filter(u => !s.has(u) && s.add(u));
  }

  function collectVideos(scopeEl) {
    const s = new Set();
    const badVideo = (el) => {
      if (!el) return true;
      if (el.matches('[class*="EdgeVideo_iosScroll_"], [class*="CreatorCard_"], [class*="CreatorCard_profileDetailsContainer"]')) return true;
      if (el.closest('[class*="EdgeVideo_iosScroll_"], [class*="CreatorCard_"], [class*="CreatorCard_profileDetailsContainer"]')) return true;
      if (el.closest('[class*="mantine-Avatar"], [class*="Header_"], [class*="Footer_"], [class*="Logo"]')) return true;
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

  // Autoscroll / carousel advance
  async function loadAllGalleryImages(gallery) {
    const nextBtn = gallery.querySelector("button svg.tabler-icon-chevron-right")?.closest("button");
    if (nextBtn) {
      log("➡️ Auto-scrolling gallery…");
      let prevCount = 0, sameCount = 0;
      for (let i = 0; i < 300; i++) {
        const imgs = gallery.querySelectorAll('img[src*="image.civitai.com"]');
        if (imgs.length > prevCount) { prevCount = imgs.length; sameCount = 0; log(`➡️ Loaded ${imgs.length} images…`); }
        else if (++sameCount > 5) break;
        nextBtn.click();
        await sleep(80);
      }
      log(`✅ Gallery fully loaded (${prevCount} images)`);
      log("⏳ Waiting for images to finish rendering…");
      let stable = 0, lastCount = 0;
      for (let i = 0; i < 30; i++) {
        const imgs = gallery.querySelectorAll('img[src*="image.civitai.com"]');
        if (imgs.length === lastCount) stable++; else { stable = 0; lastCount = imgs.length; }
        if (stable >= 3) break;
        await sleep(100);
      }
      log("✅ DOM stabilized — starting downloads…");
      return;
    }

    // Fallback: scroll page
    log("➡️ Scrolling page to trigger lazy image loads…");
    let lastSeen = 0, stable = 0;
    for (let i = 0; i < 400; i++) {
      window.scrollBy(0, Math.max(200, window.innerHeight - 120));
      await sleep(80);
      const imgs = document.querySelectorAll('img[src*="image.civitai.com"], img[data-src*="image.civitai.com"]');
      if (imgs.length > lastSeen) { lastSeen = imgs.length; stable = 0; log(`➡️ Discovered ${imgs.length} images…`); }
      else if (++stable > 8) break;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    await sleep(120);
    log(`✅ Page scroll complete (roughly ${lastSeen} images discovered)`);
  }

  // =======================
  // Networking
  // =======================
  function stopAllActive() {
    for (const c of currentControllers) { try { c.abort(); } catch {} }
    currentControllers.clear();
  }

  async function fetchWithProgress(url, workerIndex, label) {
    url = cleanUrl(url);
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      currentControllers.add(controller);
      const { signal } = controller;
      try {
        const res = await fetch(url, { signal, cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const total = +res.headers.get("content-length") || 0;
        const reader = res.body?.getReader();
        if (!reader) {
          const blob = await res.blob();
          setWorkerProgress(workerIndex, 100, `${label} (100%)`);
          currentControllers.delete(controller);
          return blob;
        }
        const chunks = [];
        let received = 0;
        let lastChunkTime = Date.now();
        const stallWatch = setInterval(() => {
          if (Date.now() - lastChunkTime > 3000) { try { controller.abort(); } catch {} }
        }, 500);
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
        clearInterval(stallWatch);
        currentControllers.delete(controller);
        const type = res.headers.get("content-type") || "";
        return new Blob(chunks, { type });
      } catch (e) {
        currentControllers.delete(controller);
        if (attempt < maxAttempts && (e.name === "AbortError" || /timeout|network|fetch/i.test(e.message))) {
          await sleep(300); // fast retry
          continue;
        } else {
          throw e;
        }
      }
    }
  }

  async function saveBlob(blob, filename) {
    filename = sanitizeFilename(filename);
    if (downloadedNames.has(filename)) { console.log("[Skip existing]", filename); return; }
    downloadedNames.add(filename);
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise(r => requestAnimationFrame(r));
    URL.revokeObjectURL(u);
  }

  // =======================
  // Parallel queue
  // =======================
  async function runQueue(items, kind) {
    if (!items.length) return;
    let nextIndex = 0;
    let completed = 0;
    const total = items.length;
    queueState.phase = kind;
    queueState.total = total;
    queueState.completed = 0;
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
          const blob = await fetchWithProgress(it.url, i, `${kind.slice(0, -1)} ${idx + 1}/${total}`);
          await saveBlob(blob, it.name(blob));
          completed++;
          queueState.completed = completed;
          setStatus(`${kind}: ${completed}/${total}`);
          setWorkerProgress(i, 100, `Saved ${idx + 1}`);
          lastProgressTime = Date.now();
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
    queueState.phase = "idle";
  }

  // =======================
  // Main flow
  // =======================
  async function runAll() {
    finishedIndicatorShown = false;
    body.textContent = "";
    setStatus("—");
    isPaused = false;
    hideAllWorkerBars();

    log("🟢 Starting image downloader…");
    const gallery = findFirstGalleryRoot();
    if (!gallery) { log("❌ No suitable gallery root found", "#f55"); return; }
    await loadAllGalleryImages(gallery);

    // Images
    const imgs = collectImages(gallery);
    if (imgs.length) {
      setStatus(`images: 0/${imgs.length}`);
      const imgItems = imgs.map((url, idx) => ({
        url,
        name: (b) => {
          const hint = sanitizeFilename(filenameFromUrl(url)) || `civitai_image_${idx + 1}`;
          const base = hint.replace(/\.(?:jpe?g|png|gif|webp)$/i, "");
          const ext = extFromBlob(b) || (hint.match(/\.(jpe?g|png|gif|webp)$/i)?.[1]) || "jpg";
          return `${base}.${ext}`;
        }
      }));
      await runQueue(imgItems, "images");
    } else {
      // second chance page-wide
      const pageImgs = collectImages(document.body);
      if (pageImgs.length) {
        log(`ℹ️ Using page-wide image fallback (${pageImgs.length} imgs)…`);
        const imgItems = pageImgs.map((url, idx) => ({
          url,
          name: (b) => {
            const hint = sanitizeFilename(filenameFromUrl(url)) || `civitai_image_${idx + 1}`;
            const base = hint.replace(/\.(?:jpe?g|png|gif|webp)$/i, "");
            const ext = extFromBlob(b) || (hint.match(/\.(jpe?g|png|gif|webp)$/i)?.[1]) || "jpg";
            return `${base}.${ext}`;
          }
        }));
        await runQueue(imgItems, "images");
      } else {
        log("⚠️ No images found", "#f55");
      }
    }

    log("🟢 Images done! Preparing videos…");
    await sleep(400);
    const vids = collectVideos(gallery);
    if (vids.length) {
      log(`🎞 Found ${vids.length} videos`);
      const vidItems = vids.map((url, idx) => ({
        url,
        name: (b) => {
          const hint = sanitizeFilename(filenameFromUrl(url)) || `civitai_video_${idx + 1}`;
          const base = hint.replace(/\.(?:mp4)$/i, "");
          const ext = extFromBlob(b) || (hint.match(/\.(mp4)$/i)?.[1]) || "mp4";
          return `${base}.${ext}`;
        }
      }));
      await runQueue(vidItems, "videos");
    } else {
      log("⚠️ No MP4 videos on page");
    }

    showFinished();
  }

  function showFinished() {
    if (finishedIndicatorShown) return;
    finishedIndicatorShown = true;
    title.textContent = "✅ Downloads complete!";
    title.style.color = "#8f8";
    setTimeout(() => { title.textContent = `${VERSION}`; title.style.color = "#9f9"; }, 3000);
    body.textContent = "";
    if (!settings.keepVisible) setTimeout(() => box.remove(), 2500);
  }

  // =======================
  // Controls
  // =======================
  btnRestart.onclick = async () => { stopAllActive(); isPaused = false; hideAllWorkerBars(); await runAll(); };
  btnStop.onclick = () => { isPaused = true; stopAllActive(); btnStop.style.display = "none"; btnResume.style.display = ""; };
  btnResume.onclick = async () => { isPaused = false; btnResume.style.display = "none"; btnStop.style.display = ""; await runAll(); };
  btnClose.onclick = () => { box.style.display = "none"; };

  // =======================
  // Watchdog (3 s inactivity, up to 5 restarts)
  // =======================
  (async function watchdog() {
    while (restartCount < maxRestarts) {
      await sleep(1000);
      const elapsed = Date.now() - lastProgressTime;
      const remaining = Math.max(0, (queueState.total || 0) - (queueState.completed || 0));
      if (remaining > 0 && elapsed > 3000 && !isPaused) {
        restartCount++;
        log(`⏳ Stall >3 s, restarting… (${restartCount}/${maxRestarts})`, "#ff0");
        try { stopAllActive(); hideAllWorkerBars(); } catch {}
        try { await runAll(); } catch (e) { console.warn("Restart failed:", e); }
        lastProgressTime = Date.now();
      }
    }
    if (restartCount >= maxRestarts) log("💀 Max restarts reached", "#f55");
  })();

  // Kick off
  await runAll();
})();