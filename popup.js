// ================================
// popup.js - TEST-DB ONLY VERSION
// ================================
//
// CHANGE: Removed Environment dropdown.
// - publisher_code is canonical brand (independent, evening_standard, ...)
// - environment_code is derived from URL (uat/prod)
// - page_env kept for diagnostics (same value as environment_code)
// - Added safety: blocks upload if URL env can't be derived.
//

document.addEventListener("DOMContentLoaded", () => {
  console.log("Popup loaded.");
  injectControls();
  checkExistsInDB();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.bidParamsData) buildTable();
  });

  buildTable();
});

/* ------------------------------
   UI CONTROLS (dropdowns + upload)
--------------------------------*/
function injectControls() {
  const container = document.getElementById("dropdownContainer");

  container.appendChild(
    makeDropdown("pageTypeSelect", "Page Type", [
      "image_article",
      "video_article",
      "index",
      "blog_article",
      "quiz_article",
      "gallery_article",
    ])
  );

  // ✅ Environment dropdown removed (now derived from URL)

  container.appendChild(makeDropdown("geoSelect", "Geo", ["uk", "us", "es", "row"]));

  container.appendChild(makeDropdown("deviceSelect", "Device", ["desktop", "mobile"]));

  ["pageTypeSelect", "geoSelect", "deviceSelect"].forEach((id) => {
    document.getElementById(id).onchange = checkExistsInDB;
  });

  const badge = document.createElement("div");
  badge.id = "dbStatus";
  badge.style.cssText =
    "margin:8px 0;padding:5px 10px;border-radius:4px;font-size:12px;text-align:center;background:#444;color:#ccc;";
  badge.textContent = "Checking DB…";
  container.appendChild(badge);

  const btn = document.createElement("button");
  btn.textContent = "Upload Table to Supabase";
  btn.style.marginTop = "4px";
  btn.onclick = onUploadToSupabase;
  container.appendChild(btn);
}

function makeDropdown(id, label, options) {
  const wrap = document.createElement("div");
  wrap.style.margin = "6px 0";

  const lbl = document.createElement("label");
  lbl.innerText = label + ": ";
  lbl.style.marginRight = "5px";

  const select = document.createElement("select");
  select.id = id;

  options.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    select.appendChild(opt);
  });

  wrap.appendChild(lbl);
  wrap.appendChild(select);
  return wrap;
}

/* ------------------------------
   TABLE RENDERING
--------------------------------*/
function buildTable() {
  chrome.storage.local.get("bidParamsData", (res) => {
    const container = document.getElementById("paramsTableContainer");
    const data = res.bidParamsData;

    if (!data || !data.partnerParamsMap) {
      container.innerHTML = "<p>No mapping data yet.</p>";
      return;
    }

    container.innerHTML =
      "<pre style='font-size:12px;white-space:pre-wrap;'>" +
      JSON.stringify(data.partnerParamsMap, null, 2) +
      "</pre>";
  });
}

/* ------------------------------
   URL → PUBLISHER + ENV (uat/prod)
   Canonical:
   - publisher_code is the real publisher brand (independent, standard, ...)
   - environment_code is derived from URL (uat/prod)
   - page_env is derived from URL (uat/prod) for diagnostics (same value)
--------------------------------*/
function derivePublicationAndEnv(pageUrl) {
  let publication = "unknown";
  let env = "unknown"; // must resolve to uat/prod to allow upload

  try {
    const host = new URL(pageUrl).hostname.toLowerCase();

    // ---- Independent ----
    if (host.includes("uat-web.independent.co.uk")) {
      publication = "independent";
      env = "uat";
    } else if (host.includes("staging-web.independent.co.uk")) {
      // staging treated as uat per your requirements/tests
      publication = "independent";
      env = "uat";
    } else if (host.endsWith("independent.co.uk")) {
      publication = "independent";
      env = "prod";
    }

    // If "the-independent.com" is a separate property in DB, keep it.
    else if (host.endsWith("the-independent.com")) {
      publication = "independent_com";
      env = "prod";
    }

    // ---- Evening Standard ----
    else if (host.endsWith("standard.co.uk")) {
      publication = "evening_standard";
      env = "prod";
    }

    // ---- HuffPost ----
    else if (host.endsWith("huffingtonpost.co.uk")) {
      publication = "huffpost";
      env = "prod";
    }

    // ---- BuzzFeed ----
    else if (host.endsWith("buzzfeed.com")) {
      publication = "buzzfeed";
      env = "prod";
    }
  } catch (e) {
    console.warn("URL parse error", e);
  }

  return { publication, env };
}

/* ------------------------------
   PAYLOAD BUILDER
   - bidder → [ "slot<br> key: val<br> key2: val2" ]
   - first segment = slot
   - rest = params_json (key: value)
--------------------------------*/
function buildPayload({
  data,
  publication,
  env,
  pageUrl,
  pageType,
  geo,
  device,
}) {
  const rows = [];
  const partnerMap = data.partnerParamsMap || {};

  Object.keys(partnerMap).forEach((bidder) => {
    const entries = partnerMap[bidder] || [];

    entries.forEach((entry) => {
      if (!entry) return;

      // 1) Strip span tags and &nbsp;
      let cleaned = entry
        .replace(/<\/?span[^>]*>/gi, "")
        .replace(/&nbsp;/gi, " ");

      // 2) Split by <br> tags into logical lines
      let segments = cleaned
        .split(/<br\s*\/?>/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // Fallback: if no <br>, try newline split
      if (!segments.length) {
        segments = cleaned
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }

      if (!segments.length) return;

      // 3) First segment is the slot code
      const slotCode = segments[0];

      // 4) Remaining segments are "key: value" pairs
      const paramsJson = {};
      for (let i = 1; i < segments.length; i++) {
        const line = segments[i];
        const idx = line.indexOf(":");
        if (idx === -1) continue;

        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();

        if (!key) continue;
        paramsJson[key] = value;
      }

      rows.push({
        publisher_code: publication, // ✅ canonical (no independent_uat)
        environment_code: env,       // ✅ derived (uat/prod)
        page_env: env,               // ✅ diagnostics (same value)
        geo_code: geo,
        device_code: device,
        page_type_code: pageType,
        page_url: pageUrl,
        slot_code: slotCode,
        bidder_code: bidder,
        params_json: paramsJson,
      });
    });
  });

  return rows;
}

/* ------------------------------
   SUPABASE CONFIG – TEST DB ONLY
--------------------------------*/
const SUPABASE_URL = "https://jcrcmwyidwsoakfearwg.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjcmNtd3lpZHdzb2FrZmVhcndnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxMTE0MTksImV4cCI6MjA3OTY4NzQxOX0.1oW4JWzvA1CR6IPKoQEZWqhB0pytnHgXMTwTCv8LALg";

/* ------------------------------
   RPC UPLOAD (always to TEST DB)
--------------------------------*/
async function uploadToSupabaseRPC(payload) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/ingest_mapping_rows`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ payload }),
    });

    const text = await res.text();

    if (!res.ok) {
      console.error("Supabase upload failed:", res.status, text);
      alert("Upload failed:\n\n" + text);
      return false;
    }

    console.log("Supabase upload success:", text);
    return true;
  } catch (err) {
    console.error("Supabase upload exception:", err);
    alert("Upload exception:\n\n" + err.message);
    return false;
  }
}

/* ------------------------------
   DB EXISTENCE CHECK
--------------------------------*/
function checkExistsInDB() {
  const badge = document.getElementById("dbStatus");
  if (!badge) return;

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const pageUrl = tabs?.[0]?.url;
    if (!pageUrl) {
      setBadge(badge, "—", "#555", "#aaa");
      return;
    }

    const { publication, env } = derivePublicationAndEnv(pageUrl);
    if (publication === "unknown" || env === "unknown") {
      setBadge(badge, "Unknown page — no check", "#555", "#aaa");
      return;
    }

    const pageType = document.getElementById("pageTypeSelect").value;
    const geo = document.getElementById("geoSelect").value;
    const device = document.getElementById("deviceSelect").value;

    setBadge(badge, "Checking DB…", "#444", "#ccc");

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_profile_bidders`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_publisher_code: publication,
          p_env_code: env,
          p_geo_code: geo,
          p_device_code: device,
          p_page_type_code: pageType,
        }),
      });

      if (!res.ok) {
        setBadge(badge, "DB check failed", "#7a0000", "#fcc");
        return;
      }

      const dbBidders = await res.json();

      if (!Array.isArray(dbBidders) || dbBidders.length === 0) {
        setBadge(badge, "\u2717 Not yet uploaded", "#5c3a00", "#ffd580");
        return;
      }

      chrome.storage.local.get("bidParamsData", (stored) => {
        const currentBidders = Object.keys(
          (stored.bidParamsData && stored.bidParamsData.partnerParamsMap) || {}
        );
        const newBidders = currentBidders.filter((b) => !dbBidders.includes(b));
        if (newBidders.length === 0) {
          setBadge(badge, "\u2713 Up to date (" + dbBidders.length + " bidders)", "#1a5c1a", "#aeffae");
        } else {
          setBadge(badge, "\u26a0 New bidders: " + newBidders.join(", "), "#5c3a00", "#ffd580");
        }
      });
    } catch (err) {
      console.warn("[checkExistsInDB] error:", err);
      setBadge(badge, "DB check error", "#7a0000", "#fcc");
    }
  });
}

function setBadge(el, text, bg, color) {
  el.textContent = text;
  el.style.background = bg;
  el.style.color = color;
}

/* ------------------------------
   UPLOAD HANDLER
--------------------------------*/
function onUploadToSupabase() {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const pageUrl = tabs?.[0]?.url;
    if (!pageUrl) {
      alert("Could not read current tab URL.");
      return;
    }

    const { publication, env } = derivePublicationAndEnv(pageUrl);

    // ✅ Safety: refuse to upload if env can't be derived
    if (env !== "uat" && env !== "prod") {
      alert(
        "Cannot derive environment from URL.\n\n" +
          `URL: ${pageUrl}\n` +
          "Expected a known uat/prod hostname."
      );
      return;
    }

    if (!publication || publication === "unknown") {
      alert(
        "Cannot derive publisher from URL.\n\n" +
          `URL: ${pageUrl}\n` +
          "Host did not match known publishers."
      );
      return;
    }

    const pageType = document.getElementById("pageTypeSelect").value;
    const geo = document.getElementById("geoSelect").value;
    const device = document.getElementById("deviceSelect").value;

    chrome.storage.local.get("bidParamsData", async (res) => {
      if (!res.bidParamsData) {
        alert("No mapping available.");
        return;
      }

      const payload = buildPayload({
        data: res.bidParamsData,
        publication,
        env,
        pageUrl,
        pageType,
        geo,
        device,
      });

      if (!payload.length) {
        alert("Payload is empty (no bidder/slot rows built). Nothing to upload.");
        return;
      }

      const ok = await uploadToSupabaseRPC(payload);
      if (ok) alert(`Upload successful!\n\npublisher=${publication}\nenv=${env}`);
    });
  });
}