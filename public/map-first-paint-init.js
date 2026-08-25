(function () {
  var paths = ["/data/venues_slim.manifest.json", "/data/venues_slim.core.json"];
  for (var i = 0; i < paths.length; i++) {
    try {
      fetch(paths[i], { cache: "force-cache" }).catch(function () {});
    } catch (e) {
      // Best-effort only.
    }
  }
})();
