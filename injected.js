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
          lines.push(`${key}: ${JSON.stringify(value)}`);
        } catch (e) {
          lines.push(`${key}: [unserializable]`);
        }
      });

    if (!lines.length) return "{}";
    return lines.join("<br>&nbsp;&nbsp;&nbsp;&nbsp;");
  }

  function getMediaTypesString(adUnitCode) {
    // mediaTypes live on pbjs.adUnits; produce a simple string e.g. "banner" or "banner, video(outstream)"
    try {
      const adUnit = Array.isArray(window.pbjs.adUnits)
        ? window.pbjs.adUnits.find((u) => u.code === adUnitCode)
        : null;
      if (!adUnit || !adUnit.mediaTypes) return "";
      const mt = adUnit.mediaTypes;
      const parts = [];
      if (mt.banner) parts.push("banner");
      if (mt.video) {
        const ctx = mt.video.context;
        parts.push(ctx ? `video(${ctx})` : "video");
      }
      if (mt.native) parts.push("native");
      if (!parts.length) return "";
      return "<br>&nbsp;&nbsp;&nbsp;&nbsp;mediatypes: " + parts.join(", ");
    } catch (e) {
      return "";
    }
  }

  function processBidRequestedEvent(ev) {
    // ev.args.bids is the array of bid objects sent out in this request batch
    const bids = (ev && ev.args && ev.args.bids) || [];

    bids.forEach((bid) => {
      const adUnitCode = bid.adUnitCode;
      const bidder     = bid.bidder || bid.bidderCode;
      if (!adUnitCode || !bidder) return;

      const paramString      = formatParams(bid.params || {});
      const mediaTypesString = getMediaTypesString(adUnitCode);

      const partnerEntry =
        `<span style="color: yellow;">${adUnitCode}</span>` +
        `<br>&nbsp;&nbsp;&nbsp;&nbsp;${paramString}${mediaTypesString}`;

      const slotEntry =
        `<span style="color: yellow;">${bidder}</span>` +
        `<br>&nbsp;&nbsp;&nbsp;&nbsp;${paramString}${mediaTypesString}`;

      if (!accumulatedPartnerMap[bidder]) accumulatedPartnerMap[bidder] = [];
      if (!accumulatedPartnerMap[bidder].includes(partnerEntry)) {
        accumulatedPartnerMap[bidder].push(partnerEntry);
      }

      if (!accumulatedSlotMap[adUnitCode]) accumulatedSlotMap[adUnitCode] = [];
      if (!accumulatedSlotMap[adUnitCode].includes(slotEntry)) {
        accumulatedSlotMap[adUnitCode].push(slotEntry);
      }
    });
  }

  function postMaps() {
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

      if (window.pbjs && typeof pbjs.onEvent === "function") {
        clearInterval(interval);
        console.log("[MappingChecker][injected] pbjs ready, setting up hooks.");

        // Replay any bidRequested events that fired before this script loaded
        if (typeof pbjs.getEvents === "function") {
          pbjs.getEvents()
            .filter((ev) => ev.eventType === "bidRequested")
            .forEach(processBidRequestedEvent);
          postMaps();
        }

        // Hook future bidRequested events (covers click-to-play video auctions)
        pbjs.onEvent("bidRequested", (args) => {
          processBidRequestedEvent({ args });
          postMaps();
        });

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

  // Reset + refresh on command from popup (via content.js)
  window.addEventListener("message", (evt) => {
    if (evt.source !== window) return;
    if (!evt.data || evt.data.source !== "bidParamsDebugger") return;

    if (evt.data.command === "refreshGPT") {
      console.log(
        "[MappingChecker][injected] refreshGPT command received – clearing maps and re-collecting."
      );
      accumulatedPartnerMap = {};
      accumulatedSlotMap = {};
      if (window.pbjs && typeof pbjs.getEvents === "function") {
        pbjs.getEvents()
          .filter((ev) => ev.eventType === "bidRequested")
          .forEach(processBidRequestedEvent);
        postMaps();
      }
    }
  });

  setupHooksWhenReady();
})();
