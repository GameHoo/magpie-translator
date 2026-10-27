// 页面提交 options 时用。不能把 feed 原样发回去：它会撑过 magpie 的 64KiB 上限。
(function () {
  var DROP = ["feed", "models", "gatewayKey", "localPanel", "panelPort", "_compare"];
  var BUDGET = 60 * 1024;
  function pageOptions(current, patch, job) {
    var next = {};
    var source = current && typeof current === "object" ? current : {};
    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key) && DROP.indexOf(key) === -1) next[key] = source[key];
    }
    if (patch && typeof patch === "object") {
      for (var patchKey in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, patchKey)) next[patchKey] = patch[patchKey];
      }
    }
    if (job) next._compare = job;
    var bytes = new TextEncoder().encode(JSON.stringify(next)).length;
    if (bytes > BUDGET) return { error: "options are " + bytes + " bytes, over magpie's 64KiB limit", bytes: bytes };
    return { options: next, bytes: bytes };
  }
  window.translatorPageOptions = pageOptions;
})();
