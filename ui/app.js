/* magpie-translator settings + history.
   Loaded with <script src> after _magpie/bridge.js. No fetch. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const params = new URLSearchParams(location.search);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const icon = (id, cls = "sm") => `<svg class="i ${cls}"><use href="#i-${id}"/></svg>`;

  const P = {
    translate: '<path d="M4 5h9M8.5 3v2M6 5c.6 3 2.6 5.4 5 6.5M11 5c-.7 3.4-3 6-6.5 7.5"/><path d="M13 21l3.8-9h.4L21 21M14.3 18h5.4"/>',
    grip: '<circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    "chev-down": '<path d="M6 9l6 6 6-6"/>', "chev-right": '<path d="M9 6l6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 012-2h8"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M15 4v16"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    alert: '<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17.2v.1"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.1"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    reset: '<path d="M4 12a8 8 0 108-8 8.6 8.6 0 00-6 2.5L4 8.5M4 4v4.5h4.5"/>', zap: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    file: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5"/>',
    braces: '<path d="M8 4c-2 0-2.5 1-2.5 3v2c0 1.5-.8 2.5-2 3 1.2.5 2 1.5 2 3v2c0 2 .5 3 2.5 3M16 4c2 0 2.5 1 2.5 3v2c0 1.5.8 2.5 2 3-1.2.5-2 1.5-2 3v2c0 2-.5 3-2.5 3"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>', thumb: '<path d="M7 11v9H4v-9h3zM7 11l4-7a2 2 0 012 2.5L12.5 10H18a2 2 0 012 2.3l-1.2 6A2 2 0 0116.8 20H7"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z"/>',
  };
  const sprite = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  sprite.setAttribute("aria-hidden", "true");
  sprite.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
  sprite.innerHTML = Object.entries(P).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join("");
  document.body.prepend(sprite);

  const STR = {
    zh: {
      "rules.count": "{n} 条规则", "rule.src": "原始模型", "rule.dst": "翻译模型", "rule.adv": "高级",
      "rule.match": "匹配 {n} 个模型", "rule.lang": "语言：{v}", "rule.prompt": "提示词：{v}", "rule.global": "跟随全局",
      "rule.custom": "自定义", "rule.langOverride": "语言覆盖", "rule.promptOverride": "覆盖提示词",
      "rule.promptPh": "关闭时使用全局提示词。", "rule.empty": "还没有规则", "rule.emptySub": "添加一条规则，指定哪个模型的回复交给谁来翻译。",
      "rule.pick": "选择模型", "rule.need": "每条规则都要选一个翻译模型",
      "pick.search": "搜索模型或厂商…", "pick.special": "通配", "pick.all": "所有模型", "pick.allSub": "兜底：匹配任何模型",
      "pick.pattern": "所有 {p}", "pick.none": "没有匹配的模型", "pick.nav": "选择", "pick.enter": "确认", "pick.esc": "关闭",
      "pick.empty": "还没有模型。等目录刷新，或先在 magpie 里配好 provider。",
      "save.saved": "已保存", "save.savedJust": "已保存 · 刚刚", "save.dirty": "有未保存的更改", "toast.saved": "设置已保存",
      "prompt.default": "默认提示词", "prompt.edited": "已修改", "prompt.chars": "{n} 字", "toast.reset": "已恢复默认提示词",
      "hero.running": "运行中 · 今日已翻译 {n} 条", "hero.paused": "已暂停 · 今日已翻译 {n} 条", "hero.offline": "预览 · 不在 magpie 窗口里",
      "h.src": "原文", "h.dst": "译文", "h.compare": "用其他模型对比…", "h.copyDst": "复制译文", "h.copySrc": "复制原文",
      "h.retranslate": "重新翻译", "h.kept": "原样保留", "h.changed": "译文改了代码", "h.empty": "没有匹配的记录",
      "h.emptySub": "换个关键词，或清除筛选条件。", "h.clear": "清除筛选", "h.pick": "选择一条记录",
      "h.pickSub": "左侧选一条，原文和译文会并排显示。", "h.none": "还没有翻译记录", "h.noneSub": "命中规则的最终回复会出现在这里。",
      "h.today": "今天", "h.yesterday": "昨天", "toast.copied": "已复制到剪贴板", "h.noOut": "没有译文", "h.retry": "重试",
      "h.retryWith": "换个模型重试…", "h.adjust": "调整超时", "h.better": "这个更好", "h.collapse": "收起列表",
      "h.alignNote": "按段落对齐 · 同步滚动", "h.queued": "已提交，钩子重载后开始", "h.retried": "已提交重新翻译",
      "h.noMagpie": "这一页要在 magpie 里打开，才能交给翻译模型", "h.rate": "成功率 {n}%", "h.lat": "中位延迟 {n} s", "h.latNone": "中位延迟 —",
      "h.count": "共 {n} 条", "h.countF": "{n} / {all} 条", "h.timeoutTitle": "翻译超时", "h.failTitle": "翻译失败",
      "h.skipTitle": "已跳过", "h.expand": "展开原文", "st.ok": "成功", "st.failed": "失败", "st.timeout": "超时", "st.skipped": "已跳过",
      "h.trunc": "原文后半被截断，这次只翻译了前面一部分。",
    },
    en: {
      "rules.count": "{n} rules", "rule.src": "SOURCE MODEL", "rule.dst": "TRANSLATOR", "rule.adv": "Advanced",
      "rule.match": "Matches {n} models", "rule.lang": "Language: {v}", "rule.prompt": "Prompt: {v}", "rule.global": "Global",
      "rule.custom": "Custom", "rule.langOverride": "Language override", "rule.promptOverride": "Override prompt",
      "rule.promptPh": "Uses the global prompt when off.", "rule.empty": "No rules yet", "rule.emptySub": "Add a rule to choose who translates which model's replies.",
      "rule.pick": "Choose a model", "rule.need": "Every rule needs a translator",
      "pick.search": "Search models or providers…", "pick.special": "Wildcards", "pick.all": "All models", "pick.allSub": "Fallback: matches any model",
      "pick.pattern": "All {p}", "pick.none": "No matching models", "pick.nav": "Move", "pick.enter": "Select", "pick.esc": "Close",
      "pick.empty": "No models yet. Wait for the catalog, or add a provider in magpie.",
      "save.saved": "Saved", "save.savedJust": "Saved · just now", "save.dirty": "Unsaved changes", "toast.saved": "Settings saved",
      "prompt.default": "Default prompt", "prompt.edited": "Edited", "prompt.chars": "{n} chars", "toast.reset": "Prompt reset",
      "hero.running": "Running · {n} translated today", "hero.paused": "Paused · {n} translated today", "hero.offline": "Preview · not inside magpie",
      "h.src": "Original", "h.dst": "Translation", "h.compare": "Compare with…", "h.copyDst": "Copy translation", "h.copySrc": "Copy original",
      "h.retranslate": "Retranslate", "h.kept": "kept as is", "h.changed": "code was changed", "h.empty": "No matching entries",
      "h.emptySub": "Try another keyword or clear filters.", "h.clear": "Clear filters", "h.pick": "Pick an entry",
      "h.pickSub": "Original and translation show side by side.", "h.none": "No translations yet", "h.noneSub": "Final replies that match a rule show up here.",
      "h.today": "Today", "h.yesterday": "Yesterday", "toast.copied": "Copied", "h.noOut": "No translation", "h.retry": "Retry",
      "h.retryWith": "Retry with…", "h.adjust": "Adjust timeout", "h.better": "Better", "h.collapse": "Hide list",
      "h.alignNote": "Paragraph-aligned · synced scroll", "h.queued": "Queued. It starts after the hook reloads", "h.retried": "Retranslate queued",
      "h.noMagpie": "Open this page inside magpie to send it to a model", "h.rate": "{n}% succeeded", "h.lat": "median {n} s", "h.latNone": "median —",
      "h.count": "{n} total", "h.countF": "{n} / {all}", "h.timeoutTitle": "Timed out", "h.failTitle": "Translation failed",
      "h.skipTitle": "Skipped", "h.expand": "Show original", "st.ok": "OK", "st.failed": "Failed", "st.timeout": "Timed out", "st.skipped": "Skipped",
      "h.trunc": "The original was cut; only the first part was translated.",
    },
  };
  const STATIC_EN = {
    "hero.desc": "While an agent works, another model rewrites its final replies in your language. Shown separately, never sent back to the session; code stays as is.",
    "out.title": "Output", "out.sub": "Which language, in what voice.",
    "out.lang": "Target language", "out.lang.sub": "Rules can override per model", "out.style": "Style", "out.style.sub": "Fills {style} in the prompt",
    "disp.title": "Display & behaviour", "disp.sub": "Where translations appear, and when to skip.", "disp.where": "Placement",
    "disp.where.sub": "On the Translations page. Never written back to the session.", "disp.badge": "Show translator badge",
    "disp.badge.sub": "Which model translated, and how long it took", "disp.collapse": "Collapse original by default",
    "disp.collapse.sub": "Only for “Below original”", "disp.skip": "Skip if already in target language",
    "disp.skip.sub": "Detected locally; no call, no history entry", "disp.code": "Keep code and commands as is", "common.always": "Always on",
    "disp.code.sub": "Fenced blocks, inline code, paths and commands are never rewritten", "disp.timeout": "Timeout",
    "disp.timeout.sub": "Give up and record as “Timed out”", "disp.hist": "Keep history", "disp.hist.sub": "Stored locally; oldest dropped first",
    "rules.title": "Rules", "rules.sub": "Matched top to bottom; first match wins. Drag or use arrows to reorder.",
    "rules.fall": "Nothing is translated when no rule matches. Put “All models” last as a fallback.", "rules.add": "Add rule",
    "prompt.title": "Prompt", "prompt.sub": "Shared by all rules; a rule can override it under Advanced.", "prompt.reset": "Reset",
    "prompt.vars": "Insert variable", "prompt.preview": "PREVIEW", "save.discard": "Discard", "save.save": "Save",
    "hist.title": "Translations", "hist.export": "Export", "hist.settings": "Rules", "hist.search": "Search original or translation",
  };
  let lang = (params.get("lang") || document.documentElement.lang || "zh").slice(0, 2) === "en" ? "en" : "zh";
  const T = (k, v = {}) => (STR[lang][k] || STR.zh[k] || k).replace(/\{(\w+)\}/g, (_, x) => (x in v ? v[x] : `{${x}}`));
  function applyStatic() {
    if (lang !== "en") return;
    document.documentElement.lang = "en";
    $$("[data-i18n]").forEach((el) => { const s = STATIC_EN[el.dataset.i18n]; if (s) el.textContent = s; });
    $$("[data-i18n-ph]").forEach((el) => { const s = STATIC_EN[el.dataset.i18nPh]; if (s) el.placeholder = s; });
  }

  const root = document.documentElement;
  function paintTheme(t) {
    if (!t) return;
    if (typeof t.dark === "boolean") root.dataset.theme = t.dark ? "dark" : "light";
    if (t.lang) {
      const next = String(t.lang).toLowerCase().startsWith("en") ? "en" : "zh";
      if (next !== lang) { lang = next; applyStatic(); rerender(); }
    }
  }
  if (window.magpie && window.magpie.ready) {
    window.magpie.ready.then(paintTheme).catch(() => {});
    if (window.magpie.onTheme) window.magpie.onTheme(paintTheme);
  } else if (params.get("theme")) root.dataset.theme = params.get("theme");
  else if (matchMedia("(prefers-color-scheme: dark)").matches) root.dataset.theme = "dark";
  let rerender = () => {};

  let toastT;
  function toast(msg) {
    const el = $("#toast"); if (!el) return;
    el.querySelector("span").textContent = msg; el.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 1800);
  }
  function copyText(text) {
    const done = () => toast(T("toast.copied"));
    const legacy = () => {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch { /* 沙箱可能拒绝 */ }
      ta.remove(); done();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, legacy);
    else legacy();
  }

  let openPop = null;
  function closePop() {
    if (!openPop) return;
    openPop.el.remove(); openPop.anchor.classList.remove("open");
    openPop.anchor.setAttribute("aria-expanded", "false"); openPop = null;
  }
  function popover(anchor, el, { align = "left", width } = {}) {
    closePop();
    document.body.appendChild(el);
    if (width) el.style.width = width + "px";
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth, hgt = el.offsetHeight;
    let left = align === "right" ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + hgt > innerHeight - 8 && r.top - hgt - 6 > 8) top = r.top - hgt - 6;
    el.style.left = left + "px"; el.style.top = top + "px";
    anchor.classList.add("open"); anchor.setAttribute("aria-expanded", "true");
    openPop = { el, anchor };
    return el;
  }
  document.addEventListener("mousedown", (e) => { if (openPop && !openPop.el.contains(e.target) && !openPop.anchor.contains(e.target)) closePop(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });
  addEventListener("resize", closePop);

  let setChain = Promise.resolve();
  let lastSet = 0;
  function setOptions(next) {
    setChain = setChain.then(() => new Promise((resolve) => {
      const wait = Math.max(0, 1100 - (Date.now() - lastSet));
      setTimeout(async () => {
        lastSet = Date.now();
        try {
          if (window.magpie?.options?.set) await window.magpie.options.set(next);
          resolve(true);
        } catch (err) { resolve(err); }
      }, wait);
    }));
    return setChain;
  }

  function loadScript(name) {
    return new Promise((resolve) => {
      const old = document.querySelector(`script[data-dyn="${name}"]`);
      if (old) old.remove();
      const el = document.createElement("script");
      el.src = `${name}?t=${Date.now()}`;
      el.dataset.dyn = name;
      el.onload = () => resolve(true);
      el.onerror = () => resolve(false);
      document.body.appendChild(el);
    });
  }

  const LANGS = ["简体中文", "繁體中文", "English", "日本語", "한국어", "Español", "Français", "Deutsch", "Português", "Русский"];
  const PRESETS = [
    { id: "plain", label: "直白人话", style: "Use plain words, as if explaining it out loud to a colleague. Drop jargon." },
    { id: "terms", label: "保留术语", style: "Keep technical terms in English, and give the target-language wording the first time each one appears." },
    { id: "brief", label: "简洁", style: "Keep only the conclusion and the key steps." },
    { id: "full", label: "详细", style: "Translate the whole reply. Do not shorten it or leave anything out." },
  ];
  const TO = [10, 20, 30, 60, 90, 120];
  const DEFAULT_PROMPT = "你是 {translator}，负责把编程 Agent（{model}）写给用户的最终回复改写成{language}。\n\n要求：\n- 风格：{style}。\n- 代码块、行内代码、命令、文件路径、URL 和报错原文一律保持不变。\n- 不补充原文没有的信息，不回答原文里的问题。\n- 保留原有的 Markdown 结构（标题、列表、表格）。\n\n只输出改写后的内容。";

  let providers = [];
  let models = [];
  function bare(id) { const s = String(id || ""); return s.includes("/") ? s.slice(s.lastIndexOf("/") + 1) : s; }
  function globHit(pattern, value) {
    const body = String(pattern).split("*").map((part) => part.replace(/[\\^$+?.()|[\]{}]/g, "\\$&")).join(".*");
    return new RegExp(`^${body}$`, "i").test(value);
  }
  function modelHit(pattern, id) {
    if (!pattern || pattern === "*") return true;
    return globHit(pattern, id) || globHit(pattern, bare(id));
  }
  function countMatch(src) {
    if (!src || src.type === "all") return models.length;
    if (src.type === "pattern") return models.filter((id) => modelHit(src.value, id)).length;
    return models.some((id) => id === src.value || bare(id) === bare(src.value)) ? 1 : 0;
  }
  function groups() {
    const named = new Map(providers.map((p) => [p.id, p.name || p.id]));
    const buckets = new Map();
    for (const id of models) {
      const prov = id.includes("/") ? id.slice(0, id.indexOf("/")) : "";
      const key = prov || "_";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(id);
    }
    const order = providers.map((p) => p.id).filter((id) => buckets.has(id));
    for (const key of buckets.keys()) if (!order.includes(key)) order.push(key);
    return order.map((key) => ({
      id: key,
      name: key === "_" ? (lang === "en" ? "Other" : "其他") : (named.get(key) || key),
      models: buckets.get(key) || [],
    }));
  }
  async function loadCatalog() {
    await loadScript("catalog.js");
    const cat = globalThis.MAGPIE_TRANSLATOR_CATALOG;
    const ids = Array.isArray(cat?.models) ? cat.models.slice() : [];
    if (window.magpie?.read) {
      try {
        const listed = await window.magpie.read("providers:list");
        providers = (Array.isArray(listed) ? listed : []).map((row) => ({
          id: String(row?.id || "").trim(),
          name: String(row?.name || row?.id || "").trim(),
        })).filter((row) => row.id);
      } catch { /* 目录文件仍可用 */ }
      try {
        const usage = await window.magpie.read("usage:summary", { period: "30d" });
        const rows = Array.isArray(usage?.models) ? usage.models : [];
        for (const row of rows) if (row?.model) ids.push(String(row.model));
      } catch { /* 没有用量时只用目录 */ }
    }
    models = [];
    for (const id of ids) {
      const text = String(id || "").trim();
      if (text && !text.includes("*") && !models.includes(text)) models.push(text);
    }
  }
  function specials(extra) {
    const list = [{ type: "all", value: "" }];
    for (const p of providers) list.push({ type: "pattern", value: `${p.id}/*`, name: p.name || p.id });
    if (extra && extra.type === "pattern" && extra.value && !list.some((item) => item.value === extra.value)) {
      list.push({ type: "pattern", value: extra.value, name: extra.value });
    }
    return list;
  }
  function ensureModel(id) {
    const text = String(id || "").trim();
    if (text && !text.includes("*") && !models.includes(text)) models.push(text);
  }

  function pillHTML(val) {
    if (!val || val.type === "all" || !val.value) {
      if (val && val.type === "model" && !val.value) return `<span class="name">${esc(T("rule.pick"))}</span>${icon("chev-down", "xs caret")}`;
      if (val && val.type === "pattern" && val.value) {
        const label = val.value.endsWith("/*") ? val.value.slice(0, -2) : val.value;
        return `<span class="star">*</span><span class="name">${T("pick.pattern", { p: `<span class="mono">${esc(label)}</span>` })}</span>${icon("chev-down", "xs caret")}`;
      }
      return `<span class="star">*</span><span class="name">${esc(T("pick.all"))}</span>${icon("chev-down", "xs caret")}`;
    }
    if (val.type === "pattern") {
      const label = val.value.endsWith("/*") ? (providers.find((p) => p.id === val.value.slice(0, -2))?.name || val.value.slice(0, -2)) : val.value;
      return `<span class="star">*</span><span class="name">${T("pick.pattern", { p: `<span class="mono">${esc(label)}</span>` })}</span>${icon("chev-down", "xs caret")}`;
    }
    const prov = val.value.includes("/") ? val.value.slice(0, val.value.indexOf("/")) : "";
    const name = bare(val.value);
    return `<span class="dot"></span><span class="name">${prov ? `<span class="prov">${esc(prov)}/</span>` : ""}${esc(name)}</span>${icon("chev-down", "xs caret")}`;
  }

  function modelPicker(anchor, { current, allowSpecial, onPick }) {
    const el = h(`<div class="popover" role="dialog">
      <div class="pop-search"><label class="search">${icon("search")}<input class="input" placeholder="${esc(T("pick.search"))}" autocomplete="off"></label></div>
      <div class="pop-body" role="listbox"></div>
      <div class="pop-foot"><span><kbd>↑</kbd><kbd>↓</kbd> ${esc(T("pick.nav"))}</span><span><kbd>↵</kbd> ${esc(T("pick.enter"))}</span><span><kbd>esc</kbd> ${esc(T("pick.esc"))}</span></div></div>`);
    const body = $(".pop-body", el), input = $("input", el);
    const isSel = (v) => current && current.type === v.type && (current.value || "") === (v.value || "");
    function render(q) {
      q = q.trim().toLowerCase();
      let html = "";
      if (allowSpecial) {
        const sp = specials(current).filter((o) => !q || `${o.value} ${o.name || ""} ${T("pick.all")}`.toLowerCase().includes(q));
        if (sp.length) {
          html += `<div class="grp">${esc(T("pick.special"))}</div>` + sp.map((o) => {
            const label = o.type === "all" ? T("pick.all") : T("pick.pattern", { p: o.name || o.value });
            const sub = o.type === "all" ? T("pick.allSub") : T("rule.match", { n: countMatch(o) });
            return `<button class="opt special" type="button" role="option" aria-selected="${isSel(o)}" data-type="${o.type}" data-value="${esc(o.value || "")}">
              <span class="o-ico">${o.type === "all" ? "*" : esc((o.name || o.value || "*")[0])}</span>
              <span class="o-main"><span class="o-name">${esc(label)}</span><span class="o-sub">${esc(sub)}</span></span><span class="o-dot"></span></button>`;
          }).join("");
        }
      }
      const gs = groups();
      if (!gs.length && !html) html = `<div class="empty-mini">${esc(T("pick.empty"))}</div>`;
      for (const g of gs) {
        const ms = g.models.filter((id) => !q || `${id} ${g.name}`.toLowerCase().includes(q));
        if (!ms.length) continue;
        html += `<div class="grp">${esc(g.name)} <span class="count">${ms.length}</span></div>` + ms.map((id) => {
          const v = { type: "model", value: id };
          return `<button class="opt" type="button" role="option" aria-selected="${isSel(v)}" data-type="model" data-value="${esc(id)}">
            <span class="o-dot"></span><span class="o-main"><span class="o-name">${esc(bare(id))}</span></span>
            <span class="o-tag">${esc(g.id === "_" ? "" : g.id)}</span></button>`;
        }).join("");
      }
      body.innerHTML = html || `<div class="empty-mini">${esc(T("pick.none"))}</div>`;
      const first = $(".opt[aria-selected=true]", body) || $(".opt", body);
      if (first) first.classList.add("kbd");
    }
    render("");
    input.addEventListener("input", () => render(input.value));
    input.addEventListener("keydown", (e) => {
      const opts = $$(".opt", body);
      let i = opts.findIndex((o) => o.classList.contains("kbd"));
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!opts.length) return;
        if (i >= 0) opts[i].classList.remove("kbd");
        i = (i + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
        opts[i].classList.add("kbd"); opts[i].scrollIntoView({ block: "nearest" });
      }
      if (e.key === "Enter" && opts[i]) opts[i].click();
    });
    body.addEventListener("click", (e) => {
      const o = e.target.closest(".opt"); if (!o) return;
      const type = o.dataset.type;
      onPick(type === "all" ? { type: "all", value: "" } : { type, value: o.dataset.value });
      closePop();
    });
    popover(anchor, el);
    const sel = $(".opt.kbd", body); if (sel) sel.scrollIntoView({ block: "center" });
    input.focus({ preventScroll: true });
  }

  function blocksOf(text) {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    let i = 0;
    const heading = (line) => /^#{1,6}\s+/.test(line);
    const item = (line) => /^\s*(?:[-*]|\d+\.)\s+/.test(line);
    while (i < lines.length) {
      if (lines[i].startsWith("```")) {
        const lng = lines[i].slice(3).trim() || "text";
        const buf = [];
        i += 1;
        while (i < lines.length && !lines[i].startsWith("```")) { buf.push(lines[i]); i += 1; }
        if (i < lines.length) i += 1;
        blocks.push({ t: "code", lang: lng, src: buf.join("\n") });
        continue;
      }
      if (heading(lines[i])) { blocks.push({ t: "h", src: lines[i].replace(/^#{1,6}\s+/, "") }); i += 1; continue; }
      if (item(lines[i])) {
        const items = [];
        while (i < lines.length && item(lines[i])) { items.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, "")); i += 1; }
        blocks.push({ t: "ul", src: items });
        continue;
      }
      if (!lines[i].trim()) { i += 1; continue; }
      const para = [];
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith("```") && !heading(lines[i]) && !item(lines[i])) {
        para.push(lines[i]); i += 1;
      }
      blocks.push({ t: "p", src: para.join("\n") });
    }
    if (!blocks.length) blocks.push({ t: "p", src: "" });
    return blocks;
  }
  function kindOf(entry) {
    const status = String(entry?.status || "");
    if (status === "skipped") return "skipped";
    if (status === "done" || status === "ok") return "ok";
    if (/timed out|timeout|超时|aborted|abort/i.test(String(entry?.error || ""))) return "timeout";
    if (status === "error" || status === "failed") return "failed";
    return status || "failed";
  }
  function styleLabel(value) {
    const text = String(value || "").trim();
    if (!text) return PRESETS[0].label;
    return PRESETS.find((p) => p.style === text || p.label === text || p.id === text)?.label || text;
  }
  function dayKey(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "older";
    const now = new Date();
    const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((start(now) - start(d)) / 86400000);
    if (diff === 0) return "today";
    if (diff === 1) return "yesterday";
    return iso.slice(0, 10);
  }
  function clock(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function clockFull(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const hm = `${clock(iso)}:${String(d.getSeconds()).padStart(2, "0")}`;
    return dayKey(iso) === "today" ? `${T("h.today")} ${hm}` : `${dayKey(iso) === "yesterday" ? T("h.yesterday") : iso.slice(0, 10)} ${hm}`;
  }
  function agentClass(name) {
    const n = String(name || "").toLowerCase();
    if (n.includes("claude")) return "claude";
    if (n.includes("codex")) return "codex";
    if (n === "pi" || n.includes("pi")) return "pi";
    if (n.includes("cursor")) return "cursor";
    return "";
  }
  function detectFrom(text) {
    const s = String(text || "");
    if (/[\u3040-\u30ff]/.test(s)) return "日本語";
    if (/[\uac00-\ud7af]/.test(s)) return "한국어";
    if (/[\u4e00-\u9fff]/.test(s)) return "中文";
    if (/[A-Za-z]/.test(s)) return "English";
    return "";
  }

  if (document.body.dataset.page === "settings") {
    let rules = [];
    let nextId = 1;
    let saved = {};
    let hydrating = false;
    let styleTouched = false;
    let timeoutTouched = false;
    let cleanSnap = "";
    const savebar = $("#savebar"), saveBtn = $("#save"), saveText = $("#saveText");

    function nearestTimeout(ms) {
      const sec = Math.round(Number(ms) / 1000) || 120;
      let best = 0;
      TO.forEach((n, i) => { if (Math.abs(n - sec) < Math.abs(TO[best] - sec)) best = i; });
      return best;
    }
    function timeoutMs() {
      if (!timeoutTouched && Number.isFinite(Number(saved.translateTimeoutMs))) return Number(saved.translateTimeoutMs);
      return TO[Number($("#timeout").value)] * 1000;
    }
    function promptForSave() {
      return $("#prompt").value === DEFAULT_PROMPT ? "" : $("#prompt").value;
    }
    function styleForSave() {
      const id = $("#styleGrid button[aria-pressed=true]")?.dataset.style || "";
      if (!id) return typeof saved.style === "string" ? saved.style : "";
      if (id === "plain" && !styleTouched && !String(saved.style || "").trim()) return "";
      return PRESETS.find((p) => p.id === id)?.style || "";
    }
    function ruleToOptions(r) {
      const out = { translator: r.dst?.value || "" };
      if (r.agent) out.agent = r.agent;
      if (r.src?.type === "pattern" && r.src.value) out.model = r.src.value;
      else if (r.src?.type === "model" && r.src.value) out.model = r.src.value;
      if (r.lang) out.language = r.lang;
      if (r.prompt != null) out.prompt = r.prompt;
      if (r.style) out.style = r.style;
      if (r.display) out.display = r.display;
      if (r.webhookUrl) out.webhookUrl = r.webhookUrl;
      return out;
    }
    function collect() {
      return {
        enabled: $("#enabled").checked,
        language: $("#lang").value,
        style: styleForSave(),
        placement: $("#where button[aria-pressed=true]")?.dataset.value || "beside",
        showTranslatorBadge: $("#badge").checked,
        collapseOriginal: $("#collapse").checked,
        rewriteSameLanguage: !$("#skip").checked,
        translateTimeoutMs: timeoutMs(),
        historyLimit: Number($("#histLimit").value),
        prompt: promptForSave(),
        rules: rules.map(ruleToOptions),
      };
    }
    function snapshot() { return JSON.stringify(collect()); }
    function setDirty() {
      const dirty = snapshot() !== cleanSnap;
      savebar.classList.toggle("dirty", dirty);
      saveBtn.disabled = !dirty;
      saveText.innerHTML = dirty ? `${esc(T("save.dirty"))}<span class="kbd-hint">⌘S</span>` : esc(T("save.saved"));
    }
    function syncTO() {
      const tr = $("#timeout");
      $("#timeoutVal").textContent = `${TO[tr.value]} s`;
      tr.style.setProperty("--pct", (tr.value / 5) * 100 + "%");
    }
    function todayCount() {
      const feed = globalThis.MAGPIE_TRANSLATOR_FEED;
      const entries = Array.isArray(feed?.entries) ? feed.entries : [];
      return entries.filter((e) => dayKey(e.at) === "today" && kindOf(e) === "ok").length;
    }
    function paintHero() {
      const on = $("#enabled").checked;
      $("#liveDot").style.background = on ? "var(--ok)" : "var(--muted)";
      $("#liveDot").style.boxShadow = on ? "0 0 0 3px var(--ok-soft)" : "none";
      const key = window.magpie ? (on ? "hero.running" : "hero.paused") : "hero.offline";
      $("#heroStatus").textContent = T(key, { n: todayCount() });
    }
    function updatePreview() {
      const ta = $("#prompt");
      const changed = ta.value !== DEFAULT_PROMPT;
      $("#promptState").textContent = changed ? T("prompt.edited") : T("prompt.default");
      $("#promptCount").textContent = T("prompt.chars", { n: ta.value.length });
      $("#resetPrompt").disabled = !changed;
      $("#resetPrompt").style.opacity = changed ? 1 : .5;
      const preset = $("#styleGrid button[aria-pressed=true] b");
      const sampleSrc = rules.find((r) => r.src?.type === "model" && r.src.value)?.src.value || models[0] || "gpt-6-astra";
      const sampleDst = rules.find((r) => r.dst?.value)?.dst.value || models[1] || models[0] || "doubao-seed-2.1-pro";
      const vals = { language: $("#lang").value, style: preset ? preset.textContent : PRESETS[0].label, model: bare(sampleSrc), translator: bare(sampleDst) };
      const line = ta.value.split("\n").find((l) => l.trim()) || "";
      $("#promptPreview").innerHTML = esc(line).replace(/\{(language|style|model|translator)\}/g, (_, k) => `<mark>${esc(vals[k] || "")}</mark>`);
    }
    function renderRules() {
      $("#ruleCount").textContent = T("rules.count", { n: rules.length });
      const list = $("#rules");
      if (!rules.length) {
        list.innerHTML = `<div class="card empty"><div class="art">${icon("translate", "")}</div><b>${esc(T("rule.empty"))}</b><p>${esc(T("rule.emptySub"))}</p></div>`;
        return;
      }
      list.innerHTML = "";
      rules.forEach((r, i) => {
        const langLbl = r.lang || T("rule.global");
        const promptLbl = r.prompt != null ? T("rule.custom") : T("rule.global");
        const card = h(`<div class="card rule ${r.open ? "expanded" : ""}" data-i="${i}">
          <div class="rule-main">
            <span class="handle" draggable="true" title="拖动排序">${icon("grip")}</span>
            <span class="rule-idx">${i + 1}</span>
            <div class="rule-side s"><span class="cap">${esc(T("rule.src"))}</span>
              <button class="model-pill ${r.src.type !== "model" ? "wild" : ""}" type="button" data-pick="src" aria-haspopup="listbox">${pillHTML(r.src)}</button></div>
            <span class="flow-arrow">${icon("arrow")}</span>
            <div class="rule-side d"><span class="cap">${esc(T("rule.dst"))}</span>
              <button class="model-pill" type="button" data-pick="dst" aria-haspopup="listbox">${pillHTML(r.dst)}</button></div>
            <div class="rule-tools">
              <button class="icon-btn" type="button" data-act="up" title="上移" ${i === 0 ? "disabled" : ""}>${icon("up")}</button>
              <button class="icon-btn" type="button" data-act="down" title="下移" ${i === rules.length - 1 ? "disabled" : ""}>${icon("down")}</button>
              <button class="icon-btn danger" type="button" data-act="del" title="删除">${icon("trash")}</button>
            </div>
          </div>
          <div class="rule-meta">
            <span class="mini-tag">${icon("columns", "xs")}${esc(T("rule.match", { n: countMatch(r.src) }))}</span>
            <span class="mini-tag ${r.lang ? "on" : ""}">${icon("globe", "xs")}${esc(T("rule.lang", { v: langLbl }))}</span>
            <span class="mini-tag ${r.prompt != null ? "on" : ""}">${icon("file", "xs")}${esc(T("rule.prompt", { v: promptLbl }))}</span>
            <span class="spacer"></span>
            <button class="disclose" type="button" data-act="toggle">${icon("chev-right", "xs")}${esc(T("rule.adv"))}</button>
          </div>
          <div class="rule-adv">
            <div><div class="field-cap">${esc(T("rule.langOverride"))}</div>
              <select class="select" data-f="lang" style="width:100%"><option value="">${esc(T("rule.global"))}（${esc($("#lang").value)}）</option>
              ${LANGS.map((l) => `<option value="${esc(l)}" ${l === r.lang ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
            <div><div class="field-cap">${esc(T("rule.promptOverride"))}<span class="spacer"></span>
              <label class="switch"><input type="checkbox" data-f="po" ${r.prompt != null ? "checked" : ""}><span class="track"></span></label></div>
              <textarea class="textarea" data-f="prompt" placeholder="${esc(T("rule.promptPh"))}" ${r.prompt == null ? "disabled" : ""}>${esc(r.prompt || "")}</textarea></div>
          </div></div>`);
        list.appendChild(card);
      });
    }
    function mutate(fn) { fn(); renderRules(); if (!hydrating) setDirty(); }
    function ruleFrom(raw, i) {
      const model = typeof raw?.model === "string" ? raw.model.trim() : "";
      let src;
      if (!model || model === "*") src = { type: "all", value: "" };
      else if (model.includes("*")) src = { type: "pattern", value: model };
      else src = { type: "model", value: model };
      if (src.type === "model") ensureModel(src.value);
      ensureModel(raw?.translator);
      return {
        id: nextId++,
        src,
        dst: { type: "model", value: String(raw?.translator || "") },
        lang: raw?.language || "",
        prompt: typeof raw?.prompt === "string" && raw.prompt ? raw.prompt : null,
        open: false,
        agent: raw?.agent || "",
        style: raw?.style || "",
        display: raw?.display || null,
        webhookUrl: raw?.webhookUrl || "",
      };
    }
    function hydrate(opts) {
      hydrating = true;
      saved = opts || {};
      styleTouched = false;
      timeoutTouched = false;
      const language = saved.language || "简体中文";
      if (![...$("#lang").options].some((o) => o.value === language)) {
        const opt = document.createElement("option");
        opt.value = language; opt.textContent = language; $("#lang").append(opt);
      }
      $("#lang").value = language;
      const known = PRESETS.find((p) => p.style === saved.style || p.label === saved.style);
      $$("#styleGrid button").forEach((b) => b.setAttribute("aria-pressed", String(known ? b.dataset.style === known.id : (!saved.style && b.dataset.style === "plain"))));
      const where = ["below", "beside", "only"].includes(saved.placement) ? saved.placement : "beside";
      $$("#where button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === where)));
      $("#badge").checked = saved.showTranslatorBadge !== false;
      $("#collapse").checked = saved.collapseOriginal === true;
      $("#skip").checked = saved.rewriteSameLanguage !== true;
      $("#enabled").checked = saved.enabled !== false;
      const idx = nearestTimeout(saved.translateTimeoutMs ?? 120000);
      $("#timeout").value = String(idx);
      syncTO();
      const limit = Number.isFinite(Number(saved.historyLimit)) ? String(saved.historyLimit) : "500";
      if (![...$("#histLimit").options].some((o) => o.value === limit)) {
        const opt = document.createElement("option");
        opt.value = limit; opt.textContent = `最近 ${limit} 条`; $("#histLimit").append(opt);
      }
      $("#histLimit").value = limit;
      $("#prompt").value = saved.prompt ? saved.prompt : DEFAULT_PROMPT;
      rules = (Array.isArray(saved.rules) ? saved.rules : []).map(ruleFrom);
      renderRules();
      updatePreview();
      paintHero();
      hydrating = false;
      cleanSnap = snapshot();
      setDirty();
    }
    async function save() {
      const body = collect();
      if (body.rules.some((rule) => !rule.translator)) { toast(T("rule.need")); return; }
      let base = saved;
      if (window.magpie?.options?.get) {
        try { base = await window.magpie.options.get() || {}; } catch { /* 用上次读到的 */ }
      }
      const next = { ...(base || {}) };
      Object.assign(next, body);
      delete next._compare;
      saveBtn.disabled = true;
      const result = await setOptions(next);
      if (result === true) {
        saved = next;
        styleTouched = false;
        timeoutTouched = false;
        cleanSnap = snapshot();
        setDirty();
        saveText.textContent = T("save.savedJust");
        toast(T("toast.saved"));
      } else {
        setDirty();
        toast(String(result?.message || result || "保存失败"));
      }
    }

    $$("[data-group]").forEach((g) => g.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || hydrating) return;
      $$("button", g).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if (g.id === "styleGrid") styleTouched = true;
      updatePreview(); setDirty();
    }));
    $("#timeout").addEventListener("input", () => { timeoutTouched = true; syncTO(); setDirty(); });
    document.addEventListener("input", (e) => { if (!hydrating && e.target.closest("[data-dirty]")) { updatePreview(); setDirty(); } });
    document.addEventListener("change", (e) => { if (!hydrating && e.target.closest("[data-dirty]")) { paintHero(); setDirty(); } });
    saveBtn.addEventListener("click", save);
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); if (!saveBtn.disabled) save(); }
    });
    $("#discard").addEventListener("click", () => hydrate(saved));
    const list = $("#rules");
    list.addEventListener("click", (e) => {
      const card = e.target.closest(".rule"); if (!card) return;
      const i = +card.dataset.i, r = rules[i];
      const pick = e.target.closest("[data-pick]");
      if (pick) {
        modelPicker(pick, { current: r[pick.dataset.pick], allowSpecial: pick.dataset.pick === "src", onPick: (v) => mutate(() => { r[pick.dataset.pick] = v; }) });
        return;
      }
      const act = e.target.closest("[data-act]"); if (!act) return;
      const a = act.dataset.act;
      if (a === "toggle") { r.open = !r.open; card.classList.toggle("expanded", r.open); return; }
      mutate(() => {
        if (a === "up" && i > 0) [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]];
        if (a === "down" && i < rules.length - 1) [rules[i + 1], rules[i]] = [rules[i], rules[i + 1]];
        if (a === "del") rules.splice(i, 1);
      });
    });
    list.addEventListener("change", (e) => {
      const card = e.target.closest(".rule"); if (!card) return;
      const r = rules[+card.dataset.i], f = e.target.dataset.f;
      if (f === "lang") mutate(() => { r.lang = e.target.value; });
      if (f === "po") mutate(() => { r.prompt = e.target.checked ? ($("#prompt").value === DEFAULT_PROMPT ? "" : $("#prompt").value) : null; });
    });
    list.addEventListener("input", (e) => {
      if (e.target.dataset.f === "prompt") { rules[+e.target.closest(".rule").dataset.i].prompt = e.target.value; setDirty(); }
    });
    let dragI = null;
    list.addEventListener("dragstart", (e) => {
      const c = e.target.closest(".rule"); if (!c) return;
      dragI = +c.dataset.i; c.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setDragImage(c, 20, 20);
    });
    list.addEventListener("dragover", (e) => {
      const c = e.target.closest(".rule"); if (dragI == null || !c) return;
      e.preventDefault();
      $$(".rule", list).forEach((x) => x.classList.remove("drop-before", "drop-after"));
      const r = c.getBoundingClientRect();
      c.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
    });
    list.addEventListener("drop", (e) => {
      const c = e.target.closest(".rule"); if (dragI == null || !c) return;
      e.preventDefault();
      let to = +c.dataset.i + (c.classList.contains("drop-after") ? 1 : 0);
      const [m] = rules.splice(dragI, 1); if (to > dragI) to -= 1;
      rules.splice(to, 0, m); dragI = null; renderRules(); setDirty();
    });
    list.addEventListener("dragend", () => { dragI = null; $$(".rule", list).forEach((x) => x.classList.remove("dragging", "drop-before", "drop-after")); });
    $("#addRule").addEventListener("click", () => mutate(() => {
      const dst = models[0] || "";
      const src = models[1] ? { type: "model", value: models[1] } : { type: "all", value: "" };
      const at = Math.max(0, rules.length - (rules.length && rules[rules.length - 1].src.type === "all" ? 1 : 0));
      rules.splice(at, 0, { id: nextId++, src, dst: { type: "model", value: dst }, lang: "", prompt: null, open: false, agent: "", style: "", display: null, webhookUrl: "" });
    }));
    const ta = $("#prompt");
    $$(".var-chip").forEach((c) => c.addEventListener("click", () => {
      const s = ta.selectionStart ?? ta.value.length, e2 = ta.selectionEnd ?? s;
      ta.setRangeText(c.dataset.var, s, e2, "end"); ta.focus(); updatePreview(); setDirty();
    }));
    $("#resetPrompt").addEventListener("click", () => { ta.value = DEFAULT_PROMPT; updatePreview(); setDirty(); toast(T("toast.reset")); });
    $("#lang").addEventListener("change", () => { updatePreview(); renderRules(); });

    rerender = () => { applyStatic(); renderRules(); updatePreview(); paintHero(); setDirty(); };
    applyStatic(); syncTO();
    (async () => {
      await loadCatalog();
      let opts = {};
      if (window.magpie?.options?.get) {
        try { opts = await window.magpie.options.get() || {}; } catch { opts = {}; }
      }
      for (const rule of opts.rules || []) ensureModel(rule?.translator);
      hydrate(opts);
      if (location.hash === "#timeout") $("#timeoutRow").scrollIntoView({ block: "center" });
      if (params.get("picker")) setTimeout(() => { const b = $('[data-pick="dst"]'); if (b) { b.scrollIntoView({ block: "center" }); b.click(); } }, 50);
      if (params.get("empty")) { rules = []; renderRules(); cleanSnap = snapshot(); setDirty(); }
    })();
    setInterval(async () => { await loadScript("feed.js"); paintHero(); }, 10000);
  }

  if (document.body.dataset.page === "history") {
    const STATUS = ["ok", "failed", "timeout", "skipped"];
    let entries = [];
    let prefs = { placement: "beside", showTranslatorBadge: true, collapseOriginal: false, rules: [] };
    const state = {
      sel: params.get("entry") || "",
      q: params.get("q") || "",
      f: { agent: "", source: "", translator: "", status: "" },
      compare: (params.get("compare") || "").split(",").filter(Boolean),
      show: 1,
      collapsed: false,
      pending: {},
      wait: null,
      openOriginal: false,
    };
    const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const plain = (s) => String(s ?? "").replace(/[`*]/g, "");
    function hl(code) {
      return esc(code);
    }
    function viewOf(raw) {
      const status = kindOf(raw);
      const blocks = blocksOf(raw.original);
      const outs = {};
      if (raw.translator && status !== "skipped") {
        outs[raw.translator] = { latency: (Number(raw.ms) || 0) / 1000, text: raw.translation || "", error: raw.error || "" };
      }
      for (const c of raw.comparisons || []) {
        if (!c?.translator) continue;
        outs[c.translator] = { latency: (Number(c.ms) || 0) / 1000, text: c.translation || "", error: c.error || "", at: c.at || "" };
      }
      return {
        id: raw.id, at: raw.at, agent: raw.agent || "", source: raw.model || "", translator: raw.translator || "",
        status, to: raw.language || "", style: styleLabel(raw.style), ms: Number(raw.ms) || 0,
        error: raw.error || "", blocks, outs, truncated: !!raw.truncated, raw,
      };
    }
    function ruleLabel(e) {
      const rules = Array.isArray(prefs.rules) ? prefs.rules : [];
      const idx = rules.findIndex((rule) => {
        if (!rule || !rule.translator) return false;
        if (rule.agent && String(rule.agent).toLowerCase() !== String(e.agent).toLowerCase()) return false;
        return modelHit(rule.model || "", e.source);
      });
      if (idx < 0) return "";
      const rule = rules[idx];
      const model = !rule.model || rule.model === "*" ? T("pick.all") : rule.model;
      return `#${idx + 1} ${model}`;
    }
    function titleOf(e) {
      if (e.status === "ok" && e.outs[e.translator]?.text) return plain(e.outs[e.translator].text).split("\n").find((l) => l.trim()) || plain(e.blocks[0].src);
      return plain(e.blocks[0]?.src || "");
    }
    function firstSentence(s) {
      const m = String(s).match(/^.*?(?:[。！？]|[.!?](?=\s|$))/);
      return (m ? m[0] : s).trim();
    }
    function filtered() {
      const q = state.q.trim().toLowerCase();
      return entries.filter((e) => {
        if (state.f.agent && e.agent !== state.f.agent) return false;
        if (state.f.source && e.source !== state.f.source) return false;
        if (state.f.translator && e.translator !== state.f.translator) return false;
        if (state.f.status && e.status !== state.f.status) return false;
        if (!q) return true;
        const blob = [e.blocks.map((b) => b.src), ...Object.values(e.outs).map((o) => o.text)].join("\n").toLowerCase();
        return blob.includes(q);
      });
    }
    function stats() {
      const finished = entries.filter((e) => e.status === "ok" || e.status === "failed" || e.status === "timeout");
      const ok = finished.filter((e) => e.status === "ok");
      const rate = finished.length ? Math.round(ok.length / finished.length * 100) : null;
      const lats = ok.map((e) => e.ms / 1000).filter((n) => n > 0).sort((a, b) => a - b);
      let med = null;
      if (lats.length) {
        const mid = Math.floor(lats.length / 2);
        med = lats.length % 2 ? lats[mid] : (lats[mid - 1] + lats[mid]) / 2;
      }
      $("#stOk").textContent = rate == null ? (lang === "en" ? "succeeded —" : "成功率 —") : T("h.rate", { n: rate });
      $("#stLat").textContent = med == null ? T("h.latNone") : T("h.lat", { n: med.toFixed(1) });
    }
    function fillFilters() {
      const F = {
        agent: ["Agent", (e) => e.agent],
        source: [lang === "en" ? "Source" : "源模型", (e) => e.source],
        translator: [lang === "en" ? "Translator" : "翻译", (e) => e.translator],
        status: [lang === "en" ? "Status" : "状态", (e) => e.status],
      };
      $$("[data-f]").forEach((sel) => {
        const k = sel.dataset.f;
        const cur = state.f[k];
        const vals = [...new Set(entries.map(F[k][1]))].filter(Boolean);
        sel.innerHTML = `<option value="">${esc(F[k][0])}</option>` + vals.map((v) => {
          const label = k === "status" ? T(`st.${v}`) : v;
          return `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(label)}</option>`;
        }).join("");
        sel.classList.toggle("active", !!cur);
      });
    }
    const list = $("#list");
    function renderList() {
      const vis = filtered();
      const filtering = state.q || Object.values(state.f).some(Boolean);
      $("#histCount").textContent = filtering ? T("h.countF", { n: vis.length, all: entries.length }) : T("h.count", { n: entries.length });
      stats();
      if (!entries.length) {
        list.innerHTML = `<div class="empty"><div class="art">${icon("inbox", "")}</div><b>${esc(T("h.none"))}</b><p>${esc(T("h.noneSub"))}</p></div>`;
        renderDetail(null); return;
      }
      if (!vis.length) {
        list.innerHTML = `<div class="empty"><div class="art">${icon("search", "")}</div><b>${esc(T("h.empty"))}</b><p>${esc(T("h.emptySub"))}</p><button class="btn sm" type="button" id="clearF">${esc(T("h.clear"))}</button></div>`;
        $("#clearF").onclick = () => {
          state.q = ""; $("#q").value = "";
          Object.keys(state.f).forEach((k) => { state.f[k] = ""; });
          fillFilters(); renderList();
        };
        renderDetail(null); return;
      }
      if (!vis.some((e) => e.id === state.sel)) state.sel = vis[0].id;
      let html = "", day = "";
      vis.forEach((e) => {
        const key = dayKey(e.at);
        if (key !== day) {
          day = key;
          const n = vis.filter((x) => dayKey(x.at) === key).length;
          const label = key === "today" ? T("h.today") : key === "yesterday" ? T("h.yesterday") : key;
          html += `<div class="day"><span>${esc(label)}</span><span style="font-weight:500;letter-spacing:0">${n}</span></div>`;
        }
        const prev = e.status === "ok" ? titleOf(e) : plain(e.blocks[0]?.src || "");
        html += `<button class="entry is-${esc(e.status)}" type="button" role="option" aria-selected="${e.id === state.sel}" data-id="${esc(e.id)}">
          <div class="e-top"><span class="badge ${agentClass(e.agent)}">${esc(e.agent || "—")}</span><span class="status ${esc(e.status)}">${esc(T("st." + e.status))}</span><span class="e-time">${esc(clock(e.at))}</span></div>
          <div class="e-prev">${esc(prev)}</div>
          <div class="e-models"><span>${esc(bare(e.source) || e.source)}</span>${e.translator ? `${icon("arrow", "xs")}<span>${esc(bare(e.translator))}</span>` : ""}</div></button>`;
      });
      list.innerHTML = html;
      renderDetail(entries.find((x) => x.id === state.sel) || null);
    }
    function textOf(e, which) {
      if (which === "src") return e.raw.original || "";
      if (typeof which === "number") return "";
      return e.outs[which]?.text || "";
    }
    function renderDetail(e) {
      const split = $(".split");
      const wide = innerWidth > 760;
      split.style.gridTemplateColumns = state.collapsed && wide ? "0 minmax(0,1fr)" : "";
      $(".list-pane").style.visibility = state.collapsed && wide ? "hidden" : "";
      const detail = $("#detail");
      if (!e) {
        detail.innerHTML = `<div class="empty" style="margin:auto"><div class="art">${icon("inbox", "")}</div><b>${esc(T("h.pick"))}</b><p>${esc(T("h.pickSub"))}</p></div>`;
        return;
      }
      const bad = e.status === "failed" || e.status === "timeout";
      const placement = prefs.placement || "beside";
      const showSrc = placement !== "only" && e.status !== "skipped";
      const cols = [];
      if (showSrc) cols.push({ kind: "src", who: e.source, lbl: T("h.src"), extra: detectFrom(e.raw.original) || "" });
      if (e.status !== "skipped" && e.translator) cols.push({ kind: "tr", who: e.translator, lbl: T("h.dst"), out: e.outs[e.translator], primary: true });
      state.compare.forEach((m) => { if (m !== e.translator) cols.push({ kind: "tr alt", who: m, lbl: T("h.dst"), out: e.outs[m], alt: true }); });
      const head = titleOf(e);
      const metaBits = [
        `<span class="m">${icon("clock", "xs")}<b>${esc(clockFull(e.at))}</b></span>`,
        `<span class="m"><span class="badge ${agentClass(e.agent)}">${esc(e.agent || "—")}</span></span>`,
        `<span class="m">${icon("globe", "xs")}<b>${esc(detectFrom(e.raw.original) ? `${detectFrom(e.raw.original)} → ${e.to}` : e.to)}</b></span>`,
        `<span class="m">${icon("sparkle", "xs")}<b>${esc(e.style)}</b></span>`,
        `<span class="m">${icon("zap", "xs")}<b>${e.status === "ok" && e.outs[e.translator] ? `${e.outs[e.translator].latency.toFixed(1)} s` : e.status === "timeout" ? `> ${(e.ms / 1000).toFixed(1)} s` : "—"}</b></span>`,
      ];
      const rule = ruleLabel(e);
      if (rule) metaBits.push(`<span class="m">${lang === "en" ? "Rule" : "规则"} <b>${esc(rule)}</b></span>`);
      if (e.truncated) metaBits.push(`<span class="m">${esc(T("h.trunc"))}</span>`);
      const errCard = e.status === "timeout" ? `
        <div class="err-card"><div class="ico">${icon("clock", "")}</div>
          <h3>${esc(T("h.timeoutTitle"))}</h3>
          <p><span class="mono">${esc(e.translator)}</span> ${lang === "en" ? "did not answer in time. The original reply is unchanged." : "没有按时返回。原文不受影响，Agent 会话照常继续。"}</p>
          <div><div class="err-detail">${esc(e.error || `timeout after ${(e.ms / 1000).toFixed(1)} s`)}${rule ? ` · ${esc(rule)}` : ""}</div>
          <div class="err-actions"><button class="btn sm primary" type="button" data-act="retry">${icon("refresh")}${esc(T("h.retry"))}</button>
            <button class="btn sm" type="button" data-act="retry-with">${icon("columns")}${esc(T("h.retryWith"))}</button>
            <a class="btn sm ghost" href="settings.html#timeout">${icon("settings")}${esc(T("h.adjust"))}</a></div></div></div>`
        : e.status === "failed" ? `
        <div class="err-card failed"><div class="ico">${icon("alert", "")}</div>
          <h3>${esc(T("h.failTitle"))}</h3>
          <p>${lang === "en" ? "The translator returned an error. Retry, or try another model." : "翻译模型返回了错误。可以重试，或换一个模型。"}</p>
          <div><div class="err-detail">${esc(e.error)} · ${esc(e.translator)}</div>
          <div class="err-actions"><button class="btn sm primary" type="button" data-act="retry">${icon("refresh")}${esc(T("h.retry"))}</button>
            <button class="btn sm" type="button" data-act="retry-with">${icon("columns")}${esc(T("h.retryWith"))}</button></div></div></div>`
        : e.status === "skipped" ? `
        <div class="err-card" style="border-color:var(--line);background:var(--well)"><div class="ico" style="background:var(--hover);color:var(--muted)">${icon("check", "")}</div>
          <h3>${esc(T("h.skipTitle"))}</h3><p>${lang === "en" ? "The original was already in the target language, so no model was called." : "原文已经是目标语言，没有调用翻译模型。可在设置里关闭「原文已是目标语言时跳过」。"}</p><div></div></div>` : "";
      const below = placement === "below";
      const collapsedOrig = below && prefs.collapseOriginal && !state.openOriginal;
      const colCount = below ? 1 : Math.max(cols.length, 1);
      const rows = e.blocks;
      let grid = "";
      if (!below) {
        grid = cols.map((c, i) => `<div class="c-head ${c.kind} c${i}" style="grid-column:${i + 1};grid-row:1">
          <span class="ttl">${esc(c.lbl)}</span>
          ${prefs.showTranslatorBadge ? `<span class="who" title="${esc(c.who)}">${esc(cols.length > 2 ? bare(c.who) : c.who)}</span>` : ""}
          ${i === 0 && c.extra ? `<span class="lat">${esc(c.extra)}</span>` : ""}
          ${c.out && prefs.showTranslatorBadge ? `<span class="lat">${c.out.latency ? c.out.latency.toFixed(1) + " s" : ""}</span>` : ""}
          ${c.alt && c.out ? `<button class="icon-btn" type="button" style="width:24px;height:24px" title="${esc(T("h.better"))}" data-act="better">${icon("thumb", "xs")}</button>` : ""}
          ${c.out ? `<button class="icon-btn" type="button" style="width:24px;height:24px" title="${esc(T("h.copyDst"))}" data-copy-who="${esc(c.who)}">${icon("copy", "xs")}</button>` : ""}
          ${c.alt ? `<button class="icon-btn x" type="button" style="width:24px;height:24px" title="${lang === "en" ? "Remove" : "移除"}" data-remove="${esc(c.who)}">${icon("x", "xs")}</button>` : ""}
        </div>`).join("");
        rows.forEach((b, r) => {
          cols.forEach((c, i) => {
            const edge = (r === 0 ? " first" : "") + (r === rows.length - 1 ? " last" : "");
            if (c.kind === "src") {
              grid += `<div class="cell c${i} src-col${edge}" data-r="${r}" style="grid-column:${i + 1};grid-row:${r + 2}">${blockHTML(b, b.src, false)}</div>`;
              return;
            }
            if (state.pending[c.who] && !c.out) {
              if (r === 0) grid += `<div class="cell c${i}" data-r="${r}" style="grid-column:${i + 1};grid-row:2 / span ${rows.length}"><div class="skeleton"><i style="width:92%"></i><i style="width:80%"></i><i style="width:64%"></i></div></div>`;
              return;
            }
            if (!c.out || c.out.error && !c.out.text) {
              if (r === 0) grid += `<div class="cell c${i}${edge}" data-r="${r}" style="grid-column:${i + 1};grid-row:2 / span ${rows.length}"><div class="pending-cell">${icon(bad && !c.alt ? "alert" : "info", "")}<span>${esc(T("h.noOut"))}</span>${!c.alt ? `<button class="btn sm" type="button" data-act="retry">${icon("refresh")}${esc(T("h.retry"))}</button>` : ""}</div></div>`;
              return;
            }
            const trans = blocksOf(c.out.text);
            const tb = trans[r];
            const val = !tb ? (b.t === "code" ? b.src : "") : (tb.t === "ul" ? tb.src : tb.src);
            const codeSame = b.t === "code" && (!tb || tb.t !== "code" || tb.src.trim() === b.src.trim());
            const codeChanged = b.t === "code" && tb && tb.t === "code" && tb.src.trim() !== b.src.trim();
            grid += `<div class="cell c${i}${edge}" data-r="${r}" style="grid-column:${i + 1};grid-row:${r + 2}">${blockHTML(b, val, true, { codeSame, codeChanged, code: tb && tb.t === "code" ? tb.src : b.src })}</div>`;
          });
        });
      }
      const tabs = cols.map((c, i) => `<button type="button" aria-pressed="${i === state.show}" data-show="${i}">${i === 0 && c.kind === "src" ? esc(T("h.src")) : c.alt ? esc(bare(c.who).split("-").slice(0, 2).join("-")) : esc(T("h.dst"))}</button>`).join("");
      detail.innerHTML = `
        <div class="d-head">
          <div class="d-title"><h2 title="${esc(head)}">${esc(firstSentence(head))}</h2>
            <div class="d-actions">
              <button class="btn sm" type="button" data-act="copy-src">${icon("copy")}${esc(T("h.copySrc"))}</button>
              <button class="btn sm" type="button" data-act="copy-dst" ${bad || e.status === "skipped" ? "disabled style='opacity:.45'" : ""}>${icon("copy")}${esc(T("h.copyDst"))}</button>
              <button class="btn sm" type="button" data-act="retranslate">${icon("refresh")}${esc(T("h.retranslate"))}</button>
            </div></div>
          <div class="meta">${metaBits.join("")}</div>
        </div>
        ${errCard}
        ${e.status === "skipped" ? "" : `<div class="d-toolbar">
          <button class="btn sm" type="button" data-act="compare" aria-haspopup="listbox">${icon("plus")}${esc(T("h.compare"))}</button>
          ${state.compare.length ? `<span class="chip">${icon("columns", "xs")}${state.compare.length + (e.translator ? 1 : 0)} ${lang === "en" ? "translations" : "个译文对比中"}</span>` : ""}
          <div class="seg col-tabs" id="colTabs">${tabs}</div>
          <span class="spacer"></span>
          <span class="muted" style="font-size:var(--t-xs)">${esc(T("h.alignNote"))}</span>
          <button class="icon-btn" type="button" data-act="collapse" title="${esc(T("h.collapse"))}" aria-pressed="${state.collapsed}">${icon("sidebar")}</button>
        </div>`}
        ${below ? belowHTML(e, cols, collapsedOrig) : `<div class="compare-scroll" id="cmpScroll"><div class="compare" style="--cols:${colCount}" data-show="${state.show}">${grid}</div></div>`}`;
      wireDetail(e, cols);
    }
    function belowHTML(e, cols, collapsedOrig) {
      const src = cols.find((c) => c.kind === "src");
      const rest = cols.filter((c) => c.kind !== "src");
      const orig = !src ? "" : collapsedOrig
        ? `<button class="btn sm" type="button" data-act="expand-orig">${esc(T("h.expand"))}</button>`
        : `<div class="card" style="padding:var(--s4);margin-bottom:var(--s3)">${e.blocks.map((b) => blockHTML(b, b.src, false)).join("")}</div>`;
      const cards = rest.map((c) => {
        if (state.pending[c.who] && !c.out) return `<div class="card" style="padding:var(--s4);margin-bottom:var(--s3)"><div class="skeleton"><i style="width:92%"></i><i style="width:70%"></i></div></div>`;
        if (!c.out || (!c.out.text && c.out.error)) return `<div class="pending-cell" style="margin-bottom:var(--s3)">${esc(T("h.noOut"))}</div>`;
        return `<div class="card" style="padding:var(--s4);margin-bottom:var(--s3)"><div class="c-head" style="position:static;border:0;padding:0 0 8px"><span class="ttl">${esc(T("h.dst"))}</span><span class="who">${esc(c.who)}</span></div>${blocksOf(c.out.text).map((b) => blockHTML(b, b.t === "ul" ? b.src : b.src, true, {})).join("")}</div>`;
      }).join("");
      return `<div class="compare-scroll">${orig}${cards}</div>`;
    }
    function blockHTML(b, val, isTr, flags = {}) {
      if (b.t === "code") {
        const code = flags.code != null ? flags.code : (typeof val === "string" ? val : b.src);
        const mark = !isTr ? `<button class="icon-btn" type="button" style="width:22px;height:22px" data-copy-code>${icon("copy", "xs")}</button>`
          : flags.codeChanged ? `<span class="changed">${icon("alert", "xs")}${esc(T("h.changed"))}</span>`
          : `<span class="same">${icon("check", "xs")}${esc(T("h.kept"))}</span>`;
        return `<div class="code"><div class="code-h"><span>${esc(b.lang || "text")}</span>${mark}</div><pre>${hl(code)}</pre></div>`;
      }
      if (b.t === "ul") {
        const items = Array.isArray(val) ? val : [];
        return `<ul>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`;
      }
      if (b.t === "h") return `<h3>${inline(val || "")}</h3>`;
      return `<p>${inline(val || "")}</p>`;
    }
    function wireDetail(e, cols) {
      const grid = $(".compare", $("#detail"));
      if (grid) {
        grid.addEventListener("mouseover", (ev) => {
          const c = ev.target.closest(".cell");
          $$(".row-hover", grid).forEach((x) => x.classList.remove("row-hover"));
          if (c && c.dataset.r != null) {
            grid.classList.add("hl-row");
            $$(`.cell[data-r="${c.dataset.r}"]`, grid).forEach((x) => x.classList.add("row-hover"));
          }
        });
        grid.addEventListener("mouseleave", () => $$(".row-hover", grid).forEach((x) => x.classList.remove("row-hover")));
      }
      $("#detail").onclick = (ev) => {
        const t = ev.target.closest("[data-act],[data-remove],[data-copy-who],[data-show],[data-copy-code]");
        if (!t) return;
        if (t.dataset.show != null) { state.show = +t.dataset.show; renderDetail(e); return; }
        if (t.dataset.remove) {
          state.compare = state.compare.filter((m) => m !== t.dataset.remove);
          state.show = Math.min(state.show, state.compare.length + 1);
          renderDetail(e); return;
        }
        if (t.dataset.copyWho) { copyText(e.outs[t.dataset.copyWho]?.text || e.raw.original || ""); return; }
        if (t.hasAttribute("data-copy-code")) { copyText(t.closest(".code").querySelector("pre").textContent); return; }
        const a = t.dataset.act;
        if (a === "copy-src") copyText(e.raw.original || "");
        if (a === "copy-dst") copyText(e.outs[e.translator]?.text || "");
        if (a === "collapse") { state.collapsed = !state.collapsed; renderDetail(e); }
        if (a === "expand-orig") { state.openOriginal = true; renderDetail(e); }
        if (a === "better") { t.style.color = "var(--accent)"; toast(`${T("h.better")} · ${t.closest(".c-head")?.querySelector(".who")?.textContent || ""}`); }
        if (a === "retry" || a === "retranslate") queue(e, e.translator, true);
        if (a === "compare" || a === "retry-with") {
          modelPicker(t, { current: null, allowSpecial: false, onPick: (v) => {
            if (!v.value || v.value === e.translator || state.compare.includes(v.value)) return;
            state.compare.push(v.value);
            state.show = state.compare.length + (e.status === "skipped" ? 0 : 1);
            if (state.compare.length >= 1 && innerWidth < 1200) state.collapsed = true;
            queue(e, v.value, false);
          } });
        }
      };
    }
    async function queue(e, translator, replace) {
      if (!translator) return;
      if (!window.magpie?.options?.set) { toast(T("h.noMagpie")); renderDetail(e); return; }
      const nonce = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      state.pending[translator] = nonce;
      state.wait = { id: e.id, translator, replace, text: e.outs[translator]?.text || "", error: e.error, ms: e.ms, n: (e.raw.comparisons || []).length };
      renderDetail(entries.find((x) => x.id === e.id) || e);
      let cur = {};
      try { cur = await window.magpie.options.get() || {}; } catch { cur = {}; }
      const result = await setOptions({ ...cur, _compare: { nonce, entryId: e.id, translator, replace: !!replace } });
      toast(result === true ? (replace ? T("h.retried") : T("h.queued")) : String(result?.message || result || "提交失败"));
    }
    function select(id) {
      state.sel = id; state.compare = []; state.show = 1; state.pending = {}; state.openOriginal = false;
      $$(".entry", list).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.id === id)));
      const el = $(`.entry[data-id="${CSS.escape(id)}"]`, list);
      if (el) el.scrollIntoView({ block: "nearest" });
      renderDetail(entries.find((x) => x.id === id) || null);
    }
    list.addEventListener("click", (e) => { const b = e.target.closest(".entry"); if (b) select(b.dataset.id); });
    $$("[data-f]").forEach((sel) => sel.addEventListener("change", () => {
      state.f[sel.dataset.f] = sel.value; sel.classList.toggle("active", !!sel.value); renderList();
    }));
    const qEl = $("#q");
    qEl.value = state.q;
    qEl.addEventListener("input", () => { state.q = qEl.value; renderList(); });
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") { e.preventDefault(); qEl.focus(); return; }
      if (document.activeElement === qEl || !["ArrowDown", "ArrowUp", "j", "k"].includes(e.key) || e.target.closest("textarea,input,select")) return;
      const vis = filtered();
      const i = vis.findIndex((x) => x.id === state.sel);
      const n = vis[Math.max(0, Math.min(vis.length - 1, i + (e.key === "ArrowDown" || e.key === "j" ? 1 : -1)))];
      if (n) { e.preventDefault(); select(n.id); }
    });
    $("#exportBtn").addEventListener("click", (ev) => {
      const n = filtered().length;
      const el = h(`<div class="popover menu" role="menu">
        <button class="opt" type="button" data-x="json">${icon("braces")}<span class="o-main"><span class="o-name" style="font-family:var(--font)">JSON</span><span class="o-sub">${lang === "en" ? `${n} filtered rows` : `当前筛选的 ${n} 条，含全部译文`}</span></span></button>
        <button class="opt" type="button" data-x="md">${icon("file")}<span class="o-main"><span class="o-name" style="font-family:var(--font)">Markdown</span><span class="o-sub">${lang === "en" ? "Original / translation" : "原文 / 译文对照，便于分享"}</span></span></button>
        <div style="height:1px;background:var(--line);margin:4px 6px"></div>
        <button class="opt" type="button" data-x="one">${icon("copy")}<span class="o-main"><span class="o-name" style="font-family:var(--font)">${lang === "en" ? "This entry" : "仅当前这条"}</span><span class="o-sub">Markdown</span></span></button></div>`);
      el.addEventListener("click", (e2) => {
        const o = e2.target.closest("[data-x]"); if (!o) return;
        closePop();
        const rows = o.dataset.x === "one" ? filtered().filter((e) => e.id === state.sel) : filtered();
        if (o.dataset.x === "json") {
          copyText(JSON.stringify(rows.map((e) => ({
            at: e.at, agent: e.agent, source: e.source, translator: e.translator, status: e.status,
            original: e.raw.original, translation: e.outs[e.translator]?.text || "", error: e.error,
            comparisons: (e.raw.comparisons || []).map((c) => ({ translator: c.translator, translation: c.translation, error: c.error, ms: c.ms })),
          })), null, 2));
          return;
        }
        copyText(rows.map((e) => `## ${clockFull(e.at)} · ${e.agent}\n\n${e.raw.original || ""}\n\n---\n\n${e.outs[e.translator]?.text || e.error || ""}`).join("\n\n"));
      });
      popover(ev.currentTarget, el, { align: "right", width: 260 });
    });
    function noteWait() {
      if (!state.wait) return;
      const e = entries.find((x) => x.id === state.wait.id);
      if (!e) return;
      const w = state.wait;
      if (w.replace) {
        const cur = e.outs[w.translator];
        if ((cur && cur.text !== w.text) || e.error !== w.error || e.ms !== w.ms) delete state.pending[w.translator];
      } else if ((e.raw.comparisons || []).some((c) => c.translator === w.translator) || e.outs[w.translator]) {
        delete state.pending[w.translator];
      }
    }
    async function refresh() {
      await loadScript("feed.js");
      const feed = globalThis.MAGPIE_TRANSLATOR_FEED;
      const rows = Array.isArray(feed?.entries) ? feed.entries : [];
      if (params.get("demo") === "1" && !rows.length) rows.push(...demoRows());
      const key = JSON.stringify(rows);
      if (key === refresh.last) { noteWait(); return; }
      refresh.last = key;
      entries = rows.map(viewOf);
      for (const e of entries) { ensureModel(e.source); ensureModel(e.translator); }
      if (window.magpie?.options?.get) {
        try {
          const opts = await window.magpie.options.get();
          prefs = {
            placement: opts?.placement || "beside",
            showTranslatorBadge: opts?.showTranslatorBadge !== false,
            collapseOriginal: opts?.collapseOriginal === true,
            rules: Array.isArray(opts?.rules) ? opts.rules : [],
          };
        } catch { /* 继续用上次的偏好 */ }
      }
      noteWait();
      fillFilters();
      renderList();
    }
    rerender = () => { applyStatic(); fillFilters(); renderList(); };
    applyStatic();
    (async () => {
      await loadCatalog();
      await refresh();
    })();
    setInterval(refresh, 4000);
    addEventListener("resize", () => renderDetail(entries.find((x) => x.id === state.sel) || null));

    let demoCache = null;
    function demoRows() {
      if (demoCache) return demoCache;
      demoCache = [
        { id: "raft", at: new Date().toISOString(), agent: "Codex", model: "openai/gpt-6-astra", translator: "traex/doubao-seed-2.1-pro", language: "简体中文", style: PRESETS[0].style, ms: 2400, status: "done", original: "Short answer: a linearizable read in Raft must observe every write that was committed before the read started.\n\nThere are two standard ways to do it:\n\n- **ReadIndex** — the leader records its current commit index.\n- **Lease read** — the leader skips the extra round trip.\n\n```go\nfunc (n *node) LinearizableRead(ctx context.Context) error {\n    return n.applyWait.Wait(ctx, idx)\n}\n```", translation: "简单说：Raft 里的线性一致读，必须能看到读请求开始之前已经提交的所有写入。\n\n常见做法有两种：\n\n- **ReadIndex**：leader 先记下当前的 commit index。\n- **Lease read（租约读）**：leader 省掉那一轮心跳。\n\n```go\nfunc (n *node) LinearizableRead(ctx context.Context) error {\n    return n.applyWait.Wait(ctx, idx)\n}\n```", comparisons: [{ id: "c1", translator: "grok/grok-4.7-build-fast", translation: "一句话：Raft 中的线性一致读要求读到读请求开始前已提交的全部写入。\n\n标准做法有两种：\n\n- **ReadIndex**：leader 记录当前提交索引。\n- **Lease read**：leader 跳过额外往返。", ms: 1100, error: "" }] },
        { id: "timeout", at: new Date(Date.now() - 600000).toISOString(), agent: "Pi", model: "cursor/grok-4.7", translator: "grok/grok-4.7-build-fast", language: "简体中文", style: PRESETS[0].style, ms: 30000, status: "error", error: "The operation timed out.（已重试一次）", original: "Here's the migration plan for moving the session store from Redis to Postgres:\n\n- Create the `sessions` table.\n- Dual-write for one release.", translation: "" },
        { id: "fail", at: new Date(Date.now() - 1200000).toISOString(), agent: "Claude Code", model: "anthropic/claude-sonnet-4.6", translator: "grok/grok-4.7-build-fast", language: "简体中文", style: PRESETS[0].style, ms: 800, status: "error", error: "HTTP 429", original: "Refactored the auth middleware: tokens are now verified once per request.", translation: "" },
      ];
      return demoCache;
    }
  }
})();
