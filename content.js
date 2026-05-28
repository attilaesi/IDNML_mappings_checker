// content.js – FINAL FIXED VERSION

// 1) Listen for messages from injected.js (page context)
window.addEventListener("message", (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return;
  if (!event.data) return;

  const data = event.data;
  let payload = null;

  // Old format: { type: "BID_PARAMS_EXTRACTED", payload: {...} }
  if (data.type === "BID_PARAMS_EXTRACTED" && data.payload) {
    payload = data.payload;
  }

  // New format: { source: "bidParamsDebugger", partnerParamsMap, slotParamsMap }
  else if (
    data.source === "bidParamsDebugger" &&
    (data.partnerParamsMap || data.slotParamsMap)
  ) {
    payload = {
      partnerParamsMap: data.partnerParamsMap || {},
      slotParamsMap: data.slotParamsMap || {}
    };
  }

  if (!payload) return;

  chrome.storage.local.set({ bidParamsData: payload }, () => {
    console.log("[MappingChecker][content] Stored bidParamsData:", payload);
  });
});

// 2) Inject injected.js into the page context
(function inject() {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("injected.js");
  (document.head || document.documentElement).appendChild(s);
  s.onload = () => s.remove();
})();