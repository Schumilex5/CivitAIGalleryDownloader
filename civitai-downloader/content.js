(async () => {
  console.log("🟢 Civitai fast auto-scroll downloader started");

  // Find the main gallery section
  const gallery = document.querySelector('[class*="ModelVersionDetails_mainSection__"]');
  if (!gallery) {
    console.log("❌ Gallery not found");
    return;
  }

  // Find the right-arrow button
  const nextBtn = gallery.querySelector("button svg.tabler-icon-chevron-right")?.closest("button");
  if (!nextBtn) {
    console.log("❌ Next button not found");
    return;
  }

  let prevCount = 0;
  let sameCount = 0;

  console.log("➡️ Auto-scrolling gallery...");
  for (let i = 0; i < 300; i++) {
    const imgs = gallery.querySelectorAll('img[src*="image.civitai.com"]');
    if (imgs.length > prevCount) {
      prevCount = imgs.length;
      sameCount = 0;
      console.log(`➡️ Loaded ${imgs.length} images...`);
    } else if (++sameCount > 5) break;

    nextBtn.click();
    await new Promise((r) => setTimeout(r, 50)); // Fast scroll delay
  }

  console.log("📸 Scrolling done, collecting images...");

  // Collect all unique image URLs
  const seen = new Set();
  const urls = [...gallery.querySelectorAll('img[src*="image.civitai.com"]')]
    .map((img) => img.src.replace(/\/anim=.*?\/|,optimized=true|,width=\d+/g, "/").split("?")[0])
    .filter((u) => u && u.startsWith("https") && !seen.has(u) && seen.add(u));

  console.log(`📥 Fetching ${urls.length} images...`);

  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i]);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `civitai_image_${i + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      console.log(`✅ Saved ${i + 1}/${urls.length}`);
    } catch (e) {
      console.log(`❌ Failed ${i + 1}`, e);
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  console.log("🟢 Done!");
})();
