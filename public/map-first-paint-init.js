(function () {
  var paths = ["/data/venues_slim.manifest.json", "/data/venues_slim.core.json"];
  var json = new Map();
  window.__pubmaxMapWarm = { json: json };
  for (var i = 0; i < paths.length; i++) {
    (function (path) {
      json.set(
        path,
        fetch(path, { cache: "force-cache" }).then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        }),
      );
    })(paths[i]);
  }
})();
