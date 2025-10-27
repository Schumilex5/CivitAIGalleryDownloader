(async () => {
  // ---------- CONFIG ----------
  const POS_KEY = "civitai_dl_pos";
  const BOX_W = 280;

  // ---------- UI ----------
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    zIndex: "999999",
    width: BOX_W + "px",
    background: "rgba(0,0,0,0.85)",
    color: "#0f0",
    fontSize: "13px",
    fontFamily: "monospace",
    padding: "8px 10px 10px",
    borderRadius: "10px",
    boxShadow: "0 0 12px rgba(0,0,0,0.55)",
    userSelect: "none",
  });

  // restore saved position (forever)
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      box.style.left = saved.left + "px";
      box.style.top = saved.top + "px";
    } else {
      box.style.right = "20px";
      box.style.bottom = "45px";
    }
  } catch {
    box.style.right = "20px";
    box.style.bottom = "45px";
  }

  // header (drag handle)
  const header = document.createElement("div");
  header.textContent = "Civitai Downloader";
  Object.assign(header.style, {
    fontWeight: "700",
    color: "#9f9",
    marginBottom: "6px",
    cursor: "move",
    textShadow: "0 1px 0 #000",
  });

  // controls
  const controls = document.createElement("div");
  Object.assign(controls.style, { display: "flex", gap: "8px", marginBottom: "6px" });

  const restartBtn = document.createElement("button");
  restartBtn.textContent = "Restart";
  Object.assign(restartBtn.style, btnStyle());

  const skipBtn = document.createElement("button");
  skipBtn.textContent = "Skip current";
  Object.assign(skipBtn.style, btnStyle());

  const body = document.createElement("div");
  Object.assign(body.style, { whiteSpace: "pre-line", minHeight: "32px", lineHeight: "1.25" });

  // progress bar + label
  const pWrap = document.createElement("div");
  Object.assign(pWrap.style, {
    width: "100%",
    height: "9px",
    borderRadius: "6px",
    background: "#222",
    boxShadow: "inset 0 0 4px rgba(0,0,0,0.8)",
    overflow: "hidden",
    marginTop: "6px",
  });
  const bar = document.createElement("div");
  Object.assign(bar.style, { height: "100%", width: "0%", background: "#33ff88", transition: "width 80ms linear" });
  pWrap.appendChild(bar);

  const pLabel = document.createElement("div");
  Object.assign(pLabel.style, { marginTop: "4px", color: "#cfc" });
  pLabel.textContent = "—";

  controls.appendChild(restartBtn);
  controls.appendChild(skipBtn);
  box.appendChild(header);
  box.appendChild(controls);
  box.appendChild(body);
  box.appendChild(pWrap);
  box.appendChild(pLabel);
  document.body.appendChild(box);

  function btnStyle() {
    return {
      padding: "6px 10px",
      fontSize: "12px",
      cursor: "pointer",
      borderRadius: "8px",
      border: "1px solid #2a2",
      background: "transparent",
      color: "#8f8",
    };
  }

  // ---------- Drag handling (save forever) ----------
  (() => {
    let dragging = false, dx = 0, dy = 0, raf = 0;
    const onDown = (e) => {
      dragging = true;
      // if right/bottom were set, convert to left/top first
      const rect = box.getBoundingClientRect();
      box.style.left = rect.left + "px";
      box.style.top = rect.top + "px";
      box.style.right = "auto";
      box.style.bottom = "auto";
      dx = e.clientX - rect.left;
      dy = e.clientY - rect.top;
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const l = Math.max(4, Math.min(window.innerWidth - BOX_W - 4, e.clientX - dx));
        const t = Math.max(4, Math.min(window.innerHeight - 40, e.clientY - dy));
        box.style.left = l + "px";
        box.style.top = t + "px";
      });
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      const rect = box.getBoundingClientRect();
      localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
    };
    header.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    // touch support
    header.addEventListener("touchstart", (e) => onDown(e.touches[0]), { passive: false });
    window.addEventListener("touchmove", (e) => onMove(e.touches[0]), { passive: false });
    window.addEventListener("touchend", onUp);
  })();

  // ---------- Logging & progress ----------
  const log = (msg, color = "#0f0") => {
    body.style.color = color;
    body.textContent = msg;
  };
  const setProgress = (pct, label) => {
    const v = Math.max(0, Math.min(100, pct | 0));
    bar.style.width = v + "%";
    pLabel.textContent = `${v}% ${label || ""}`;
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cleanUrl = (u) => u.replace(/\/anim=.*?\/|,optimized=true|,width=\d+/g, "/").split("?")[0];

  // Abort controller shared with "Skip current"
  let currentController = null;
  skipBtn.onclick = () => {
    if (currentController) {
      try { currentController.abort(); } catch {}
    }
  };

  // Streamed fetch with true progress, returns Blob
  async function fetchWithProgress(url, label, timeoutMs = 20000) {
    currentController = new AbortController();
    const { signal } = currentController;

    const to = setTimeout(() => {
      if (currentController) {
        try { currentController.abort(); } catch {}
      }
    }, timeoutMs);

    const res = await fetch(url, { signal, cache: "no-store" });
    clearTimeout(to);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const total = Number(res.headers.get("content-length") || 0);
    const reader = res.body?.getReader();
    if (!reader) {
      // fallback if no stream (rare)
      const b = await res.blob();
      setProgress(100, label);
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
        setProgress((received / total) * 100, label);
      } else {
        // Unknown size — animate rough progress
        const cycle = (received % (512 * 1024)) / (512 * 1024); // 512KB cycle
        setProgress(cycle * 100, label + " (stream)");
      }
    }
    const type = res.headers.get("content-type") || "";
    return new Blob(chunks, { type });
  }

  async function saveBlob(blob, filename) {
    const objectURL = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectURL;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise((r) => requestAnimationFrame(r));
    URL.revokeObjectURL(objectURL);
  }

  // -------------------- IMAGE DOWNLOADER --------------------
  const downloadImages = async () => {
    log("🟢 Starting image downloader…");
    setProgress(0, "Preparing images");

    const gallery = document.querySelector('[class*="ModelVersionDetails_mainSection__"]');
    if (!gallery) {
      log("❌ Gallery not found", "#f55");
      return;
    }

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
        await sleep(60);
      }
    } else {
      log("ℹ️ No next button found — static gallery");
    }

    const seen = new Set();
    const urls = [...gallery.querySelectorAll('img[src*="image.civitai.com"]')]
      .map((img) => cleanUrl(img.src))
      .filter((u) => u && u.startsWith("https") && !seen.has(u) && seen.add(u));

    log(`📥 Fetching ${urls.length} images…`);
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        // skip problematic webp placeholders outright
        if (url.endsWith(".webp")) {
          log(`⚠️ Skipping placeholder ${i + 1}/${urls.length}`);
          continue;
        }
        const label = `image ${i + 1}/${urls.length}`;
        setProgress(0, label);

        const blob = await fetchWithProgress(url, label, 15000);

        let ext = "jpg";
        const t = (blob.type || "").toLowerCase();
        if (t.includes("gif")) ext = "gif";
        else if (t.includes("png")) ext = "png";
        else if (t.includes("webp")) ext = "webp";

        await saveBlob(blob, `civitai_image_${i + 1}.${ext}`);
        log(`✅ Saved ${i + 1}/${urls.length}`);
      } catch (e) {
        if (e.name === "AbortError") {
          log(`⏭️ Skipped ${i + 1}/${urls.length}`, "#f88");
        } else {
          log(`❌ Failed ${i + 1}: ${e.message || e}`, "#f55");
        }
      }
      await sleep(250); // pacing prevents throttling/memory spikes
    }

    log("🟢 Images done! Starting videos…");
    setProgress(0, "Preparing videos");
    await sleep(800);
  };

  // -------------------- VIDEO DOWNLOADER --------------------
  const downloadVideos = async () => {
    log("🟢 Starting video downloader…");
    const root = document.querySelector('[class*="ModelVersionDetails_mainSection__"]') || document;
    const seen = new Set();

    const mp4Urls = [...root.querySelectorAll('video source[type="video/mp4"]')]
      .map((s) => s.src?.split("?")[0])
      .filter((u) => u && u.startsWith("https") && !seen.has(u) && seen.add(u));

    if (!mp4Urls.length) {
      log("⚠️ No MP4 sources found on page", "#f55");
      setProgress(100, "No videos");
      setTimeout(() => box.remove(), 2500);
      return;
    }

    log(`📥 Found ${mp4Urls.length} MP4 files, downloading…`);
    for (let i = 0; i < mp4Urls.length; i++) {
      const url = mp4Urls[i];
      try {
        const label = `video ${i + 1}/${mp4Urls.length}`;
        setProgress(0, label);

        const blob = await fetchWithProgress(url, label, 20000);
        await saveBlob(blob, `civitai_video_${i + 1}.mp4`);

        log(`🎞️ Saved ${i + 1}/${mp4Urls.length}`);
      } catch (e) {
        if (e.name === "AbortError") {
          log(`⏭️ Skipped video ${i + 1}`, "#f88");
        } else {
          log(`❌ Failed ${i + 1}: ${e.message || e}`, "#f55");
        }
      }
      await sleep(400);
    }

    log("🟢 All done!");
    setProgress(100, "Complete");
    setTimeout(() => box.remove(), 5000);
  };

  // -------------------- MAIN FLOW --------------------
  const runAll = async () => {
    try {
      await downloadImages();
      await downloadVideos();
    } finally {
      currentController = null;
    }
  };

  restartBtn.onclick = () => {
    // cancel any current fetch & rerun
    if (currentController) {
      try { currentController.abort(); } catch {}
      currentController = null;
    }
    setProgress(0, "Restarting…");
    runAll();
  };

  await runAll();
})();
