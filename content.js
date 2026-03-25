// content.js – UPDATED (single-inject + strict message filtering)

// 1) Listen for messages from injected.js (page context)
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (!event.data) return;

  const data = event.data;
  let payload = null;

  // Old format: { type: "BID_PARAMS_EXTRACTED", payload: {...} }
  if (data.type === "BID_PARAMS_EXTRACTED" && data.payload) {
    payload = data.payload;
  }
  // New format: { source: "bidParamsDebugger", partnerParamsMap, slotParamsMap }
  // IMPORTANT: only store when BOTH maps are present (prevents overwriting with commands/partials)
  else if (
    data.source === "bidParamsDebugger" &&
    data.partnerParamsMap &&
    data.slotParamsMap
  ) {
    payload = {
      partnerParamsMap: data.partnerParamsMap,
      slotParamsMap: data.slotParamsMap
    };
  }

  if (!payload) return;

  chrome.storage.local.set({ bidParamsData: payload }, () => {
    console.log("[MappingChecker][content] Stored bidParamsData:", payload);
  });
});

// 2) Inject injected.js into the page context (ONCE per frame)
(function injectOnce() {
  const SCRIPT_ID = "mapping-checker-injected";

  // Prevent duplicate injection (SPA navigations, extension reload, etc.)
  if (document.getElementById(SCRIPT_ID)) {
    console.log("[MappingChecker][content] injected.js already present, skipping.");
    return;
  }

  const s = document.createElement("script");
  s.id = SCRIPT_ID;
  s.src = chrome.runtime.getURL("injected.js");
  (document.head || document.documentElement).appendChild(s);

  // Keep script element for the ID guard
  s.onload = () => {
    console.log("[MappingChecker][content] injected.js injected.");
  };
})();