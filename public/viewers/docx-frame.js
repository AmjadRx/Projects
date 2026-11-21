/*
 * Renders a Word document inside the sandboxed frame (public/viewers/docx-frame.html), with
 * docx-preview and JSZip, which that page's loader inserts before this file, in order. The reader
 * that embeds this frame is components/viewers/document/WordReader.tsx; the messages between them:
 *
 *   frame to reader   { type: 'docx:ready' }                       scripts loaded, waiting
 *                     { type: 'docx:rendered', width, height, pages }
 *                                                                  drawn: its own size in px, and the
 *                                                                  top of each page (one section each)
 *                     { type: 'docx:size', width, height, pages }  the same, after a change (fonts, images)
 *                     { type: 'docx:error' }                       the file could not be read
 *                     { type: 'docx:found', id, pages }            a search's matches: the page of each
 *                     { type: 'docx:selected', id, index, page, top, left, width, height }
 *                                                                  the current match, its page and box
 *   reader to frame   { type: 'docx:render', data: ArrayBuffer }   the file, once
 *                     { type: 'docx:scale', scale: number }        zoom
 *                     { type: 'docx:search', id, query: string }   highlight every match ('' clears)
 *                     { type: 'docx:select', id, index }           make one match of search `id` current
 *
 * Positions and sizes are CSS pixels of the document at scale 1, from its top left corner. The
 * frame answers with numbers only, never with text from the document.
 *
 * The frame has an opaque origin, so both sides post with the target origin "*". The reader
 * accepts a message only when its source is this frame's window; this frame accepts one only
 * from its parent, and only in the shapes above. Nothing inside the document may navigate: links
 * lose their addresses, and clicks and form submissions are stopped.
 */
(function () {
  'use strict';

  var host = window.parent;

  // Work only inside a sandboxed frame: framed, with an opaque origin, unable to read the page
  // around it. Opened any other way (as a page of its own, or framed without the sandbox), the
  // file renders nothing.
  function isIsolated() {
    if (host === window) return false;
    if (typeof self.origin === 'string') return self.origin === 'null';
    try {
      return !host.document;
    } catch (blocked) {
      return true;
    }
  }
  if (!isIsolated()) return;

  var MAX_BYTES = 50000000;
  /** The same limits as the reader: the most matches, the longest query, the largest id. */
  var MAX_MATCHES = 2000;
  var MAX_QUERY = 1000;
  var MAX_ID = 2147483647;
  var OPTIONS = {
    className: 'docx',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    breakPages: true,
    ignoreLastRenderedPageBreak: true,
    experimental: false,
    trimXmlDeclaration: true,
    useBase64URL: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderComments: false,
    renderChanges: false,
    // Embedded HTML ("alt chunks") would need a frame of its own; it is never rendered.
    renderAltChunks: false,
    debug: false,
  };

  var root = document.getElementById('root');
  var styleHost = document.getElementById('styles');
  var state = 'waiting';
  var scale = 1;
  var reported = '';

  function post(message) {
    host.postMessage(message, '*');
  }

  function isId(value) {
    return typeof value === 'number' && Math.floor(value) === value && value >= 0 && value <= MAX_ID;
  }

  // ---------------------------------------------------------------------------------------------
  // Pages: docx-preview draws each page as a section in the wrapper.
  function pageSections() {
    return root.querySelectorAll('.docx-wrapper > section.docx');
  }

  /** The top of each page, from the top of the document, at scale 1. */
  function pageTops() {
    var sections = pageSections();
    var origin = root.getBoundingClientRect().top;
    var tops = [];
    var previous = 0;
    for (var i = 0; i < sections.length; i += 1) {
      var top = Math.max(previous, Math.round((sections[i].getBoundingClientRect().top - origin) / scale));
      tops.push(top);
      previous = top;
    }
    if (tops.length === 0) tops.push(0);
    return tops;
  }

  /** The page (from 1) that holds an element. */
  function pageOf(element, sections) {
    var section = element.closest('section.docx');
    var index = section ? Array.prototype.indexOf.call(sections, section) : -1;
    return index >= 0 ? index + 1 : 1;
  }

  function report(type) {
    var width = Math.ceil(root.offsetWidth);
    var height = Math.ceil(root.offsetHeight);
    if (width <= 0 || height <= 0) return;
    var pages = pageTops();
    var key = width + 'x' + height + ':' + pages.join(',');
    if (type === 'docx:size' && key === reported) return;
    reported = key;
    post({ type: type, width: width, height: height, pages: pages });
  }

  // ---------------------------------------------------------------------------------------------
  // Search. Matching ignores case and treats any run of spaces or line ends as one space, as the
  // PDF reader does; a paragraph, cell, or line break between two pieces of text counts as a
  // space. Matches are wrapped in <mark> elements built with DOM nodes, never from markup.
  var search = { id: -1, marks: [], pages: [], current: -1 };

  function fold(ch) {
    var lower = ch.toLowerCase();
    return lower.length === 1 ? lower : ch;
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function patternFor(query) {
    var normalized = query.trim().replace(/\s+/g, ' ');
    var folded = '';
    for (var i = 0; i < normalized.length; i += 1) folded += fold(normalized[i]);
    if (folded === '' || folded === ' ') return null;
    return new RegExp(folded.split(' ').map(escapeRegExp).join('\\s+'), 'g');
  }

  var BLOCKS = 'p, li, td, th, caption, h1, h2, h3, h4, h5, h6, header, footer, article, section, table, tr, div';

  /** Every text node in reading order, the folded text, and which node and offset made each character. */
  function textIndex() {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (node.nodeType === 1) {
          var tag = node.localName;
          if (tag === 'svg' || tag === 'style' || tag === 'script') return NodeFilter.FILTER_REJECT;
          return tag === 'br' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    var nodes = [];
    var owner = [];
    var offset = [];
    var chunks = [];
    var lastBlock = null;
    var pendingBreak = false;
    for (var node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 1) {
        pendingBreak = true;
        continue;
      }
      var block = node.parentElement.closest(BLOCKS);
      if (nodes.length > 0 && (pendingBreak || block !== lastBlock)) {
        chunks.push(' ');
        owner.push(-1);
        offset.push(-1);
      }
      pendingBreak = false;
      lastBlock = block;
      var n = nodes.length;
      nodes.push(node);
      var value = node.nodeValue;
      var folded = '';
      for (var c = 0; c < value.length; c += 1) {
        folded += fold(value[c]);
        owner.push(n);
        offset.push(c);
      }
      chunks.push(folded);
    }
    return { nodes: nodes, text: chunks.join(''), owner: owner, offset: offset };
  }

  function clearMarks() {
    var marks = root.querySelectorAll('mark[data-docx-match]');
    var parents = [];
    for (var i = 0; i < marks.length; i += 1) {
      var mark = marks[i];
      var parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      if (parents.indexOf(parent) < 0) parents.push(parent);
    }
    for (var j = 0; j < parents.length; j += 1) parents[j].normalize();
    search.marks = [];
    search.pages = [];
    search.current = -1;
  }

  function runSearch(id, query) {
    clearMarks();
    search.id = id;
    var pattern = patternFor(query);
    if (!pattern) {
      post({ type: 'docx:found', id: id, pages: [] });
      return;
    }
    var index = textIndex();
    var pieces = [];
    var count = 0;
    var found;
    pattern.lastIndex = 0;
    while (count < MAX_MATCHES && (found = pattern.exec(index.text)) !== null) {
      var end = found.index + found[0].length;
      if (end === found.index) {
        pattern.lastIndex += 1;
        continue;
      }
      // The pieces of this match: one per text node it touches.
      var before = pieces.length;
      for (var i = found.index; i < end; i += 1) {
        var n = index.owner[i];
        if (n < 0) continue;
        var last = pieces[pieces.length - 1];
        if (pieces.length > before && last.node === n && last.end === index.offset[i]) last.end += 1;
        else pieces.push({ match: count, node: n, start: index.offset[i], end: index.offset[i] + 1 });
      }
      if (pieces.length > before) count += 1;
    }
    var marks = [];
    for (var m = 0; m < count; m += 1) marks.push([]);
    // Last piece first: splitting a text node leaves the earlier pieces' offsets unchanged.
    for (var p = pieces.length - 1; p >= 0; p -= 1) {
      var piece = pieces[p];
      var text = index.nodes[piece.node];
      if (piece.end < text.length) text.splitText(piece.end);
      var target = piece.start > 0 ? text.splitText(piece.start) : text;
      var mark = document.createElement('mark');
      mark.setAttribute('data-docx-match', '');
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      marks[piece.match].unshift(mark);
    }
    var sections = pageSections();
    var pages = [];
    for (var k = 0; k < count; k += 1) pages.push(pageOf(marks[k][0], sections));
    search.marks = marks;
    search.pages = pages;
    search.current = -1;
    post({ type: 'docx:found', id: id, pages: pages });
  }

  function select(index) {
    var previous = search.marks[search.current] || [];
    for (var i = 0; i < previous.length; i += 1) previous[i].removeAttribute('data-current');
    search.current = index;
    var marks = search.marks[index];
    var origin = root.getBoundingClientRect();
    var top = Infinity;
    var left = Infinity;
    var bottom = -Infinity;
    var right = -Infinity;
    for (var j = 0; j < marks.length; j += 1) {
      marks[j].setAttribute('data-current', '');
      var box = marks[j].getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      top = Math.min(top, box.top);
      left = Math.min(left, box.left);
      bottom = Math.max(bottom, box.bottom);
      right = Math.max(right, box.right);
    }
    if (top === Infinity) {
      top = origin.top;
      left = origin.left;
      bottom = top;
      right = left;
    }
    post({
      type: 'docx:selected',
      id: search.id,
      index: index,
      page: search.pages[index],
      top: Math.max(0, (top - origin.top) / scale),
      left: Math.max(0, (left - origin.left) / scale),
      width: (right - left) / scale,
      height: (bottom - top) / scale,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Links keep their text and lose their addresses; anything that could load or submit goes.
  function quiet() {
    var links = root.querySelectorAll('a, area');
    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      link.removeAttribute('href');
      link.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
      link.removeAttribute('target');
      link.removeAttribute('ping');
      link.removeAttribute('download');
    }
    var embedded = root.querySelectorAll('iframe, frame, object, embed, script, form, base, meta, link');
    for (var j = 0; j < embedded.length; j += 1) embedded[j].remove();
  }

  function render(data) {
    state = 'rendering';
    window.docx.renderAsync(data, root, styleHost, OPTIONS).then(
      function () {
        quiet();
        state = 'rendered';
        report('docx:rendered');
        if (typeof ResizeObserver === 'function') {
          new ResizeObserver(function () {
            report('docx:size');
          }).observe(root);
        }
      },
      function () {
        state = 'failed';
        root.replaceChildren();
        post({ type: 'docx:error' });
      },
    );
  }

  window.addEventListener('message', function (event) {
    if (event.source !== host) return;
    var message = event.data;
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
    if (message.type === 'docx:render') {
      var data = message.data;
      if (state !== 'waiting' || !(data instanceof ArrayBuffer)) return;
      if (data.byteLength === 0 || data.byteLength > MAX_BYTES) {
        state = 'failed';
        post({ type: 'docx:error' });
        return;
      }
      render(data);
    } else if (message.type === 'docx:scale') {
      var next = Number(message.scale);
      if (!isFinite(next) || next < 0.05 || next > 8) return;
      scale = next;
      root.style.transform = next === 1 ? '' : 'scale(' + next + ')';
    } else if (message.type === 'docx:search') {
      if (state !== 'rendered' || !isId(message.id)) return;
      if (typeof message.query !== 'string' || message.query.length > MAX_QUERY) return;
      runSearch(message.id, message.query);
    } else if (message.type === 'docx:select') {
      if (state !== 'rendered' || message.id !== search.id) return;
      var index = message.index;
      if (typeof index !== 'number' || Math.floor(index) !== index || index < 0 || index >= search.marks.length) return;
      select(index);
    }
  });

  document.addEventListener(
    'click',
    function (event) {
      var target = event.target;
      if (target && typeof target.closest === 'function' && target.closest('a, area')) event.preventDefault();
    },
    true,
  );
  document.addEventListener(
    'auxclick',
    function (event) {
      event.preventDefault();
    },
    true,
  );
  document.addEventListener(
    'submit',
    function (event) {
      event.preventDefault();
    },
    true,
  );

  if (!window.docx || typeof window.docx.renderAsync !== 'function' || !window.JSZip) {
    state = 'failed';
    post({ type: 'docx:error' });
    return;
  }
  post({ type: 'docx:ready' });
})();
