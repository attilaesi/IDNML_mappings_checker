// popup.js

console.log("Attila: popup.js loaded.");

let viewMode = 'partner'; 
let displayedKeys = new Set();

document.addEventListener('DOMContentLoaded', () => {
  console.log("Attila: DOMContentLoaded in popup.");

  document.getElementById('clearAndRefreshBtn').addEventListener('click', onClearAndRefresh);
  document.getElementById('toggleViewBtn').textContent = 'Switch to view by slot';
  document.getElementById('toggleViewBtn').addEventListener('click', onToggleView);

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy Table to Clipboard';
  copyBtn.style.marginLeft = '10px';
  copyBtn.addEventListener('click', copyTableToClipboard);
  document.body.insertBefore(copyBtn, document.getElementById('paramsTableContainer'));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.bidParamsData) {
      console.log("Attila: popup sees new bidParamsData -> buildTable().");
      buildTable();
    }
  });

  buildTable();
});

function onClearAndRefresh() {
  console.log("Attila: Clear Data & Refresh GPT button clicked.");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs?.length) {
      console.log("Attila: Sending { action: 'clearAndRefresh' } to content script.");
      chrome.tabs.sendMessage(tabs[0].id, { action: 'clearAndRefresh' }, (resp) => {
        console.log("Attila: Response from content script:", resp);
        displayedKeys.clear();
        document.getElementById('paramsTableContainer').innerHTML = 'No data available';
      });
    }
  });
}

function onToggleView() {
  console.log("Attila: Toggling view mode.");
  viewMode = viewMode === 'partner' ? 'slot' : 'partner';
  this.textContent = `Switch to view by ${viewMode === 'partner' ? 'slot' : 'partner'}`;
  buildTable();
}

function buildTable() {
  console.log("Attila: buildTable() called in popup.");
  chrome.storage.local.get('bidParamsData', (res) => {
    const data = res.bidParamsData;
    if (!data) {
      document.getElementById('paramsTableContainer').innerHTML = 'No data available';
      return;
    }

    const partnerMap = data.partnerParamsMap;
    displayedKeys.clear();

    const allSlots = new Set();
    Object.values(partnerMap).forEach(entries => {
      entries.forEach(entry => {
        const match = entry.match(/<span[^>]*>(.*?)<\/span>/);
        if (match) {
          allSlots.add(match[1]);
        }
      });
    });

    const slotNames = Array.from(allSlots);
    const bidders = Object.keys(partnerMap);

    let html = `
      <style>
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        th, td {
          border: 1px solid #333;
          padding: 4px 6px;
          white-space: pre-wrap;
          vertical-align: top;
        }
        th {
          background-color: #2a2a2a;
          color: #aaffaa;
        }
        td {
          background-color: #111;
          color: #cceccc;
        }
        tr:nth-child(even) td {
          background-color: #181818;
        }
        td:empty {
          background-color: #222;
        }
      </style>
      <div style="overflow-x: auto;"><table><thead>`;

    if (viewMode === 'partner') {
      html += '<tr><th>Bidder</th>';
      slotNames.forEach(slot => html += `<th>${slot}</th>`);
      html += '</tr>';

      bidders.forEach(bidder => {
        html += `<tr><td>${bidder}</td>`;
        const entryMap = {};
        partnerMap[bidder].forEach(entry => {
          const match = entry.match(/<span[^>]*>(.*?)<\/span><br>([\s\S]*)/);
          if (match) {
            entryMap[match[1]] = match[2];
          }
        });
        slotNames.forEach(slot => {
          html += `<td>${entryMap[slot] || ''}</td>`;
        });
        html += '</tr>';
      });

    } else {
      html += '<tr><th>Slot</th>';
      bidders.forEach(bidder => html += `<th>${bidder}</th>`);
      html += '</tr>';

      slotNames.forEach(slot => {
        html += `<tr><td>${slot}</td>`;
        bidders.forEach(bidder => {
          const entry = partnerMap[bidder]?.find(e => e.includes(`<span style=\"color: yellow;\">${slot}</span>`));
          const content = entry ? entry.replace(/<span[^>]*>.*?<\/span><br>/, '') : '';
          html += `<td>${content}</td>`;
        });
        html += '</tr>';
      });
    }

    html += '</thead><tbody></tbody></table></div>';
    document.getElementById('paramsTableContainer').innerHTML = html;
  });
}

function copyTableToClipboard() {
  const el = document.createElement('textarea');
  el.style.position = 'fixed';
  el.style.opacity = '0';
  el.value = document.getElementById('paramsTableContainer').innerText;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  alert('Table copied to clipboard');
}