// content.js

console.log("Attila: content.js loaded. Clearing data on page load.");

chrome.storage.local.set({ bidParamsData: null });

(function() {
  console.log("Attila: Injecting injected.js into the page context.");
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injected.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();

// Listen for messages from injected.js
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data && event.data.source === 'bidParamsDebugger') {
    // If we got slotParamsMap & partnerParamsMap
    if (event.data.slotParamsMap && event.data.partnerParamsMap) {
      console.log("Attila: content.js received new data from injected.js. Storing in chrome.storage.");
      const data = {
        slotParamsMap: event.data.slotParamsMap,
        partnerParamsMap: event.data.partnerParamsMap
      };
      chrome.storage.local.set({ bidParamsData: data }, () => {
        console.log("Attila: content.js stored bidParamsData in chrome.storage.local.");
      });
    }
  }
});

// Listen for the "clearAndRefresh" message from popup.js
chrome.runtime.onMessage.addListener((req, sender, sendResp) => {
  if (req.action === 'clearAndRefresh') {
    console.log("Attila: content.js got 'clearAndRefresh' from popup.");
    chrome.storage.local.set({ bidParamsData: null }, () => {
      console.log("Attila: content.js cleared data. Posting refreshGPT to injected.js.");
      window.postMessage({
        source: 'bidParamsDebugger',
        command: 'refreshGPT'
      }, '*');
      sendResp({ success: true });
    });
    return true; // indicates async response
  }
});