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

  connect();
})();
