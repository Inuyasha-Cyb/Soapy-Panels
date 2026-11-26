(function (root) {
  'use strict';
  function create({ read, onError }) {
    const lens = document.createElement('div');
    lens.id = 'canvasColorMagnifier';
    lens.className = 'canvas-color-magnifier';
    lens.hidden = true;
    lens.setAttribute('aria-hidden', 'true');
    lens.innerHTML = '<div class="color-magnifier-grid"><canvas width="11" height="11"></canvas><i></i></div><div class="color-magnifier-value"><b></b><span></span></div>';
    document.body.appendChild(lens);
    const canvas = lens.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    let timer = null, frame = null, point = null, lastRender = -Infinity;
    function clear() {
      if (timer !== null) clearTimeout(timer);
      if (frame !== null) cancelAnimationFrame(frame);
      timer = frame = null;
      point = null;
      lastRender = -Infinity;
      lens.hidden = true;
      ctx.clearRect(0, 0, 11, 11);
    }
    function render() {
      frame = null;
      if (!point) return;
      try {
        const sample = read(point, true);
        if (!sample) { clear(); return; }
        ctx.putImageData(new ImageData(sample.pixels, 11, 11), 0, 0);
        lens.querySelector('span').textContent = sample.color;
        lens.querySelector('b').style.backgroundColor = sample.color;
        lens.hidden = false;
        const w = lens.offsetWidth, h = lens.offsetHeight;
        const left = point.clientX + 20 + w <= innerWidth - 8 ? point.clientX + 20 : point.clientX - w - 20;
        const top = point.clientY + 20 + h <= innerHeight - 8 ? point.clientY + 20 : point.clientY - h - 20;
        lens.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, left))}px`;
        lens.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, top))}px`;
        lastRender = performance.now();
      } catch (error) { clear(); onError(error); }
    }
    function move(event) {
      point = { clientX: event.clientX, clientY: event.clientY };
      if (timer !== null || frame !== null) return;
      timer = setTimeout(() => {
        timer = null;
        frame = requestAnimationFrame(render);
      }, Math.max(0, 1000 / 30 - (performance.now() - lastRender)));
    }
    return { move, clear };
  }
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.colorMagnifier = { create };
})(window);
