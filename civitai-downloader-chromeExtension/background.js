chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    // 1️⃣ Attempt to send a STOP signal to existing instance
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (window.__CIVITAI_DL_ACTIVE__) {
          console.log("[CivitAI Script] Stopping previous instance…");
          try {
            window.__CIVITAI_DL_ACTIVE__.abort?.();
            document.querySelector("#civitai-dl-popup")?.remove();
          } catch (e) {
            console.warn("Error cleaning up previous instance:", e);
          }
          delete window.__CIVITAI_DL_ACTIVE__;
        }
      }
    });
  } catch (err) {
    console.warn("Stop signal not sent (likely no instance yet):", err);
  }

  // 2️⃣ Inject a fresh new instance
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content_combined.js"]
  });
});
