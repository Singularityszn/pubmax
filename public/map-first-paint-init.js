(function () {
  var nav = navigator;
  var conn = nav && nav.connection;
  if (
    conn &&
    (conn.saveData === true ||
      conn.effectiveType === "slow-2g" ||
      conn.effectiveType === "2g")
  ) {
    return;
  }
  var paths = ["/data/venues_slim.manifest.json", "/data/venues_slim.core.json"];
  var json = new Map();
  window.__pubmaxMapWarm = { json: json };
  for (var i = 0; i < paths.length; i++) {
    (function (path) {
      var warm = fetch(path, { cache: "force-cache" }).then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      });
      json.set(path, warm);
      void warm.catch(function () {
        if (json.get(path) === warm) json.delete(path);
      });
    })(paths[i]);
  }
})();
