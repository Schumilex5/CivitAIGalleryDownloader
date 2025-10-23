(async () => {
  // Create floating progress box
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    bottom: "45px", // 25px higher
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

  // Restart button
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

  const downloadGallery = async () => {
    log("🟢 Starting Civitai downloader…");

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
        await new Promise(r => setTimeout(r, 50));
      }
    } else {
      log("ℹ️ No next button found — static gallery");
    }

    log("📸 Collecting images…");
    const seen = new Set();
    const urls = [...gallery.querySelectorAll('img[src*="image.civitai.com"]')]
      .map(img => img.src.replace(/\/anim=.*?\/|,optimized=true|,width=\d+/g, "/").split("?")[0])
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
        log(`✅ ${i + 1}/${urls.length} saved`);
      } catch (e) {
        log(`❌ Failed ${i + 1}`, "#f55");
      }
      await new Promise(r => setTimeout(r, 80));
    }

    log("🟢 Done!");
    setTimeout(() => box.remove(), 5000); // close 5 seconds after done
  };

  restartBtn.onclick = downloadGallery;
  await downloadGallery();
})();
