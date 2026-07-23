(function (root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.utils = root.SoapyPanels.utils || {};
  root.SoapyPanels.utils.uid = api.uid;
  root.SoapyPanels.utils.createUidFactory = api.createUidFactory;
})(typeof self !== 'undefined' ? self : this, function () {
  function createUidFactory(randomSource) {
    const getRandom =
      typeof randomSource === 'function' ? randomSource : Math.random;

    return function uid() {
      return getRandom().toString(36).slice(2);
    };
  }

  return {
    createUidFactory,
    uid: createUidFactory(),
  };
});
