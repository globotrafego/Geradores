const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const resultsContainer = document.getElementById('resultsContainer');
const resultsGrid = document.getElementById('resultsGrid');
const resultsCount = document.getElementById('resultsCount');
const btnExport = document.getElementById('btnExport');
const btnClear = document.getElementById('btnClear');

let allResults = [];
let extensionActive = false;
const weightResolvers = {};

window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'EXTENSION_CONNECTED') {
    window.postMessage({ type: 'ENABLE_DEBUGGER' }, '*');
  }
  else if (event.data && event.data.type === 'DEBUGGER_STATUS') {
    if (event.data.success) {
      extensionActive = true;
      document.getElementById('extension-banner').style.display = 'block';
    }
  }
  else if (event.data && event.data.type === 'WEIGHT_RESULT') {
    if (weightResolvers[event.data.id]) {
       weightResolvers[event.data.id](event.data.data);
       delete weightResolvers[event.data.id];
    }
  }
});

// Drag and Drop Events
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('active'); });
dropzone.addEventListener('dragleave', (e) => { e.preventDefault(); dropzone.classList.remove('active'); });
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('active');
  if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) processFiles(e.target.files);
});

btnClear.addEventListener('click', () => {
  allResults = [];
  resultsGrid.innerHTML = '';
  resultsContainer.style.display = 'none';
});

btnExport.addEventListener('click', () => {
  if (!allResults.length) return;
  const headers = ['Filename', 'Status', 'Dimensions', 'Loaded Weight (Bytes)', 'Requests Count', 'Click URL', 'Macros'];
  const csv = [headers.join(',')].concat(allResults.map(r => {
    return [
      `"${r.filename}"`,
      r.status,
      `"${r.dimensions}"`,
      r.weight,
      r.requestCount,
      `"${r.clickUrl}"`,
      `"${r.macros}"`
    ].join(',');
  })).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'ad_tags_validation.csv';
  link.click();
});

async function processFiles(files) {
  resultsContainer.style.display = 'block';
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.name.match(/\.(txt|html)$/i)) {
      const content = await file.text();
      const cardId = 'card-' + Math.random().toString(36).substr(2, 9);
      createLoadingCard(file.name, cardId);
      const previewContainer = document.getElementById(cardId + '-preview');
      
      testAdTag(content, file.name, cardId, previewContainer).then(result => {
        allResults.push(result);
        resultsCount.textContent = allResults.length;
        updateCard(cardId, result);
      });
    }
  }
}

function createLoadingCard(filename, id) {
  const card = document.createElement('div');
  card.className = 'card';
  card.id = id;
  const debugText = extensionActive 
    ? 'Using Chrome Debugger extension for exact weights...' 
    : 'Using fallback approximation (extension not detected)...';

  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">${filename}</span>
      <span class="status-badge status-loading" id="${id}-status">Simulating Load...</span>
    </div>
    <div class="card-body" id="${id}-body">
      <p style="color: var(--text-muted); font-size: 0.9rem;">${debugText}</p>
    </div>
    <div id="${id}-preview" class="preview-container">
    </div>
  `;
  resultsGrid.appendChild(card);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1000, sizes = ['Bytes', 'kB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function updateCard(id, result) {
  const statusBadge = document.getElementById(`${id}-status`);
  const body = document.getElementById(`${id}-body`);
  if (!statusBadge || !body) return;

  const badgeClass = result.status === 'Valid' ? 'status-valid' : 'status-warning';
  statusBadge.className = `status-badge ${badgeClass}`;
  statusBadge.textContent = result.status;
  
  let macrosHtml = result.macros !== 'None' 
    ? result.macros.split(', ').map(m => `<span class="macro-badge">${m}</span>`).join('')
    : '<span style="font-size:0.8rem; color:var(--warning)">No standard macros detected</span>';

  let weightDisplay = formatBytes(result.weight);
  
  let exactMsg = result.exactWeight 
    ? `<div class="warning-text" style="color:var(--success)">*Exact Network measurement via Chrome Helper Extension</div>`
    : `<div class="warning-text" style="color:var(--warning)">*Approximate Weight (CORS limitations). Install Helper Extension for exact weights.</div>`;

  body.innerHTML = `
    <div class="info-row"><span class="info-label">Dimensions</span><span class="info-value">${result.dimensions}</span></div>
    <div class="info-row"><span class="info-label">Loaded Weight</span><span class="info-value">${weightDisplay}</span></div>
    <div class="info-row"><span class="info-label">Network Requests</span><span class="info-value">${result.requestCount}</span></div>
    <div class="info-row">
      <span class="info-label">Click URL</span>
      <span class="info-value">
        ${result.clickUrl !== 'Not found' ? `<a href="${result.clickUrl}" target="_blank" style="color:var(--primary)">${result.clickUrl.substring(0,30)}...</a>` : 'Not found'}
      </span>
    </div>
    ${exactMsg}
    <div class="macros-container">
      <div class="macros-title">IAB Macros Detected</div>
      ${macrosHtml}
    </div>
  `;
}

function testAdTag(tagContent, filename, cardId, previewContainer) {
  return new Promise((resolve) => {
    // 1. Static Parsing
    let dimensions = "Unknown";
    const wMatch = tagContent.match(/width\s*=\s*["']?(\d+)["']?/i);
    const hMatch = tagContent.match(/height\s*=\s*["']?(\d+)["']?/i);
    let commonSizes = null;
    if (wMatch && hMatch) {
        dimensions = `${wMatch[1]}x${hMatch[1]}`;
    } else {
        commonSizes = tagContent.match(/\b(300x250|728x90|160x600|300x600|320x50|970x250|300x50|320x480|300x100)\b/);
        if (commonSizes) dimensions = commonSizes[1] + " (Parsed from text)";
    }

    let clickUrl = "Not found";
    const hrefMatch = tagContent.match(/href\s*=\s*["']([^"']+)["']/i);
    if (hrefMatch && !hrefMatch[1].toLowerCase().includes('javascript:')) {
      clickUrl = hrefMatch[1];
    } else {
      const cMatch = tagContent.match(/(?:click|clickurl|cu)=([^&"']+)/i);
      if (cMatch) {
        try { clickUrl = decodeURIComponent(cMatch[1]); } catch(e) { clickUrl = cMatch[1]; }
      }
    }

    const COMMON_MACROS = ['[timestamp]', '%%CACHEBUSTER%%', '{cachebuster}', '[click]', '%%CLICK_URL_UNESC%%', '%%SITE%%', '%%PLACEMENT%%'];
    const foundMacros = COMMON_MACROS.filter(m => tagContent.toLowerCase().includes(m.toLowerCase()));

    // 2. Dynamic Loading
    const iframe = document.createElement('iframe');
    iframe.style.border = 'none';
    iframe.style.backgroundColor = 'transparent';
    if (wMatch && hMatch) {
        iframe.style.width = wMatch[1] + 'px';
        iframe.style.height = hMatch[1] + 'px';
    } else if (commonSizes) {
        const [w, h] = commonSizes[1].split('x');
        iframe.style.width = w + 'px';
        iframe.style.height = h + 'px';
    } else {
        iframe.style.width = '100%';
        iframe.style.minHeight = '250px';
    }
    
    // Sanitize protocol-relative URLs to ensure they work locally
    let sanitizedContent = tagContent.replace(/src=["']\/\//gi, 'src="https://');
    sanitizedContent = sanitizedContent.replace(/href=["']\/\//gi, 'href="https://');

    const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:0;padding:0;overflow:hidden;}</style></head><body>${sanitizedContent}</body></html>`;
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    
    // Set the iframe name to the cardId so the Chrome Debugger can map the frameId
    iframe.name = cardId;
    iframe.src = blobUrl;
    previewContainer.appendChild(iframe);

    // Wait 5 seconds for ad assets to fully load
    setTimeout(() => {
      
      // Try to infer dimensions from rendered DOM if statically unknown
      if (dimensions === "Unknown" || dimensions.includes("Parsed from text")) {
        try {
          let maxWidth = 0;
          let maxHeight = 0;
          const elements = iframe.contentDocument.querySelectorAll('*');
          elements.forEach(el => {
            if (el.tagName !== 'HTML' && el.tagName !== 'BODY' && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') {
              if (el.offsetWidth > maxWidth && el.offsetWidth < 1200) maxWidth = el.offsetWidth;
              if (el.offsetHeight > maxHeight && el.offsetHeight < 1200) maxHeight = el.offsetHeight;
            }
          });
          if (maxWidth > 0 && maxHeight > 0) {
            dimensions = `${maxWidth}x${maxHeight} (Inferred from DOM)`;
          }
        } catch(e) {}
      }

      const isValid = dimensions !== "Unknown" && (foundMacros.length > 0 || clickUrl !== "Not found");
      
      if (dimensions !== "Unknown") {
        const widthMatch = dimensions.match(/^(\d+)/);
        if (widthMatch && parseInt(widthMatch[1]) > 400) {
          const cardEl = document.getElementById(cardId);
          if (cardEl) cardEl.classList.add('card-wide');
        }
      }

      if (extensionActive) {
         weightResolvers[cardId] = (data) => {
            resolve({
              filename, dimensions, clickUrl,
              macros: foundMacros.length ? foundMacros.join(', ') : 'None',
              weight: data.size,
              requestCount: data.requests,
              exactWeight: true,
              status: isValid ? 'Valid' : 'Needs Review'
            });
         };
         window.postMessage({ type: 'GET_WEIGHT', id: cardId }, '*');
      } else {
         // Fallback tracking
         let totalBytes = 0;
         let requestCount = 0;
         try {
            const win = iframe.contentWindow;
            if (win && win.performance) {
              const entries = win.performance.getEntriesByType("resource");
              requestCount = entries.length;
              entries.forEach(entry => {
                if (entry.transferSize > 0) totalBytes += entry.transferSize;
                else if (entry.decodedBodySize > 0) totalBytes += entry.decodedBodySize;
              });
            }
         } catch(e) {}

         resolve({
            filename, dimensions, clickUrl,
            macros: foundMacros.length ? foundMacros.join(', ') : 'None',
            weight: totalBytes,
            requestCount,
            exactWeight: false,
            status: isValid ? 'Valid' : 'Needs Review'
         });
      }

    }, 5000); // 5 seconds loading window
  });
}
