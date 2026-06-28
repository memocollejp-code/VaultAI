// ===== CONSTANTS =====
const STORAGE_KEY = 'aimemo_entries_v2';
const SETTINGS_KEY = 'aimemo_settings_v2';
const DRAFT_KEY = 'aimemo_draft_v2';
const DB_NAME = 'aimemo_db';
const DB_VERSION = 1;
const STORE_NAME = 'entries';

const MODE_DEFS = [
  { key: 'reproduce', icon: '🔁', name: '再現する', desc: '今回と同じ回答を得るための文章' },
  { key: 'delegate', icon: '🤝', name: 'AIへ依頼する', desc: '他のAIへ作業を依頼するための文章' },
  { key: 'expand', icon: '🌱', name: '発展させる', desc: '今回の内容を改善・深掘りする文章' },
  { key: 'imageReproduce', icon: '🖼️', name: '画像を再現する', desc: '画像生成AIへ渡す文章' },
  { key: 'save', icon: '💾', name: '保存する', desc: 'AIメモ標準フォーマットへ変換する文章' },
  { key: 'nextShortest', icon: '⚡', name: '次回最短質問', desc: '次回、最短で同じ結果を得るための質問文' },
];

const AIMF_TEMPLATE =
`AIMF（AI Memo Format）v1.1

以下のルールを厳守してください。

【ルール】

・「===AIMF v1.0 START===」より前、「===AIMF v1.0 END===」より後には一切文字を出力しない
・指定された項目以外は一切出力しない
・説明、補足、挨拶、前置き、後書きは禁止
・Markdownは禁止
・コードブロックは禁止
・絵文字は禁止
・項目名は変更・削除・追加しない
・項目の順番は変更しない
・空欄は禁止
・内容がない場合は必ず「なし」と出力する
・タグは半角カンマ（,）のみで区切り、スペースを入れない
・評価は1～5の半角数字1文字のみを出力する
・改行位置は変更しない
・各項目は簡潔に記載する
・タイトルは20文字以内で記載する
・【AI名】には回答を生成したAI名を正式名称で記載する
・質問はユーザーの質問内容を要約する
・解決策は回答内容を要約する
・学びは今回の対話から得られる重要な気づきを1文で記載する
・次回最短質問は、今回と同じ結論を最短で得られる質問文を作成する
・ルール文は出力しない
・「===AIMF v1.0 START===」と「===AIMF v1.0 END===」は必ず出力する

===AIMF v1.0 START===

【AI名】

【タイトル】

【質問】

【解決策】

【タグ】

【評価】

【学び】

【次回最短質問】

===AIMF v1.0 END===`;

let state = {
  entries: [],
  settings: { theme: 'light' },
  history: ['home'],
  selectedAI: 'ChatGPT',
  editingId: null,
  detailId: null,
  deleteId: null,
  currentTags: [],
  currentRating: 3,
  currentImages: [],
  currentModes: {},
  searchTimer: null,
  imageActionTarget: null,
};

// ===== INDEXEDDB =====
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function idbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function idbPutAll(entries) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const clearReq = store.clear();
    clearReq.onsuccess = () => {
      let count = entries.length;
      if (count === 0) { resolve(); return; }
      entries.forEach(entry => {
        const req = store.put(entry);
        req.onsuccess = () => { count--; if (count === 0) resolve(); };
        req.onerror = () => reject(req.error);
      });
    };
    clearReq.onerror = () => reject(clearReq.error);
  });
}

// ===== STORAGE =====
async function saveEntries() {
  try {
    await idbPutAll(state.entries);
    checkStorageQuota();
    return true;
  } catch (e) {
    console.error('saveEntries error:', e);
    return false;
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { theme: 'light' };
  } catch (e) { return { theme: 'light' }; }
}
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); }

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ===== AIMF PARSE =====
function isAIMF(text) {
  return text.includes('===AIMF v1.0 START===') && text.includes('===AIMF v1.0 END===');
}

function parseAIMF(text) {
  const startMarker = '===AIMF v1.0 START===';
  const endMarker = '===AIMF v1.0 END===';
  const startIdx = text.indexOf(startMarker);
  const endIdx = text.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) return {};

  const inner = text.slice(startIdx + startMarker.length, endIdx);
  const KNOWN_KEYS = ['AI名','タイトル','質問','解決策','タグ','評価','学び','次回最短質問'];
  const headingRe = new RegExp('(^|\\n)【(' + KNOWN_KEYS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')】', 'g');

  const result = {};
  const matches = [...inner.matchAll(headingRe)];
  if (!matches.length) return {};

  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][2];
    const valueStart = matches[i].index + matches[i][0].length;
    const valueEnd = i + 1 < matches.length ? matches[i + 1].index : inner.length;
    const val = inner.slice(valueStart, valueEnd).trim();
    if (key === 'タグ') {
      result[key] = val.split(/[,、，]/).map(s => s.trim()).filter(Boolean);
    } else if (key === '評価') {
      const n = parseInt(val.match(/\d/)?.[0] || '3');
      result[key] = Math.min(5, Math.max(1, n));
    } else {
      result[key] = val;
    }
  }
  return result;
}

// ===== TEXT GENERATORS FOR EACH MODE =====
function genReproduce(e) {
  return `以下と同じ条件で、もう一度同じ趣旨の回答をしてください。\n\n【元の質問】\n${e.question}\n\n【期待する回答の方向性】\n${e.solution}`;
}
function genDelegate(e) {
  return `これまで別のAI（${e.aiName}）と次のやり取りをしました。続きを引き継いで作業してください。\n\n【質問】\n${e.question}\n\n【これまでの回答】\n${e.solution}\n\n上記を踏まえて、続きの作業をお願いします。`;
}
function genExpand(e) {
  return `以下の内容について、さらに深掘り・改善してください。\n\n【元の質問】\n${e.question}\n\n【元の回答】\n${e.solution}\n\n改善できる点、見落としている観点、さらに発展させられる方向性を提案してください。`;
}
function genImageReproduce(e) {
  return `次の特徴を持つ画像を生成してください。\n\n${e.learning || e.solution || e.question}`;
}
function genSaveFormat(e) {
  return `【タイトル】\n${e.title}\n\n【質問】\n${e.question}\n\n【解決策】\n${e.solution}\n\n【タグ】\n${(e.tags||[]).join(', ')}\n\n【評価】\n${e.rating}\n\n【学び】\n${e.learning}\n\n【次回最短質問】\n${e.shortestQuestion || ''}`;
}
function genNextShortest(e) {
  return e.shortestQuestion || `「${e.title}」について、前回と同じ結論を最短で得たいです。前提を踏まえて一言で要点を教えてください。`;
}
const MODE_GENERATORS = {
  reproduce: genReproduce, delegate: genDelegate, expand: genExpand,
  imageReproduce: genImageReproduce, save: genSaveFormat, nextShortest: genNextShortest,
};

// ===== TOAST =====
const toastQueue = [];
let toastShowing = false;
function showToast(msg, duration = 2000) {
  toastQueue.push({ msg, duration });
  if (!toastShowing) processToastQueue();
}
function processToastQueue() {
  if (!toastQueue.length) { toastShowing = false; return; }
  toastShowing = true;
  const { msg, duration } = toastQueue.shift();
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(processToastQueue, 220);
  }, duration);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      return true;
    } catch (e2) { showToast('⚠️ コピーに失敗しました'); return false; }
  }
}

// ===== SCREEN NAV =====
function showScreen(id, pushHistory = true) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  if (pushHistory) {
    state.history.push(id);
    try { history.pushState({ aimemoScreen: id }, '', location.href); } catch (e) {}
  }
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navMap = { home: 'home', images: 'images', settings: 'settings' };
  if (navMap[id]) {
    const el = document.querySelector(`.nav-item[data-nav="${navMap[id]}"]`);
    if (el) el.classList.add('active');
  }
}
function goBack() {
  if (state.history.length > 1) {
    history.back();
  }
}
function handlePopState() {
  if (state.history.length > 1) state.history.pop();
  const prev = state.history[state.history.length - 1] || 'home';
  showScreen(prev, false);
  if (prev === 'home') renderHome();
}
window.addEventListener('popstate', handlePopState);

function applyTheme() {
  document.body.classList.toggle('dark-mode', state.settings.theme === 'dark');
  document.getElementById('theme-toggle').classList.toggle('on', state.settings.theme === 'dark');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function getAIClass(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('chatgpt') || n.includes('gpt')) return 'chatgpt';
  if (n.includes('claude')) return 'claude';
  if (n.includes('gemini')) return 'gemini';
  return 'other';
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) {
  return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const SAFE_IMAGE_DATAURL_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;
function isSafeImageDataUrl(s) {
  return typeof s === 'string' && SAFE_IMAGE_DATAURL_RE.test(s);
}
function safeImageTag(img) {
  if (!isSafeImageDataUrl(img.dataUrl)) {
    return `<div class="image-tile-broken">⚠️</div>`;
  }
  return `<img src="${escapeAttr(img.dataUrl)}" alt="">`;
}

// ===== RENDER: HOME =====
let activeFilter = 'all';
function renderHome() {
  const entries = state.entries;
  document.getElementById('sum-total').textContent = entries.length;
  document.getElementById('sum-images').textContent = entries.reduce((acc, e) => acc + (e.images?.length || 0), 0);
  document.getElementById('sum-fav').textContent = entries.filter(e => e.isFavorite).length;

  const added = [...entries].sort((a,b) => new Date(b.savedAt) - new Date(a.savedAt)).slice(0, 6);
  document.getElementById('carousel-added').innerHTML = added.length ? added.map(miniCardHtml).join('') :
    `<div class="empty-mini">まだ保存された資産がありません</div>`;

  const edited = [...entries].sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 6);
  document.getElementById('carousel-edited').innerHTML = edited.length ? edited.map(miniCardHtml).join('') :
    `<div class="empty-mini">まだ編集された資産がありません</div>`;

  const tagCount = {};
  entries.forEach(e => (e.tags||[]).forEach(t => tagCount[t] = (tagCount[t]||0) + 1));
  const ranked = Object.entries(tagCount).sort((a,b) => b[1]-a[1]).slice(0, 10);
  document.getElementById('carousel-tags').innerHTML = ranked.length ?
    ranked.map(([t,c]) => `<button class="tag-rank-chip" data-tag="${escapeHtml(t)}">#${escapeHtml(t)} (${c})</button>`).join('') :
    `<div class="empty-mini">タグがまだありません</div>`;

  renderEntryList();
}
function miniCardHtml(e) {
  return `<div class="mini-card" data-id="${e.id}">
    <div class="mini-card-title">${escapeHtml(e.title || e.question || '無題')}</div>
    <div class="mini-card-meta">${escapeHtml(e.aiName||'')} ・ ${formatDate(e.updatedAt)}</div>
  </div>`;
}

function renderEntryList(searchQuery) {
  let list = [...state.entries];
  if (activeFilter === 'favorite') list = list.filter(e => e.isFavorite);
  else if (['chatgpt','claude','gemini'].includes(activeFilter)) list = list.filter(e => getAIClass(e.aiName) === activeFilter);
  list.sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const container = document.getElementById('entry-list');
  if (!list.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-emoji">🗂️</div>
      <div class="empty-title">まだ資産がありません</div>
      <div class="empty-desc">＋ボタンからAIとの会話を保存してみましょう</div>
    </div>`;
    return;
  }
  container.innerHTML = list.map(entryCardHtml).join('');
}
function entryCardHtml(e) {
  const cls = getAIClass(e.aiName);
  return `<div class="entry-card" data-id="${e.id}">
    <div class="card-top">
      <span class="ai-badge ${cls}">${escapeHtml(e.aiName||'')}</span>
      ${e.isFavorite ? '<span class="card-fav">⭐</span>' : ''}
      <span class="card-date" style="margin-left:auto;">${formatDate(e.updatedAt)}</span>
    </div>
    <div class="card-title">${escapeHtml(e.title || '無題')}</div>
    <div class="card-question">${escapeHtml(e.question || '')}</div>
    <div class="card-tags">${(e.tags||[]).map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>
    <div class="card-bottom"><span class="stars-mini">${'★'.repeat(e.rating||0)}${'☆'.repeat(5-(e.rating||0))}</span></div>
  </div>`;
}

// ===== RENDER: IMAGE LIBRARY =====
function renderImageLibrary() {
  const grid = document.getElementById('image-grid');
  const images = [];
  state.entries.forEach(e => (e.images||[]).forEach(img => images.push({ ...img, entryId: e.id, entry: e })));
  if (!images.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="empty-emoji">🖼️</div>
      <div class="empty-title">画像がまだありません</div>
      <div class="empty-desc">保存時に画像を追加すると、ここに一覧表示されます</div>
    </div>`;
    return;
  }
  grid.innerHTML = images.map(img => `
    <div class="image-tile" data-entry-id="${escapeAttr(img.entryId)}" data-image-id="${escapeAttr(img.id)}">
      ${safeImageTag(img)}
      <div class="image-tile-caption">${escapeHtml(img.entry.title || '')}</div>
    </div>`).join('');
}

// ===== STEP1 =====
function renderAIMFTemplate() { document.getElementById('aimf-template-box').textContent = AIMF_TEMPLATE; }

function updateAISelectUI() {
  document.querySelectorAll('#ai-select-row .ai-btn, #ai-select-row-step2 .ai-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.ai === state.selectedAI);
  });
}

// ===== STEP2 =====
function renderEditTags() {
  document.getElementById('edit-tag-list').innerHTML = state.currentTags.map((t, i) =>
    `<button class="tag-removable" data-idx="${i}">#${escapeHtml(t)} ✕</button>`).join('');
}
function renderEditStars() {
  document.querySelectorAll('#edit-stars .star-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.val) <= state.currentRating);
  });
}
function renderEditImages() {
  const grid = document.getElementById('edit-image-grid');
  grid.innerHTML = state.currentImages.map((img) => `
    <div class="image-tile">
      ${safeImageTag(img)}
      <div class="image-tile-caption" style="cursor:pointer;" data-remove-id="${escapeAttr(img.id)}">✕ 削除</div>
    </div>`).join('');
}

function populateEditForm(data) {
  document.getElementById('edit-title').value = data.title || '';
  document.getElementById('edit-question').value = data.question || '';
  document.getElementById('edit-solution').value = data.solution || '';
  document.getElementById('edit-learning').value = data.learning || '';
  state.currentTags = [...(data.tags || [])];
  state.currentRating = data.rating || 3;
  state.currentImages = [...(data.images || [])];
  state.currentShortest = data.shortestQuestion || '';
  renderEditTags(); renderEditStars(); renderEditImages();
}

function collectFormData() {
  return {
    title: document.getElementById('edit-title').value.trim().slice(0, 20),
    aiName: state.selectedAI,
    question: document.getElementById('edit-question').value.trim(),
    solution: document.getElementById('edit-solution').value.trim(),
    learning: document.getElementById('edit-learning').value.trim(),
    tags: [...state.currentTags],
    rating: state.currentRating,
    images: [...state.currentImages],
    shortestQuestion: state.currentShortest || '',
  };
}

// ===== STEP3 =====
function renderModeList() {
  document.getElementById('mode-list').innerHTML = MODE_DEFS.map(m => `
    <div class="mode-row ${state.currentModes[m.key] ? 'checked' : ''}" data-mode="${m.key}">
      <div class="mode-check">${state.currentModes[m.key] ? '✓' : ''}</div>
      <div class="mode-info">
        <div class="mode-name">${m.icon} ${m.name}</div>
        <div class="mode-desc">${m.desc}</div>
      </div>
    </div>`).join('');
}

// ===== DETAIL =====
function renderDetail(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  document.getElementById('btn-detail-fav').textContent = e.isFavorite ? '⭐' : '☆';

  const modeBlocks = MODE_DEFS.filter(m => e.modes && e.modes[m.key] && e.modes[m.key].enabled).map(m => {
    const text = MODE_GENERATORS[m.key](e);
    return `<div class="mode-action" data-text="${escapeHtml(text)}">
      <div class="mode-action-icon">${m.icon}</div>
      <div class="mode-action-text">
        <div class="mode-action-title">${m.name}</div>
        <div class="mode-action-desc">${m.desc}</div>
      </div>
      <button class="copy-btn" data-copy-target="${m.key}">コピー</button>
    </div>`;
  }).join('');

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-top-row">
      <span class="ai-badge ${getAIClass(e.aiName)}">${escapeHtml(e.aiName||'')}</span>
    </div>
    <div class="detail-title">${escapeHtml(e.title || '無題')}</div>
    <div class="card-tags" style="margin-bottom:14px;">${(e.tags||[]).map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>
    <div style="margin-bottom:18px; color:var(--star-active);">${'★'.repeat(e.rating||0)}${'☆'.repeat(5-(e.rating||0))}</div>

    ${e.images && e.images.length ? `<div class="image-grid" style="margin-bottom:16px;">${e.images.map(img => `<div class="image-tile" data-image-id="${escapeAttr(img.id)}">${safeImageTag(img)}</div>`).join('')}</div>` : ''}

    <div class="detail-block"><div class="detail-label">質問</div><div class="detail-text">${escapeHtml(e.question || '（未入力）')}</div></div>
    <div class="detail-block"><div class="detail-label">解決策</div><div class="detail-text">${escapeHtml(e.solution || '（未入力）')}</div></div>
    <div class="detail-block"><div class="detail-label">学び</div><div class="detail-text">${escapeHtml(e.learning || '（未入力）')}</div></div>

    <div class="section-title" style="margin-top:8px;">使う機能</div>
    ${modeBlocks || `<div class="empty-mini">この資産では機能が選択されていません</div>`}

    <div style="margin-top:24px; display:flex; gap:10px;">
      <button class="btn-secondary danger-row" id="btn-delete-entry" style="flex:1;">🗑️ 削除する</button>
    </div>
  `;

  document.getElementById('detail-content').querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const block = btn.closest('.mode-action');
      const ok = await copyText(block.dataset.text);
      if (ok) {
        btn.textContent = '✅'; btn.classList.add('copied');
        showToast('📋 コピーしました');
        setTimeout(() => { btn.textContent = 'コピー'; btn.classList.remove('copied'); }, 1600);
      }
    });
  });
}

// ===== SEARCH =====
function renderSearch(query) {
  const q = (query || '').trim().toLowerCase();
  const container = document.getElementById('search-results');
  if (!q) { container.innerHTML = ''; return; }
  const results = state.entries.filter(e => {
    const hay = [e.title, e.aiName, e.question, e.solution, e.learning, ...(e.tags||[])].join(' ').toLowerCase();
    return hay.includes(q);
  });
  if (!results.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-emoji">🔍</div><div class="empty-title">見つかりませんでした</div></div>`;
    return;
  }
  container.innerHTML = results.map(entryCardHtml).join('');
}

// ===== EXPORT / IMPORT =====
function exportData() {
  const data = { entries: state.entries, exportedAt: new Date().toISOString(), schemaVersion: 1 };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `aimemo_export_${Date.now()}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('📤 エクスポートしました');
}

function validateEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const safeStr = (v) => (typeof v === 'string' ? v : '');
  const safeArr = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
  const safeImages = (v) => (Array.isArray(v) ? v
    .filter(img => img && typeof img === 'object' && isSafeImageDataUrl(img.dataUrl))
    .map(img => ({ id: typeof img.id === 'string' ? img.id : uuid(), dataUrl: img.dataUrl, caption: safeStr(img.caption) }))
    : []);
  const rating = parseInt(raw.rating, 10);
  return {
    id: typeof raw.id === 'string' ? raw.id : uuid(),
    title: safeStr(raw.title).slice(0, 20),
    aiName: safeStr(raw.aiName) || 'ChatGPT',
    question: safeStr(raw.question),
    solution: safeStr(raw.solution),
    learning: safeStr(raw.learning),
    tags: safeArr(raw.tags),
    rating: Number.isFinite(rating) ? Math.min(5, Math.max(1, rating)) : 3,
    images: safeImages(raw.images),
    shortestQuestion: safeStr(raw.shortestQuestion),
    isFavorite: !!raw.isFavorite,
    modes: (raw.modes && typeof raw.modes === 'object') ? raw.modes : {},
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (e) {
      showToast('⚠️ ファイルの読み込みに失敗しました');
      return;
    }
    try {
      const rawEntries = data.entries || data;
      if (!Array.isArray(rawEntries)) throw new Error('invalid');
      const entries = rawEntries.map(validateEntry).filter(Boolean);
      if (!entries.length) throw new Error('empty');
      state.entries = entries;
      const ok = await saveEntries();
      if (ok) {
        renderHome();
        showToast(`📥 ${entries.length}件をインポートしました`);
      } else {
        showToast('⚠️ 容量超過またはエラーにより保存に失敗しました');
      }
    } catch (e) {
      showToast('⚠️ データの形式が正しくありません');
    }
  };
  reader.readAsText(file);
}

// ===== IMAGE HANDLING =====
const IMAGE_MAX_DIMENSION = 1280;
const IMAGE_QUALITY = 0.7;

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function compressImage(dataUrl) {
  try {
    const img = await loadImageElement(dataUrl);
    let { width, height } = img;
    if (width <= 0 || height <= 0) return dataUrl;
    const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(width, height));
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = targetW; canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, targetW, targetH);
    const compressed = canvas.toDataURL('image/webp', IMAGE_QUALITY);
    if (compressed && compressed.length < dataUrl.length) return compressed;
    return dataUrl;
  } catch (e) {
    console.error('compressImage error:', e);
    return dataUrl;
  }
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (file.type && !ALLOWED_TYPES.includes(file.type)) {
      showToast('⚠️ この画像形式（' + (file.type || '不明') + '）には対応していません');
      reject(new Error('unsupported image type'));
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const original = reader.result;
      if (!isSafeImageDataUrl(original)) {
        showToast('⚠️ 画像データの形式を確認できませんでした');
        reject(new Error('unsafe image data'));
        return;
      }
      const compressedDataUrl = await compressImage(original);
      resolve({ id: uuid(), dataUrl: compressedDataUrl, caption: '' });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function checkStorageQuota() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return;
    const { usage, quota } = await navigator.storage.estimate();
    if (quota && usage / quota > 0.85) {
      showToast('⚠️ ストレージ容量が残り少なくなっています。データのエクスポートをおすすめします', 3200);
    }
  } catch (e) { /* ignore */ }
}

// ===== INIT =====
async function init() {
  try { history.replaceState({ aimemoScreen: 'home' }, '', location.href); } catch (e) {}
  try {
    db = await openDB();
  } catch (e) {
    console.error('IndexedDB open failed:', e);
    showToast('⚠️ ストレージの初期化に失敗しました');
  }

  if (db) {
    try {
      const existingEntries = await idbGetAll();
      if (existingEntries.length === 0) {
        const lsRaw = localStorage.getItem(STORAGE_KEY);
        if (lsRaw) {
          let lsEntries;
          try { lsEntries = JSON.parse(lsRaw); } catch (e) { lsEntries = null; }
          if (Array.isArray(lsEntries) && lsEntries.length > 0) {
            await idbPutAll(lsEntries);
            localStorage.removeItem(STORAGE_KEY);
            state.entries = lsEntries;
          } else {
            state.entries = [];
          }
        } else {
          state.entries = [];
        }
      } else {
        state.entries = existingEntries;
      }
    } catch (e) {
      console.error('Migration/load error:', e);
      state.entries = [];
    }
  } else {
    state.entries = [];
  }

  state.settings = loadSettings();
  applyTheme();
  renderHome();
  renderAIMFTemplate();
  setupEventListeners();
}

function setupEventListeners() {
  // ---- NAV ----
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.nav;
      if (target === 'add') { startSaveFlow(); return; }
      state.history = ['home'];
      try { history.replaceState({ aimemoScreen: 'home' }, '', location.href); } catch (err) {}
      if (target === 'home') { showScreen('home', false); renderHome(); }
      else if (target === 'images') { showScreen('images'); renderImageLibrary(); }
      else if (target === 'settings') { showScreen('settings'); }
    });
  });

  document.getElementById('btn-fab-add').addEventListener('click', startSaveFlow);

  function startSaveFlow() {
    state.editingId = null;
    state.selectedAI = 'ChatGPT';
    state.currentModes = { reproduce: true, delegate: true, expand: true, save: true, nextShortest: true, imageReproduce: false };
    populateEditForm({});
    document.getElementById('paste-area').value = '';
    document.getElementById('parse-warning').classList.remove('show');
    updateAISelectUI();
    showScreen('step1');
  }

  // ---- HOME ----
  document.getElementById('btn-open-search').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    document.getElementById('search-results').innerHTML = '';
    showScreen('search');
    setTimeout(() => document.getElementById('search-input').focus(), 200);
  });
  document.getElementById('btn-open-settings').addEventListener('click', () => showScreen('settings'));

  document.getElementById('filter-row').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-tab'); if (!btn) return;
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderEntryList();
  });

  document.querySelectorAll('.section-title .more').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      document.querySelector('.filter-tab[data-filter="all"]').classList.add('active');
      activeFilter = 'all';
      renderEntryList();
      document.getElementById('entry-list').scrollIntoView({ behavior: 'smooth' });
    });
  });

  document.getElementById('carousel-added').addEventListener('click', cardClickHandler);
  document.getElementById('carousel-edited').addEventListener('click', cardClickHandler);
  document.getElementById('entry-list').addEventListener('click', cardClickHandler);
  document.getElementById('search-results').addEventListener('click', cardClickHandler);
  function cardClickHandler(e) {
    const card = e.target.closest('.mini-card, .entry-card');
    if (!card) return;
    openDetail(card.dataset.id);
  }
  function openDetail(id) {
    state.detailId = id;
    renderDetail(id);
    showScreen('detail');
  }

  document.getElementById('carousel-tags').addEventListener('click', (e) => {
    const chip = e.target.closest('.tag-rank-chip'); if (!chip) return;
    showScreen('search');
    document.getElementById('search-input').value = chip.dataset.tag;
    renderSearch(chip.dataset.tag);
  });

  // ---- SEARCH ----
  document.getElementById('btn-search-back').addEventListener('click', goBack);
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => renderSearch(e.target.value), 300);
  });

  // ---- IMAGE LIBRARY ----
  document.getElementById('btn-images-back').addEventListener('click', goBack);
  document.getElementById('image-grid').addEventListener('click', (e) => {
    const tile = e.target.closest('.image-tile'); if (!tile) return;
    const entry = state.entries.find(x => x.id === tile.dataset.entryId);
    if (!entry) return;
    state.imageActionTarget = entry;
    document.getElementById('sheet-image-action').classList.add('show');
  });
  document.getElementById('sheet-image-action').addEventListener('click', (e) => {
    if (e.target === document.getElementById('sheet-image-action')) {
      document.getElementById('sheet-image-action').classList.remove('show');
    }
  });
  async function copyImageMode(genFn, label) {
    const entry = state.imageActionTarget; if (!entry) return;
    const ok = await copyText(genFn(entry));
    document.getElementById('sheet-image-action').classList.remove('show');
    if (ok) showToast(`📋 ${label}をコピーしました`);
  }
  document.getElementById('btn-img-reproduce').addEventListener('click', () => copyImageMode(genImageReproduce, '画像を再現する文章'));
  document.getElementById('btn-img-expand').addEventListener('click', () => copyImageMode(genExpand, '発展させる文章'));
  document.getElementById('btn-img-delegate').addEventListener('click', () => copyImageMode(genDelegate, 'AIへ依頼する文章'));

  // ---- STEP1 ----
  document.getElementById('btn-s1-back').addEventListener('click', () => { state.history=['home']; showScreen('home', false); renderHome(); });
  document.getElementById('ai-select-row').addEventListener('click', (e) => {
    const btn = e.target.closest('.ai-btn'); if (!btn) return;
    state.selectedAI = btn.dataset.ai;
    updateAISelectUI();
  });
  document.getElementById('ai-select-row-step2').addEventListener('click', (e) => {
    const btn = e.target.closest('.ai-btn'); if (!btn) return;
    state.selectedAI = btn.dataset.ai;
    updateAISelectUI();
  });
  document.getElementById('btn-copy-aimf').addEventListener('click', async () => {
    const ok = await copyText(AIMF_TEMPLATE);
    if (ok) showToast('📋 AIMFをコピーしました');
  });
  document.getElementById('btn-analyze').addEventListener('click', () => {
    const text = document.getElementById('paste-area').value.trim();
    if (!text) { showToast('⚠️ テキストを貼り付けてください'); return; }
    const hasAIMF = isAIMF(text);
    const parsed = parseAIMF(text);
    document.getElementById('parse-warning').classList.toggle('show', !hasAIMF);

    const parsedAIName = (parsed['AI名'] || '').trim();
    if (parsedAIName && parsedAIName !== 'なし') {
      const lower = parsedAIName.toLowerCase();
      let matched = null;
      if (lower.includes('chatgpt') || lower.includes('gpt')) matched = 'ChatGPT';
      else if (lower.includes('claude')) matched = 'Claude';
      else if (lower.includes('gemini')) matched = 'Gemini';
      state.selectedAI = matched || 'その他';
      showToast(`🤖 AI名を「${state.selectedAI}」に自動設定しました`);
    }
    updateAISelectUI();

    populateEditForm({
      title: parsed['タイトル'] || '',
      aiName: state.selectedAI,
      question: parsed['質問'] || (hasAIMF ? '' : text.slice(0, 200)),
      solution: parsed['解決策'] || '',
      tags: parsed['タグ'] || [],
      rating: parsed['評価'] || 3,
      learning: parsed['学び'] || '',
      shortestQuestion: parsed['次回最短質問'] || '',
      images: [],
    });
    showScreen('step2');
  });

  // ---- STEP2 ----
  document.getElementById('btn-s2-back').addEventListener('click', goBack);
  document.getElementById('edit-stars').addEventListener('click', (e) => {
    const btn = e.target.closest('.star-btn'); if (!btn) return;
    state.currentRating = parseInt(btn.dataset.val);
    renderEditStars();
  });
  function addTagFromInput() {
    const input = document.getElementById('edit-tag-input');
    const val = input.value.trim();
    if (val && !state.currentTags.includes(val)) { state.currentTags.push(val); renderEditTags(); }
    input.value = '';
  }
  document.getElementById('edit-tag-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTagFromInput(); }
  });
  document.getElementById('btn-add-tag').addEventListener('click', addTagFromInput);
  document.getElementById('edit-tag-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.tag-removable'); if (!btn) return;
    state.currentTags.splice(parseInt(btn.dataset.idx), 1);
    renderEditTags();
  });
  document.getElementById('btn-add-image').addEventListener('click', () => document.getElementById('image-file-input').click());
  document.getElementById('image-file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      try {
        const img = await readImageFile(f);
        state.currentImages.push(img);
      } catch (err) {
        console.error('image load skipped:', err);
      }
    }
    renderEditImages();
    e.target.value = '';
  });

  document.getElementById('edit-image-grid').addEventListener('click', (e) => {
    const cap = e.target.closest('[data-remove-id]'); if (!cap) return;
    const removeId = cap.dataset.removeId;
    const idx = state.currentImages.findIndex(img => img.id === removeId);
    if (idx !== -1) state.currentImages.splice(idx, 1);
    renderEditImages();
  });

  document.getElementById('btn-to-step3').addEventListener('click', () => {
    const data = collectFormData();
    if (!data.question && !data.solution) { showToast('⚠️ 質問または解決策を入力してください'); return; }
    state.pendingData = data;
    if (!document.getElementById('edit-title').value.trim()) {
      document.getElementById('edit-title').value = (data.question || '無題').slice(0, 20);
      state.pendingData.title = document.getElementById('edit-title').value;
    }
    renderModeList();
    showScreen('step3');
  });

  // ---- STEP3 ----
  document.getElementById('btn-s3-back').addEventListener('click', goBack);
  document.getElementById('mode-list').addEventListener('click', (e) => {
    const row = e.target.closest('.mode-row'); if (!row) return;
    const key = row.dataset.mode;
    state.currentModes[key] = !state.currentModes[key];
    renderModeList();
  });

  document.getElementById('btn-save').addEventListener('click', async () => {
    const data = state.pendingData || collectFormData();
    const now = new Date().toISOString();
    const modes = {};
    MODE_DEFS.forEach(m => { modes[m.key] = { enabled: !!state.currentModes[m.key] }; });

    if (state.editingId) {
      const idx = state.entries.findIndex(e => e.id === state.editingId);
      if (idx !== -1) state.entries[idx] = { ...state.entries[idx], ...data, modes, updatedAt: now };
    } else {
      const entry = { id: uuid(), schemaVersion: 1, ...data, modes, savedAt: now, updatedAt: now, isFavorite: false };
      state.entries.unshift(entry);
    }

    const ok = await saveEntries();
    if (ok) {
      showToast(state.editingId ? '✅ 更新しました' : '✅ 保存しました');
    } else {
      showToast('⚠️ 容量超過またはエラーにより保存に失敗しました');
    }

    state.editingId = null; state.pendingData = null;
    state.history = ['home'];
    showScreen('home', false);
    renderHome();
  });

  document.getElementById('btn-cancel').addEventListener('click', () => {
    state.editingId = null; state.pendingData = null;
    state.history = ['home']; showScreen('home', false); renderHome();
  });

  // ---- DETAIL ----
  document.getElementById('btn-detail-back').addEventListener('click', goBack);

  document.getElementById('btn-detail-fav').addEventListener('click', async () => {
    const entry = state.entries.find(e => e.id === state.detailId); if (!entry) return;
    entry.isFavorite = !entry.isFavorite;
    const ok = await saveEntries();
    if (ok) {
      document.getElementById('btn-detail-fav').textContent = entry.isFavorite ? '⭐' : '☆';
      showToast(entry.isFavorite ? '⭐ お気に入りに追加しました' : '☆ お気に入りを解除しました');
    } else {
      entry.isFavorite = !entry.isFavorite;
      showToast('⚠️ 容量超過またはエラーにより保存に失敗しました');
    }
  });

  document.getElementById('btn-detail-edit').addEventListener('click', () => {
    const entry = state.entries.find(e => e.id === state.detailId); if (!entry) return;
    state.editingId = state.detailId;
    state.selectedAI = entry.aiName || 'ChatGPT';
    updateAISelectUI();
    state.currentModes = {}; MODE_DEFS.forEach(m => state.currentModes[m.key] = !!(entry.modes && entry.modes[m.key] && entry.modes[m.key].enabled));
    populateEditForm(entry);
    showScreen('step2');
  });
  document.getElementById('detail-content').addEventListener('click', (e) => {
    if (e.target.id === 'btn-delete-entry') {
      state.deleteId = state.detailId;
      document.getElementById('modal-delete').classList.add('show');
    }
  });

  document.getElementById('btn-delete-cancel').addEventListener('click', () => {
    document.getElementById('modal-delete').classList.remove('show'); state.deleteId = null;
  });

  document.getElementById('btn-delete-confirm').addEventListener('click', async () => {
    if (!state.deleteId) return;
    state.entries = state.entries.filter(e => e.id !== state.deleteId);
    const ok = await saveEntries();
    state.deleteId = null;
    document.getElementById('modal-delete').classList.remove('show');
    if (ok) {
      showToast('🗑️ 削除しました');
    } else {
      showToast('⚠️ 容量超過またはエラーにより保存に失敗しました');
    }
    state.history = ['home']; showScreen('home', false); renderHome();
  });

  // ---- SETTINGS ----
  document.getElementById('btn-settings-back').addEventListener('click', goBack);
  document.getElementById('theme-toggle-row').addEventListener('click', () => {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    saveSettings(); applyTheme();
    showToast(state.settings.theme === 'dark' ? '🌙 ダークモードに切り替えました' : '☀️ ライトモードに切り替えました');
  });
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-import-row').addEventListener('click', () => document.getElementById('import-file-input').click());
  document.getElementById('import-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (file) importData(file);
    e.target.value = '';
  });
  document.getElementById('btn-clear-all').addEventListener('click', () => document.getElementById('modal-clear').classList.add('show'));
  document.getElementById('btn-clear-cancel').addEventListener('click', () => document.getElementById('modal-clear').classList.remove('show'));

  document.getElementById('btn-clear-confirm').addEventListener('click', async () => {
    state.entries = [];
    const ok = await saveEntries();
    document.getElementById('modal-clear').classList.remove('show');
    if (ok) {
      showToast('🗑️ すべてのデータを消去しました');
    } else {
      showToast('⚠️ 容量超過またはエラーにより保存に失敗しました');
    }
    state.history = ['home']; showScreen('home', false); renderHome();
  });

  document.getElementById('modal-delete').addEventListener('click', (e) => { if (e.target.id === 'modal-delete') { e.currentTarget.classList.remove('show'); state.deleteId = null; } });
  document.getElementById('modal-clear').addEventListener('click', (e) => { if (e.target.id === 'modal-clear') e.currentTarget.classList.remove('show'); });
}

document.addEventListener('DOMContentLoaded', init);
