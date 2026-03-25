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

  const btn = document.createElement("button");
  btn.id = "uploadBtn";
  btn.textContent = "Upload Table to Supabase";
  btn.style.marginTop = "10px";
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

    // Replace literal "\n" (stored by injected.js) with real newlines for display
    const displayJson = JSON.stringify(data.partnerParamsMap, null, 2)
      .replace(/\\\\n/g, "\n");
    container.innerHTML =
      "<pre style='font-size:12px;white-space:pre-wrap;'>" +
      displayJson +
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

      // 2) Split into logical lines.
      // Primary: injected.js stores literal "\n" (backslash + n, two chars)
      let segments = cleaned
        .split("\\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // Fallback: <br> tags (legacy format)
      if (!segments.length) {
        segments = cleaned
          .split(/<br\s*\/?>/i)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }

      // Final fallback: real newlines
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
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
        if (attempt < MAX_RETRIES) {
          console.warn(`Supabase upload attempt ${attempt + 1} failed (${res.status}), retrying…`);
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        console.error("Supabase upload failed:", res.status, text);
        alert("Upload failed:\n\n" + text);
        return false;
      }

      console.log("Supabase upload success:", text);
      return true;
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        console.warn(`Supabase upload attempt ${attempt + 1} threw, retrying…`, err);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      console.error("Supabase upload exception:", err);
      alert("Upload exception:\n\n" + err.message);
      return false;
    }
  }
  return false;
}

/* ------------------------------
   UPLOAD HANDLER
--------------------------------*/
async function onUploadToSupabase() {
  const btn = document.getElementById("uploadBtn");
  btn.disabled = true;
  btn.textContent = "Uploading…";

  try {
    const tabs = await new Promise((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve)
    );
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

    const storageRes = await new Promise((resolve) =>
      chrome.storage.local.get("bidParamsData", resolve)
    );

    if (!storageRes.bidParamsData) {
      alert("No mapping available.");
      return;
    }

    const payload = buildPayload({
      data: storageRes.bidParamsData,
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
  } finally {
    btn.disabled = false;
    btn.textContent = "Upload Table to Supabase";
  }
}