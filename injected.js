// injected.js – accumulate full mappings per bidder + slot

(function () {
  console.log("[MappingChecker][injected] Loaded, waiting for pbjs…");

  // Accumulated maps for the lifetime of the page
  // bidder -> [ "<span>slot</span><br>  key: val..." ]
  let accumulatedPartnerMap = {};
  // slot   -> [ "<span>bidder</span><br>  key: val..." ]
  let accumulatedSlotMap = {};

  // Keys we don't want to include in the mapping output
  const EXCLUDE_KEYS = [
    "keywords",
    "customData",
    "video",
    "dctr",
    "wiid",
    "floor",
    "floorPrice",
    "pageviewId"
  ];

  function formatParams(params) {
    if (!params || typeof params !== "object") return "{}";

    const lines = [];

    Object.keys(params)
      .sort()
      .forEach((key) => {
        if (EXCLUDE_KEYS.includes(key)) return;
        const value = params[key];
        try {
          if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
          ) {
            lines.push(`${key}: ${JSON.stringify(value)}`);
          } else {
            lines.push(`${key}: ${JSON.stringify(value)}`);
          }
        } catch (e) {
          lines.push(`${key}: [unserializable]`);
        }
      });

    if (!lines.length) return "{}";
    return lines.join("<br>&nbsp;&nbsp;&nbsp;&nbsp;");
  }

  function formatMediaTypes(bid) {
    // Try mediaTypes on the config, then mediaType string on the bid
    const mt = (bid && bid.mediaTypes) || null;
    const single = bid && bid.mediaType;

    const parts = [];

    if (mt) {
      try {
        parts.push("mediaTypes: " + JSON.stringify(mt));
      } catch (e) {
        // ignore
      }
    }
    if (single && !parts.length) {
      parts.push("mediaType: " + single);
    }

    if (!parts.length) return "";
    return "<br>&nbsp;&nbsp;&nbsp;&nbsp;" + parts.join("<br>&nbsp;&nbsp;&nbsp;&nbsp;");
  }

  function updateMappings() {
    if (!window.pbjs || typeof pbjs.getBidResponses !== "function") {
      console.warn(
        "[MappingChecker][injected] pbjs.getBidResponses not available yet."
      );
      return;
    }

    const responses = pbjs.getBidResponses() || {};
    console.log("[MappingChecker][injected] getBidResponses()", responses);

    Object.keys(responses).forEach((adUnitCode) => {
      const bids = (responses[adUnitCode] && responses[adUnitCode].bids) || [];
      bids.forEach((bid) => {
        const bidder = bid.bidder;
        const paramsObj = bid.params || {};

        const paramString = formatParams(paramsObj);
        const mediaTypesString = formatMediaTypes(bid);

        // For partner view: show slot name, then params
        const partnerEntry =
          `<span style="color: yellow;">${adUnitCode}</span>` +
          `<br>&nbsp;&nbsp;&nbsp;&nbsp;${paramString}${mediaTypesString}`;

        // For slot view: show bidder name, then params
        const slotEntry =
          `<span style="color: yellow;">${bidder}</span>` +
          `<br>&nbsp;&nbsp;&nbsp;&nbsp;${paramString}${mediaTypesString}`;

        // ---- accumulate per bidder ----
        if (!accumulatedPartnerMap[bidder]) {
          accumulatedPartnerMap[bidder] = [];
        }
        if (!accumulatedPartnerMap[bidder].includes(partnerEntry)) {
          accumulatedPartnerMap[bidder].push(partnerEntry);
        }

        // ---- accumulate per slot ----
        if (!accumulatedSlotMap[adUnitCode]) {
          accumulatedSlotMap[adUnitCode] = [];
        }
        if (!accumulatedSlotMap[adUnitCode].includes(slotEntry)) {
          accumulatedSlotMap[adUnitCode].push(slotEntry);
        }
      });
    });

    // Push the accumulated maps to the content script
    window.postMessage(
      {
        source: "bidParamsDebugger",
        slotParamsMap: accumulatedSlotMap,
        partnerParamsMap: accumulatedPartnerMap
      },
      "*"
    );

    console.log(
      "[MappingChecker][injected] Posted accumulated maps to content.js",
      accumulatedPartnerMap,
      accumulatedSlotMap
    );
  }

  function setupHooksWhenReady() {
    let attempts = 0;
    const maxAttempts = 120; // ~1 minute at 500ms
    const interval = setInterval(() => {
      attempts += 1;

      if (window.pbjs && typeof pbjs.getBidResponses === "function") {
        clearInterval(interval);
        console.log("[MappingChecker][injected] pbjs ready, setting up hooks.");

        // Initial snapshot
        updateMappings();

        // If pbjs.onEvent exists, hook into it
        if (typeof pbjs.onEvent === "function") {
          try {
            pbjs.onEvent("bidResponse", updateMappings);
            pbjs.onEvent("auctionEnd", updateMappings);
            console.log(
              "[MappingChecker][injected] Registered pbjs bidResponse/auctionEnd hooks."
            );
          } catch (e) {
            console.warn(
              "[MappingChecker][injected] Error attaching pbjs events:",
              e
            );
          }
        } else {
          // Fallback: poll every few seconds
          setInterval(updateMappings, 5000);
          console.log(
            "[MappingChecker][injected] pbjs.onEvent missing – using polling."
          );
        }
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        console.log(
          "[MappingChecker][injected] pbjs not found on this page after",
          attempts,
          "attempts — no auction detected."
        );
      }
    }, 500);
  }

  // Optional: reset + refresh on command from popup (via content.js)
  window.addEventListener("message", (evt) => {
    if (evt.source !== window) return;
    if (!evt.data || evt.data.source !== "bidParamsDebugger") return;

    if (evt.data.command === "refreshGPT") {
      console.log(
        "[MappingChecker][injected] refreshGPT command received – clearing maps and re-collecting."
      );
      accumulatedPartnerMap = {};
      accumulatedSlotMap = {};
      updateMappings();
    }
  });

  setupHooksWhenReady();
})();