// Test-only entry point; production startup does not accept a profile override.
const { app } = require('electron');
const path = require('node:path');
app.setPath('userData', process.env.SOAPY_TEST_PROFILE);
app.setAppPath(path.resolve(__dirname, '../..'));
const recovery = require('../../app/main/project-recovery-store');
const create = recovery.createRecoveryStore;
const limits = JSON.parse(process.env.SOAPY_TEST_RECOVERY_LIMITS || '{}');
global.recoveryTest = { starts: 0, writes: 0 };
recovery.createRecoveryStore = (root, options) => {
  const store = create(root, { ...options, ...limits });
  for (const [method, counter] of [
    ['start', 'starts'],
    ['write', 'writes'],
  ]) {
    const original = store[method];
    store[method] = (...args) => {
      global.recoveryTest[counter]++;
      return original(...args);
    };
  }
  const read = store.read;
  store.read = (...args) => {
    if (global.recoveryTest.failRead)
      return Promise.reject(new Error('Injected restore read failure'));
    return read(...args);
  };
  return store;
};
require('../../app/main/index');
