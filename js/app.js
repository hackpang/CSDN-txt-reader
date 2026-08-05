/* =====================================================================
 * app.js —— 交互逻辑
 * 上传/拖拽 → 自动识别编码 → 解析 → 单章展示 → 目录/搜索/伸缩/翻章
 * ===================================================================== */
(function () {
  'use strict';

  // ---------- DOM 引用 ----------
  var fileInput    = document.getElementById('fileInput');
  var pickBtn      = document.getElementById('pickBtn');
  var dropZone     = document.getElementById('dropZone');
  var uploader     = document.getElementById('uploader');
  var contentBody  = document.getElementById('contentBody');
  var articleContent = document.getElementById('articleContent');  // 滚动容器
  var originalArticle = document.getElementById('originalArticle');
  var modeSwitch   = document.getElementById('modeSwitch');
  var chapterHeading = document.getElementById('chapterHeading');
  var chapterNav   = document.getElementById('chapterNav');
  var prevBtn      = document.getElementById('prevBtn');
  var nextBtn      = document.getElementById('nextBtn');
  var chapterPos   = document.getElementById('chapterPos');
  var colMain      = document.getElementById('colMain');
  var tocList      = document.getElementById('tocList');
  var tocCount     = document.getElementById('tocCount');
  var tocSearch    = document.getElementById('tocSearch');
  var tocToggle    = document.getElementById('tocToggle');
  var reimportBtn  = document.getElementById('reimportBtn');
  var tocReopen    = document.getElementById('tocReopen');
  var container    = document.getElementById('container');

  // ---------- 运行时状态 ----------
  var PREFACE_ID = 'preface';
  var state = {
    chapters: [],       // [{ id, index, title(clean), lines }]
    preface: [],        // 开头无法解析成章节的内容
    tocItems: {},       // id -> <li>
    currentId: null     // 当前展示的章节/简介 id
  };
  var rawText = null;   // 保留原始解码后文本，用于持久化

  /* ===================== 文件读取（自动识别编码） ===================== */

  pickBtn.addEventListener('click', function () { fileInput.click(); });
  dropZone.addEventListener('click', function (e) {
    if (e.target === pickBtn) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  // 目录栏「重新导入」：换一个 txt（清空 value 以允许重选同名文件）
  if (reimportBtn) {
    reimportBtn.addEventListener('click', function () {
      fileInput.value = '';
      fileInput.click();
    });
  }

  ['dragenter', 'dragover'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) {
      e.preventDefault(); e.stopPropagation();
      dropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropZone.addEventListener(ev, function (e) {
      e.preventDefault(); e.stopPropagation();
      dropZone.classList.remove('dragover');
    });
  });
  dropZone.addEventListener('drop', function (e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    if (files && files[0]) handleFile(files[0]);
  });

  /**
   * 处理选中的文件：统一读为 ArrayBuffer，再自动识别编码解码
   */
  function handleFile(file) {
    if (!/\.txt$/i.test(file.name) && file.type !== 'text/plain') {
      alert('请选择 .txt 文本文件');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var text = decodeText(reader.result);
      render(text, file.name);
    };
    reader.onerror = function () { alert('文件读取失败，请重试'); };
    reader.readAsArrayBuffer(file);
  }

  /**
   * 编码自动识别：优先严格 UTF-8，失败则回退 GBK
   * @param {ArrayBuffer} buffer
   * @returns {string}
   */
  function decodeText(buffer) {
    // 1) 严格 UTF-8：遇到非法字节会抛错，用于判定是否真为 UTF-8
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (e) { /* 非 UTF-8，尝试 GBK */ }
    // 2) GBK / GB18030
    try {
      return new TextDecoder('gbk').decode(buffer);
    } catch (e2) {
      try { return new TextDecoder('gb18030').decode(buffer); }
      catch (e3) {
        // 3) 兜底：宽松 UTF-8
        return new TextDecoder('utf-8').decode(buffer);
      }
    }
  }

  /* ===================== 渲染主流程 ===================== */

  function render(text, fileName, restoreId) {
    rawText = text;
    var result = window.TxtParser.parse(text);

    // 章节标题清理
    state.chapters = result.chapters.map(function (ch) {
      return {
        id: ch.id,
        index: ch.index,
        title: window.TxtParser.cleanTitle(ch.title),
        lines: ch.lines
      };
    });
    state.preface = result.preface;

    // 文章标题/元信息一律写死在 HTML 中，不根据文件名修改

    renderToc();
    uploader.style.display = 'none';

    // 重新导入时重置为 TXT 阅读态（退出可能的原文模式）
    isOriginalMode = false;
    if (originalArticle) originalArticle.style.display = 'none';
    if (modeSwitch) modeSwitch.classList.remove('tag--switch-active');
    contentBody.style.display = '';

    // 恢复上次位置 / 或初始展示
    if (restoreId === PREFACE_ID) {
      showPreface();
    } else if (restoreId && restoreId.indexOf('chapter-') === 0) {
      var idx = parseInt(restoreId.replace('chapter-', ''), 10);
      if (idx >= 0 && idx < state.chapters.length) showChapter(idx);
      else showChapter(0);
    } else if (state.preface.length) {
      showPreface();
    } else if (state.chapters.length) {
      showChapter(0);
    } else {
      showEmpty();
    }

    // 保存到 localStorage
    saveState(fileName);
  }

  /* ===================== 目录 ===================== */

  function renderToc() {
    tocList.innerHTML = '';
    state.tocItems = {};

    var totalCount = state.chapters.length;
    tocCount.textContent = totalCount ? '共 ' + totalCount + ' 章' : '';

    // 简介入口（开头无法解析的内容）
    if (state.preface.length) {
      var pre = makeTocItem(PREFACE_ID, '【作品相关 / 简介】', 'toc-item--preface');
      pre.addEventListener('click', function () { showPreface(); });
      tocList.appendChild(pre);
      state.tocItems[PREFACE_ID] = pre;
    }

    if (!totalCount && !state.preface.length) {
      var empty = document.createElement('li');
      empty.className = 'toc-empty';
      empty.textContent = '未识别到章节，已作为单篇显示';
      tocList.appendChild(empty);
      return;
    }

    state.chapters.forEach(function (ch) {
      var li = makeTocItem(ch.id, ch.title, '');
      li.addEventListener('click', function () {
        if (isOriginalMode) showTxt();
        showChapter(ch.index);
      });
      tocList.appendChild(li);
      state.tocItems[ch.id] = li;
    });
  }

  function makeTocItem(id, title, extraClass) {
    var li = document.createElement('li');
    li.className = 'toc-item' + (extraClass ? ' ' + extraClass : '');
    li.textContent = title;
    li.title = title;
    li.dataset.target = id;
    li.dataset.title = title;
    return li;
  }

  /* ===================== 单章 / 简介展示 ===================== */

  function showPreface() {
    chapterHeading.style.display = 'none';
    chapterNav.style.display = 'none';

    var frag = document.createDocumentFragment();
    var head = document.createElement('div');
    head.className = 'preface-title';
    head.textContent = '作品相关 / 简介';
    frag.appendChild(head);
    appendParagraphs(frag, window.TxtParser.toParagraphs(state.preface));

    contentBody.innerHTML = '';
    contentBody.appendChild(frag);
    setActive(PREFACE_ID);
    scrollMainTop();
  }

  function showChapter(index) {
    if (index < 0 || index >= state.chapters.length) return;
    var ch = state.chapters[index];

    // 章节标题
    chapterHeading.style.display = '';
    chapterHeading.textContent = ch.title;

    // 正文
    var frag = document.createDocumentFragment();
    appendParagraphs(frag, window.TxtParser.toParagraphs(ch.lines));
    contentBody.innerHTML = '';
    contentBody.appendChild(frag);

    // 上一章 / 下一章
    chapterNav.style.display = 'flex';
    prevBtn.disabled = (index === 0);
    nextBtn.disabled = (index === state.chapters.length - 1);
    prevBtn.onclick = function () { showChapter(index - 1); };
    nextBtn.onclick = function () { showChapter(index + 1); };
    chapterPos.textContent = '第 ' + (index + 1) + ' / ' + state.chapters.length + ' 章';

    setActive(ch.id);
    scrollMainTop();
  }

  function showEmpty() {
    chapterHeading.style.display = 'none';
    chapterNav.style.display = 'none';
    contentBody.innerHTML = '<p>（文件内容为空）</p>';
  }

  /**
   * 高亮目录当前项，并滚动目录使其可见
   */
  function setActive(id) {
    state.currentId = id;
    Object.keys(state.tocItems).forEach(function (key) {
      var li = state.tocItems[key];
      var on = (key === id);
      li.classList.toggle('active', on);
      if (on) scrollTocIntoView(li);
    });
  }

  function appendParagraphs(container, paras) {
    paras.forEach(function (text) {
      var p = document.createElement('p');
      p.textContent = text;
      container.appendChild(p);
    });
  }

  function scrollMainTop() {
    articleContent.scrollTo({ top: 0, behavior: 'auto' });
  }

  function scrollTocIntoView(li) {
    var listRect = tocList.getBoundingClientRect();
    var liRect = li.getBoundingClientRect();
    if (liRect.top < listRect.top || liRect.bottom > listRect.bottom) {
      li.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ===================== 章节搜索 ===================== */

  tocSearch.addEventListener('input', function () {
    var kw = tocSearch.value.trim();
    var kwLower = kw.toLowerCase();
    var matched = 0;

    Object.keys(state.tocItems).forEach(function (key) {
      var li = state.tocItems[key];
      var title = li.dataset.title;
      if (!kw) {
        li.style.display = '';
        li.innerHTML = escapeHtml(title);
        matched++;
        return;
      }
      if (title.toLowerCase().indexOf(kwLower) !== -1) {
        li.style.display = '';
        li.innerHTML = highlight(title, kw);
        matched++;
      } else {
        li.style.display = 'none';
      }
    });

    var noResult = tocList.querySelector('.toc-no-result');
    if (kw && matched === 0) {
      if (!noResult) {
        noResult = document.createElement('li');
        noResult.className = 'toc-no-result';
        noResult.textContent = '没有匹配的章节';
        tocList.appendChild(noResult);
      }
    } else if (noResult) {
      noResult.remove();
    }
  });

  function highlight(text, kw) {
    var idx = text.toLowerCase().indexOf(kw.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    return escapeHtml(text.slice(0, idx)) +
      '<mark>' + escapeHtml(text.slice(idx, idx + kw.length)) + '</mark>' +
      escapeHtml(text.slice(idx + kw.length));
  }

  /* ===================== 原文 / TXT 一键切换 ===================== */

  var isOriginalMode = false;
  var txtScrollTop = 0;        // 记忆 TXT 视图的滚动位置
  var originalScrollTop = 0;   // 记忆原文视图的滚动位置

  function showOriginal() {
    // 切换前记住当前 TXT 阅读位置
    txtScrollTop = articleContent.scrollTop;
    isOriginalMode = true;
    // 填充静态原文（仅首次）
    if (!originalArticle.innerHTML && window.ORIGINAL_ARTICLE_HTML) {
      originalArticle.innerHTML = window.ORIGINAL_ARTICLE_HTML;
    }
    uploader.style.display = 'none';
    chapterHeading.style.display = 'none';
    contentBody.style.display = 'none';
    chapterNav.style.display = 'none';
    originalArticle.style.display = 'block';
    modeSwitch.classList.add('tag--switch-active');
    // 恢复原文上次阅读位置
    articleContent.scrollTop = originalScrollTop;
  }

  function showTxt() {
    // 切换前记住当前原文阅读位置
    if (isOriginalMode) originalScrollTop = articleContent.scrollTop;
    isOriginalMode = false;
    originalArticle.style.display = 'none';
    contentBody.style.display = '';
    modeSwitch.classList.remove('tag--switch-active');
    // 恢复到当前章节/简介；若还未上传文件则显示上传区
    if (!rawText) {
      uploader.style.display = '';
      return;
    }
    if (state.currentId === PREFACE_ID) showPreface();
    else if (state.currentId && state.currentId.indexOf('chapter-') === 0) {
      showChapter(parseInt(state.currentId.replace('chapter-', ''), 10));
    } else if (state.chapters.length) {
      showChapter(0);
    }
    // 覆盖 showChapter 的置顶，恢复 TXT 上次阅读位置
    articleContent.scrollTop = txtScrollTop;
  }

  modeSwitch.addEventListener('click', function () {
    if (isOriginalMode) showTxt(); else showOriginal();
  });

  /* ===================== 正文区域点击切换 ===================== */

  (function initContentClickToggle() {
    var downX = 0, downY = 0;

    articleContent.addEventListener('mousedown', function (e) {
      downX = e.clientX; downY = e.clientY;
    });

    articleContent.addEventListener('click', function (e) {
      // 未上传文件（上传态）：不切换，让选文件交互正常工作
      if (!rawText) return;
      // 点击按钮/链接/输入框（如上一章/下一章）：不切换
      if (e.target.closest('button, a, input, textarea')) return;
      // 拖动选中文字：不切换
      if (Math.abs(e.clientX - downX) > 5 || Math.abs(e.clientY - downY) > 5) return;
      if (window.getSelection && String(window.getSelection()).length > 0) return;
      // 切换原文 / TXT
      if (isOriginalMode) showTxt(); else showOriginal();
    });
  })();

  /* ===================== 目录伸缩 / 展开 ===================== */

  tocToggle.addEventListener('click', function () {
    container.classList.add('right-collapsed');
  });
  tocReopen.addEventListener('click', function () {
    container.classList.remove('right-collapsed');
  });

  /* ===================== 本地缓存（IndexedDB） ===================== */

  var DB_NAME = 'csdn_txt_reader';
  var DB_STORE = 'state';
  var DB_KEY = 'reading';
  var db = null;

  /**
   * 打开/初始化 IndexedDB
   */
  function openDB(cb) {
    if (db) { cb(db); return; }
    var req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function (e) {
      var d = e.target.result;
      if (!d.objectStoreNames.contains(DB_STORE)) {
        d.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = function (e) { db = e.target.result; cb(db); };
    req.onerror = function () { cb(null); };
  }

  /**
   * 保存当前阅读状态
   */
  function saveState(fileName) {
    openDB(function (d) {
      if (!d) return;
      try {
        var tx = d.transaction(DB_STORE, 'readwrite');
        var store = tx.objectStore(DB_STORE);
        store.put({
          fileName: fileName || '',
          currentId: state.currentId,
          scrollTop: articleContent.scrollTop,
          text: rawText
        }, DB_KEY);
      } catch (e) {}
    });
  }

  /**
   * 每次切换章节/滚动时，自动保存进度（增量更新，不重写 text）
   */
  function autoSave() {
    if (!rawText) return;
    openDB(function (d) {
      if (!d) return;
      try {
        var tx = d.transaction(DB_STORE, 'readwrite');
        var store = tx.objectStore(DB_STORE);
        var getReq = store.get(DB_KEY);
        getReq.onsuccess = function () {
          var saved = getReq.result || {};
          saved.currentId = state.currentId;
          saved.scrollTop = articleContent.scrollTop;
          store.put(saved, DB_KEY);
        };
      } catch (e) {}
    });
  }

  // 切章节时自动保存
  var _origSetActive = setActive;
  setActive = function (id) {
    _origSetActive(id);
    setTimeout(autoSave, 50);
  };

  // 滚动停止后保存（防抖 800ms）
  var _scrollTimer = null;
  articleContent.addEventListener('scroll', function () {
    clearTimeout(_scrollTimer);
    _scrollTimer = setTimeout(autoSave, 800);
  });

  /**
   * 页面加载时尝试恢复上次的阅读
   */
  function tryRestore() {
    openDB(function (d) {
      if (!d) return;
      try {
        var tx = d.transaction(DB_STORE, 'readonly');
        var store = tx.objectStore(DB_STORE);
        var getReq = store.get(DB_KEY);
        getReq.onsuccess = function () {
          var data = getReq.result;
          if (!data || !data.text) return;
          render(data.text, data.fileName || '', data.currentId);
          if (typeof data.scrollTop === 'number') {
            setTimeout(function () { articleContent.scrollTo(0, data.scrollTop); }, 80);
          }
        };
      } catch (e) {}
    });
  }

  // 页面打开时自动恢复
  tryRestore();

  /* ===================== 动态时间字段 ===================== */

  (function initDynamicTime() {
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth() + 1;
    var day = now.getDate();
    // 计算当月第几周（第 1 天所在周往后数）
    var weekOfMonth = Math.ceil(day / 7);
    var cnMonth = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'][month - 1];

    // 1. 文章发布/修改时间
    var timeEls = document.querySelectorAll('.js-time');
    for (var i = 0; i < timeEls.length; i++) {
      var el = timeEls[i];
      var offset = parseInt(el.getAttribute('data-offset') || '0', 10) * 1000;
      var d = new Date(Date.now() + offset);
      el.textContent = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    // 2. 码龄
    var ageEls = document.querySelectorAll('.js-coding-age');
    for (var j = 0; j < ageEls.length; j++) {
      var ageEl = ageEls[j];
      var startYear = parseInt(ageEl.getAttribute('data-start') || '2016', 10);
      ageEl.textContent = '码龄' + (year - startYear) + '年';
    }

    // 3. 周报标题：“AI周报（XXXX年X月第X周）”
    var weeklyTitle = 'AI周报（' + year + '年' + month + '月第' + weekOfMonth + '周）：WAIC产业发布、Kimi K3开源、AI工具供应链警钟';
    var titleEls = document.querySelectorAll('.js-weekly-title');
    for (var k = 0; k < titleEls.length; k++) {
      titleEls[k].textContent = weeklyTitle;
    }
    document.title = weeklyTitle + ' - CSDN 博客';

    // 4. 话题标签：“#暑假·X月创作之星博客挑战赛”
    var topicEls = document.querySelectorAll('.js-month-topic');
    for (var m = 0; m < topicEls.length; m++) {
      topicEls[m].textContent = '#暑假·' + cnMonth + '月创作之星博客挑战赛';
    }

    // 5. 含年份的文本（如 "WAIC 2026 ..."）→ 替换为当前年份
    var yearEls = document.querySelectorAll('.js-year-text');
    for (var n = 0; n < yearEls.length; n++) {
      yearEls[n].textContent = yearEls[n].textContent.replace(/20\d{2}/, String(year));
    }
  })();

  /* ===================== 工具函数 ===================== */

  function formatDate(d) {
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
})();
