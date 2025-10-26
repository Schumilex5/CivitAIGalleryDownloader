(async () => {
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    bottom: "45px",
    right: "20px",
    zIndex: "999999",
    background: "rgba(0,0,0,0.8)",
    color: "#0f0",
    fontSize: "13px",
    fontFamily: "monospace",
    padding: "10px 14px",
    borderRadius: "10px",
    boxShadow: "0 0 10px rgba(0,0,0,0.5)",
    whiteSpace: "pre-line",
  });
  document.body.appendChild(box);

  const restartBtn = document.createElement("button");
  restartBtn.textContent = "Restart";
  Object.assign(restartBtn.style, {
    display: "block",
    marginTop: "8px",
    fontSize: "12px",
    cursor: "pointer",
  });
  box.appendChild(restartBtn);

  const log = (msg, color = "#0f0") => {
    box.style.color = color;
    box.textContent = msg;
    box.appendChild(restartBtn);
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const cleanUrl = (u) =>
    u.replace(/\/anim=.*?\/|,optimized=true|,width=\d+/g, "/").split("?")[0];

  // -------------------- IMAGE DOWNLOADER --------------------
  const downloadImages = async () => {
    log("🟢 Starting image downloader…");

    const gallery = document.querySelector('[class*="ModelVersionDetails_mainSection__"]');
    if (!gallery) return log("❌ Gallery not found", "#f55");

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
        await sleep(50);
      }
    } else {
      log("ℹ️ No next button found — static gallery");
    }

    log("📸 Collecting images…");
    const seen = new Set();
    const urls = [...gallery.querySelectorAll('img[src*="image.civitai.com"]')]
      .map(img => cleanUrl(img.src))
      .filter(u => u && u.startsWith("https") && !seen.has(u) && seen.add(u));

    log(`📥 Fetching ${urls.length} images…`);
    for (let i = 0; i < urls.length; i++) {
      try {
        const res = await fetch(urls[i]);
        const blob = await res.blob();
        let ext = "jpg";
        if (blob.type.includes("gif")) ext = "gif";
        else if (blob.type.includes("png")) ext = "png";
        else if (blob.type.includes("webp")) ext = "webp";

        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `civitai_image_${i + 1}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        log(`✅ ${i + 1}/${urls.length} images saved`);
      } catch (e) {
        log(`❌ Failed ${i + 1}`, "#f55");
      }
      await sleep(80);
    }

    log("🟢 Images done! Starting videos…");
    await sleep(500);
  };

  // -------------------- VIDEO DOWNLOADER --------------------
  const downloadVideos = async () => {
    log("🟢 Starting video downloader…");
    const root = document.querySelector('[class*="ModelVersionDetails_mainSection__"]') || document;
    const seen = new Set();

    const mp4Urls = [...root.querySelectorAll('video source[type="video/mp4"]')]
      .map(s => s.src?.split("?")[0])
      .filter(u => u && u.startsWith("https") && !seen.has(u) && seen.add(u));

    if (!mp4Urls.length) return log("⚠️ No MP4 sources found on page", "#f55");

    log(`📥 Found ${mp4Urls.length} MP4 files, downloading…`);
    for (let i = 0; i < mp4Urls.length; i++) {
      const url = mp4Urls[i];
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `civitai_video_${i + 1}.mp4`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        log(`🎞️ Saved ${i + 1}/${mp4Urls.length}`);
      } catch (e) {
        log(`❌ Failed ${i + 1}: ${e}`, "#f55");
      }
      await sleep(150);
    }

    log("🟢 All done!");
    setTimeout(() => box.remove(), 5000);
  };

  // -------------------- MAIN FLOW --------------------
  const runAll = async () => {
    await downloadImages();
    await downloadVideos();
  };

  restartBtn.onclick = runAll;
  await runAll();
})();
