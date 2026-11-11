const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeElectronEnvironment } = require("../../tools/development/start-electron");

test("sanitizeElectronEnvironment removes Electron's Node compatibility mode", () => {
  const previous = process.env.ELECTRON_RUN_AS_NODE;
  process.env.ELECTRON_RUN_AS_NODE = "1";
  try {
    const environment = sanitizeElectronEnvironment({ SOAPY_TEST_VALUE: "ok" });
    assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(environment.SOAPY_TEST_VALUE, "ok");
  } finally {
    if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = previous;
  }
});
