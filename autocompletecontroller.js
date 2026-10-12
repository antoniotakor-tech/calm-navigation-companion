// ---------------------------------------------------------------------------
// Autocomplete controller — accessible combobox behaviour for the start/
// destination address fields.
//
// Split in two halves on purpose:
//   1. Pure helpers (debounce, sequencer, computeNextActiveIndex, decision
//      functions) — DOM-free, unit-tested directly under `node --test`.
//   2. AutocompleteController — the DOM-wiring class that uses them. This
//      half is intentionally not unit-tested (same convention as app.js
//      itself, which also has no tests): it needs a real browser DOM, and
//      this project has no jsdom/browser-test dependency. It's covered by
//      the manual test checklist instead.
// ---------------------------------------------------------------------------

const TYPE_ICONS = {
  address: "📍", street: "🛣️", place: "📌",
  station: "🚉", park: "🌳", landmark: "🏛️", "current-location": "🧭",
  food: "☕", shop: "🛍️", transit: "🚏",
};

// ---- Pure helpers ----------------------------------------------------------

function debounce(fn, waitMs) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

// Monotonic token guard: "never allow older responses to overwrite newer
// results" even if a stale request somehow isn't cancelled in time.
function createSequencer() {
  let current = 0;
  return {
    next() {
      current += 1;
      return current;
    },
    isCurrent(token) {
      return token === current;
    },
  };
}

function shouldTriggerSearch(value, minChars) {
  return String(value || "").trim().length >= minChars;
}

// currentIndex === -1 means "no item highlighted yet". Wraps in both
// directions; returns -1 unchanged when the list is empty.
function computeNextActiveIndex(currentIndex, key, length) {
  if (length <= 0) return -1;
  if (key === "ArrowDown") {
    if (currentIndex < 0) return 0;
    return (currentIndex + 1) % length;
  }
  if (key === "ArrowUp") {
    if (currentIndex < 0) return length - 1;
    return (currentIndex - 1 + length) % length;
  }
  return currentIndex;
}

// Retyping after a selection should stop treating the field as "already
// resolved to exact coordinates" the moment the text no longer matches what
// was selected — this is what lets runSearch() in app.js know whether it's
// safe to skip re-geocoding.
function stillMatchesSelection(inputValue, selectedValue) {
  return selectedValue != null && inputValue === selectedValue;
}

function labelForItem(item) {
  // An explicit label wins — local place matches carry a display-only
  // secondary line ("Shop · 120 m away") that doesn't belong in the field.
  if (item.label) return item.label;
  return item.secondary ? `${item.primary}, ${item.secondary}` : item.primary;
}

// ---- DOM controller ---------------------------------------------------------

class AutocompleteController {
  // options:
  //   input, listEl, statusEl, wrapperEl: DOM elements (wrapperEl scopes the
  //     outside-click check; defaults to input.closest(".route-input-row")).
  //   isStartField: bool — adds the persistent "Use my current location" item.
  //   geocodingService, ranking: the two sibling modules (injected so this
  //     file has no hard import — matches the classic-script/global convention
  //     used across the rest of the project).
  //   getUserContext(): () => { point:{lat,lon}|null, city, state, countryCode }
  //   onSelect(result): called with { lat, lon, label } when a real place is chosen.
  //   onUseCurrentLocation(): async () => { lat, lon, label } | null, only used
  //     when isStartField is true.
  //   getLocalMatches(query): optional () => [{type, primary, secondary, lat, lon}]
  //     — nearby places the app already knows about (e.g. cafés/shops loaded
  //     on the map), shown first because "near me" beats "matches the name
  //     somewhere else". Also shown on their own if the geocoder fails.
  //   minChars (default 2), debounceMs (default 300), limit (default 6).
  constructor(options) {
    this.input = options.input;
    this.listEl = options.listEl;
    this.statusEl = options.statusEl;
    this.wrapperEl = options.wrapperEl || this.input.closest(".route-input-row") || this.input.parentElement;
    this.isStartField = !!options.isStartField;
    this.geocodingService = options.geocodingService;
    this.ranking = options.ranking;
    this.getUserContext = options.getUserContext || (() => ({}));
    this.onSelect = options.onSelect || (() => {});
    this.onUseCurrentLocation = options.onUseCurrentLocation || (async () => null);
    this.getLocalMatches = options.getLocalMatches || (() => []);
    this.minChars = options.minChars || 2;
    this.limit = options.limit || 6;
    this.endpointBase = options.endpointBase || "";

    this.items = [];
    this.activeIndex = -1;
    this.open_ = false;
    this.selectedValue = null;
    this.abortController = null;
    this.sequencer = createSequencer();
    this.lastQuery = "";

    if (!this.listEl.id) this.listEl.id = `${this.input.id || "ac"}-listbox`;
    this.input.setAttribute("role", "combobox");
    this.input.setAttribute("aria-autocomplete", "list");
    this.input.setAttribute("aria-expanded", "false");
    this.input.setAttribute("aria-controls", this.listEl.id);
    this.input.setAttribute("autocomplete", "off");
    this.listEl.setAttribute("role", "listbox");
    const inputLabel = this.input.getAttribute("aria-label") || this.input.placeholder || "address";
    this.listEl.setAttribute("aria-label", `${inputLabel} suggestions`);

    this.debouncedSearch = debounce((value) => this.runSearch(value), options.debounceMs || 300);

    this.input.addEventListener("input", () => this.handleInput());
    this.input.addEventListener("focus", () => this.handleFocus());
    this.input.addEventListener("keydown", (e) => this.handleKeydown(e));
    this._onDocPointerDown = (e) => {
      if (!this.wrapperEl.contains(e.target) && !this.listEl.contains(e.target)) this.close();
    };
    document.addEventListener("pointerdown", this._onDocPointerDown);
  }

  destroy() {
    document.removeEventListener("pointerdown", this._onDocPointerDown);
    this.debouncedSearch.cancel();
    if (this.abortController) this.abortController.abort();
  }

  handleInput() {
    const value = this.input.value;
    if (!stillMatchesSelection(value, this.selectedValue)) this.selectedValue = null;

    if (!shouldTriggerSearch(value, this.minChars)) {
      this.debouncedSearch.cancel();
      if (this.isStartField) this.showCurrentLocationOnly();
      else this.close();
      return;
    }
    this.setLoading();
    this.debouncedSearch(value.trim());
  }

  handleFocus() {
    if (!shouldTriggerSearch(this.input.value, this.minChars)) {
      if (this.isStartField) this.showCurrentLocationOnly();
    } else if (this.items.length) {
      this.openList();
    }
  }

  showCurrentLocationOnly() {
    this.setItems([{ type: "current-location", primary: "Use my current location", secondary: "", isAction: true }]);
  }

  async runSearch(query) {
    const token = this.sequencer.next();
    this.lastQuery = query;
    if (this.abortController) this.abortController.abort();
    this.abortController = new AbortController();

    const ctx = this.getUserContext() || {};
    // Started alongside the geocoder so nearby places never add latency.
    const localPromise = this.safeLocalMatches(query);
    try {
      const { hits } = await this.geocodingService.forwardGeocode({
        query,
        point: ctx.point || null,
        limit: this.limit,
        endpointBase: this.endpointBase,
        signal: this.abortController.signal,
      });
      if (!this.sequencer.isCurrent(token)) return; // superseded by a newer keystroke

      const ranked = this.ranking
        .rankHits(hits, {
          queryText: query,
          userPoint: ctx.point || null,
          userCity: ctx.city || null,
          userState: ctx.state || null,
          userCountryCode: ctx.countryCode || null,
        })
        .slice(0, this.limit);

      // Don't hold the list hostage to the slower nearby-place lookup: show
      // geocoder results after a short grace period, then re-render with
      // nearby places on top whenever they arrive (2026-10-12).
      let local = await Promise.race([localPromise, new Promise((r) => setTimeout(() => r(null), 700))]);
      if (!this.sequencer.isCurrent(token)) return;
      if (local === null) {
        this.renderMerged([], ranked, query);
        local = await localPromise;
        if (!this.sequencer.isCurrent(token) || !local.length) return;
      }
      this.renderMerged(local, ranked, query);
    } catch (e) {
      if (!this.sequencer.isCurrent(token)) return;
      if (e && e.kind === "cancelled") return; // superseded request, not a user-facing error
      // The address service failed, but nearby places we already know about
      // are still worth offering instead of only an error.
      const local = await localPromise;
      if (!this.sequencer.isCurrent(token)) return;
      if (local.length) { this.setItems(local); return; }
      this.setError(e, query);
    }
  }

  renderMerged(local, ranked, query) {
    {
      // Drop geocoder hits that are the same place as a local match (same
      // name within ~150 m) so nothing appears twice.
      const merged = [
        ...local,
        ...ranked.filter((r) => !local.some((l) =>
          l.primary.toLowerCase() === String(r.primary || "").toLowerCase() &&
          Math.abs(l.lat - r.lat) < 0.0015 && Math.abs(l.lon - r.lon) < 0.0015)),
      ].slice(0, this.limit);

      if (!merged.length) {
        this.setEmpty(query);
        return;
      }
      const items = this.isStartField
        ? [{ type: "current-location", primary: "Use my current location", secondary: "", isAction: true }, ...merged]
        : merged;
      this.setItems(items);
    }
  }

  async safeLocalMatches(query) {
    try {
      return ((await this.getLocalMatches(query)) || []).slice(0, 3);
    } catch (e) {
      return []; // a local lookup bug must never break address search
    }
  }

  retryLastQuery() {
    if (this.lastQuery) {
      this.setLoading();
      this.runSearch(this.lastQuery);
    }
  }

  // ---- rendering ----

  setLoading() {
    this.openList();
    this.statusEl.textContent = "Searching…";
    this.statusEl.removeAttribute("data-error");
  }

  setEmpty(query) {
    this.items = this.isStartField
      ? [{ type: "current-location", primary: "Use my current location", secondary: "", isAction: true }]
      : [];
    this.renderList();
    this.statusEl.textContent = `No results for "${query}".`;
    this.statusEl.removeAttribute("data-error");
    this.openList();
  }

  setError(err, query) {
    this.items = this.isStartField
      ? [{ type: "current-location", primary: "Use my current location", secondary: "", isAction: true }]
      : [];
    this.renderList();
    const reason = err && err.kind === "timeout" ? "took too long" : "couldn't load suggestions";
    this.statusEl.textContent = `Search ${reason} for "${query}". `;
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "ac-retry-btn";
    retryBtn.textContent = "Retry";
    retryBtn.addEventListener("click", () => this.retryLastQuery());
    this.statusEl.appendChild(retryBtn);
    this.statusEl.setAttribute("data-error", "true");
    this.openList();
  }

  setItems(items) {
    this.items = items;
    this.activeIndex = -1;
    this.statusEl.textContent = "";
    this.statusEl.removeAttribute("data-error");
    this.renderList();
    this.openList();
  }

  renderList() {
    this.listEl.innerHTML = "";
    this.items.forEach((item, i) => {
      const li = document.createElement("li");
      li.id = `${this.listEl.id}-opt-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === this.activeIndex));
      li.className = "ac-option" + (item.isAction ? " ac-option-action" : "") + (i === this.activeIndex ? " ac-option-active" : "");
      li.dataset.index = String(i);

      const icon = document.createElement("span");
      icon.className = "ac-option-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = TYPE_ICONS[item.type] || "📌";

      const text = document.createElement("span");
      text.className = "ac-option-text";
      const primary = document.createElement("span");
      primary.className = "ac-option-primary";
      primary.textContent = item.primary;
      text.appendChild(primary);
      if (item.secondary) {
        const secondary = document.createElement("span");
        secondary.className = "ac-option-secondary";
        secondary.textContent = item.secondary;
        text.appendChild(secondary);
      }

      li.appendChild(icon);
      li.appendChild(text);
      li.addEventListener("pointerdown", (e) => {
        // Selecting on pointerdown (not click) so the input's blur — which
        // would otherwise fire first and close the list before a click
        // event ever arrives — never gets the chance to steal the selection.
        e.preventDefault();
        this.selectItem(i);
      });
      this.listEl.appendChild(li);
    });
  }

  updateActiveDescendant() {
    Array.from(this.listEl.children).forEach((li, i) => {
      const active = i === this.activeIndex;
      li.setAttribute("aria-selected", String(active));
      li.classList.toggle("ac-option-active", active);
    });
    if (this.activeIndex >= 0 && this.listEl.children[this.activeIndex]) {
      const activeEl = this.listEl.children[this.activeIndex];
      this.input.setAttribute("aria-activedescendant", activeEl.id);
      if (activeEl.scrollIntoView) activeEl.scrollIntoView({ block: "nearest" });
    } else {
      this.input.removeAttribute("aria-activedescendant");
    }
  }

  openList() {
    this.open_ = true;
    this.listEl.style.display = "block";
    this.input.setAttribute("aria-expanded", "true");
    this.fitToViewport();
  }

  // Keep the list above the on-screen keyboard: size it to the visible
  // viewport instead of a fixed 300px (on an iPhone SE the keyboard hid most
  // of it). Re-fits as the keyboard opens/closes.
  fitToViewport() {
    const vv = typeof window !== "undefined" && window.visualViewport;
    if (!vv || this.listEl.style.display === "none") return;
    if (!this._vvBound) {
      this._vvBound = true;
      vv.addEventListener("resize", () => this.fitToViewport());
    }
    const top = this.listEl.getBoundingClientRect().top;
    this.listEl.style.maxHeight = Math.max(110, Math.min(300, vv.offsetTop + vv.height - top - 10)) + "px";
  }

  close() {
    this.open_ = false;
    this.listEl.style.display = "none";
    this.input.setAttribute("aria-expanded", "false");
    this.input.removeAttribute("aria-activedescendant");
    this.activeIndex = -1;
    this.debouncedSearch.cancel();
    if (this.abortController) this.abortController.abort();
  }

  handleKeydown(e) {
    if (e.key === "Escape") {
      if (this.open_) {
        e.preventDefault();
        this.close();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!this.open_ || !this.items.length) return;
      e.preventDefault();
      this.activeIndex = computeNextActiveIndex(this.activeIndex, e.key, this.items.length);
      this.updateActiveDescendant();
      return;
    }
    if (e.key === "Enter") {
      if (this.open_ && this.activeIndex >= 0) {
        e.preventDefault();
        this.selectItem(this.activeIndex);
      }
      return;
    }
  }

  async selectItem(index) {
    const item = this.items[index];
    if (!item) return;

    if (item.type === "current-location") {
      this.input.value = "Locating…";
      this.close();
      this.statusEl.textContent = "";
      this.statusEl.removeAttribute("data-error");
      const result = await this.onUseCurrentLocation();
      if (result) {
        this.input.value = result.label || "Current location";
        this.selectedValue = this.input.value;
        this.onSelect({ lat: result.lat, lon: result.lon, label: this.selectedValue });
      } else {
        this.input.value = "";
      }
      return;
    }

    const label = labelForItem(item);
    this.input.value = label;
    this.selectedValue = label;
    this.close();
    this.onSelect({ lat: item.lat, lon: item.lon, label });
  }
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    debounce, createSequencer, shouldTriggerSearch, computeNextActiveIndex,
    stillMatchesSelection, labelForItem, AutocompleteController, TYPE_ICONS,
  };
}
