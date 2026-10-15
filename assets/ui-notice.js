/* Shared in-page notice. Replaces window.alert so a dismissed message cannot
   leave an input unable to type (native dialogs do not always return focus).
   Dialogs queue. Opening a second notice does not resolve the one already
   on screen, so a replaced confirm cannot be mistaken for Cancel. */
(function (root, factory) {
  const api = { createNotice: factory };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    const notice = factory(root.document, root);
    root.alert = function (message) { notice.alert(message); };
    root.AppNotice = notice;
  }
})(typeof window !== "undefined" ? window : null, function (document, window) {
  let root = null;
  let textEl = null;
  let okBtn = null;
  let cancelBtn = null;
  let mode = "alert";
  let active = null;
  const queue = [];
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

  if (document && typeof document.addEventListener === "function") {
    document.addEventListener("focusin", (event) => {
      const target = event.target;
      if (!target || (root && root.contains && root.contains(target))) return;
      if (isTextInput(target)) lastTextInput = target;
    }, true);
  }

  function el(tag, id, text) {
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (text) node.textContent = text;
    return node;
  }

  function build() {
    if (root || !document || !document.body) return;
    root = el("div", "appNotice");
    root.className = "appNotice hidden";
    root.setAttribute("role", "alertdialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-hidden", "true");
    const card = el("div");
    card.className = "appNoticeCard";
    textEl = el("p", "appNoticeText");
    const actions = el("div");
    actions.className = "appNoticeActions";
    cancelBtn = el("button", "appNoticeCancel", "Cancel");
    cancelBtn.type = "button";
    okBtn = el("button", "appNoticeOk", "OK");
    okBtn.type = "button";
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    card.appendChild(textEl);
    card.appendChild(actions);
    root.appendChild(card);
    document.body.appendChild(root);
    okBtn.addEventListener("click", () => finish(true));
    cancelBtn.addEventListener("click", () => finish(false));
    root.addEventListener("mousedown", (event) => {
      if (event.target !== root) return;
      if (mode === "choose") return;
      finish(mode !== "confirm");
    });
    document.addEventListener("keydown", (event) => {
      if (!root || root.classList.contains("hidden")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        if (mode === "choose") return;
        finish(mode !== "confirm");
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        const focused = document.activeElement;
        finish(focused === cancelBtn ? false : true);
      }
    });
  }

  function pickTarget() {
    if (restoreId && document.getElementById) {
      const chosen = document.getElementById(restoreId);
      if (visible(chosen) && !chosen.disabled && !chosen.readOnly) return chosen;
    }
    if (visible(lastTextInput) && !lastTextInput.disabled && !lastTextInput.readOnly) {
      return lastTextInput;
    }
    return null;
  }

  function pump() {
    if (active || !queue.length) return;
    active = queue.shift();
    show(active);
  }

  function show(item) {
    build();
    if (!root) {
      active = null;
      if (item.kind === "choose" && item.resolve) item.resolve("interrupted");
      else if (item.kind === "confirm" && item.resolve) item.resolve(false);
      else if (item.resolve) item.resolve();
      pump();
      return;
    }
    mode = item.kind;
    restoreId = item.focusId || null;
    textEl.textContent = item.message == null ? "" : String(item.message);
    okBtn.textContent = item.okLabel || "OK";
    cancelBtn.textContent = item.cancelLabel || "Cancel";
    cancelBtn.classList.toggle("hidden", item.kind === "alert");
    root.classList.remove("hidden");
    root.setAttribute("aria-hidden", "false");
    if (okBtn.focus) okBtn.focus();
  }

  function settle(item, accepted) {
    if (!item || typeof item.resolve !== "function") return;
    if (item.kind === "choose") item.resolve(accepted ? "update" : "decline");
    else if (item.kind === "confirm") item.resolve(!!accepted);
    else item.resolve();
  }

  function finish(accepted) {
    if (!active || !root || root.classList.contains("hidden")) return;
    root.classList.add("hidden");
    root.setAttribute("aria-hidden", "true");
    const target = pickTarget();
    const item = active;
    active = null;
    restoreId = null;
    if (document.body && document.body.style) document.body.style.pointerEvents = "";
    if (document.documentElement && document.documentElement.style) {
      document.documentElement.style.pointerEvents = "";
    }
    const focusTarget = () => {
      try { if (window && window.focus) window.focus(); } catch (err) { /* ignore */ }
      if (target && typeof target.focus === "function") {
        try { target.focus(); } catch (err) { /* ignore */ }
      }
    };
    focusTarget();
    const raf = window && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : (fn) => setTimeout(fn, 0);
    raf(focusTarget);
    setTimeout(focusTarget, 30);
    settle(item, accepted);
    pump();
  }

  function enqueue(item) {
    queue.push(item);
    pump();
  }

  function alertNotice(message, focusId) {
    enqueue({ kind: "alert", message: message, focusId: focusId || null, resolve: null });
  }

  function confirmNotice(message, focusId) {
    return new Promise((resolve) => {
      enqueue({ kind: "confirm", message: message, focusId: focusId || null, resolve: resolve });
    });
  }

  /* Update / Not now. Only those buttons settle the promise.
     "update" accepts. "decline" is the explicit dismissal. */
  function chooseNotice(message, okLabel, cancelLabel) {
    return new Promise((resolve) => {
      enqueue({
        kind: "choose",
        message: message,
        okLabel: okLabel || "Update",
        cancelLabel: cancelLabel || "Not now",
        resolve: resolve
      });
    });
  }

  return {
    alert: alertNotice,
    confirm: confirmNotice,
    choose: chooseNotice,
    pending: function () { return queue.length + (active ? 1 : 0); }
  };
});
