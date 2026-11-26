// Test-only bootstrap: exercise the packaged resolver in a development Electron host.
const { app } = require('electron');
const path = require('node:path');
const profile = process.env.SOAPY_TEST_PROFILE;
app.setPath('userData', profile);
app.setAppPath(path.resolve(__dirname, '../..'));
process.env.SOAPY_DEV_EDITION = 'windows-store';
delete process.env.SOAPY_DEV_ENTITLEMENT;
const bridge = require('../../app/main/windows-store-bridge');
const createBridge = bridge.createWindowsStoreBridge;
global.storeHelperTest = { spawns: 0, context: null };
bridge.createWindowsStoreBridge = (options) => {
  global.storeHelperTest.context = options;
  return createBridge({
    ...options,
    isPackaged: true,
    resourcesPath: path.join(profile, 'resources'),
    mainDirectory: path.join(profile, 'source', 'app', 'main'),
    execFileImpl() {
      global.storeHelperTest.spawns++;
      throw new Error('Unexpected helper execution');
    },
  });
};
require('../../app/main/index');
