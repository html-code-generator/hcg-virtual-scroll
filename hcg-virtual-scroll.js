/*!
 * hcg-virtual-scroll - vanilla JS virtual scrolling
 * Author: HTML Code Generator
 * https://www.html-code-generator.com/
 * Documentation: https://www.html-code-generator.com/javascript/virtual-scrolling
 *
 * @version 1.0.4
 * @license MIT
 */

'use strict';

class HCGVirtualScroll {

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(arrayData, options = {}) {
    if (!options.container)  throw new Error('HCGVirtualScroll: "container" option is required.');
    if (!options.renderItem) throw new Error('HCGVirtualScroll: "renderItem" option is required.');

    // Resolve container element
    const container = typeof options.container === 'string'
      ? (document.querySelector(options.container) ||
         document.getElementById(options.container.replace(/^#/, '')))
      : options.container;

    if (!container) throw new Error('HCGVirtualScroll: container element not found.');

    // -- Config ---------------------------------------------------------------

    this._itemHeight          = options.itemHeight          !== undefined ? options.itemHeight          : 65;
    this._estimatedItemHeight = options.estimatedItemHeight !== undefined ? options.estimatedItemHeight  : (typeof this._itemHeight === 'number' ? this._itemHeight : 65);

    if (typeof this._itemHeight === 'number' && this._itemHeight <= 0) {
      throw new Error('HCGVirtualScroll: "itemHeight" must be a positive number greater than 0.');
    }
    this._bufferSize          = options.bufferSize          !== undefined ? options.bufferSize           : 3;
    this._maxHeight           = options.maxHeight           !== undefined ? options.maxHeight            : 10000000;
    this._keyField            = options.keyField            || null;
    this._adaptiveOverscan    = options.adaptiveOverscan    !== undefined ? options.adaptiveOverscan     : true;
    this._reverse             = options.reverse             || false;
    this._reachEndThreshold   = options.reachEndThreshold   !== undefined ? options.reachEndThreshold    : 5;
    this._renderItem          = options.renderItem;
    this._onScroll            = options.onScroll            || null;
    this._onVisibleChange     = options.onVisibleRangeChange || null;
    this._onRender            = options.onRender            || null;
    this._onReachEnd          = options.onReachEnd          || options.onLoadMore || null;
    this._onReachStart        = options.onReachStart        || null;
    this._onResize            = options.onResize            || null;

    // -- Empty state ----------------------------------------------------------

    this._emptyText = options.emptyText || null;
    this._emptyHTML = options.emptyHTML || null;

    // -- Loading state --------------------------------------------------------

    this._loadingText = options.loadingText || 'Loading...';
    this._loadingHTML = options.loadingHTML || null;

    // -- State ----------------------------------------------------------------

    this._items          = HCGVirtualScroll._toArray(arrayData, 'constructor data');
    this._positions      = [];
    this._rawTotal       = 0;
    this._lastStart      = -1;
    this._lastEnd        = -1;
    this._rafId          = null;
    this._reachedEnd     = false;
    this._reachedStart   = false;
    this._prevScrollTop  = 0;
    this._scrollSpeed    = 0;
    this._resizeObserver = null;
    this._loading        = false;
    this._destroyed      = false;
    this._forceFresh     = false;  // force fresh render on next recycle (after data change)
    this._warnedDuplicateKey = false;

    // -- DOM ------------------------------------------------------------------

    this._container = container;

    if (options.containerHeight) {
      const h = parseFloat(options.containerHeight);
      if (!isNaN(h) && h > 0) container.style.height = h + 'px';
    }

    container.classList.add('hcg-vs-container');

    this._phantom           = document.createElement('div');
    this._phantom.className = 'hcg-vs-phantom';

    this._content           = document.createElement('div');
    this._content.className = 'hcg-vs-content';
    this._content.setAttribute('role', 'list');
    if (options.ariaLabel) this._content.setAttribute('aria-label', options.ariaLabel);

    container.innerHTML = '';
    container.appendChild(this._phantom);
    container.appendChild(this._content);

    // Bind scroll handler once so the same reference can be removed in destroy()
    this._boundHandleScroll = this._handleScroll.bind(this);
    container.addEventListener('scroll', this._boundHandleScroll, { passive: true });

    // ResizeObserver
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        if (this._onResize) this._onResize({ width: this._container.clientWidth, height: this._container.clientHeight });
        this._lastStart = -1;
        this._lastEnd   = -1;
        this._render();
      });
      this._resizeObserver.observe(container);
    }

    // Initial render
    this._buildPositions();
    if (this._reverse && this._items.length > 0) {
      container.scrollTop = Math.max(0, this._phantom.offsetHeight - container.clientHeight);
    }
    this._render();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  // Normalize input to a real array. null / undefined become []. A non-array value
  // (object, string, number) is rejected with a warning so the list does not fail
  // silently when, for example, an API returns {} instead of [].
  static _toArray(data, where) {
    if (data == null) return [];
    if (Array.isArray(data)) return data;
    console.warn('HCGVirtualScroll: ' + (where || 'data') +
      ' must be an array, received ' + (typeof data) + '. Using an empty list instead.');
    return [];
  }

  _isFixed() {
    return typeof this._itemHeight === 'number';
  }

  _buildPositions() {
    if (this._isFixed()) {
      this._rawTotal = this._items.length * this._itemHeight;
    } else {
      let top = 0;
      this._positions = new Array(this._items.length);
      for (let i = 0; i < this._items.length; i++) {
        // guard against 0, negative, NaN - fall back to the estimated height
        let h = this._itemHeight(this._items[i], i);
        if (!(h > 0)) h = this._estimatedItemHeight;
        this._positions[i] = { top, height: h };
        top += h;
      }
      this._rawTotal = top;
    }
    this._phantom.style.height = Math.min(this._rawTotal, this._maxHeight) + 'px';
  }

  _extendPositions(newItems, startIdx) {
    if (this._isFixed()) {
      this._rawTotal = this._items.length * this._itemHeight;
    } else {
      const prev = this._positions[startIdx - 1];
      let top    = prev ? prev.top + prev.height : 0;
      for (let i = 0; i < newItems.length; i++) {
        // guard against 0, negative, NaN - fall back to the estimated height
        let h = this._itemHeight(newItems[i], startIdx + i);
        if (!(h > 0)) h = this._estimatedItemHeight;
        this._positions[startIdx + i] = { top, height: h };
        top += h;
      }
      this._rawTotal = top;
    }
    this._phantom.style.height = Math.min(this._rawTotal, this._maxHeight) + 'px';
  }

  // Compression ratio: maps the scrollable range (rawTotal - viewH) onto (maxHeight - viewH).
  // Using scrollable ranges - not total heights - ensures the last items are always reachable.
  // Returns 1 when no compression is needed.
  _scale() {
    if (this._rawTotal <= this._maxHeight) return 1;
    const viewH = this._container.clientHeight;
    const den   = this._maxHeight - viewH;
    return den > 0 ? (this._rawTotal - viewH) / den : this._rawTotal / this._maxHeight;
  }

  // Convert an item's unscaled top position to the scrollTop that shows it at the viewport top.
  _indexToScrollTop(index) {
    const raw   = this._isFixed() ? index * this._itemHeight : this._positions[index].top;
    const scale = this._scale();
    return scale > 1 ? raw / scale : raw;
  }

  _getItemHeight(index) {
    return this._isFixed() ? this._itemHeight : (this._positions[index].height || this._estimatedItemHeight);
  }

  _effectiveBuffer() {
    if (!this._adaptiveOverscan) return this._bufferSize;
    if (this._scrollSpeed > 500) return this._bufferSize * 4;
    if (this._scrollSpeed > 150) return this._bufferSize * 2;
    return this._bufferSize;
  }

  _calcVisibleRange(scrollTop) {
    const viewH = this._container.clientHeight;
    const count = this._items.length;
    if (count === 0) return { start: 0, end: -1 };

    const buf    = this._effectiveBuffer();
    const scale  = this._scale();
    const adj    = scrollTop * scale;
    // Items are rendered at natural heights, so the viewport covers viewH * scale unscaled pixels.
    const bottom = adj + viewH * scale;

    let start, end;

    if (this._isFixed()) {
      start = Math.floor(adj / this._itemHeight);
      end   = Math.ceil(bottom / this._itemHeight) - 1;
    } else {
      let lo = 0, hi = count - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this._positions[mid].top + this._positions[mid].height <= adj) { lo = mid + 1; }
        else { hi = mid; }
      }
      start = lo;
      end   = start;
      while (end < count - 1 && this._positions[end + 1].top < bottom) { end++; }
    }

    // rawStart / rawEnd  = strict viewport indices (used by reach callbacks)
    // start / end        = buffered/overscanned indices (used for rendering)
    return {
      rawStart: Math.max(0, start),
      rawEnd:   Math.min(count - 1, end),
      start:    Math.max(0, start - buf),
      end:      Math.min(count - 1, end + buf)
    };
  }

  _createItemElement(item, index) {
    const result = this._renderItem(item, index);
    let el;
    if (result instanceof Element) {
      el = result;
    } else {
      const wrapper     = document.createElement('div');
      wrapper.innerHTML = result;
      el = wrapper.firstElementChild || wrapper;
    }
    el.setAttribute('role', 'listitem');
    if (this._keyField != null) el.dataset.vsKey = String(item[this._keyField]);
    return el;
  }

  _renderFresh(range) {
    const frag = document.createDocumentFragment();
    for (let i = range.start; i <= range.end; i++) {
      const el        = this._createItemElement(this._items[i], i);
      el.style.height = this._getItemHeight(i) + 'px';
      frag.appendChild(el);
    }
    this._content.innerHTML = '';
    this._content.appendChild(frag);
  }

  _renderRecycled(range) {
    const pool     = new Map();
    const children = this._content.children;

    // When data changed (updateData / updateConfig / refresh), skip the pool so every
    // visible row is re-rendered with fresh content. During plain scrolling the pool is
    // used so DOM nodes - and their focus / checkbox / input state - are preserved.
    if (!this._forceFresh) {
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.dataset.vsKey !== undefined) pool.set(child.dataset.vsKey, child);
      }
    }

    const seen = new Set();  // duplicate-key detection for the rendered range
    const frag = document.createDocumentFragment();
    for (let i = range.start; i <= range.end; i++) {
      const h      = this._getItemHeight(i);
      const rawKey = this._items[i][this._keyField];

      // missing or null key - fall back to fresh render for this item
      if (rawKey == null) {
        const el        = this._createItemElement(this._items[i], i);
        el.style.height = h + 'px';
        frag.appendChild(el);
        continue;
      }

      const key = String(rawKey);

      // warn once if duplicate keys are found - recycling needs unique keys
      if (seen.has(key) && !this._warnedDuplicateKey) {
        this._warnedDuplicateKey = true;
        console.warn('HCGVirtualScroll: duplicate keyField value "' + key +
          '" detected. Keys must be unique - DOM recycling may bind the wrong row.');
      }
      seen.add(key);

      if (pool.has(key)) {
        const el  = pool.get(key);
        pool.delete(key);
        el.style.height = h + 'px';
        frag.appendChild(el);
      } else {
        const el        = this._createItemElement(this._items[i], i);
        el.style.height = h + 'px';
        frag.appendChild(el);
      }
    }

    this._content.innerHTML = '';
    this._content.appendChild(frag);
    this._forceFresh = false;  // reset after each render
  }

  // Render loading state inside content
  _renderLoading() {
    this._phantom.style.height    = '0px';
    this._content.style.transform = 'translateY(0px)';
    if (this._loadingHTML) {
      this._content.innerHTML = this._loadingHTML;
    } else {
      const el = document.createElement('div');
      el.className = 'hcg-vs-loading';
      el.textContent = this._loadingText;
      this._content.innerHTML = '';
      this._content.appendChild(el);
    }
  }

  // Render empty state inside content
  _renderEmpty() {
    this._phantom.style.height    = '0px';
    this._content.style.transform = 'translateY(0px)';
    if (this._emptyHTML) {
      this._content.innerHTML = this._emptyHTML;
    } else if (this._emptyText) {
      const el = document.createElement('div');
      el.className = 'hcg-vs-empty';
      el.textContent = this._emptyText;
      this._content.innerHTML = '';
      this._content.appendChild(el);
    } else {
      this._content.innerHTML = '';
    }
  }

  _render() {
    // Loading state takes priority - pause all rendering
    if (this._loading) return;

    const scrollTop = this._container.scrollTop;
    const range     = this._calcVisibleRange(scrollTop);

    if (this._onScroll) this._onScroll(scrollTop, { start: range.start, end: range.end });

    // Reach-end / reach-start callbacks
    // Threshold is checked against the strict viewport range (rawStart / rawEnd),
    // not the buffered range, so triggers fire when the real viewport edge nears
    // the list boundary - not earlier because of overscan.
    if (this._items.length > 0) {
      if (this._onReachEnd) {
        if (range.rawEnd >= this._items.length - 1 - this._reachEndThreshold) {
          if (!this._reachedEnd) {
            this._reachedEnd = true;
            this._onReachEnd({ start: range.start, end: range.end, total: this._items.length });
          }
        } else {
          this._reachedEnd = false;
        }
      }
      if (this._onReachStart) {
        if (range.rawStart <= this._reachEndThreshold) {
          if (!this._reachedStart) {
            this._reachedStart = true;
            this._onReachStart({ start: range.start, end: range.end, total: this._items.length });
          }
        } else {
          this._reachedStart = false;
        }
      }
    }

    // Transform updated BEFORE early-return check (Bug #1 fix):
    // In compressed scroll mode scrollTop can change while start/end stay the same,
    // so translateY must always be recalculated even when the rendered range is unchanged.
    if (this._items.length > 0 && range.end >= 0) {
      const scale        = this._scale();
      const adj          = scrollTop * scale;
      const firstItemTop = this._isFixed()
        ? range.start * this._itemHeight
        : this._positions[range.start].top;
      // Continuous translation: keeps rendered items pinned to the exact scroll position
      // so there is no visual jump when items enter or leave the DOM at the buffer boundary.
      // translateY = scrollTop - (adj - firstItemTop)
      //   adj           = scrollTop in unscaled item-space
      //   firstItemTop  = unscaled top of first rendered item
      //   the difference is how far into the first rendered item the viewport has scrolled
      this._content.style.transform = `translateY(${scrollTop - (adj - firstItemTop)}px)`;
    }

    if (range.start === this._lastStart && range.end === this._lastEnd) return;

    this._lastStart = range.start;
    this._lastEnd   = range.end;

    // Empty state
    if (this._items.length === 0) {
      this._renderEmpty();
      if (this._onVisibleChange) this._onVisibleChange({ start: 0, end: -1 });
      return;
    }

    if (this._keyField != null) {
      this._renderRecycled(range);
    } else {
      this._renderFresh(range);
    }

    if (this._onVisibleChange) this._onVisibleChange({ start: range.start, end: range.end });
    if (this._onRender)        this._onRender(range.start, range.end);
  }

  _handleScroll() {
    const currentTop    = this._container.scrollTop;
    this._scrollSpeed   = Math.abs(currentTop - this._prevScrollTop);
    this._prevScrollTop = currentTop;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(() => {
      this._render();
      this._rafId = null;
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  showLoading() {
    this._loading = true;
    this._renderLoading();
  }

  hideLoading() {
    this._loading = false;
    this._lastStart = -1;
    this._lastEnd   = -1;
    this._render();
  }

  refresh() {
    this._forceFresh = true;
    this._lastStart  = -1;
    this._lastEnd    = -1;
    this._render();
  }

  updateData(newData, keepScrollPosition = false) {
    const savedAdj     = this._container.scrollTop * this._scale();
    this._items        = HCGVirtualScroll._toArray(newData, 'updateData');
    this._reachedEnd   = false;
    this._reachedStart = false;
    this._forceFresh   = true;
    this._buildPositions();
    this._lastStart    = -1;
    this._lastEnd      = -1;
    this._container.scrollTop = (keepScrollPosition && this._items.length > 0)
      ? savedAdj / this._scale()
      : 0;
    this._render();
  }

  updateItems(newData) {
    this.updateData(newData, false);
  }

  append(newItems) {
    newItems = HCGVirtualScroll._toArray(newItems, 'append');
    if (!newItems.length) return;

    const wasAtBottom =
      this._reverse &&
      this._container.scrollTop >= this._phantom.offsetHeight - this._container.clientHeight - 50;

    const savedAdj = this._container.scrollTop * this._scale();
    const prevLen  = this._items.length;
    this._items    = this._items.concat(newItems);

    this._extendPositions(newItems, prevLen);
    this._reachedEnd = false;
    this._lastStart  = -1;
    this._lastEnd    = -1;

    this._container.scrollTop = wasAtBottom
      ? Math.max(0, this._phantom.offsetHeight - this._container.clientHeight)
      : savedAdj / this._scale();

    this._render();
  }

  prepend(newItems) {
    newItems = HCGVirtualScroll._toArray(newItems, 'prepend');
    if (!newItems.length) return;

    const savedAdj     = this._container.scrollTop * this._scale();
    this._items        = newItems.concat(this._items);
    this._buildPositions();
    this._reachedStart = false;
    this._lastStart    = -1;
    this._lastEnd      = -1;

    let addedHeight;
    if (this._isFixed()) {
      addedHeight = newItems.length * this._itemHeight;
    } else {
      addedHeight = 0;
      for (let i = 0; i < newItems.length; i++) addedHeight += this._positions[i].height;
    }
    // Add the prepended height in unscaled space, then re-scale to the new total.
    this._container.scrollTop = (savedAdj + addedHeight) / this._scale();
    this._render();
  }

  updateConfig(newOptions) {
    if (!newOptions) return;
    if (newOptions.itemHeight !== undefined) {
      if (typeof newOptions.itemHeight === 'number' && newOptions.itemHeight <= 0) {
        throw new Error('HCGVirtualScroll: "itemHeight" must be a positive number greater than 0.');
      }
      this._itemHeight = newOptions.itemHeight;
    }
    if (newOptions.estimatedItemHeight  !== undefined) this._estimatedItemHeight = newOptions.estimatedItemHeight;
    if (newOptions.bufferSize           !== undefined) this._bufferSize          = newOptions.bufferSize;
    if (newOptions.maxHeight            !== undefined) this._maxHeight           = newOptions.maxHeight;
    if (newOptions.keyField             !== undefined) this._keyField            = newOptions.keyField;
    if (newOptions.adaptiveOverscan     !== undefined) this._adaptiveOverscan    = newOptions.adaptiveOverscan;
    if (newOptions.reverse              !== undefined) this._reverse             = newOptions.reverse;
    if (newOptions.reachEndThreshold    !== undefined) this._reachEndThreshold   = newOptions.reachEndThreshold;
    if (newOptions.renderItem           !== undefined) this._renderItem          = newOptions.renderItem;
    if (newOptions.onScroll             !== undefined) this._onScroll            = newOptions.onScroll;
    if (newOptions.onVisibleRangeChange !== undefined) this._onVisibleChange     = newOptions.onVisibleRangeChange;
    if (newOptions.onRender             !== undefined) this._onRender            = newOptions.onRender;
    if (newOptions.onReachEnd  !== undefined) { this._onReachEnd = newOptions.onReachEnd; }
    else if (newOptions.onLoadMore !== undefined) { this._onReachEnd = newOptions.onLoadMore; }
    if (newOptions.onReachStart         !== undefined) this._onReachStart        = newOptions.onReachStart;
    if (newOptions.onResize             !== undefined) this._onResize            = newOptions.onResize;
    if (newOptions.emptyText            !== undefined) this._emptyText           = newOptions.emptyText;
    if (newOptions.emptyHTML            !== undefined) this._emptyHTML           = newOptions.emptyHTML;
    if (newOptions.loadingText          !== undefined) this._loadingText         = newOptions.loadingText;
    if (newOptions.loadingHTML          !== undefined) this._loadingHTML         = newOptions.loadingHTML;
    this._forceFresh = true;
    this._buildPositions();
    this._lastStart = -1;
    this._lastEnd   = -1;
    this._render();
  }

  scrollTo(index, smooth = false) {
    if (index < 0 || index >= this._items.length) {
      console.warn(`HCGVirtualScroll: Index ${index} out of range`);
      return;
    }
    const top = this._indexToScrollTop(index);
    if (smooth) {
      this._container.scrollTo({ top, behavior: 'smooth' });
    } else {
      this._container.scrollTop = top;
      this._render();
    }
  }

  scrollToTop(smooth = false) {
    if (smooth) {
      this._container.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      this._container.scrollTop = 0;
      this._render();
    }
  }

  scrollToBottom(smooth = false) {
    const maxScrollTop = Math.max(0, this._phantom.offsetHeight - this._container.clientHeight);
    if (smooth) {
      this._container.scrollTo({ top: maxScrollTop, behavior: 'smooth' });
    } else {
      this._container.scrollTop = maxScrollTop;
      this._render();
    }
  }

  clear() {
    this._loading        = false;
    this._items          = [];
    this._positions      = [];
    this._rawTotal        = 0;
    this._reachedEnd      = false;
    this._reachedStart    = false;
    this._prevScrollTop   = 0;
    this._scrollSpeed     = 0;
    this._lastStart       = -1;
    this._lastEnd         = -1;
    this._container.scrollTop = 0;
    this._render();
  }

  getScrollPosition() {
    return this._container.scrollTop;
  }

  getData() {
    return this._items;
  }

  getVisibleRange() {
    return { start: this._lastStart, end: this._lastEnd };
  }

  isLoading() {
    return this._loading;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this._container.removeEventListener('scroll', this._boundHandleScroll);
    this._container.classList.remove('hcg-vs-container');
    this._container.innerHTML = '';
    this._items     = [];
    this._positions = [];
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

// Browser global
if (typeof window !== 'undefined') window.HCGVirtualScroll = HCGVirtualScroll;

// CommonJS / Node.js
if (typeof module !== 'undefined' && module.exports) module.exports = HCGVirtualScroll;
