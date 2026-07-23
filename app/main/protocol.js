const path = require("path");
const {
  RENDERER_DIR,
  RENDERER_ENTRY,
  resolveRendererPath,
} = require("../shared/app-paths");

function registerAppProtocolPrivileges(protocol) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

function normalizeRendererRequestPath(requestUrl) {
  const url = new URL(requestUrl);
  let relPath = decodeURIComponent(url.pathname || "");
  if (relPath.startsWith("/")) relPath = relPath.slice(1);
  if (!relPath || relPath === "index" || relPath === RENDERER_ENTRY) {
    return RENDERER_ENTRY;
  }
  return relPath;
}

function registerAppFileProtocol(protocol) {
  protocol.registerFileProtocol("app", (request, callback) => {
    try {
      const relPath = normalizeRendererRequestPath(request.url);
      const resolvedPath = resolveRendererPath(relPath);
      if (!resolvedPath || !resolvedPath.startsWith(RENDERER_DIR + path.sep)) {
        if (resolvedPath !== RENDERER_DIR) {
          callback({ error: -6 });
          return;
        }
      }
      callback({ path: resolvedPath });
    } catch {
      callback({ error: -6 });
    }
  });
}

module.exports = {
  registerAppProtocolPrivileges,
  registerAppFileProtocol,
};
