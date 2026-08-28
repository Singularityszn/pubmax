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
  // The manifest is always eager. Once it answers, warm only cells that match
  // the opening camera. This preserves location-first loading while allowing
  // the cell response to overlap React and MapLibre startup.
  var manifestPath = "/data/venues_slim.manifest.json";
  var json = new Map();
  window.__pubmaxMapWarm = { json: json };
  var manifestWarm = fetch(manifestPath, { cache: "force-cache" }).then(function (response) {
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  });
  json.set(manifestPath, manifestWarm);
  void manifestWarm.then(function (manifest) {
    if (!manifest || !Array.isArray(manifest.shards)) return;
    var location = { lat: 51.52, lng: -0.12 };
    try {
      var raw = window.localStorage.getItem("pubmax:map-opening-location:v1");
      var saved = raw ? JSON.parse(raw) : null;
      if (
        saved &&
        Number.isFinite(saved.lat) &&
        Number.isFinite(saved.lng) &&
        saved.lat >= 51.25 && saved.lat <= 51.75 &&
        saved.lng >= -0.6 && saved.lng <= 0.4
      ) {
        location = saved;
      }
    } catch {
      // Opening location is an optional hint. Default London center stays safe.
    }
    var zoom = 15;
    var scale = 512 * Math.pow(2, zoom);
    var longitudeDelta = (Math.max(window.innerWidth, 1) * 180) / scale;
    var latitudeDelta = (Math.max(window.innerHeight, 1) * 180 * 1.4) / scale;
    var bounds = {
      west: location.lng - longitudeDelta,
      south: Math.max(-85, location.lat - latitudeDelta),
      east: location.lng + longitudeDelta,
      north: Math.min(85, location.lat + latitudeDelta),
    };
    manifest.shards.forEach(function (shard) {
      if (!Array.isArray(shard.bbox) || shard.bbox.length !== 4) return;
      var minLng = shard.bbox[0];
      var minLat = shard.bbox[1];
      var maxLng = shard.bbox[2];
      var maxLat = shard.bbox[3];
      if (
        minLng > bounds.east ||
        maxLng < bounds.west ||
        minLat > bounds.north ||
        maxLat < bounds.south
      ) return;
      var warm = fetch(shard.url, { cache: "force-cache" }).then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      });
      json.set(shard.url, warm);
      void warm.catch(function () {
        if (json.get(shard.url) === warm) json.delete(shard.url);
      });
    });
  }).catch(function () {
    if (json.get(manifestPath) === manifestWarm) json.delete(manifestPath);
  });
})();
