chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id || !tab.url || !/^https?:/i.test(tab.url)) {
    return; // ignore non-http(s) or missing tabs
  }

  // Try to stop previous
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        try {
          if (window.__CIVITAI_DL_ACTIVE__) {
            window.__CIVITAI_DL_ACTIVE__.abort?.();
          }
          document.querySelector("#civitai-dl-popup")?.remove();
          delete window.__CIVITAI_DL_ACTIVE__;
        } catch (e) {
          console.warn("Cleanup error in page:", e);
        }
      }
    });
  } catch (err) {
    // frame removed or no permission; ignore
  }

  // Inject fresh
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content_combined.js"]
    });
  } catch (err) {
    // Forward a friendly error; ignore if no receiver
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "CIVITAI_ERROR", message: String(err && err.message || err) });
    } catch (e) {}
  }
});
