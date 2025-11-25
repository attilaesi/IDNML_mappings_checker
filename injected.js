// injected.js

(function() {
  let prevSlotMap = {};
  let prevPartnerMap = {};

  console.log("Attila: injected.js loaded, waiting for pbjs & googletag.");

  // 1) Wait for pbjs + GPT
  function waitForPbjsAndGpt() {
    if (
      !window.pbjs ||
      typeof pbjs.getEvents !== 'function' ||
      !window.googletag ||
      !googletag.pubads
    ) {
      console.log("Attila: pbjs/googletag not ready, retry in 500ms.");
      setTimeout(waitForPbjsAndGpt, 500);
      return;
    }
    console.log("Attila: pbjs & googletag are ready. Setting up event listeners.");
    setupEvents();
  }

  // 2) Setup GPT event + handle refreshGPT command
  function setupEvents() {
    // Hook GPT's slotResponseReceived to gather data whenever GPT responds
    googletag.pubads().addEventListener('slotResponseReceived', (event) => {
      const slotId = event.slot.getSlotElementId();
      console.log(`Attila: slotResponseReceived for slotElementId="${slotId}". Collecting data now.`);
      collectPrebidData();
    });

    // Also collect data in case some slots responded before we hooked in
    collectPrebidData();

    // Listen for "refreshGPT" from content.js
    window.addEventListener('message', (evt) => {
      if (evt.source !== window) return;
      if (!evt.data || evt.data.source !== 'bidParamsDebugger') return;

      if (evt.data.command === 'refreshGPT') {
        console.log("Attila: 'refreshGPT' command received. Will request new Prebid bids, then refresh GPT.");
        handleRefresh();
      }
    });
  }

  // 3) Request new Prebid bids, then refresh GPT
  function handleRefresh() {
    if (window.pbjs?.requestBids && window.googletag?.pubads) {
      const slots = googletag.pubads().getSlots();
      if (!slots.length) {
        console.log("Attila: No GPT slots found to refresh.");
        return;
      }

      const adUnitCodes = slots.map(slot => slot.getAdUnitPath());
      console.log("Attila: handleRefresh -> requesting new bids for adUnitCodes:", adUnitCodes);

      pbjs.requestBids({
        adUnitCodes,
        bidsBackHandler: () => {
          console.log("Attila: Prebid bids returned, now calling googletag.pubads().refresh()");
          googletag.pubads().refresh(slots);
        }
      });
    } else {
      console.log("Attila: pbjs.requestBids or googletag not available. Can't refresh GPT.");
    }
  }

  // 4) Collect data from Prebid events & post to content.js
  function collectPrebidData() {
    console.log("Attila: collectPrebidData() called, building slot & partner maps.");
    const events = pbjs.getEvents();
    const bidRequestedEvents = events.filter(e => e.eventType === 'bidRequested');

    const slotMap = {};

    // We'll store partner data in nested objects for dedup
    // partnerMap[bid.bidder] = { [adUnitCode]: "formatted string" }
    const partnerMapObj = {};

    // *** Keys to exclude ***
    const EXCLUDE_KEYS = ['keywords', 'customData', 'video', 'dctr', 'wiid', 'floor', 'floorPrice','pageviewId'];

    bidRequestedEvents.forEach(event => {
      if (event.args && Array.isArray(event.args.bids)) {
        event.args.bids.forEach(bid => {
          if (bid && bid.params && bid.adUnitCode && bid.bidder) {
            // Filter out unwanted keys
            const paramString = Object.entries(bid.params)
              .filter(([key]) => !EXCLUDE_KEYS.includes(key))
              .map(([key, val]) => `${key}: ${val}`)
              .join('<br>&nbsp;&nbsp;&nbsp;&nbsp;');
            // Build mediaTypes string if present
            let mediaTypesString = '';
            try {
              const mt = bid && bid.mediaTypes ? bid.mediaTypes : (event && event.args && event.args.mediaTypes ? event.args.mediaTypes : null);
              if (mt && typeof mt === 'object') {
                const parts = [];
                if (mt.banner) parts.push('banner');
                if (mt.video) {
                  let label = 'video';
                  try {
                    const ctx = mt.video.context || mt.video.playerParams && mt.video.playerParams.context;
                    if (ctx) label += `(${ctx})`;
                  } catch (_) {}
                  parts.push(label);
                }
                if (mt.native) parts.push('native');
                if (parts.length) {
                  mediaTypesString = `<br>&nbsp;&nbsp;&nbsp;&nbsp;mediatypes: ${parts.join(', ')}`;
                }
              }
            } catch (e) {
              // keep silent to avoid breaking existing features
            }


            // --- BY SLOT (no dedup) ---
            if (!slotMap[bid.adUnitCode]) {
              slotMap[bid.adUnitCode] = [];
            }
            slotMap[bid.adUnitCode].push(
              `<span style="color: yellow;">${bid.bidder}</span><br>&nbsp;&nbsp;&nbsp;&nbsp;${paramString}${mediaTypesString}`
            );

            // --- BY PARTNER (DEDUP) ---
            if (!partnerMapObj[bid.bidder]) {
              partnerMapObj[bid.bidder] = {};
            }
            // Overwrite or unify, but here we overwrite for dedup
            partnerMapObj[bid.bidder][bid.adUnitCode] =
              `<span style="color: yellow;">${bid.adUnitCode}</span><br>&nbsp;&nbsp;&nbsp;&nbsp;${paramString}${mediaTypesString}`;
          }
        });
      }
    });

    // Convert partnerMapObj from { [bidder]: { [slot]: "string" } } to arrays
    const partnerMap = {};
    Object.keys(partnerMapObj).forEach(bidder => {
      partnerMap[bidder] = Object.values(partnerMapObj[bidder]);
    });

    // Compare new vs old to see if truly new data
    const isSameData =
      isEqual(slotMap, prevSlotMap) &&
      isEqual(partnerMap, prevPartnerMap);

    if (isSameData) {
      console.log("Attila: No new data found, skipping postMessage.");
      return;
    }

    prevSlotMap = slotMap;
    prevPartnerMap = partnerMap;

    console.log("Attila: Found new data, posting to content.js (slotMap & partnerMap).");
    window.postMessage({
      source: 'bidParamsDebugger',
      slotParamsMap: slotMap,
      partnerParamsMap: partnerMap
    }, '*');
  }

  // Simple deep compare (just for demo)
  function isEqual(obj1, obj2) {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  }

  waitForPbjsAndGpt();
})();