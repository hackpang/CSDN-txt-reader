/* =====================================================================
 * parser.js —— TXT 章节解析器（简化版）
 * 职责：把纯文本按「第X章 / 第X节」等中文章节标记切成单级章节数组。
 *       只求能切分、能跳转；个别误判可接受，不做去重/纠错等复杂处理。
 * 输出：{ chapters: [{ id, index, title, lines }], preface: [], chapterCount }
 * ===================================================================== */
(function (global) {
  'use strict';

  /* 章节标题正则：
   * - 行首只允许「半角空格 / Tab」缩进，不允许全角空格（U+3000）——
   *   中文小说正文段落多以全角空格缩进，真正的标题一般顶格，据此过滤大部分误判。
   * - 结构：第 + 数字/中文数字 + 章/节/回/卷/篇/集/部 + （可选标题）
   */
  var CHAPTER_RE = /^[ \t\u00a0]*第\s*[0-9零一二三四五六七八九十百千两]+\s*[章节回卷篇集部].*$/;

  /* 标题长度上限：超过基本不可能是标题，避免误伤正文 */
  var MAX_TITLE_LEN = 40;

  /**
   * 判断某一行是否为章节标题行（只去除行尾空白，保留行首用于缩进判定）
   */
  function isChapterTitle(rawLine) {
    var line = rawLine.replace(/\s+$/, '');
    if (!line) return false;
    if (line.trim().length > MAX_TITLE_LEN) return false;
    return CHAPTER_RE.test(line);
  }

  /**
   * 解析全文
   * @param {string} text
   * @returns {{chapters: Array, preface: string[], chapterCount: number}}
   */
  function parse(text) {
    var normalized = String(text).replace(/\r\n?/g, '\n');
    var lines = normalized.split('\n');

    var chapters = [];
    var preface = [];       // 第一章之前无法解析成章节的内容（简介/序言）
    var current = null;
    var seq = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (isChapterTitle(line)) {
        current = { id: 'chapter-' + seq, index: seq, title: line.trim(), lines: [] };
        chapters.push(current);
        seq++;
      } else if (current) {
        current.lines.push(line);
      } else {
        preface.push(line);
      }
    }

    return {
      chapters: chapters,
      preface: trimEmpty(preface),
      chapterCount: chapters.length
    };
  }

  function trimEmpty(arr) {
    var start = 0, end = arr.length;
    while (start < end && arr[start].trim() === '') start++;
    while (end > start && arr[end - 1].trim() === '') end--;
    return arr.slice(start, end);
  }

  /**
   * 行数组 -> 段落数组（每个非空行一段，空行忽略）
   */
  function toParagraphs(lines) {
    var paras = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t) paras.push(t);
    }
    return paras;
  }

  /**
   * 清理章节标题用于展示：把章节标记后紧跟的分隔符（字面 ? / 全角？/ 全角空格 / 多空白）统一为一个空格
   * 例：“第一章?旧土” -> “第一章 旧土”
   */
  function cleanTitle(title) {
    return String(title)
      .replace(/^(\s*第\s*[0-9零一二三四五六七八九十百千两]+\s*[章节回卷篇集部])[\s?？　]+/, '$1 ')
      .trim();
  }

  global.TxtParser = {
    parse: parse,
    isChapterTitle: isChapterTitle,
    toParagraphs: toParagraphs,
    cleanTitle: cleanTitle,
    CHAPTER_RE: CHAPTER_RE
  };
})(window);
