/* Shared in-page notice. Replaces window.alert so a dismissed message cannot
   leave an input unable to type (native dialogs do not always return focus). */
(function () {
  let root = null;
  let textEl = null;
  let okBtn = null;
  let cancelBtn = null;
  let mode = "alert";
  let resolver = null;
  let restoreId = null;
  let lastTextInput = null;

  function isTextInput(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
    if (el.tagName !== "INPUT") return false;
    const type = (el.type || "text").toLowerCase();
    return type !== "button" && type !== "submit" && type !== "checkbox" &&
      type !== "radio" && type !== "range" && type !== "file" && type !== "hidden";
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!target || (root && root.contains(target))) return;
    if (isTextInput(target)) lastTextInput = target;
  }, true);

  function build() {
    if (root) return;
    root = document.createElement("div");
    root.id = "appNotice";
    root.className = "appNotice hidden";
    root.setAttribute("role", "alertdialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-hidden", "true");
    root.innerHTML =
      '<div class="appNoticeCard">' +
        '<p id="appNoticeText"></p>' +
        '<div class="appNoticeActions">' +
          '<button type="button" id="appNoticeCancel">Cancel</button>' +
          '<button type="button" id="appNoticeOk">OK</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(root);
    textEl = root.querySelector("#appNoticeText");
    okBtn = root.querySelector("#appNoticeOk");
    cancelBtn = root.querySelector("#appNoticeCancel");
    okBtn.addEventListener("click", () => finish(true));
    cancelBtn.addEventListener("click", () => finish(false));
    root.addEventListener("mousedown", (event) => {
      if (event.target === root) finish(mode !== "confirm");
    });
    document.addEventListener("keydown", (event) => {
      if (!root || root.classList.contains("hidden")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(mode !== "confirm");
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      }
    });
  }

  function pickTarget() {
    if (restoreId) {
      const chosen = document.getElementById(restoreId);
      if (visible(chosen) && !chosen.disabled && !chosen.readOnly) return chosen;
    }
    if (visible(lastTextInput) && !lastTextInput.disabled && !lastTextInput.readOnly) {
      return lastTextInput;
    }
    return null;
  }

  function finish(result) {
    if (!root || root.classList.contains("hidden")) return;
    root.classList.add("hidden");
    root.setAttribute("aria-hidden", "true");
    const target = pickTarget();
    const done = resolver;
    const wasConfirm = mode === "confirm";
    resolver = null;
    restoreId = null;
    document.body.style.pointerEvents = "";
    document.documentElement.style.pointerEvents = "";
    const focusTarget = () => {
      try { window.focus(); } catch (err) { /* ignore */ }
      if (target && typeof target.focus === "function") {
        try { target.focus(); } catch (err) { /* ignore */ }
      }
    };
    focusTarget();
    requestAnimationFrame(focusTarget);
    setTimeout(focusTarget, 30);
    if (done) done(wasConfirm ? !!result : undefined);
  }

  function open(message, kind, focusId) {
    build();
    if (resolver) {
      const previous = resolver;
      resolver = null;
      previous(false);
    }
    mode = kind;
    restoreId = focusId || null;
    textEl.textContent = message == null ? "" : String(message);
    cancelBtn.classList.toggle("hidden", kind !== "confirm");
    root.classList.remove("hidden");
    root.setAttribute("aria-hidden", "false");
    okBtn.focus();
  }

  function alertNotice(message, focusId) {
    open(message, "alert", focusId || null);
  }

  function confirmNotice(message, focusId) {
    return new Promise((resolve) => {
      resolver = resolve;
      open(message, "confirm", focusId || null);
    });
  }

  window.alert = function (message) {
    alertNotice(message);
  };

  window.AppNotice = {
    alert: alertNotice,
    confirm: confirmNotice
  };
})();
