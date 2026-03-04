(function () {
  "use strict";

  var path = window.location.pathname;
  var match = path.match(/^\/s\/([^/]+)/);
  if (!match) return;

  var sessionId = match[1];
  var params = new URLSearchParams(window.location.search);
  var screenId = params.get("screen");

  if (!screenId) {
    screenId = "scr-" + Math.random().toString(36).substring(2, 10);
    params.set("screen", screenId);
    history.replaceState(null, "", path + "?" + params.toString());
  }

  document.getElementById("screen-label").textContent = screenId;

  var dot = document.getElementById("status-dot");
  var ws = null;
  var backoff = 1000;
  var maxBackoff = 30000;
  var monitorId = null;
  var currentGrid = [1, 1];

  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host + "/ws");

    ws.onopen = function () {
      backoff = 1000;
      ws.send(JSON.stringify({
        type: "register",
        screenId: screenId,
        sessionId: sessionId
      }));
    };

    ws.onmessage = function (event) {
      var data = JSON.parse(event.data);
      if (data.type === "welcome") {
        dot.className = "connected";
        monitorId = data.monitorId;
      } else if (data.type === "identify") {
        showIdentifyOverlay(data.monitorId);
      } else if (data.type === "split") {
        applySplit(data.grid);
      } else if (data.type === "load") {
        loadSlot(data.slot, data.url, data.tab, data.tabs, data.active_tab);
      } else if (data.type === "loadAll") {
        loadAllTabs(data.slot, data.tabs, data.active_tab);
      } else if (data.type === "clear") {
        clearSlot(data.slot);
      } else if (data.type === "switchTab") {
        switchTab(data.slot, data.tab);
      }
    };

    ws.onclose = function () {
      dot.className = "";
      setTimeout(function () {
        backoff = Math.min(backoff * 2, maxBackoff);
        connect();
      }, backoff);
    };

    ws.onerror = function () {
      ws.close();
    };
  }

  // S3: Identification overlay
  function showIdentifyOverlay(id) {
    var existing = document.getElementById("identify-overlay");
    if (existing) existing.remove();

    var overlay = document.createElement("div");
    overlay.id = "identify-overlay";
    overlay.textContent = id;
    document.body.appendChild(overlay);

    setTimeout(function () {
      overlay.classList.add("fade-out");
      setTimeout(function () {
        overlay.remove();
      }, 500);
    }, 5000);
  }

  // S4/S11: Grid split
  function getSlotId(index) {
    return monitorId + String.fromCharCode(65 + index);
  }

  function applySplit(grid) {
    currentGrid = grid;
    var container = document.getElementById("grid-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "grid-container";
      document.body.appendChild(container);
    }
    container.innerHTML = "";

    var rows = grid[0];
    var cols = grid[1];

    if (rows === 1 && cols === 1) {
      container.style.display = "none";
      return;
    }

    container.style.display = "grid";
    container.style.gridTemplateRows = "repeat(" + rows + ", 1fr)";
    container.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";

    var total = rows * cols;
    for (var i = 0; i < total; i++) {
      var slot = document.createElement("div");
      slot.className = "grid-slot";
      var slotId = getSlotId(i);
      slot.id = "slot-" + slotId;
      slot.setAttribute("data-slot-id", slotId);

      var label = document.createElement("span");
      label.className = "slot-label";
      label.textContent = slotId;
      slot.appendChild(label);

      container.appendChild(slot);
    }
  }

  // S6: Build tab bar and iframes for a slot
  function renderSlotTabs(slotId, tabs, activeTab) {
    var slot = document.getElementById("slot-" + slotId);
    if (!slot) return;

    slot.innerHTML = "";

    // Create iframe container
    var iframeContainer = document.createElement("div");
    iframeContainer.className = "slot-iframe-container";

    for (var i = 0; i < tabs.length; i++) {
      var iframe = document.createElement("iframe");
      iframe.src = tabs[i].url;
      iframe.className = "slot-iframe";
      iframe.setAttribute("data-tab-index", String(i));
      iframe.style.display = i === activeTab ? "block" : "none";
      iframeContainer.appendChild(iframe);
    }

    slot.appendChild(iframeContainer);

    // Show tab bar only if 2+ tabs
    if (tabs.length >= 2) {
      var tabBar = document.createElement("div");
      tabBar.className = "slot-tab-bar";

      for (var t = 0; t < tabs.length; t++) {
        var btn = document.createElement("span");
        btn.className = "slot-tab-btn" + (t === activeTab ? " active" : "");
        btn.textContent = String(t + 1);
        btn.setAttribute("data-tab", String(t));
        btn.setAttribute("data-slot", slotId);
        tabBar.appendChild(btn);
      }

      slot.appendChild(tabBar);
    }
  }

  // S5/S11: Load URL into slot (tab-aware)
  function loadSlot(slotId, url, tabIndex, tabs, activeTab) {
    if (tabs && tabs.length > 0) {
      renderSlotTabs(slotId, tabs, activeTab);
    } else {
      // Fallback: single tab, no tab bar
      var slot = document.getElementById("slot-" + slotId);
      if (!slot) return;
      slot.innerHTML = "";
      var iframe = document.createElement("iframe");
      iframe.src = url;
      iframe.className = "slot-iframe";
      iframe.style.display = "block";
      var container = document.createElement("div");
      container.className = "slot-iframe-container";
      container.appendChild(iframe);
      slot.appendChild(container);
    }
  }

  // S6: Load all tabs at once (for layout apply)
  function loadAllTabs(slotId, tabs, activeTab) {
    if (tabs && tabs.length > 0) {
      renderSlotTabs(slotId, tabs, activeTab);
    }
  }

  // S6: Switch tab
  function switchTab(slotId, tabIndex) {
    var slot = document.getElementById("slot-" + slotId);
    if (!slot) return;

    var iframes = slot.querySelectorAll(".slot-iframe");
    for (var i = 0; i < iframes.length; i++) {
      iframes[i].style.display = parseInt(iframes[i].getAttribute("data-tab-index")) === tabIndex ? "block" : "none";
    }

    var btns = slot.querySelectorAll(".slot-tab-btn");
    for (var b = 0; b < btns.length; b++) {
      if (parseInt(btns[b].getAttribute("data-tab")) === tabIndex) {
        btns[b].classList.add("active");
      } else {
        btns[b].classList.remove("active");
      }
    }
  }

  // S5/S11: Clear slot
  function clearSlot(slotId) {
    var slot = document.getElementById("slot-" + slotId);
    if (!slot) return;

    slot.innerHTML = "";
    var label = document.createElement("span");
    label.className = "slot-label";
    label.textContent = slotId;
    slot.appendChild(label);
  }

  connect();
})();
