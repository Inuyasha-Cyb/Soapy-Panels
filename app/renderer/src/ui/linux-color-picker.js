(function (root) {
  'use strict';
  const clamp = (n, max = 1) => Math.max(0, Math.min(max, n));
  function parseHex(value) {
    const match = /^#?([\da-f]{6}|[\da-f]{3})$/i.exec(String(value).trim());
    if (!match) return null;
    const hex = match[1].length === 3 ? [...match[1]].map(c => c + c).join('') : match[1];
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  }
  function rgbToHex(rgb) {
    if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some(n => !Number.isFinite(n) || n < 0 || n > 255)) return null;
    return '#' + rgb.map(n => Math.round(n).toString(16).padStart(2, '0')).join('');
  }
  function rgbToHsv(rgb) {
    const [r, g, b] = rgb.map(n => n / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) h = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
    return [h, max ? d / max : 0, max];
  }
  function hsvToRgb([h, s, v]) {
    h = ((h % 360) + 360) % 360;
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    const channels = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return channels.map(n => Math.round(clamp(n + m) * 255));
  }

  function install({ translate: t, sample, cancelSample, beginEdit = () => {}, endEdit = () => {} }) {
    if (root.electronApi?.platform !== 'linux') return null;
    const overlay = document.createElement('div');
    overlay.id = 'linuxColorPicker';
    overlay.className = 'linux-color-picker';
    overlay.hidden = true;
    // Static markup only. User values and translations are assigned as text/value.
    overlay.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="linuxColorTitle" tabindex="-1">
      <div class="linux-color-heading"><h2 id="linuxColorTitle" data-color-label="title"></h2><button type="button" data-color-close>×</button></div>
      <div class="linux-color-area" tabindex="0" role="group"><span></span></div>
      <label><span data-color-label="hue"></span><input data-color-hue type="range" min="0" max="359" step="1"></label>
      <div class="linux-color-previews"><label><span data-color-label="current"></span><i data-color-current></i></label><label><span data-color-label="new"></span><i data-color-new></i></label></div>
      <label>HEX <input data-color-hex type="text" maxlength="7" spellcheck="false" autocomplete="off"></label>
      <div class="linux-color-rgb">${['R', 'G', 'B'].map((c, i) => `<label>${c}<input data-color-channel="${i}" type="number" min="0" max="255" step="1"></label>`).join('')}</div>
      <p data-color-message role="status" aria-live="polite"></p>
      <button type="button" data-color-pick><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5 4 4m-5-3 4 4-7.8 7.8-4.2.2.2-4.2zM5.5 18.5l-2 2"/></svg></button>
    </section>`;
    document.body.appendChild(overlay);
    const dialog = overlay.querySelector('section');
    const area = overlay.querySelector('.linux-color-area');
    const marker = area.querySelector('span');
    const hex = overlay.querySelector('[data-color-hex]');
    const channels = [...overlay.querySelectorAll('[data-color-channel]')];
    const hue = overlay.querySelector('[data-color-hue]');
    const closeButton = overlay.querySelector('[data-color-close]');
    const pick = overlay.querySelector('[data-color-pick]');
    const message = overlay.querySelector('[data-color-message]');
    let target = null, draft = '#000000', hsv = [0, 0, 0], sampling = false, host = null;
    let liveFrame = null, changed = false;
    function flushLive() {
      if (liveFrame !== null) cancelAnimationFrame(liveFrame);
      liveFrame = null;
      if (!validTarget() || target.value === draft) return;
      changed = true;
      target.value = draft;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function queueLive() { if (liveFrame === null) liveFrame = requestAnimationFrame(flushLive); }
    function validTarget() {
      return target?.isConnected && !target.matches(':disabled') && !target.closest('[hidden], [aria-hidden="true"]');
    }
    function draw() {
      hex.value = draft;
      parseHex(draft).forEach((n, i) => { channels[i].value = n; });
      hue.value = hsv[0];
      hue.style.setProperty('--selected-hue', rgbToHex(hsvToRgb([hsv[0], 1, 1])));
      area.style.backgroundColor = rgbToHex(hsvToRgb([hsv[0], 1, 1]));
      marker.style.left = `${hsv[1] * 100}%`;
      marker.style.top = `${(1 - hsv[2]) * 100}%`;
      overlay.querySelector('[data-color-new]').style.backgroundColor = draft;
      message.textContent = '';
      for (const input of [hex, ...channels]) input.removeAttribute('aria-invalid');
    }
    function setRgb(rgb, live = true) {
      draft = rgbToHex(rgb);
      const next = rgbToHsv(rgb);
      // Retain the selected hue while moving through black or grayscale.
      hsv = [next[1] ? next[0] : hsv[0], next[1], next[2]];
      draw();
      if (live) queueLive();
    }
    function endSampling() {
      host?.classList.remove('color-picker-sampling-host');
      host = null;
      sampling = false;
    }
    function position() {
      if (!target || overlay.hidden) return;
      const rect = target.getBoundingClientRect();
      const width = dialog.offsetWidth, height = dialog.offsetHeight;
      dialog.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left))}px`;
      const top = rect.top - height - 8 >= 8 ? rect.top - height - 8 : rect.bottom + 8;
      dialog.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, top))}px`;
    }
    function close({ discardPending = false, restoreFocus = true } = {}) {
      if (!target) return;
      const previous = target;
      if (!discardPending) flushLive();
      if (liveFrame !== null) cancelAnimationFrame(liveFrame);
      liveFrame = null;
      if (changed && !discardPending && previous.isConnected) previous.dispatchEvent(new Event('change', { bubbles: true }));
      target = null;
      if (sampling) cancelSample();
      endSampling();
      overlay.hidden = true;
      endEdit({ discardPending });
      if (restoreFocus && previous.isConnected && !previous.matches(':disabled')) previous.focus({ preventScroll: true });
    }
    function open(input) {
      if (target) close();
      target = input;
      if (!validTarget()) { target = null; return; }
      overlay.querySelectorAll('[data-color-label]').forEach(el => { el.textContent = t(`colorPicker.${el.dataset.colorLabel}`); });
      area.setAttribute('aria-label', t('colorPicker.area'));
      pick.setAttribute('aria-label', t('colorSampler.pick'));
      pick.title = t('colorSampler.pick');
      closeButton.setAttribute('aria-label', t('colorPicker.close'));
      closeButton.title = t('colorPicker.close');
      overlay.querySelector('[data-color-current]').style.backgroundColor = input.value;
      changed = false;
      beginEdit(input);
      setRgb(parseHex(input.value) || [0, 0, 0], false);
      overlay.hidden = false;
      position();
      hex.focus();
      hex.select();
    }
    function invalid(input) {
      input.setAttribute('aria-invalid', 'true');
      message.textContent = t('colorPicker.invalid');
    }
    hex.addEventListener('input', () => {
      const typed = hex.value;
      const rgb = parseHex(hex.value);
      if (rgb) { setRgb(rgb); hex.value = typed; } else invalid(hex);
    });
    channels.forEach(input => input.addEventListener('input', () => {
      const rgb = channels.map(el => el.value === '' ? NaN : Number(el.value));
      if (rgbToHex(rgb) && rgb.every(Number.isInteger)) setRgb(rgb); else invalid(input);
    }));
    hue.addEventListener('input', () => { hsv[0] = Number(hue.value); draft = rgbToHex(hsvToRgb(hsv)); draw(); queueLive(); });
    function move(event) {
      const rect = area.getBoundingClientRect();
      hsv[1] = clamp((event.clientX - rect.left) / rect.width);
      hsv[2] = 1 - clamp((event.clientY - rect.top) / rect.height);
      draft = rgbToHex(hsvToRgb(hsv)); draw(); queueLive();
    }
    area.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); area.focus(); area.setPointerCapture(event.pointerId); move(event);
    });
    area.addEventListener('pointermove', event => { if (area.hasPointerCapture(event.pointerId)) move(event); });
    area.addEventListener('pointerup', event => { if (area.hasPointerCapture(event.pointerId)) area.releasePointerCapture(event.pointerId); });
    area.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'ArrowUp') hsv[2] = clamp(hsv[2] + 0.01);
      if (event.key === 'ArrowDown') hsv[2] = clamp(hsv[2] - 0.01);
      if (event.key === 'ArrowLeft') hsv[1] = clamp(hsv[1] - 0.01);
      if (event.key === 'ArrowRight') hsv[1] = clamp(hsv[1] + 0.01);
      draft = rgbToHex(hsvToRgb(hsv)); draw(); queueLive();
    });
    closeButton.addEventListener('click', () => close());
    overlay.addEventListener('pointerdown', event => { if (event.target === overlay) { event.preventDefault(); close(); } });
    pick.addEventListener('click', () => {
      if (!validTarget()) { close(); return; }
      flushLive();
      // Finalize any target-specific throttled preview before sampling it.
      if (changed) target.dispatchEvent(new Event('change', { bubbles: true }));
      sampling = true;
      overlay.hidden = true;
      host = target.closest('.gradient-overlay, .image-effects-panel');
      host?.classList.add('color-picker-sampling-host');
      sample(target, (color, error) => {
        endSampling();
        if (!target) return;
        if (!validTarget()) { close(); return; }
        if (color) setRgb(parseHex(color));
        overlay.hidden = false;
        position();
        message.textContent = error ? t('colorPicker.failed') : '';
        pick.focus();
      });
    });
    // Capture at window level so parent dialogs cannot consume the popup's keys.
    root.addEventListener('keydown', event => {
      if (!target) {
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('input[type="color"]:not(:disabled)')) {
          event.preventDefault(); event.stopImmediatePropagation(); open(event.target);
        }
        return;
      }
      if (sampling) return; // Existing sampler handles cancellation and click suppression.
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
      if (event.key === 'Tab') {
        event.preventDefault();
        const items = [...dialog.querySelectorAll('input, button, [tabindex="0"]')].filter(el => !el.disabled);
        const index = items.indexOf(document.activeElement);
        items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
      }
      // Let keys reach popup controls but stop parent document shortcuts.
      if (!dialog.contains(event.target)) event.stopImmediatePropagation();
    }, true);
    dialog.addEventListener('keydown', event => event.stopPropagation());
    // A click generated from a label also targets its associated color input.
    root.addEventListener('click', event => {
      if (sampling) return;
      if (event.target.matches?.('input[type="color"]:not(:disabled)')) {
        event.preventDefault(); event.stopImmediatePropagation(); open(event.target);
      }
    }, true);
    new MutationObserver(() => { if (target && !validTarget()) close(); }).observe(document.body, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'aria-hidden'],
    });
    root.addEventListener('resize', position);
    return { close, isOpen: () => !!target };
  }
  const api = { parseHex, rgbToHex, rgbToHsv, hsvToRgb, install };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SoapyPanels = root.SoapyPanels || {};
  root.SoapyPanels.linuxColorPicker = api;
})(typeof window !== 'undefined' ? window : globalThis);
