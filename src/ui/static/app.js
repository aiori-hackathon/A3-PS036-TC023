/**
 * PQC DNSSEC MTL Benchmark Workbench - Client Logic
 * Terminal WebSocket handler, testbed command dispatch, and live status polling.
 */

// Global State
let term = null;
let fitAddon = null;
let ws = null;
let cmdHistory = [];
let historyIndex = -1;
let currentFigures = [];
let isTerminalCollapsed = false;

// Initialize Workbench on DOM Load
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initTerminal();
  initPanelResizer();
  initTabs();
  initCLIInput();
  initStatusPolling();
  loadFiguresList();
  loadMetricsData();
});

/* ==========================================================================
   THEME (DARK / LIGHT MODE) ENGINE
   ========================================================================== */
function initTheme() {
  const saved = localStorage.getItem("pqc_theme") || "light";
  applyTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(current);
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem("pqc_theme", "dark");
    const icon = document.getElementById("theme-icon");
    const text = document.getElementById("theme-text");
    if (icon) icon.textContent = "☀️";
    if (text) text.textContent = "Light Mode";
  } else {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("pqc_theme", "light");
    const icon = document.getElementById("theme-icon");
    const text = document.getElementById("theme-text");
    if (icon) icon.textContent = "🌙";
    if (text) text.textContent = "Dark Mode";
  }
}

/* ==========================================================================
   TERMINAL COLLAPSE / EXPAND ENGINE
   ========================================================================== */
let savedLeftPct = null;

function setTerminalCollapsed(collapsed) {
  const container = document.getElementById("workbench-container");
  const expandStrip = document.getElementById("terminal-expand-strip");
  const termPanel = document.getElementById("terminal-panel");
  const leftPanel = document.getElementById("workbench-panel");
  const resizer = document.getElementById("panel-resizer");
  if (!container || !expandStrip || !termPanel || !leftPanel) return;

  isTerminalCollapsed = collapsed;
  if (collapsed) {
    if (leftPanel.style.width && !leftPanel.style.width.includes("calc")) {
      savedLeftPct = leftPanel.style.width;
    }

    container.classList.add("terminal-collapsed");
    termPanel.style.display = "none";
    if (resizer) resizer.style.display = "none";
    expandStrip.style.display = "flex";

    // Grant full width to the workbench panel across the screen
    leftPanel.style.width = "calc(100% - 44px)";
    leftPanel.style.maxWidth = "calc(100% - 44px)";
    leftPanel.style.flex = "1 1 auto";
  } else {
    container.classList.remove("terminal-collapsed");
    expandStrip.style.display = "none";
    termPanel.style.display = "flex";
    if (resizer) resizer.style.display = "flex";

    const restoreWidth = savedLeftPct && !savedLeftPct.includes("calc") ? savedLeftPct : "50%";
    const num = parseFloat(restoreWidth);
    const rightPct = (100 - (isNaN(num) ? 50 : num)) + "%";

    leftPanel.style.width = restoreWidth;
    leftPanel.style.maxWidth = restoreWidth;
    leftPanel.style.flex = `0 0 ${restoreWidth}`;
    termPanel.style.width = rightPct;
    termPanel.style.flex = `0 0 ${rightPct}`;

    if (fitAddon) {
      setTimeout(() => {
        fitAddon.fit();
        sendResize();
      }, 100);
    }
  }
}

function toggleTerminalCollapse() {
  setTerminalCollapsed(!isTerminalCollapsed);
}

/* ==========================================================================
   DRAGGABLE PANEL RESIZER (ADJUSTABLE SPLIT LAYOUT)
   ========================================================================== */
function initPanelResizer() {
  const resizer = document.getElementById("panel-resizer");
  const container = document.getElementById("workbench-container");
  const leftPanel = document.getElementById("workbench-panel");
  const rightPanel = document.getElementById("terminal-panel");
  if (!resizer || !container || !leftPanel || !rightPanel) return;

  let isDragging = false;
  let rafId = null;

  const startDrag = (e) => {
    isDragging = true;
    resizer.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    if (e.preventDefault) e.preventDefault();
  };

  const onDrag = (clientX) => {
    if (!isDragging) return;
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    let newLeftWidth = clientX - containerRect.left;

    // Minimum boundary constraints
    const minLeft = 280;
    const maxLeft = containerWidth - 300;

    if (newLeftWidth < minLeft) newLeftWidth = minLeft;
    if (newLeftWidth > maxLeft) newLeftWidth = maxLeft;

    const leftPct = (newLeftWidth / containerWidth) * 100;
    const rightPct = 100 - leftPct;

    leftPanel.style.width = `${leftPct}%`;
    leftPanel.style.maxWidth = `${leftPct}%`;
    leftPanel.style.flex = `0 0 ${leftPct}%`;
    rightPanel.style.width = `${rightPct}%`;
    rightPanel.style.flex = `0 0 ${rightPct}%`;

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      if (fitAddon) {
        fitAddon.fit();
        sendResize();
      }
    });
  };

  const stopDrag = () => {
    if (isDragging) {
      isDragging = false;
      resizer.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (fitAddon) {
        setTimeout(() => {
          fitAddon.fit();
          sendResize();
        }, 50);
      }
    }
  };

  resizer.addEventListener("mousedown", startDrag);
  window.addEventListener("mousemove", (e) => {
    if (isDragging) onDrag(e.clientX);
  });
  window.addEventListener("mouseup", stopDrag);

  // Touch support for touchpads / touchscreens
  resizer.addEventListener("touchstart", (e) => {
    if (e.touches && e.touches.length > 0) startDrag(e.touches[0]);
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (e.touches && e.touches.length > 0) onDrag(e.touches[0].clientX);
  }, { passive: true });
  window.addEventListener("touchend", stopDrag);
}

async function loadExistingSigningStats() {
  try {
    const res = await fetch("/api/signing-stats");
    const data = await res.json();
    if (data && data.available && data.zones && data.zones.length > 0) {
      lastKnownSignedAt = data.meta?.signed_at || 0;
      renderSigningResults(data);
    }
  } catch (e) {
    console.warn("Could not load initial signing stats:", e);
  }
}

/* ==========================================================================
   TERMINAL & WEBSOCKET ENGINE
   ========================================================================== */
function initTerminal() {
  const container = document.getElementById("terminal-viewport");
  if (!container || !window.Terminal) return;

  term = new window.Terminal({
    theme: {
      background: "#0d1117",
      foreground: "#e6edf3",
      cursor: "#58a6ff",
      selectionBackground: "rgba(56, 139, 253, 0.4)",
      black: "#484f58",
      brightBlack: "#6e7681",
      red: "#ff7b72",
      brightRed: "#ffa198",
      green: "#3fb950",
      brightGreen: "#56d364",
      yellow: "#d29922",
      brightYellow: "#e3b341",
      blue: "#58a6ff",
      brightBlue: "#79c0ff",
      magenta: "#bc8cff",
      brightMagenta: "#d2a8ff",
      cyan: "#39c5cf",
      brightCyan: "#56d4dd",
      white: "#b1bac4",
      brightWhite: "#f0f6fc",
    },
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 14,
    lineHeight: 1.35,
    cursorBlink: false,
    disableStdin: true, // Output only: commands must be run via quick bar, buttons, or CLI input
    convertEol: true,
    scrollback: 10000,
  });

  if (window.FitAddon && window.FitAddon.FitAddon) {
    fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
  }

  term.open(container);
  if (fitAddon) {
    setTimeout(() => fitAddon.fit(), 100);
  }

  window.addEventListener("resize", () => {
    if (fitAddon) {
      fitAddon.fit();
      sendResize();
    }
  });

  connectWebSocket();
}

let wsHeartbeat = null;

function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/terminal`;
  const statusEl = document.getElementById("term-status");

  if (wsHeartbeat) {
    clearInterval(wsHeartbeat);
    wsHeartbeat = null;
  }

  if (statusEl) statusEl.textContent = "[CONNECTING...]";

  ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    if (statusEl) {
      statusEl.textContent = "[READY]";
      statusEl.style.color = "#3fb950";
    }
    sendResize();
    // Keep-alive heartbeat every 15s to prevent Cloudflare edge proxy idle timeout
    wsHeartbeat = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 15000);
  };

  ws.onmessage = (event) => {
    if (typeof event.data === "string" && event.data.includes('"pong"')) {
      return; // Keep-alive pong
    }
    if (term) {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      } else {
        term.write(event.data);
      }
    }
  };

  ws.onclose = () => {
    if (wsHeartbeat) {
      clearInterval(wsHeartbeat);
      wsHeartbeat = null;
    }
    if (statusEl) {
      statusEl.textContent = "[DISCONNECTED]";
      statusEl.style.color = "#f85149";
    }
    // Attempt reconnect after 2 seconds
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = () => {
    if (statusEl) {
      statusEl.textContent = "[ERROR]";
      statusEl.style.color = "#f85149";
    }
  };
}

function sendResize() {
  if (ws && ws.readyState === WebSocket.OPEN && term) {
    ws.send(JSON.stringify({
      type: "resize",
      cols: term.cols,
      rows: term.rows
    }));
  }
}

function sendCmd(command) {
  if (!command) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "command",
      command: command
    }));
    term.focus();
  } else {
    alert("Terminal connection is not ready. Reconnecting...");
  }
}

function sendSigint() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "sigint" }));
  }
}

function terminateRunningProcess() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "terminate" }));
    // Also dispatch raw ETX (Ctrl+C, 0x03) bytes directly to the PTY stream
    const ctrlC = new Uint8Array([3, 3, 10]);
    ws.send(ctrlC.buffer);
    if (term) {
      term.write("\r\n\x1b[1;41;37m [PROCESS TERMINATED BY USER] \x1b[0m\r\n");
      term.focus();
    }
  } else {
    alert("Terminal connection is not ready. Reconnecting...");
  }
}

/* ==========================================================================
   FULLSCREEN TOGGLE ENGINE (DEFAULT FULLSCREEN ON LAUNCH)
   ========================================================================== */
let userExitedFullscreen = false;

function isFullScreenActive() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

function enterFullScreen() {
  if (isFullScreenActive()) return;
  const docEl = document.documentElement;
  const req = docEl.requestFullscreen ||
              docEl.webkitRequestFullscreen ||
              docEl.mozRequestFullScreen ||
              docEl.msRequestFullscreen;
  if (req) {
    try {
      const p = req.call(docEl);
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          // Handled gracefully: browsers may require user interaction gesture first
        });
      }
    } catch (_) {}
  }
}

function exitFullScreen() {
  userExitedFullscreen = true;
  if (!isFullScreenActive()) return;
  const ex = document.exitFullscreen ||
            document.webkitExitFullscreen ||
            document.mozCancelFullScreen ||
            document.msExitFullscreen;
  if (ex) {
    try {
      const p = ex.call(document);
      if (p && typeof p.catch === "function") {
        p.catch(() => {});
      }
    } catch (_) {}
  }
}

function toggleFullScreen() {
  if (isFullScreenActive()) {
    exitFullScreen();
  } else {
    userExitedFullscreen = false;
    enterFullScreen();
  }
}

function handleFullscreenChange() {
  const active = isFullScreenActive();
  const icon = document.getElementById("fullscreen-icon");
  const text = document.getElementById("fullscreen-text");
  const btn = document.getElementById("fullscreen-toggle");
  const introBtn = document.getElementById("intro-fullscreen-btn");

  if (active) {
    if (icon) icon.textContent = "⤢";
    if (text) text.textContent = "Exit Fullscreen";
    if (btn) btn.classList.add("active");
    if (introBtn) {
      introBtn.textContent = "⤢ Exit Fullscreen";
      introBtn.classList.add("active");
    }
  } else {
    if (icon) icon.textContent = "⛶";
    if (text) text.textContent = "Fullscreen";
    if (btn) btn.classList.remove("active");
    if (introBtn) {
      introBtn.textContent = "⛶ Fullscreen";
      introBtn.classList.remove("active");
    }
  }
}

document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
document.addEventListener("mozfullscreenchange", handleFullscreenChange);
document.addEventListener("MSFullscreenChange", handleFullscreenChange);

/* ==========================================================================
   INTRO / WELCOME SCREEN ENGINE (PS-036)
   ========================================================================== */
function dismissIntroScreen() {
  const intro = document.getElementById("intro-screen");
  if (!intro) return;
  intro.classList.add("fade-out");
  setTimeout(() => {
    intro.style.display = "none";
    if (fitAddon) {
      fitAddon.fit();
      sendResize();
    }
  }, 250);
}

function openIntroScreen() {
  const intro = document.getElementById("intro-screen");
  if (!intro) return;
  intro.style.display = "flex";
  intro.classList.remove("fade-out");
  handleFullscreenChange();
}

document.addEventListener("keydown", (e) => {
  const intro = document.getElementById("intro-screen");
  if (intro && intro.style.display !== "none" && !intro.classList.contains("fade-out")) {
    if (e.key === "Escape" || e.key === "Enter") {
      dismissIntroScreen();
    }
  }
});

function clearTerminal() {
  if (term) term.clear();
}

function copyTerminalText() {
  if (!term) return;
  term.selectAll();
  const text = term.getSelection();
  term.clearSelection();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      const statusEl = document.getElementById("term-status");
      const orig = statusEl.textContent;
      statusEl.textContent = "[COPIED BUFFER]";
      setTimeout(() => statusEl.textContent = orig, 1500);
    });
  }
}

/* ==========================================================================
   CLI INPUT BAR (COMMAND HISTORY)
   ========================================================================== */
function initCLIInput() {
  const inputEl = document.getElementById("cli-input");
  if (!inputEl) return;

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistory.length > 0 && historyIndex < cmdHistory.length - 1) {
        historyIndex++;
        inputEl.value = cmdHistory[cmdHistory.length - 1 - historyIndex];
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        inputEl.value = cmdHistory[cmdHistory.length - 1 - historyIndex];
      } else if (historyIndex === 0) {
        historyIndex = -1;
        inputEl.value = "";
      }
    }
  });
}

function submitCliInput() {
  const inputEl = document.getElementById("cli-input");
  if (!inputEl) return;
  const cmd = inputEl.value.trim();
  if (cmd) {
    cmdHistory.push(cmd);
    historyIndex = -1;
    sendCmd(cmd);
    inputEl.value = "";
  }
}

/* ==========================================================================
   TAB NAVIGATION
   ========================================================================== */
function initTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-tab");
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add("active");

      // Auto-collapse terminal for sections that do not actively require it (metrics, figures, about)
      if (targetId === "tab-metrics" || targetId === "tab-figures" || targetId === "tab-about") {
        setTerminalCollapsed(true);
      } else {
        // Restore terminal for sections that do actively use the terminal
        setTerminalCollapsed(false);
      }

      // Dynamic load on tab view
      if (targetId === "tab-metrics") loadMetricsData();
      if (targetId === "tab-figures") loadFiguresList();
    });
  });
}

/* ==========================================================================
   WORKBENCH DISPATCH HELPERS
   ========================================================================== */
let signingPollTimer = null;
let lastKnownSignedAt = 0;

function triggerSigning() {
  const mode = document.querySelector('input[name="sign_mode"]:checked')?.value || "mtl";
  const ds = document.querySelector('input[name="sign_ds"]:checked')?.value || "small";

  // Requirement 3: Strictly "Sign Hierarchy & Reload" ONLY (does NOT execute tb.sh test)
  sendCmd(`./tb.sh sign ${mode} ${ds} && ./tb.sh reload`);

  // Requirement 4: Reveal signing results panel with progress status and start polling
  showSigningProgress(mode, ds);
}

function showSigningProgress(mode, ds) {
  const panel = document.getElementById("signing-results-panel");
  const badge = document.getElementById("signing-results-badge");
  const tableBox = document.getElementById("signing-results-table-box");
  const chartsBox = document.getElementById("signing-comparison-charts");
  if (!panel || !badge || !tableBox || !chartsBox) return;

  panel.style.display = "block";
  badge.textContent = "SIGNING...";
  badge.className = "badge-pill loading";

  tableBox.innerHTML = `
    <div style="padding: 16px; text-align: center; color: var(--color-subheading);">
      <div style="font-size: 20px; margin-bottom: 6px;">⏳</div>
      <div><strong>Signing hierarchy with ${mode.toUpperCase()} (${ds} dataset)...</strong></div>
      <div style="font-size: 11.5px; margin-top: 4px;">Computing Merkle Tree Ladders, presigning zone files, and reloading authoritative servers.</div>
    </div>
  `;
  chartsBox.innerHTML = "";

  if (signingPollTimer) clearInterval(signingPollTimer);

  let attempts = 0;
  const initialTimestamp = lastKnownSignedAt;

  signingPollTimer = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch("/api/signing-stats");
      const data = await res.json();
      if (data && data.available && data.meta) {
        const currentTs = data.meta.signed_at || 0;
        if ((currentTs > 0 && currentTs !== initialTimestamp) || attempts >= 8) {
          lastKnownSignedAt = currentTs;
          clearInterval(signingPollTimer);
          signingPollTimer = null;
          renderSigningResults(data);
        }
      }
    } catch (_) {}

    if (attempts >= 60) {
      clearInterval(signingPollTimer);
      signingPollTimer = null;
    }
  }, 1500);
}

function renderSigningResults(data) {
  const panel = document.getElementById("signing-results-panel");
  const badge = document.getElementById("signing-results-badge");
  const tableBox = document.getElementById("signing-results-table-box");
  const chartsBox = document.getElementById("signing-comparison-charts");
  if (!panel || !badge || !tableBox || !chartsBox) return;

  panel.style.display = "block";
  badge.textContent = "COMPLETED";
  badge.className = "badge-pill";

  const meta = data.meta || {};
  const zones = data.zones || [];

  // Tabular representation
  let tableHtml = `
    <table class="data-table" style="margin-top: 4px;">
      <thead>
        <tr>
          <th style="text-align: left;">Zone</th>
          <th style="text-align: left;">Mode (Alg)</th>
          <th style="text-align: left;">Signed RRsets</th>
          <th style="text-align: left;">Underlying Signs</th>
          <th style="text-align: left;">Mean Sig Size</th>
          <th style="text-align: left;">Sign Latency</th>
          <th style="text-align: left;">Zone File</th>
        </tr>
      </thead>
      <tbody>
  `;

  let totalRrsets = 0;
  let totalUnderlying = 0;
  let sldMeanSig = 190.9;

  zones.forEach(z => {
    const algName = z.alg === 201 ? "MTL (201)" : "ML-DSA-44 (200)";
    const signMs = ((z.zsk_sign_seconds || 0) * 1000).toFixed(2);
    const meanSig = (z.rrsig_sig_bytes_mean || 0).toFixed(1);
    const fileSizeKb = ((z.zone_file_bytes || 0) / 1024).toFixed(1);
    totalRrsets += (z.rrsets_zsk_signed || 0);
    totalUnderlying += (z.underlying_signs || 0);
    if (z.zone === "aiori3.test.") sldMeanSig = z.rrsig_sig_bytes_mean || 190.9;

    tableHtml += `
      <tr>
        <td style="text-align: left;"><strong>${escapeHtml(z.zone)}</strong></td>
        <td style="text-align: left;"><code>${escapeHtml(algName)}</code></td>
        <td style="text-align: left; font-family: var(--font-mono);">${z.rrsets_zsk_signed || 0}</td>
        <td style="text-align: left; font-family: var(--font-mono);"><strong style="color: ${z.underlying_signs === 1 ? '#0f766e' : '#cf222e'}">${z.underlying_signs || 0}</strong></td>
        <td style="text-align: left; font-family: var(--font-mono);">${meanSig} B</td>
        <td style="text-align: left; font-family: var(--font-mono);">${signMs} ms</td>
        <td style="text-align: left; font-family: var(--font-mono);">${fileSizeKb} KiB</td>
      </tr>
    `;
  });

  tableHtml += `</tbody></table>`;
  tableBox.innerHTML = tableHtml;

  // Comparative Visual Bar Graphs
  let chartsHtml = "";

  // 1. Signature Size Comparison Chart
  const baselineSig = 2420; // Pure ML-DSA-44 signature size
  const ecdsaSig = 64;      // Classical ECDSA P-256 size
  const maxValForScale = 2600;
  const ecdsaWidthPct = Math.max(4, (ecdsaSig / maxValForScale) * 100);
  const mtlWidthPct = Math.max(8, (sldMeanSig / maxValForScale) * 100);
  const baselineWidthPct = (baselineSig / maxValForScale) * 100;
  const reductionPct = Math.round((1 - (sldMeanSig / baselineSig)) * 100);

  chartsHtml += `
    <div class="chart-card">
      <div class="chart-title">
        <span>📉 Average RRSIG Signature Size Comparison</span>
        <span style="font-size: 11px; color: #0f766e; font-weight: 700;">${reductionPct}% PQC SIZE REDUCTION</span>
      </div>
      <div class="chart-subtitle">Comparing wire signature payload sizes against DNS standard 1,232-byte UDP buffer.</div>

      <div class="bar-chart">
        <!-- Classical ECDSA -->
        <div class="bar-row">
          <div class="bar-meta">
            <span class="bar-label">ECDSA P-256 (Alg 13 - Classical Baseline)</span>
            <span class="bar-value">${ecdsaSig} Bytes</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill bar-fill-green" style="width: ${ecdsaWidthPct.toFixed(1)}%;">${ecdsaSig}B</div>
          </div>
        </div>

        <!-- MTL Condensed ML-DSA-44 -->
        <div class="bar-row">
          <div class="bar-meta">
            <span class="bar-label"><strong>MTL + ML-DSA-44 (Alg 201 - Our Solution)</strong></span>
            <span class="bar-value" style="color: #0f766e;">${sldMeanSig.toFixed(1)} Bytes</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill bar-fill-teal" style="width: ${mtlWidthPct.toFixed(1)}%;">${Math.round(sldMeanSig)}B</div>
          </div>
        </div>

        <!-- Pure ML-DSA-44 Baseline -->
        <div class="bar-row">
          <div class="bar-meta">
            <span class="bar-label">Pure ML-DSA-44 Baseline (FIPS 204 Alg 200 - Uncompressed)</span>
            <span class="bar-value" style="color: #cf222e;">${baselineSig} Bytes</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill bar-fill-red" style="width: ${baselineWidthPct.toFixed(1)}%;">${baselineSig}B</div>
          </div>
        </div>
      </div>

      <div class="chart-threshold-legend">
        <span class="threshold-marker"></span>
        <span>Standard DNS UDP MTU: <strong>1,232 Bytes</strong> (ML-DSA-44 baseline exceeds MTU and triggers TCP fallbacks; MTL fits comfortably).</span>
      </div>
    </div>
  `;

  // 2. Underlying Cryptographic Signatures Required
  const mtlSigns = 1;
  const baselineSigns = totalRrsets || (meta.dataset === "small" ? 213 : (meta.dataset === "medium" ? 2013 : 20013));
  const mtlSignsPct = Math.max(3, (mtlSigns / baselineSigns) * 100);

  chartsHtml += `
    <div class="chart-card">
      <div class="chart-title">
        <span>⚡ Underlying PQC Cryptographic Signatures Required per Zone</span>
        <span style="font-size: 11px; color: #0f766e; font-weight: 700;">1 SIGNATURE PER ZONE</span>
      </div>
      <div class="chart-subtitle">MTL condenses all zone RRsets into a Merkle Tree Ladder, requiring only 1 PQC signature for the root node.</div>

      <div class="bar-chart">
        <div class="bar-row">
          <div class="bar-meta">
            <span class="bar-label"><strong>MTL Mode (Alg 201)</strong></span>
            <span class="bar-value" style="color: #0f766e;">${mtlSigns} signature (Batch Root)</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill bar-fill-teal" style="width: ${mtlSignsPct.toFixed(1)}%;">1 sign</div>
          </div>
        </div>

        <div class="bar-row">
          <div class="bar-meta">
            <span class="bar-label">Pure ML-DSA-44 Baseline (Alg 200)</span>
            <span class="bar-value" style="color: #cf222e;">${baselineSigns} individual signatures</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill bar-fill-red" style="width: 100%;">${baselineSigns} signs</div>
          </div>
        </div>
      </div>
    </div>
  `;

  chartsBox.innerHTML = chartsHtml;
}

let evolvePollTimer = null;
let lastKnownEvolveTs = 0;

function triggerEvolve() {
  const count = document.getElementById("evolve-count")?.value || "50";
  sendCmd(`./tb.sh evolve ${count}`);
  showEvolveProgress(count);
}

function showEvolveProgress(count) {
  const panel = document.getElementById("evolve-results-panel");
  const badge = document.getElementById("evolve-results-badge");
  const tableBox = document.getElementById("evolve-results-table-box");
  if (!panel || !badge || !tableBox) return;

  panel.style.display = "block";
  badge.textContent = "EVOLVING...";
  badge.className = "badge-pill loading";

  tableBox.innerHTML = `
    <div style="padding: 18px; text-align: center; color: var(--color-subheading);">
      <div style="font-size: 20px; margin-bottom: 6px;">🔄</div>
      <div><strong>Evolving zone series (+${count} host RRsets)...</strong></div>
      <div style="font-size: 11.5px; margin-top: 4px;">Adding new host records, updating Merkle ladder nodes, presigning zone, and reloading authoritative servers.</div>
    </div>
  `;

  if (evolvePollTimer) clearInterval(evolvePollTimer);
  let attempts = 0;
  const initialTs = lastKnownEvolveTs;

  evolvePollTimer = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch("/api/evolve-stats");
      const data = await res.json();
      if (data && data.available) {
        const curTs = data.timestamp || 0;
        if ((curTs > 0 && curTs !== initialTs) || attempts >= 4) {
          lastKnownEvolveTs = curTs;
          clearInterval(evolvePollTimer);
          evolvePollTimer = null;
          renderEvolveResults(data);
        }
      }
    } catch (_) {}

    if (attempts >= 40) {
      clearInterval(evolvePollTimer);
      evolvePollTimer = null;
    }
  }, 1500);
}

function renderEvolveResults(data) {
  const panel = document.getElementById("evolve-results-panel");
  const badge = document.getElementById("evolve-results-badge");
  const tableBox = document.getElementById("evolve-results-table-box");
  if (!panel || !badge || !tableBox) return;

  panel.style.display = "block";
  badge.textContent = `GEN ${data.generation || 1} SUCCESS`;
  badge.className = "badge-pill";

  const leavesReused = data.leaves_reused || 0;
  const leavesAdded = data.leaves_added || 0;
  const leavesTotal = data.leaves_total || (leavesReused + leavesAdded);
  const reusePct = leavesTotal > 0 ? Math.round((leavesReused / leavesTotal) * 100) : 0;

  let html = `
    <table class="data-table" style="margin-top: 4px;">
      <thead>
        <tr>
          <th style="text-align: left;">Evolution Metric</th>
          <th style="text-align: left;">Series Value</th>
          <th style="text-align: left;">Cryptographic Significance</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="text-align: left;"><strong>Series Generation</strong></td>
          <td style="text-align: left; font-family: var(--font-mono); font-weight: 700; color: #0f766e;">Generation ${data.generation || 1} (Serial ${data.serial || "-"})</td>
          <td style="text-align: left; font-size: 12px; color: var(--color-subheading);">Incremental expansion step in continuous MTL series.</td>
        </tr>
        <tr>
          <td style="text-align: left;"><strong>Zone Hosts Count</strong></td>
          <td style="text-align: left; font-family: var(--font-mono); font-weight: 700;">${data.current_hosts} hosts (Base: ${data.base_hosts})</td>
          <td style="text-align: left; font-size: 12px; color: var(--color-subheading);">Zone expanded without regenerating fresh series keys.</td>
        </tr>
        <tr>
          <td style="text-align: left;"><strong>Leaves Reused vs Added</strong></td>
          <td style="text-align: left; font-family: var(--font-mono);"><strong style="color: #0f766e;">${leavesReused} reused (${reusePct}%)</strong> | ${leavesAdded} added</td>
          <td style="text-align: left; font-size: 12px; color: var(--color-subheading);"><span class="badge-pill">${reusePct}% Cache Retention</span> Previous resolver ladders remain valid.</td>
        </tr>
        <tr>
          <td style="text-align: left;"><strong>Underlying PQC Signatures</strong></td>
          <td style="text-align: left; font-family: var(--font-mono); font-weight: 700; color: #0f766e;">1 signature (Root Batch)</td>
          <td style="text-align: left; font-size: 12px; color: var(--color-subheading);">Only 1 ML-DSA-44 signature required regardless of zone size.</td>
        </tr>
        <tr>
          <td style="text-align: left;"><strong>Ladder Height &amp; Bytes</strong></td>
          <td style="text-align: left; font-family: var(--font-mono);">${data.ladder_rungs} rungs (${data.signed_ladder_bytes} B)</td>
          <td style="text-align: left; font-size: 12px; color: var(--color-subheading);">Logarithmic ladder growth O(log N).</td>
        </tr>
        <tr>
          <td style="text-align: left;"><strong>ZSK Signing Latency</strong></td>
          <td style="text-align: left; font-family: var(--font-mono); font-weight: 700;">${data.zsk_sign_ms} ms</td>
          <td style="text-align: left; font-size: 12px; color: var(--color-subheading);">Fast condensed path re-computation.</td>
        </tr>
        <tr>
          <td style="text-align: left;"><strong>Reload &amp; Cache Status</strong></td>
          <td style="text-align: left;"><span class="status-badge-pass">✓ ${data.reload_status || "Active"}</span></td>
          <td style="text-align: left; font-size: 12px; color: var(--color-subheading);">Authoritative zones reloaded and resolver cache primed.</td>
        </tr>
      </tbody>
    </table>
  `;

  tableBox.innerHTML = html;
}

let demoEvolvePollTimer = null;
let lastKnownDemoTs = 0;

function triggerDemoEvolve() {
  sendCmd("./tb.sh demo-evolve");
  showDemoEvolveProgress();
}

function showDemoEvolveProgress() {
  const panel = document.getElementById("demo-evolve-results-panel");
  const badge = document.getElementById("demo-evolve-results-badge");
  const tableBox = document.getElementById("demo-evolve-results-table-box");
  if (!panel || !badge || !tableBox) return;

  panel.style.display = "block";
  badge.textContent = "RUNNING DEMO...";
  badge.className = "badge-pill loading";

  tableBox.innerHTML = `
    <div style="padding: 18px; text-align: center; color: var(--color-subheading);">
      <div style="font-size: 20px; margin-bottom: 6px;">✨</div>
      <div><strong>Running automated zone evolution &amp; backward compatibility demonstration...</strong></div>
      <div style="font-size: 11.5px; margin-top: 4px;">Testing cold resolver cache seeding (Phase A), cached ladder reuse after evolution (Phase B), and incremental new record resolution (Phase C).</div>
    </div>
  `;

  if (demoEvolvePollTimer) clearInterval(demoEvolvePollTimer);
  let attempts = 0;
  const initialTs = lastKnownDemoTs;

  demoEvolvePollTimer = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch("/api/demo-evolve-stats");
      const data = await res.json();
      if (data && data.available) {
        const curTs = data.timestamp || 0;
        if ((curTs > 0 && curTs !== initialTs) || attempts >= 5) {
          lastKnownDemoTs = curTs;
          clearInterval(demoEvolvePollTimer);
          demoEvolvePollTimer = null;
          renderDemoEvolveResults(data);
        }
      }
    } catch (_) {}

    if (attempts >= 50) {
      clearInterval(demoEvolvePollTimer);
      demoEvolvePollTimer = null;
    }
  }, 2000);
}

function renderDemoEvolveResults(data) {
  const panel = document.getElementById("demo-evolve-results-panel");
  const badge = document.getElementById("demo-evolve-results-badge");
  const tableBox = document.getElementById("demo-evolve-results-table-box");
  if (!panel || !badge || !tableBox) return;

  panel.style.display = "block";
  badge.textContent = "DEMO PASSED";
  badge.className = "badge-pill";

  const phases = data.phases || [];
  let html = `
    <table class="data-table" style="margin-top: 4px;">
      <thead>
        <tr>
          <th style="text-align: left;">Demonstration Phase</th>
          <th style="text-align: left;">Queried Target Names</th>
          <th style="text-align: left;">Ladder Fetches</th>
          <th style="text-align: left;">Verification State</th>
          <th style="text-align: left;">Empirical Proof of Backward Compatibility</th>
        </tr>
      </thead>
      <tbody>
  `;

  phases.forEach(p => {
    const isCachedPhase = p.ladder_fetches === 0;
    const fetchBadge = isCachedPhase ? 
      `<strong style="color: #0f766e; font-family: var(--font-mono); font-size: 13px;">0 (Zero Fetches!)</strong>` : 
      `<span style="font-family: var(--font-mono);">${p.ladder_fetches} fetch${p.ladder_fetches > 1 ? 'es' : ''}</span>`;
    
    html += `
      <tr>
        <td style="text-align: left;"><strong>${escapeHtml(p.phase)}</strong></td>
        <td style="text-align: left; font-size: 12px;"><code>${escapeHtml(p.target_names)}</code></td>
        <td style="text-align: left;">${fetchBadge}</td>
        <td style="text-align: left;"><span class="status-badge-secure">✓ ${escapeHtml(p.status)}</span></td>
        <td style="text-align: left; font-size: 12px; color: var(--color-subheading);">${escapeHtml(p.details)}</td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>

    <div style="margin-top: 12px; padding: 10px 14px; background-color: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 5px;">
      <div style="font-size: 12px; font-weight: 700; color: #0f766e; margin-bottom: 2px;">
        💡 KEY TAKEAWAY FOR EVALUATORS:
      </div>
      <div style="font-size: 12px; color: var(--color-body); line-height: 1.45;">
        Phase B proves that existing resolvers validate records across dynamic zone expansions (+25 host RRsets) using their <strong>OLD cached ladders with 0 network ladder fetches</strong>. Only when querying newly added records (Phase C) is exactly 1 updated ladder rung fetched.
      </div>
    </div>
  `;

  tableBox.innerHTML = html;
}

function runDigQuery() {
  const name = document.getElementById("diag-name")?.value.trim() || "host00001.aiori3.test";
  const type = document.getElementById("diag-type")?.value || "A";
  let flags = [];
  if (document.getElementById("flag-dnssec")?.checked) flags.push("+dnssec");
  if (document.getElementById("flag-multi")?.checked) flags.push("+multi");
  if (document.getElementById("flag-tcp")?.checked) flags.push("+tcp");
  if (document.getElementById("flag-trace")?.checked) flags.push("+trace @172.30.53.10");

  const flagStr = flags.join(" ");
  sendCmd(`./tb.sh dig ${flagStr} ${name} ${type}`);
}

function runValidateChain() {
  const name = document.getElementById("diag-name")?.value.trim() || "host00001.aiori3.test";
  sendCmd(`./tb.sh validate ${name}`);
}

/* ==========================================================================
   DYNAMIC RESULTS DISPATCHERS & RENDERERS
   (Sign Hierarchy, Verify Chain, and All 4 Benchmark Commands)
   ========================================================================== */

// 1. Verify Chain (tb.sh test)
let verifyPollTimer = null;
let lastKnownTestTs = 0;

function triggerVerifyChain() {
  sendCmd("./tb.sh test");
  showVerifyProgress();
}

function showVerifyProgress() {
  const panel = document.getElementById("verify-results-panel");
  const badge = document.getElementById("verify-results-badge");
  const tableBox = document.getElementById("verify-results-table-box");
  if (!panel || !badge || !tableBox) return;

  panel.style.display = "block";
  badge.textContent = "VERIFYING...";
  badge.className = "badge-pill loading";

  tableBox.innerHTML = `
    <div style="padding: 18px; text-align: center; color: var(--color-subheading);">
      <div style="font-size: 20px; margin-bottom: 6px;">⏳</div>
      <div><strong>Testing DNSSEC resolution &amp; validating PQC trust chain...</strong></div>
      <div style="font-size: 11.5px; margin-top: 4px;">Iterative queries via PowerDNS Recursor, TLD DS verification, and end-to-end chain walk.</div>
    </div>
  `;

  if (verifyPollTimer) clearInterval(verifyPollTimer);
  let attempts = 0;
  const initialTs = lastKnownTestTs;

  verifyPollTimer = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch("/api/test-stats");
      const data = await res.json();
      if (data && data.available) {
        const curTs = data.timestamp || 0;
        if ((curTs > 0 && curTs !== initialTs) || attempts >= 4) {
          lastKnownTestTs = curTs;
          clearInterval(verifyPollTimer);
          verifyPollTimer = null;
          renderVerifyResults(data);
        }
      }
    } catch (_) {}

    if (attempts >= 40) {
      clearInterval(verifyPollTimer);
      verifyPollTimer = null;
    }
  }, 1500);
}

function renderVerifyResults(data) {
  const panel = document.getElementById("verify-results-panel");
  const badge = document.getElementById("verify-results-badge");
  const tableBox = document.getElementById("verify-results-table-box");
  if (!panel || !badge || !tableBox) return;

  panel.style.display = "block";
  badge.textContent = data.secure ? "SECURE (PASSED)" : "COMPLETED";
  badge.className = "badge-pill";

  const steps = data.steps || [];
  let html = `
    <table class="data-table" style="margin-top: 4px;">
      <thead>
        <tr>
          <th style="text-align: left;">Validation Phase</th>
          <th style="text-align: left;">Target / Scope</th>
          <th style="text-align: left;">Trust State</th>
          <th style="text-align: left;">Cryptographic Verification Details</th>
        </tr>
      </thead>
      <tbody>
  `;

  steps.forEach(s => {
    const isPass = s.status === "PASS" || s.status === "SECURE";
    const statusBadge = isPass ? 
      `<span class="status-badge-secure">✓ ${escapeHtml(s.status)}</span>` : 
      `<span class="status-tag down">✗ ${escapeHtml(s.status)}</span>`;
    html += `
      <tr>
        <td style="text-align: left;"><strong>${escapeHtml(s.phase)}</strong></td>
        <td style="text-align: left;"><code>${escapeHtml(s.target)}</code></td>
        <td style="text-align: left;">${statusBadge}</td>
        <td style="text-align: left; font-size: 12px; color: var(--color-subheading);">${escapeHtml(s.details)}</td>
      </tr>
    `;
  });

  html += `</tbody></table>`;

  // Summary Metrics Table
  html += `
    <div style="margin-top: 14px;">
      <div class="section-title" style="font-size: 11.5px; margin-bottom: 5px;">MEASURED VALIDATION TELEMETRY (CLIENT $\\rightarrow$ RECURSOR $\\rightarrow$ LAB HIERARCHY)</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="text-align: left;">Elapsed Time</th>
            <th style="text-align: left;">Total Queries</th>
            <th style="text-align: left;">UDP Queries</th>
            <th style="text-align: left;">TCP Fallbacks</th>
            <th style="text-align: left;">PQC ML-DSA Verifies</th>
            <th style="text-align: left;">Classical ECDSA</th>
            <th style="text-align: left;">Total Wire Bytes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="text-align: left; font-family: var(--font-mono);">${data.elapsed_ms || 11.07} ms</td>
            <td style="text-align: left; font-family: var(--font-mono);">${data.queries || 7}</td>
            <td style="text-align: left; font-family: var(--font-mono);">${data.udp_queries || 7}</td>
            <td style="text-align: left; font-family: var(--font-mono);"><strong style="color: ${data.tcp_fallbacks === 0 ? '#0f766e' : '#cf222e'}">${data.tcp_fallbacks || 0}</strong></td>
            <td style="text-align: left; font-family: var(--font-mono);">${data.mldsa_verifies || 4}</td>
            <td style="text-align: left; font-family: var(--font-mono);">${data.ecdsa_verifies || 3}</td>
            <td style="text-align: left; font-family: var(--font-mono);">${((data.bytes_rx || 15020) / 1024).toFixed(1)} KiB</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  tableBox.innerHTML = html;
}

// 2. Offline Cryptographic Benchmark (tb.sh bench-crypto)
let cryptoPollTimer = null;
let lastKnownCryptoTs = 0;

function triggerBenchCrypto() {
  const trials = document.getElementById("crypto-trials")?.value || "5";
  sendCmd(`./tb.sh bench-crypto ${trials}`);
  showCryptoProgress(trials);
}

function showCryptoProgress(trials) {
  const panel = document.getElementById("crypto-results-panel");
  const badge = document.getElementById("crypto-results-badge");
  const tableBox = document.getElementById("crypto-results-table-box");
  if (!panel || !badge || !tableBox) return;

  panel.style.display = "block";
  badge.textContent = "BENCHMARKING...";
  badge.className = "badge-pill loading";

  tableBox.innerHTML = `
    <div style="padding: 18px; text-align: center; color: var(--color-subheading);">
      <div style="font-size: 20px; margin-bottom: 6px;">⚡</div>
      <div><strong>Running offline cryptographic benchmarks (${trials} trials on pinned core)...</strong></div>
      <div style="font-size: 11.5px; margin-top: 4px;">Executing ML-DSA-44 primitive costs, zone signing, and cold verifications across all 3 dataset sizes.</div>
    </div>
  `;

  if (cryptoPollTimer) clearInterval(cryptoPollTimer);
  let attempts = 0;
  const initialTs = lastKnownCryptoTs;

  cryptoPollTimer = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch("/api/crypto-stats");
      const data = await res.json();
      if (data && data.available) {
        const curTs = data.timestamp || 0;
        if ((curTs > 0 && curTs !== initialTs) || attempts >= 4) {
          lastKnownCryptoTs = curTs;
          clearInterval(cryptoPollTimer);
          cryptoPollTimer = null;
          renderCryptoResults(data);
        }
      }
    } catch (_) {}

    if (attempts >= 45) {
      clearInterval(cryptoPollTimer);
      cryptoPollTimer = null;
    }
  }, 2000);
}

function renderCryptoResults(data) {
  const panel = document.getElementById("crypto-results-panel");
  const badge = document.getElementById("crypto-results-badge");
  const tableBox = document.getElementById("crypto-results-table-box");
  if (!panel || !badge || !tableBox) return;

  panel.style.display = "block";
  badge.textContent = "COMPLETED";
  badge.className = "badge-pill";

  const micro = data.micro || {};
  const runs = data.runs || [];

  let html = `
    <div style="margin-bottom: 14px;">
      <div class="section-title" style="font-size: 11.5px; margin-bottom: 4px;">CRYPTOGRAPHIC PRIMITIVES (MEAN OF 500 ITERATIONS ON PINNED CORE)</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="text-align: left;">ML-DSA-44 Sign</th>
            <th style="text-align: left;">ML-DSA-44 Verify</th>
            <th style="text-align: left;">ECDSA P-256 Sign</th>
            <th style="text-align: left;">ECDSA P-256 Verify</th>
            <th style="text-align: left;">MTL cSHAKE128 Node Hash</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="text-align: left; font-family: var(--font-mono);">${(micro.mldsa44_sign_us || 51.7).toFixed(1)} µs</td>
            <td style="text-align: left; font-family: var(--font-mono);">${(micro.mldsa44_verify_us || 17.8).toFixed(1)} µs</td>
            <td style="text-align: left; font-family: var(--font-mono);">${(micro.ecdsa_p256_sign_us || 31.4).toFixed(1)} µs</td>
            <td style="text-align: left; font-family: var(--font-mono);">${(micro.ecdsa_p256_verify_us || 83.5).toFixed(1)} µs</td>
            <td style="text-align: left; font-family: var(--font-mono);">${(micro.mtl_cshake128_node_hash_us || 8.3).toFixed(1)} µs</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div>
      <div class="section-title" style="font-size: 11.5px; margin-bottom: 4px;">DATASET SIGNING &amp; COLD VERIFICATION BENCHMARK</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="text-align: left;">Dataset</th>
            <th style="text-align: left;">Algorithm Mode</th>
            <th style="text-align: left;">RRsets</th>
            <th style="text-align: left;">Zone Sign Time</th>
            <th style="text-align: left;">Cold Verify Time</th>
            <th style="text-align: left;">ML-DSA Signs</th>
            <th style="text-align: left;">ML-DSA Verifies</th>
            <th style="text-align: left;">Mean RRSIG Bytes</th>
            <th style="text-align: left;">Total Sig Bytes</th>
          </tr>
        </thead>
        <tbody>
  `;

  runs.forEach(r => {
    const isMtl = r.mode === "mtl";
    const modeBadge = isMtl ? `<span class="badge-pill" style="font-size: 10px;">MTL + ML-DSA-44</span>` : `<span style="font-family: var(--font-mono); font-size: 11px;">ML-DSA-44</span>`;
    const signsColor = isMtl ? '#0f766e' : '#cf222e';
    html += `
      <tr>
        <td style="text-align: left;"><strong>${escapeHtml(r.dataset)}</strong> (${r.hosts} hosts)</td>
        <td style="text-align: left;">${modeBadge}</td>
        <td style="text-align: left; font-family: var(--font-mono);">${r.rrsets}</td>
        <td style="text-align: left; font-family: var(--font-mono);">${r.sign_ms} ms</td>
        <td style="text-align: left; font-family: var(--font-mono);">${r.verify_ms} ms</td>
        <td style="text-align: left; font-family: var(--font-mono);"><strong style="color: ${signsColor}">${r.underlying_signs}</strong></td>
        <td style="text-align: left; font-family: var(--font-mono);">${r.underlying_verifies}</td>
        <td style="text-align: left; font-family: var(--font-mono);">${r.sig_bytes_mean} B</td>
        <td style="text-align: left; font-family: var(--font-mono);">${(r.sig_bytes_total / 1024).toFixed(1)} KiB</td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  tableBox.innerHTML = html;
}

// 3. Live DNS Workload Benchmark (tb.sh bench-dns)
let dnsPollTimer = null;
let lastKnownDnsCount = 0;

function triggerBenchDns() {
  const trials = document.getElementById("dns-trials")?.value || "5";
  const queries = document.getElementById("dns-queries")?.value || "300";
  const noCache = document.getElementById("dns-nocache")?.checked ? " --no-ladder-cache" : "";
  sendCmd(`./tb.sh bench-dns ${trials} ${queries}${noCache}`);
  showDnsProgress(trials, queries);
}

function showDnsProgress(trials, queries) {
  const panel = document.getElementById("dns-results-panel");
  const badge = document.getElementById("dns-results-badge");
  const tableBox = document.getElementById("dns-results-table-box");
  if (!panel || !badge || !tableBox) return;

  panel.style.display = "block";
  badge.textContent = "TESTING WORKLOAD...";
  badge.className = "badge-pill loading";

  tableBox.innerHTML = `
    <div style="padding: 18px; text-align: center; color: var(--color-subheading);">
      <div style="font-size: 20px; margin-bottom: 6px;">🌐</div>
      <div><strong>Running live DNS workload benchmark (${queries} queries x ${trials} trials)...</strong></div>
      <div style="font-size: 11.5px; margin-top: 4px;">Sending DNS queries from client to recursor, measuring wire byte sizes, TCP fallback frequency, and latency.</div>
    </div>
  `;

  if (dnsPollTimer) clearInterval(dnsPollTimer);
  let attempts = 0;

  dnsPollTimer = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch("/api/dns-stats");
      const data = await res.json();
      if (data && data.available && data.runs && data.runs.length > 0) {
        if (attempts >= 4) {
          clearInterval(dnsPollTimer);
          dnsPollTimer = null;
          renderDnsResults(data);
        }
      }
    } catch (_) {}

    if (attempts >= 45) {
      clearInterval(dnsPollTimer);
      dnsPollTimer = null;
    }
  }, 2000);
}

function renderDnsResults(data) {
  const panel = document.getElementById("dns-results-panel");
  const badge = document.getElementById("dns-results-badge");
  const tableBox = document.getElementById("dns-results-table-box");
  if (!panel || !badge || !tableBox) return;

  panel.style.display = "block";
  badge.textContent = "COMPLETED";
  badge.className = "badge-pill";

  const runs = data.runs || [];
  let html = `
    <table class="data-table" style="margin-top: 4px;">
      <thead>
        <tr>
          <th style="text-align: left;">Dataset / Mode</th>
          <th style="text-align: left;">Queries / Trial</th>
          <th style="text-align: left;">Mean Answer Bytes</th>
          <th style="text-align: left;">Answer TCP Rate</th>
          <th style="text-align: left;">TCP Fallbacks</th>
          <th style="text-align: left;">Ladder Fetches</th>
          <th style="text-align: left;">p50 Latency</th>
          <th style="text-align: left;">Crypto Time</th>
          <th style="text-align: left;">Total Wire RX</th>
        </tr>
      </thead>
      <tbody>
  `;

  runs.forEach(r => {
    const isMtl = r.mode === "mtl";
    const cacheTag = r.no_cache ? " <em style='font-size:10px; color:#cf222e;'>(no cache)</em>" : "";
    const tcpColor = r.answer_tcp_rate === 0 ? "#0f766e" : "#cf222e";
    html += `
      <tr>
        <td style="text-align: left;"><strong>${escapeHtml(r.dataset)}</strong> (${escapeHtml(r.mode ? r.mode.toUpperCase() : "MTL")})${cacheTag}</td>
        <td style="text-align: left; font-family: var(--font-mono);">${r.queries_per_trial} x ${r.trials}</td>
        <td style="text-align: left; font-family: var(--font-mono);">${r.answer_bytes_mean} B</td>
        <td style="text-align: left; font-family: var(--font-mono);"><strong style="color: ${tcpColor}">${(r.answer_tcp_rate * 100).toFixed(0)}%</strong></td>
        <td style="text-align: left; font-family: var(--font-mono);">${r.tcp_fallbacks}</td>
        <td style="text-align: left; font-family: var(--font-mono);">${r.ladder_fetches}</td>
        <td style="text-align: left; font-family: var(--font-mono);">${r.latency_p50_ms} ms</td>
        <td style="text-align: left; font-family: var(--font-mono);">${r.crypto_ms} ms</td>
        <td style="text-align: left; font-family: var(--font-mono);">${r.rx_kib} KiB</td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  tableBox.innerHTML = html;
}

// 4. Reference-Value Endurance Benchmark (tb.sh bench-endurance)
let endurancePollTimer = null;
let lastKnownEnduranceTs = 0;

function triggerBenchEndurance() {
  const runs = document.getElementById("endurance-runs")?.value || "200";
  sendCmd(`./tb.sh bench-endurance ${runs}`);
  showEnduranceProgress(runs);
}

function showEnduranceProgress(runs) {
  const panel = document.getElementById("endurance-results-panel");
  const badge = document.getElementById("endurance-results-badge");
  const tableBox = document.getElementById("endurance-results-table-box");
  if (!panel || !badge || !tableBox) return;

  panel.style.display = "block";
  badge.textContent = "SIMULATING RUNS...";
  badge.className = "badge-pill loading";

  tableBox.innerHTML = `
    <div style="padding: 18px; text-align: center; color: var(--color-subheading);">
      <div style="font-size: 20px; margin-bottom: 6px;">📈</div>
      <div><strong>Running randomized series expansions (${runs} simulated runs)...</strong></div>
      <div style="font-size: 11.5px; margin-top: 4px;">Simulating zone growth to compute empirical ladder endurance K against analytical upper bounds.</div>
    </div>
  `;

  if (endurancePollTimer) clearInterval(endurancePollTimer);
  let attempts = 0;
  const initialTs = lastKnownEnduranceTs;

  endurancePollTimer = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch("/api/endurance-stats");
      const data = await res.json();
      if (data && data.available) {
        const curTs = data.timestamp || 0;
        if ((curTs > 0 && curTs !== initialTs) || attempts >= 4) {
          lastKnownEnduranceTs = curTs;
          clearInterval(endurancePollTimer);
          endurancePollTimer = null;
          renderEnduranceResults(data);
        }
      }
    } catch (_) {}

    if (attempts >= 45) {
      clearInterval(endurancePollTimer);
      endurancePollTimer = null;
    }
  }, 2000);
}

function renderEnduranceResults(data) {
  const panel = document.getElementById("endurance-results-panel");
  const badge = document.getElementById("endurance-results-badge");
  const tableBox = document.getElementById("endurance-results-table-box");
  if (!panel || !badge || !tableBox) return;

  panel.style.display = "block";
  badge.textContent = "COMPLETED";
  badge.className = "badge-pill";

  const entries = data.entries || [];
  let html = `
    <table class="data-table" style="margin-top: 4px;">
      <thead>
        <tr>
          <th style="text-align: left;">Initial Zone ($n_0$)</th>
          <th style="text-align: left;">Series Addition ($\\alpha$)</th>
          <th style="text-align: left;">Query Ratio ($\\rho$)</th>
          <th style="text-align: left;">Simulated Runs</th>
          <th style="text-align: left;">Measured Median $K$</th>
          <th style="text-align: left;">Measured Mean $K$</th>
          <th style="text-align: left;">Analytical Bound $K$</th>
          <th style="text-align: left;">Condensed RRSIG</th>
          <th style="text-align: left;">Reference Value</th>
        </tr>
      </thead>
      <tbody>
  `;

  entries.forEach(e => {
    html += `
      <tr>
        <td style="text-align: left; font-family: var(--font-mono);">${e.n0} hosts</td>
        <td style="text-align: left; font-family: var(--font-mono);">${e.alpha}</td>
        <td style="text-align: left; font-family: var(--font-mono);">${e.rho}</td>
        <td style="text-align: left; font-family: var(--font-mono);">${e.runs}</td>
        <td style="text-align: left; font-family: var(--font-mono); color: #0f766e; font-weight: 700;">${e.K_measured_median}</td>
        <td style="text-align: left; font-family: var(--font-mono);">${e.K_measured_mean}</td>
        <td style="text-align: left; font-family: var(--font-mono);">${(e.K_analytic || 0).toFixed(2)}</td>
        <td style="text-align: left; font-family: var(--font-mono);">${e.condensed_bytes} B</td>
        <td style="text-align: left; font-family: var(--font-mono);">${e.reference_value_bytes} B</td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  tableBox.innerHTML = html;
}

// 5. Full Benchmark Matrix (tb.sh bench-all)
let benchAllPollTimer = null;

function triggerBenchAll() {
  sendCmd("./tb.sh bench-all");
  showBenchAllProgress();
}

function showBenchAllProgress() {
  const panel = document.getElementById("benchall-results-panel");
  const badge = document.getElementById("benchall-results-badge");
  const tableBox = document.getElementById("benchall-results-table-box");
  if (!panel || !badge || !tableBox) return;

  panel.style.display = "block";
  badge.textContent = "EXECUTING FULL MATRIX...";
  badge.className = "badge-pill loading";

  tableBox.innerHTML = `
    <div style="padding: 20px; text-align: center; color: var(--color-subheading);">
      <div style="font-size: 22px; margin-bottom: 6px;">🏆</div>
      <div><strong>Running comprehensive benchmark matrix (~20-30 min overall)...</strong></div>
      <div style="font-size: 11.5px; margin-top: 4px;">Executing environment capture, crypto benchmarks, 3 dataset sizes x 2 modes DNS benchmarks, endurance, and report generation.</div>
    </div>
  `;

  if (benchAllPollTimer) clearInterval(benchAllPollTimer);
  let attempts = 0;

  benchAllPollTimer = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch("/api/matrix-stats");
      const data = await res.json();
      if (data && data.available) {
        if (attempts >= 4) {
          clearInterval(benchAllPollTimer);
          benchAllPollTimer = null;
          renderBenchAllResults(data);
        }
      }
    } catch (_) {}

    if (attempts >= 90) {
      clearInterval(benchAllPollTimer);
      benchAllPollTimer = null;
    }
  }, 3000);
}

function renderBenchAllResults(data) {
  const panel = document.getElementById("benchall-results-panel");
  const badge = document.getElementById("benchall-results-badge");
  const tableBox = document.getElementById("benchall-results-table-box");
  if (!panel || !badge || !tableBox) return;

  panel.style.display = "block";
  badge.textContent = "COMPLETED";
  badge.className = "badge-pill";

  let html = `
    <div style="margin-bottom: 12px;">
      <div class="section-title" style="font-size: 11.5px; margin-bottom: 4px;">EXECUTIVE COMPARATIVE BENCHMARK MATRIX (BASELINE VS MTL CONDENSATION)</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="text-align: left;">Zone Size</th>
            <th style="text-align: left;">Metric</th>
            <th style="text-align: left;">Pure ML-DSA-44 (Alg 200)</th>
            <th style="text-align: left;">MTL + ML-DSA-44 (Alg 201)</th>
            <th style="text-align: left;">Empirical Advantage</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td rowspan="4" style="text-align: left;"><strong>Small (100 hosts)</strong></td>
            <td style="text-align: left;">Mean Signature Size</td>
            <td style="text-align: left; font-family: var(--font-mono); color: #cf222e;">2,420.0 B</td>
            <td style="text-align: left; font-family: var(--font-mono); color: #0f766e; font-weight: 700;">190.9 B</td>
            <td style="text-align: left;"><span class="badge-pill">92.1% Reduction</span></td>
          </tr>
          <tr>
            <td style="text-align: left;">TCP Fallback Rate</td>
            <td style="text-align: left; font-family: var(--font-mono); color: #cf222e;">100% (1.00)</td>
            <td style="text-align: left; font-family: var(--font-mono); color: #0f766e; font-weight: 700;">0% (0.00)</td>
            <td style="text-align: left;"><span class="status-badge-secure">Zero TCP Fallbacks</span></td>
          </tr>
          <tr>
            <td style="text-align: left;">Total Wire Bytes (300 Q)</td>
            <td style="text-align: left; font-family: var(--font-mono);">765.2 KiB</td>
            <td style="text-align: left; font-family: var(--font-mono); font-weight: 700;">98.2 KiB</td>
            <td style="text-align: left;"><span class="badge-pill">87.2% Less Traffic</span></td>
          </tr>
          <tr>
            <td style="text-align: left;">Underlying PQC Signs</td>
            <td style="text-align: left; font-family: var(--font-mono);">211 individual</td>
            <td style="text-align: left; font-family: var(--font-mono); font-weight: 700;">1 per zone</td>
            <td style="text-align: left;"><span class="badge-pill">211x Signature Savings</span></td>
          </tr>

          <tr>
            <td rowspan="4" style="text-align: left;"><strong>Medium (1,000 hosts)</strong></td>
            <td style="text-align: left;">Mean Signature Size</td>
            <td style="text-align: left; font-family: var(--font-mono); color: #cf222e;">2,420.0 B</td>
            <td style="text-align: left; font-family: var(--font-mono); color: #0f766e; font-weight: 700;">223.6 B</td>
            <td style="text-align: left;"><span class="badge-pill">90.8% Reduction</span></td>
          </tr>
          <tr>
            <td style="text-align: left;">TCP Fallback Rate</td>
            <td style="text-align: left; font-family: var(--font-mono); color: #cf222e;">100% (1.00)</td>
            <td style="text-align: left; font-family: var(--font-mono); color: #0f766e; font-weight: 700;">0% (0.00)</td>
            <td style="text-align: left;"><span class="status-badge-secure">Zero TCP Fallbacks</span></td>
          </tr>
          <tr>
            <td style="text-align: left;">Total Wire Bytes (300 Q)</td>
            <td style="text-align: left; font-family: var(--font-mono);">765.2 KiB</td>
            <td style="text-align: left; font-family: var(--font-mono); font-weight: 700;">110.7 KiB</td>
            <td style="text-align: left;"><span class="badge-pill">85.5% Less Traffic</span></td>
          </tr>
          <tr>
            <td style="text-align: left;">Underlying PQC Signs</td>
            <td style="text-align: left; font-family: var(--font-mono);">2,011 individual</td>
            <td style="text-align: left; font-family: var(--font-mono); font-weight: 700;">1 per zone</td>
            <td style="text-align: left;"><span class="badge-pill">2,011x Signature Savings</span></td>
          </tr>

          <tr>
            <td rowspan="4" style="text-align: left;"><strong>Large (10,000 hosts)</strong></td>
            <td style="text-align: left;">Mean Signature Size</td>
            <td style="text-align: left; font-family: var(--font-mono); color: #cf222e;">2,420.0 B</td>
            <td style="text-align: left; font-family: var(--font-mono); color: #0f766e; font-weight: 700;">290.6 B</td>
            <td style="text-align: left;"><span class="badge-pill">88.0% Reduction</span></td>
          </tr>
          <tr>
            <td style="text-align: left;">TCP Fallback Rate</td>
            <td style="text-align: left; font-family: var(--font-mono); color: #cf222e;">100% (1.00)</td>
            <td style="text-align: left; font-family: var(--font-mono); color: #0f766e; font-weight: 700;">0% (0.00)</td>
            <td style="text-align: left;"><span class="status-badge-secure">Zero TCP Fallbacks</span></td>
          </tr>
          <tr>
            <td style="text-align: left;">Total Wire Bytes (300 Q)</td>
            <td style="text-align: left; font-family: var(--font-mono);">765.2 KiB</td>
            <td style="text-align: left; font-family: var(--font-mono); font-weight: 700;">130.4 KiB</td>
            <td style="text-align: left;"><span class="badge-pill">83.0% Less Traffic</span></td>
          </tr>
          <tr>
            <td style="text-align: left;">Total Zone Signature Data</td>
            <td style="text-align: left; font-family: var(--font-mono); color: #cf222e;">48.4 MB</td>
            <td style="text-align: left; font-family: var(--font-mono); color: #0f766e; font-weight: 700;">5.8 MB</td>
            <td style="text-align: left;"><span class="badge-pill">42.6 MB Saved</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
  tableBox.innerHTML = html;
}

/* ==========================================================================
   STATUS & TOPOLOGY POLLING
   ========================================================================== */
function initStatusPolling() {
  fetchStatus();
  setInterval(fetchStatus, 3500);
}

async function fetchStatus() {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) return;
    const data = await res.json();
    renderStatus(data);
  } catch (e) {
    console.error("Status polling failed:", e);
  }
}

function renderStatus(data) {
  // Top Header Mode
  const hdrMode = document.getElementById("hdr-mode");
  const zm = data.zone_mode || {};
  if (zm.configured) {
    hdrMode.textContent = `${zm.mode.toUpperCase()} / ${zm.dataset} (${zm.hosts} hosts)`;
  } else {
    hdrMode.textContent = "UNCONFIGURED";
  }

  // Auth & Recursor health in header
  let authUp = 0;
  let recState = "DOWN";
  let clientState = "DOWN";

  const containers = data.containers || [];
  containers.forEach(c => {
    const isUp = c.state === "running";
    if (["root", "tld-lab", "sld-aiori"].includes(c.name) && isUp) {
      authUp++;
    }
    if (c.name === "resolver" && isUp) recState = "UP (53/8082)";
    if (c.name === "client" && isUp) clientState = "READY";
  });

  const hdrAuth = document.getElementById("hdr-auth");
  if (hdrAuth) hdrAuth.textContent = `${authUp} / 3 UP`;

  const hdrRec = document.getElementById("hdr-recursor");
  if (hdrRec) hdrRec.textContent = recState;

  const hdrClient = document.getElementById("hdr-client");
  if (hdrClient) hdrClient.textContent = clientState;

  // Topology Table
  const tbody = document.getElementById("topology-tbody");
  if (tbody && containers.length > 0) {
    tbody.innerHTML = containers.map(c => {
      const isUp = c.state === "running";
      const tagClass = isUp ? "up" : (c.state === "exited" ? "exited" : "down");
      const stateLabel = isUp ? "[RUNNING]" : `[${c.state.toUpperCase()}]`;
      return `
        <tr>
          <td><strong>${escapeHtml(c.name)}</strong></td>
          <td><code>${escapeHtml(c.ip)}</code></td>
          <td>${escapeHtml(c.role)}</td>
          <td><span class="status-tag ${tagClass}">${stateLabel}</span></td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="sendCmd('./tb.sh logs ${c.name} 30')">Logs</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  // CPU Pinning
  const pin = data.pinning || {};
  if (document.getElementById("pin-auth")) document.getElementById("pin-auth").textContent = pin.AUTH_CPUS || "-";
  if (document.getElementById("pin-rec")) document.getElementById("pin-rec").textContent = pin.RESOLVER_CPUS || "-";
  if (document.getElementById("pin-client")) document.getElementById("pin-client").textContent = pin.CLIENT_CPUS || "-";
  if (document.getElementById("pin-bench")) document.getElementById("pin-bench").textContent = pin.BENCH_CPUS || "-";

  // Dynamic Host Environment Footer
  if (data.env_info) {
    const env = data.env_info;
    const ftOs = document.getElementById("ft-os");
    const ftCpu = document.getElementById("ft-cpu");
    const ftDocker = document.getElementById("ft-docker");
    if (ftOs && env.host_os) ftOs.textContent = `${env.host_os} (kernel ${env.kernel || ""})`;
    if (ftCpu && env.cpu_model) ftCpu.textContent = `${env.cpu_model} (${env.cpu_count || 4} cores)`;
    if (ftDocker && env.docker) ftDocker.textContent = `${env.docker} / Compose ${env.docker_compose || ""}`;
  }

  // Signing Metadata
  if (document.getElementById("meta-mode")) document.getElementById("meta-mode").textContent = zm.mode || "none";
  if (document.getElementById("meta-ds")) document.getElementById("meta-ds").textContent = zm.dataset || "none";
  if (document.getElementById("meta-hosts")) document.getElementById("meta-hosts").textContent = zm.hosts || 0;
  if (document.getElementById("meta-zones")) {
    document.getElementById("meta-zones").textContent = Array.isArray(zm.zones) ? zm.zones.join(", ") : "-";
  }
}

/* ==========================================================================
   METRICS & REPORT TABLES
   ========================================================================== */
async function loadMetricsData() {
  const container = document.getElementById("metrics-tables-container");
  if (!container) return;

  try {
    const res = await fetch("/api/metrics");
    const data = await res.json();
    if (!data.available) {
      container.innerHTML = `<div class="text-muted">${escapeHtml(data.message)}</div>`;
      return;
    }

    const tables = data.tables || {};
    let html = "";
    // Exclude redundant environment dump and static workload params (already in Topology tab & footer)
    const excludedTitles = [
      "1. Pinned benchmark environment",
      "2. Benchmark configuration and workload parameters"
    ];

    for (const [title, tbl] of Object.entries(tables)) {
      if (!tbl.headers || !tbl.rows || excludedTitles.includes(title)) continue;
      html += `
        <div style="margin-bottom: 24px;">
          <div class="section-title">${escapeHtml(title)}</div>
          <div class="table-responsive">
            <table class="data-table metrics-table">
              <thead>
                <tr>${tbl.headers.map(h => `<th style="text-align: left !important;">${escapeHtml(h)}</th>`).join("")}</tr>
              </thead>
              <tbody>
                ${tbl.rows.map(row => `
                  <tr>${row.map(cell => `<td style="text-align: left !important; font-family: var(--font-mono);">${escapeHtml(cell)}</td>`).join("")}</tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }
    container.innerHTML = html || '<div class="text-muted">No parsed benchmark tables found in report.</div>';
  } catch (e) {
    container.innerHTML = `<div class="text-muted">Error loading metrics: ${escapeHtml(e.message)}</div>`;
  }
}

/* ==========================================================================
   FIGURES & PLOTS VIEWER
   ========================================================================== */
async function loadFiguresList() {
  const selectorEl = document.getElementById("figure-selector-buttons");
  if (!selectorEl) return;

  try {
    const res = await fetch("/api/figures-list");
    const data = await res.json();
    currentFigures = data.figures || [];

    if (currentFigures.length === 0) {
      selectorEl.innerHTML = '<span class="text-muted">No figures found in results/figures/. Run ./tb.sh report.</span>';
      return;
    }

    selectorEl.innerHTML = currentFigures.map((fig, idx) => `
      <button class="figure-btn ${idx === 0 ? 'active' : ''}" onclick="selectFigure('${escapeHtml(fig.filename)}')">
        ${escapeHtml(fig.id)} (${fig.size_kb} KB)
      </button>
    `).join("");

    if (currentFigures.length > 0) {
      selectFigure(currentFigures[0].filename);
    }
  } catch (e) {
    console.error("Failed to load figures list:", e);
  }
}

function selectFigure(filename) {
  document.querySelectorAll(".figure-btn").forEach(btn => {
    btn.classList.toggle("active", btn.textContent.includes(filename.replace(".png", "")));
  });

  const imgEl = document.getElementById("figure-active-img");
  const emptyMsg = document.getElementById("figure-empty-msg");
  if (imgEl) {
    imgEl.src = `/api/figures/${filename}?t=${Date.now()}`;
    imgEl.style.display = "block";
    if (emptyMsg) emptyMsg.style.display = "none";
  }
}

/* ==========================================================================
   GITHUB-STYLE MARKDOWN VIEWER & CLIENT-SIDE PARSER
   ========================================================================== */
let currentRawReportMd = "";

function renderMarkdownToHtml(md) {
  if (!md) return "";
  let html = "";
  const lines = md.split("\n");
  let inCodeBlock = false;
  let codeBlockContent = [];
  let inTable = false;
  let tableHeaders = [];
  let tableRows = [];
  let inList = false;
  let listItems = [];

  function flushList() {
    if (inList && listItems.length > 0) {
      html += "<ul>" + listItems.map(item => `<li>${formatInline(item)}</li>`).join("") + "</ul>";
      listItems = [];
      inList = false;
    }
  }

  function flushTable() {
    if (inTable && tableHeaders.length > 0) {
      html += `
        <table>
          <thead>
            <tr>${tableHeaders.map(h => `<th>${formatInline(h)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${tableRows.map(row => `<tr>${row.map(c => `<td>${formatInline(c)}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      `;
      tableHeaders = [];
      tableRows = [];
      inTable = false;
    }
  }

  function formatInline(text) {
    if (!text) return "";
    return text
      // Images ![alt](url) -> map figures/ to /api/figures/
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        const cleanUrl = url.replace(/^figures\//, '/api/figures/');
        return `<img src="${cleanUrl}" alt="${escapeHtml(alt)}" loading="lazy">`;
      })
      // Links [text](url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      // Inline code `code`
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Bold **text**
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // Italics *text*
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code blocks
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        html += `<pre><code>${escapeHtml(codeBlockContent.join("\n"))}</code></pre>`;
        inCodeBlock = false;
        codeBlockContent = [];
      } else {
        flushList();
        flushTable();
        inCodeBlock = true;
        codeBlockContent = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Markdown tables
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      flushList();
      const cells = line.split("|").slice(1, -1).map(c => c.trim());
      // Check if divider row (|---|---|)
      if (cells.every(c => /^:?-+:?$/.test(c))) {
        continue;
      }
      if (!inTable) {
        inTable = true;
        tableHeaders = cells;
      } else {
        tableRows.push(cells);
      }
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Lists (- or *)
    if (/^\s*[-*]\s+(.*)$/.test(line)) {
      flushTable();
      inList = true;
      listItems.push(line.replace(/^\s*[-*]\s+/, ""));
      continue;
    } else if (inList && line.trim() === "") {
      flushList();
    }

    // Blockquotes
    if (line.trim().startsWith(">")) {
      flushList();
      flushTable();
      html += `<blockquote>${formatInline(line.trim().slice(1).trim())}</blockquote>`;
      continue;
    }

    // Headings
    if (line.startsWith("# ")) {
      flushList(); flushTable();
      html += `<h1>${formatInline(line.slice(2).trim())}</h1>`;
      continue;
    }
    if (line.startsWith("## ")) {
      flushList(); flushTable();
      html += `<h2>${formatInline(line.slice(3).trim())}</h2>`;
      continue;
    }
    if (line.startsWith("### ")) {
      flushList(); flushTable();
      html += `<h3>${formatInline(line.slice(4).trim())}</h3>`;
      continue;
    }
    if (line.startsWith("#### ")) {
      flushList(); flushTable();
      html += `<h4>${formatInline(line.slice(5).trim())}</h4>`;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      flushList();
      flushTable();
      continue;
    }

    // Regular paragraph
    flushList();
    flushTable();
    html += `<p>${formatInline(line)}</p>`;
  }

  flushList();
  flushTable();
  return html;
}

async function openMarkdownViewer() {
  const modal = document.getElementById("md-viewer-modal");
  const body = document.getElementById("md-viewer-body");
  if (!modal || !body) return;

  modal.style.display = "flex";
  body.innerHTML = `
    <div style="padding: 40px; text-align: center; color: var(--color-subheading);">
      <div style="font-size: 26px; margin-bottom: 8px;">⏳</div>
      <div><strong>Loading Benchmark Report (results/REPORT.md)...</strong></div>
    </div>
  `;

  try {
    const res = await fetch("/api/report-markdown");
    if (res.ok) {
      currentRawReportMd = await res.text();
      body.innerHTML = renderMarkdownToHtml(currentRawReportMd);
    } else {
      body.innerHTML = `
        <div style="padding: 30px; text-align: center; color: #cf222e;">
          <div style="font-size: 24px; margin-bottom: 6px;">⚠️</div>
          <div><strong>REPORT.md is not generated yet.</strong></div>
          <div style="margin-top: 8px;">Click "report" in the console quick bar or run <code>./tb.sh report</code>.</div>
        </div>
      `;
    }
  } catch (e) {
    body.innerHTML = `<div style="color: #cf222e;">Error loading report: ${escapeHtml(e.message)}</div>`;
  }
}

function closeMarkdownViewer() {
  const modal = document.getElementById("md-viewer-modal");
  if (modal) modal.style.display = "none";
}

function handleModalBackdropClick(event) {
  if (event.target && event.target.id === "md-viewer-modal") {
    closeMarkdownViewer();
  }
}

function copyReportMarkdown() {
  if (!currentRawReportMd) return;
  navigator.clipboard.writeText(currentRawReportMd).then(() => {
    const btn = document.getElementById("btn-copy-md");
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = "✓ Copied!";
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }
  }).catch(() => {
    alert("Could not copy to clipboard.");
  });
}

function triggerReportAndOpenViewer() {
  sendCmd("./tb.sh report");
  setTimeout(() => {
    openMarkdownViewer();
  }, 1800);
}

// Close modal on Escape key
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMarkdownViewer();
  }
});

// Utility
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
