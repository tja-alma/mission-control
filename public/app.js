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
        loadSlot(data.slot, data.url);
      } else if (data.type === "clear") {
        clearSlot(data.slot);
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

  // S5/S11: Load URL into slot
  function loadSlot(slotId, url) {
    var slot = document.getElementById("slot-" + slotId);
    if (!slot) return;

    // Remove existing content
    slot.innerHTML = "";

    var iframe = document.createElement("iframe");
    iframe.src = url;
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    slot.appendChild(iframe);
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
