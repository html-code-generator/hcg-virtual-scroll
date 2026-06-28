/*!
 * hcg-virtual-scroll - vanilla JS virtual scrolling
 * Author: HTML Code Generator
 * https://www.html-code-generator.com/
 * Documentation: https://www.html-code-generator.com/javascript/virtual-scrolling
 *
 * @version 1.0.5
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

    const container = HCGVirtualScroll._resolveEl(options.container);
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
    this._scrollDecayId  = null;
    this._reachedEnd     = false;
    this._reachedStart   = false;
    this._prevScrollTop  = 0;
    this._scrollSpeed    = 0;
    this._resizeObserver = null;
    this._resizeRaf      = null;
    this._loading        = false;
    this._destroyed      = false;
    this._forceFresh     = false;
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

    this._boundHandleScroll = this._handleScroll.bind(this);
    container.addEventListener('scroll', this._boundHandleScroll, { passive: true });

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
        this._resizeRaf = requestAnimationFrame(() => {
          this._resizeRaf = null;
          this._scrollSpeed = 0;
          if (this._onResize) {
            this._onResize({
              width:  this._container.clientWidth,
              height: this._container.clientHeight
            });
          }
          this._lastStart = -1;
          this._lastEnd   = -1;
          this._render();
        });
      });
      this._resizeObserver.observe(container);
    }

    this._buildPositions();
    if (this._reverse && this._items.length > 0) {
      container.scrollTop = Math.max(0, this._phantom.offsetHeight - container.clientHeight);
    }
    this._render();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  static _toArray(data, where) {
    if (data == null) return [];
    if (Array.isArray(data)) return data;
    console.warn('HCGVirtualScroll: ' + (where || 'data') +
      ' must be an array, received ' + (typeof data) + '. Using an empty list instead.');
    return [];
  }

  static _resolveEl(target) {
    if (!target) return null;
    if (typeof target === 'string') {
      return document.querySelector(target) ||
        document.getElementById(target.replace(/^#/, ''));
    }
    return target;
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
        let h = this._itemHeight(newItems[i], startIdx + i);
        if (!(h > 0)) h = this._estimatedItemHeight;
        this._positions[startIdx + i] = { top, height: h };
        top += h;
      }
      this._rawTotal = top;
    }
    this._phantom.style.height = Math.min(this._rawTotal, this._maxHeight) + 'px';
  }

  _scale() {
    if (this._rawTotal <= this._maxHeight) return 1;
    const viewH = this._container.clientHeight;
    const den   = this._maxHeight - viewH;
    return den > 0 ? (this._rawTotal - viewH) / den : this._rawTotal / this._maxHeight;
  }

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

    return {
      rawStart: Math.max(0, start),
      rawEnd:   Math.min(count - 1, end),
      start:    Math.max(0, start - buf),
      end:      Math.min(count - 1, end + buf)
    };
  }

  _createItemElement(item, index) {
    const result = this._renderItem(item, index);
    let inner;
    if (result instanceof Element) {
      inner = result;
    } else {
      const tmp         = document.createElement('div');
      tmp.innerHTML     = result;
      inner = tmp.firstElementChild || tmp;
    }

    const el = document.createElement('div');
    el.className = 'hcg-vs-item';
    el.setAttribute('role', 'listitem');
    if (this._keyField != null) el.dataset.vsKey = String(item[this._keyField]);
    el.appendChild(inner);
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

    if (!this._forceFresh) {
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.dataset.vsKey !== undefined) pool.set(child.dataset.vsKey, child);
      }
    }

    const seen = new Set();
    const frag = document.createDocumentFragment();
    for (let i = range.start; i <= range.end; i++) {
      const h      = this._getItemHeight(i);
      const rawKey = this._items[i][this._keyField];

      if (rawKey == null) {
        const el        = this._createItemElement(this._items[i], i);
        el.style.height = h + 'px';
        frag.appendChild(el);
        continue;
      }

      const key = String(rawKey);

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
    this._forceFresh = false;
  }

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
    if (this._loading) return;

    const scrollTop = this._container.scrollTop;
    const range     = this._calcVisibleRange(scrollTop);

    if (this._onScroll) this._onScroll(scrollTop, { start: range.start, end: range.end });

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

    if (this._items.length > 0 && range.end >= 0) {
      const scale        = this._scale();
      const adj          = scrollTop * scale;
      const firstItemTop = this._isFixed()
        ? range.start * this._itemHeight
        : this._positions[range.start].top;
      this._content.style.transform = `translateY(${scrollTop - (adj - firstItemTop)}px)`;
    }

    if (range.start === this._lastStart && range.end === this._lastEnd) return;

    this._lastStart = range.start;
    this._lastEnd   = range.end;

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
    // Shrink adaptive overscan after scrolling stops so rows stay in view.
    if (this._scrollDecayId) clearTimeout(this._scrollDecayId);
    this._scrollDecayId = setTimeout(() => {
      this._scrollSpeed = 0;
      this._lastStart   = -1;
      this._lastEnd     = -1;
      this._render();
      this._scrollDecayId = null;
    }, 120);
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
    if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
    if (this._scrollDecayId) clearTimeout(this._scrollDecayId);
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

if (typeof window !== 'undefined') window.HCGVirtualScroll = HCGVirtualScroll;
if (typeof module !== 'undefined' && module.exports) module.exports = HCGVirtualScroll;
