/**
 * Conduit recorder content script.
 *
 * Injected programmatically by the SW via chrome.scripting.executeScript
 * when a user clicks "Record workflow" in the popup. Captures click/input/
 * keydown/submit events on the page and posts them to the SW via
 * chrome.runtime.sendMessage. The SW correlates each event with an AX-tree
 * snapshot taken via CDP.
 *
 * Idempotent: a window-level flag prevents double-instrumentation if the
 * SW injects twice (e.g. across SPA navigations the SW thinks it lost).
 *
 * Sensitive-input redaction: values from <input type=password|email|tel>
 * and any element with autocomplete containing "cc-" or "password" are
 * replaced with the literal string "[REDACTED]" before leaving the page.
 * Recording credentials would be a footgun.
 */

(() => {
  const FLAG = "__conduitRecorderInstalled" as const;
  type WindowWithFlag = Window & { [FLAG]?: boolean };
  const w = window as WindowWithFlag;
  if (w[FLAG]) return;
  w[FLAG] = true;

  const TEXT_MAX = 80;

  interface TargetDescriptor {
    tagName: string;
    id?: string;
    classList?: string[];
    role?: string;
    ariaLabel?: string;
    text?: string;
    name?: string;
    inputType?: string;
  }

  function describe(el: Element): TargetDescriptor {
    const out: TargetDescriptor = { tagName: el.tagName.toLowerCase() };
    if (el.id) out.id = el.id;
    if (el.classList.length > 0) {
      out.classList = Array.from(el.classList).slice(0, 8);
    }
    const role = el.getAttribute("role");
    if (role) out.role = role;
    const ariaLabel =
      el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby");
    if (ariaLabel) out.ariaLabel = ariaLabel;
    const text = (el.textContent ?? "").trim();
    if (text) out.text = text.length > TEXT_MAX ? text.slice(0, TEXT_MAX - 1) + "…" : text;
    const nameAttr = el.getAttribute("name");
    if (nameAttr) out.name = nameAttr;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const t = (el as HTMLInputElement).type;
      if (t) out.inputType = t;
    }
    return out;
  }

  function isSensitiveInput(el: Element): boolean {
    if (
      el instanceof HTMLInputElement &&
      ["password", "email", "tel"].includes(el.type)
    ) {
      return true;
    }
    const ac = el.getAttribute("autocomplete") ?? "";
    if (/cc-|password/i.test(ac)) return true;
    return false;
  }

  function send(payload: unknown): void {
    try {
      chrome.runtime.sendMessage(payload, () => {
        // Swallow any "no receiver" errors — the SW may have stopped recording.
        void chrome.runtime.lastError;
      });
    } catch {
      /* extension context invalidated, page outliving extension reload */
    }
  }

  function postEvent(event: object): void {
    send({ kind: "conduit/recorder-event", event });
  }

  document.addEventListener(
    "click",
    (ev) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      postEvent({
        type: "click",
        target: describe(target),
        x: ev.clientX,
        y: ev.clientY,
        t: performance.now(),
      });
    },
    true,
  );

  // 'input' fires on every keystroke; we coalesce by sending only the latest
  // value per element after a short debounce.
  const inputDebounce = new Map<Element, number>();
  document.addEventListener(
    "input",
    (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
        return;
      }
      const prev = inputDebounce.get(target);
      if (prev !== undefined) window.clearTimeout(prev);
      const id = window.setTimeout(() => {
        inputDebounce.delete(target);
        const value = isSensitiveInput(target) ? "[REDACTED]" : target.value;
        postEvent({
          type: "input",
          target: describe(target),
          value,
          t: performance.now(),
        });
      }, 250);
      inputDebounce.set(target, id);
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (ev) => {
      // Only capture the keys profiles tend to care about (Enter, Escape, Tab,
      // arrow keys). Plain alphanumeric keys are covered by `input` events.
      const interesting = new Set([
        "Enter",
        "Escape",
        "Tab",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ]);
      if (!interesting.has(ev.key)) return;
      const target = ev.target;
      if (!(target instanceof Element)) return;
      postEvent({
        type: "keydown",
        key: ev.key,
        target: describe(target),
        t: performance.now(),
      });
    },
    true,
  );

  document.addEventListener(
    "submit",
    (ev) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      postEvent({ type: "submit", target: describe(target), t: performance.now() });
    },
    true,
  );

  // Best-effort SPA navigation capture. History API hooks via monkey-patch.
  const fireNav = (): void => {
    postEvent({ type: "navigation", url: location.href, t: performance.now() });
  };
  window.addEventListener("popstate", fireNav);
  const _push = history.pushState;
  history.pushState = function (...args) {
    const r = _push.apply(this, args);
    fireNav();
    return r;
  };
  const _replace = history.replaceState;
  history.replaceState = function (...args) {
    const r = _replace.apply(this, args);
    fireNav();
    return r;
  };
})();
