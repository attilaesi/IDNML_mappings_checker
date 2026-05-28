chrome.runtime.onInstalled.addListener(() => {
  console.log("Mapping extension installed.");
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  // DO NOT INJECT ON chrome:// pages
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) {
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId },
    files: ["injected.js"]
  }).catch(() => {});
});