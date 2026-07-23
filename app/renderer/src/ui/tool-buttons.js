window.SoapyPanels = window.SoapyPanels || {};
    (function () {
      const i18n =
        window.SoapyPanels &&
          window.SoapyPanels.i18n &&
          typeof window.SoapyPanels.i18n.t === "function"
          ? window.SoapyPanels.i18n
          : null;

      function tr(key, fallback) {
        return i18n && typeof i18n.t === "function" ? i18n.t(key) : fallback;
      }

      const fallbackSvgs = {
        duplicate:
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<rect x="4" y="4" width="9" height="9" rx="2" fill="currentColor" opacity="0.6"></rect>' +
          '<rect x="9" y="9" width="9" height="9" rx="2" fill="currentColor"></rect>' +
          "</svg>",
        deleteBubble:
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<rect x="9" y="4" width="6" height="2.5" rx="1" fill="currentColor"></rect>' +
          '<rect x="4" y="7" width="16" height="2" fill="currentColor"></rect>' +
          '<rect x="6" y="9" width="12" height="10" rx="2" fill="currentColor"></rect>' +
          '<rect x="9" y="11" width="2" height="6" fill="#fff" opacity="0.85"></rect>' +
          '<rect x="13" y="11" width="2" height="6" fill="#fff" opacity="0.85"></rect>' +
          "</svg>",
        saveStyle:
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<path d="M6 5h9l3 3v11H6z" fill="currentColor"></path>' +
          '<rect x="8" y="7" width="6" height="4" fill="#fff" opacity="0.85"></rect>' +
          '<rect x="9" y="13" width="6" height="4" fill="#fff" opacity="0.85"></rect>' +
          "</svg>",
        deleteStyle:
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<circle cx="12" cy="12" r="8" fill="currentColor" opacity="0.95"></circle>' +
          '<path d="M9 9l6 6m0-6-6 6" stroke="#fff" stroke-width="2" stroke-linecap="round"></path>' +
          "</svg>",
        cloud:
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<path d="M7.4 18h9.8a4 4 0 000-8h-.2A5.5 5.5 0 006.5 8.8 3.6 3.6 0 007.4 18z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>' +
          '<path d="M9 18H7.5a3 3 0 01-.3-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>' +
          "</svg>",
        reset:
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<path d="M20 12a8 8 0 11-2.35-5.65" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>' +
          '<path d="M20 4v4h-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>' +
          "</svg>",
      };

      // Definition of buttons to style
      const buttons = [
        {
          id: "btnDuplicate",
          cls: "soapy-tool-button--blue",
          icon: "⧉",
          labelKey: "toolButtons.duplicate",
          label: "Duplicate",
          image: "assets/ui/Duplicate Bubble.png",
          fallbackSvg: fallbackSvgs.duplicate,
          iconClass: "soapy-tool-button-img--duplicate",
        },
        {
          id: "btnDelete",
          cls: "soapy-tool-button--red",
          icon: "🗑",
          labelKey: "toolButtons.delete",
          label: "Delete",
          removeClasses: ["warn"],
          image: "assets/ui/Delete bubble.png",
          fallbackSvg: fallbackSvgs.deleteBubble,
        },
        {
          id: "btnMerge2",
          cls: "soapy-tool-button--blue",
          icon: "⇌",
          labelKey: "toolButtons.mergeBubbles",
          label: "Merge Bubbles",
          hideIcon: true,
        },
        {
          id: "btnUnmerge",
          cls: "soapy-tool-button--red",
          icon: "↺",
          labelKey: "toolButtons.unmerge",
          label: "Unmerge",
          hideIcon: true,
        },
        {
          id: "btnSaveStyle",
          cls: "soapy-tool-button--blue",
          icon: "💾",
          labelKey: "toolButtons.saveStyle",
          label: "Save style",
          image: "assets/ui/Save Style.png",
          fallbackSvg: fallbackSvgs.saveStyle,
        },
        {
          id: "btnDeleteStyle",
          cls: "soapy-tool-button--red",
          icon: "✖",
          labelKey: "toolButtons.deleteStyle",
          label: "Delete style",
          image: "assets/ui/Delete Styles.png",
          fallbackSvg: fallbackSvgs.deleteStyle,
        },
        {
          id: "btnRandomizeCloud",
          cls: "soapy-tool-button--blue",
          icon: "☁",
          labelKey: "toolButtons.randomizeScallops",
          label: "Randomize scallops",
          image: "assets/ui/Cloud.png",
          fallbackSvg: fallbackSvgs.cloud,
        },
        {
          id: "btnRandomizeCloud2",
          cls: "soapy-tool-button--blue",
          icon: "☁",
          labelKey: "toolButtons.randomizeScallops",
          label: "Randomize scallops",
          image: "assets/ui/Cloud.png",
          fallbackSvg: fallbackSvgs.cloud,
        },
        {
          id: "btnThought3Reseed",
          cls: "soapy-tool-button--blue",
          icon: "☁",
          labelKey: "toolButtons.reshape",
          label: "Reshape",
          image: "assets/ui/Cloud.png",
          fallbackSvg: fallbackSvgs.cloud,
        },
        {
          id: "btnThought4Reseed",
          cls: "soapy-tool-button--blue",
          icon: "☁",
          labelKey: "toolButtons.reshape",
          label: "Reshape",
          image: "assets/ui/Cloud.png",
          fallbackSvg: fallbackSvgs.cloud,
        },
        {
          id: "btnRandomizeRays",
          cls: "soapy-tool-button--blue",
          labelKey: "toolButtons.randomizeRays",
          label: "Randomize rays",
          hideIcon: true,
        },
        {
          id: "btnRandomizeSpikes",
          cls: "soapy-tool-button--blue",
          icon: "✦",
          labelKey: "toolButtons.randomizeSpikes",
          label: "Randomize spikes",
          image: "assets/ui/Star.png",
        },
        {
          id: "btnSymmetrizeSpikes",
          cls: "soapy-tool-button--blue",
          icon: "⇄",
          labelKey: "toolButtons.symmetrizeSpikes",
          label: "Symmetrize spikes",
          image: "assets/ui/Star.png",
        },
        {
          id: "btnEditSpikes",
          cls: "soapy-tool-button--blue",
          icon: "✎",
          labelKey: "toolButtons.editSpikes",
          label: "Edit spikes",
          image: "assets/ui/Star.png",
        },
        {
          id: "btnRandomizeYell",
          cls: "soapy-tool-button--blue",
          icon: "ƒ~?",
          labelKey: "toolButtons.randomizeYell",
          label: "Randomize yell",
          image: "assets/ui/Yelling.png",
        },
        {
          id: "btnResetYell",
          cls: "soapy-tool-button--blue",
          icon: "↺",
          labelKey: "toolButtons.symmetrize",
          label: "Symmetrize",
          fallbackSvg: fallbackSvgs.reset,
        },
      ];

      function createFallbackIcon(wrapper, btn) {
        wrapper.classList.add("soapy-tool-button-icon--fallback");
        if (btn.fallbackSvg) {
          wrapper.innerHTML = btn.fallbackSvg;
        } else {
          wrapper.textContent = btn.icon || "";
        }
      }

      function createIconElement(btn) {

        if (btn.hideIcon) return null;

        const wrapper = document.createElement("span");
        wrapper.className = "soapy-tool-button-icon";
        wrapper.setAttribute("aria-hidden", "true");

        if (btn.image) {
          const img = document.createElement("img");
          img.className = "soapy-tool-button-img";
          if (btn.iconClass) {
            img.classList.add(btn.iconClass);
          }
          img.alt = "";
          // Load immediately to avoid Edge lazy-load intervention warnings
          img.decoding = "async";
          img.setAttribute("aria-hidden", "true");

          img.addEventListener("error", function handleMissing() {
            img.remove();
            createFallbackIcon(wrapper, btn);
          });

          img.src = encodeURI(btn.image);
          wrapper.appendChild(img);
        } else {
          createFallbackIcon(wrapper, btn);
        }

        return wrapper;
      }

      function getButtonLabel(btn) {
        return btn.labelKey ? tr(btn.labelKey, btn.label) : btn.label;
      }

      function refreshButtonText(el, btn) {
        const labelEl = el.querySelector(".soapy-tool-button-label");
        const label = getButtonLabel(btn);
        if (labelEl && labelEl.textContent !== label) labelEl.textContent = label;
        const statusEl = el.querySelector(".soapy-tool-button-status");
        if (statusEl && btn.status && statusEl.textContent !== btn.status) {
          statusEl.textContent = btn.status;
        }
      }

      function updateButtons() {
        buttons.forEach((btn) => {
          const el = document.getElementById(btn.id);
          // Check if element exists and hasn't been styled yet
          if (el && !el.classList.contains("soapy-tool-button")) {
            el.classList.add("soapy-tool-button", btn.cls);
            if (btn.status) {
              el.classList.add("soapy-tool-button--with-status");
            }

            if (btn.removeClasses) {
              btn.removeClasses.forEach((c) => el.classList.remove(c));
            }

            const iconEl = createIconElement(btn);
            const labelStack = document.createElement("span");
            labelStack.className = "soapy-tool-button-label-stack";

            const labelEl = document.createElement("span");
            labelEl.className = "soapy-tool-button-label";
            labelEl.textContent = getButtonLabel(btn);
            labelStack.appendChild(labelEl);

            if (btn.status) {
              const statusEl = document.createElement("span");
              statusEl.className = "soapy-tool-button-status";
              statusEl.textContent = btn.status;
              labelStack.appendChild(statusEl);
            }

            el.innerHTML = "";
            if (iconEl) {

              el.append(iconEl, labelStack);

            } else {

              el.append(labelStack);

            }
          } else if (el) {
            refreshButtonText(el, btn);
          }
        });
      }

      // Run immediately in case they exist
      updateButtons();

      // Watch for changes in the DOM to catch when these buttons are created/inserted
      const observer = new MutationObserver(() => {
        updateButtons();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      if (i18n && typeof i18n.onChange === "function") {
        i18n.onChange(updateButtons);
      }
    })();
