// injected.js – accumulate bidder/slot mappings (queue-safe, uses bidRequested)
// Output format stored as a SINGLE LINE string using literal "\n" separators:
// "slot\\nkey: val\\nkey2: val\\nmediatypes: banner, video(outstream)"

(function () {
  console.log("[MappingChecker][injected] Loaded, waiting for pbjs…");

  let accumulatedPartnerMap = {}; // bidder -> Set of entry strings
  let accumulatedSlotMap = {};    // slot   -> Set of entry strings

  let backfillIntervalId = null;

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

  // IMPORTANT: store literal "\n" (two chars) so DB/JSON layers don't eat formatting
  const NL = "\\n";

  function normalizeValue(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number" || typeof v === "boolean") return String(v);

    if (typeof v === "string") {
      const s = v.trim();
      if (
        (s.startsWith('"') && s.endsWith('"')) ||
        (s.startsWith("'") && s.endsWith("'"))
      ) {
        return s.slice(1, -1);
      }
      return s;
    }

    try {
      return JSON.stringify(v);
    } catch (e) {
      return "[unserializable]";
    }
  }

  function sanitizeLine(line) {
    // Ensure we never accidentally embed real newlines into a "line"
    // (which would make the output inconsistent)
    return String(line).replace(/\r?\n/g, " ");
  }

  function formatParamsLines(params) {
    if (!params || typeof params !== "object") return [];

    const keys = Object.keys(params).sort();
    const lines = [];

    keys.forEach((key) => {
      if (EXCLUDE_KEYS.includes(key)) return;
      const val = normalizeValue(params[key]);
      lines.push(`${sanitizeLine(key)}: ${sanitizeLine(val)}`);
    });

    return lines;
  }

  function inferVideoKind(videoObj) {
    if (!videoObj || typeof videoObj !== "object") return null;

    const ctx = typeof videoObj.context === "string" ? videoObj.context.toLowerCase() : "";
    if (ctx.includes("instream")) return "instream";
    if (ctx.includes("outstream")) return "outstream";

    const plcmt = videoObj.plcmt;
    if (plcmt === 1) return "instream";
    if (typeof plcmt === "number") return "outstream";

    const placement = typeof videoObj.placement === "string" ? videoObj.placement.toLowerCase() : "";
    if (placement.includes("instream")) return "instream";
    if (placement.includes("outstream")) return "outstream";

    return null;
  }

  function summarizeMediaTypes(bid, bidderRequest) {
    const mt = (bid && bid.mediaTypes) || (bidderRequest && bidderRequest.mediaTypes) || null;
    const legacy = (bid && bid.mediaType) ? String(bid.mediaType).toLowerCase() : null;

    const parts = [];

    if (mt && typeof mt === "object") {
      if (mt.banner) parts.push("banner");

      if (mt.video) {
        const kind = inferVideoKind(mt.video);
        parts.push(kind ? `video(${kind})` : "video");
      }
    } else if (legacy) {
      if (legacy === "banner") parts.push("banner");
      else if (legacy === "video") parts.push("video");
      else parts.push(legacy);
    }

    if (!parts.length) return "mediatypes: unknown";

    return `mediatypes: ${[...new Set(parts)].join(", ")}`;
  }

  function joinLines(lines) {
    return lines.map(sanitizeLine).join(NL);
  }

  function addEntry(bidder, adUnitCode, paramsObj, mediaTypesLine) {
    const bidderName = sanitizeLine(bidder || "(unknown)");
    const slotName = sanitizeLine(adUnitCode || "(unknown_adunit)");

    const paramLines = formatParamsLines(paramsObj);

    // Partner map entry: first line is slot
    const entry = joinLines([slotName, ...paramLines, sanitizeLine(mediaTypesLine)]);

    if (!accumulatedPartnerMap[bidderName]) accumulatedPartnerMap[bidderName] = new Set();
    accumulatedPartnerMap[bidderName].add(entry);

    // Slot map entry: first line is bidder
    const slotEntry = joinLines([bidderName, ...paramLines, sanitizeLine(mediaTypesLine)]);

    if (!accumulatedSlotMap[slotName]) accumulatedSlotMap[slotName] = new Set();
    accumulatedSlotMap[slotName].add(slotEntry);
  }

  function postAccumulatedMaps() {
    const partnerMapArr = {};
    for (const k of Object.keys(accumulatedPartnerMap)) {
      partnerMapArr[k] = [...accumulatedPartnerMap[k]];
    }
    const slotMapArr = {};
    for (const k of Object.keys(accumulatedSlotMap)) {
      slotMapArr[k] = [...accumulatedSlotMap[k]];
    }
    window.postMessage(
      {
        source: "bidParamsDebugger",
        slotParamsMap: slotMapArr,
        partnerParamsMap: partnerMapArr
      },
      "*"
    );
  }

  function handleBidRequested(bidderRequest) {
    try {
      const bidder =
        bidderRequest.bidderCode ||
        bidderRequest.bidder ||
        bidderRequest.bidderName ||
        "(unknown)";

      const bids = Array.isArray(bidderRequest.bids) ? bidderRequest.bids : [];
      bids.forEach((bid) => {
        const adUnitCode =
          bid.adUnitCode ||
          bid.adUnit ||
          bid.placementCode ||
          "(unknown_adunit)";

        const paramsObj = bid.params || {};
        const mediaTypesLine = summarizeMediaTypes(bid, bidderRequest);

        addEntry(bidder, adUnitCode, paramsObj, mediaTypesLine);
      });

      postAccumulatedMaps();
    } catch (e) {
      console.warn("[MappingChecker][injected] handleBidRequested failed:", e);
    }
  }

  function backfillFromGetBidRequests() {
    if (!window.pbjs || typeof pbjs.getBidRequests !== "function") return false;

    try {
      const reqs = pbjs.getBidRequests();
      if (!Array.isArray(reqs)) return false;

      reqs.forEach((br) => {
        if (br && (br.bids || br.bidderCode)) {
          handleBidRequested(br);
        }
      });

      return true;
    } catch (e) {
      console.warn("[MappingChecker][injected] backfillFromGetBidRequests failed:", e);
      return false;
    }
  }

  function whenPrebidReady(cb) {
    if (!window.pbjs || !pbjs.que || !Array.isArray(pbjs.que)) return false;

    pbjs.que.push(function () {
      try {
        cb();
      } catch (e) {
        console.warn("[MappingChecker][injected] Prebid-ready callback failed:", e);
      }
    });

    return true;
  }

  function setupHooksWhenReady() {
    let attempts = 0;
    const maxAttempts = 240;

    const interval = setInterval(() => {
      attempts++;

      const ok = whenPrebidReady(() => {
        console.log("[MappingChecker][injected] Prebid queue confirmed → attaching hooks");

        if (typeof pbjs.onEvent === "function") {
          try {
            pbjs.onEvent("bidRequested", handleBidRequested);
            pbjs.onEvent("auctionEnd", postAccumulatedMaps);
            console.log("[MappingChecker][injected] Hooks attached: bidRequested + auctionEnd");
          } catch (e) {
            console.warn("[MappingChecker][injected] pbjs.onEvent attach failed:", e);
          }
        } else {
          console.warn("[MappingChecker][injected] pbjs.onEvent not available; relying on backfill/polling.");
        }

        backfillFromGetBidRequests();

        backfillIntervalId = setInterval(() => {
          backfillFromGetBidRequests();
        }, 5000);

        postAccumulatedMaps();
      });

      if (ok) {
        clearInterval(interval);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(interval);
        console.warn("[MappingChecker][injected] Gave up waiting for pbjs after", attempts, "attempts.");
      }
    }, 500);
  }

  window.addEventListener("message", (evt) => {
    if (evt.source !== window) return;
    if (!evt.data || evt.data.source !== "bidParamsDebugger") return;

    if (evt.data.command === "refreshGPT") {
      accumulatedPartnerMap = {};
      accumulatedSlotMap = {};
      backfillFromGetBidRequests();
      postAccumulatedMaps();
    }
  });

  window.addEventListener("beforeunload", () => {
    if (backfillIntervalId !== null) {
      clearInterval(backfillIntervalId);
      backfillIntervalId = null;
    }
  });

  setupHooksWhenReady();
})();