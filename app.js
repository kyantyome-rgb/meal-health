'use strict';

/* ========== ユーティリティ ========== */
const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function getUrl() { return (localStorage.getItem('gasUrl') || '').trim(); }

// GAS へ POST（CORSプリフライト回避のため text/plain）
async function api(payload) {
  const url = getUrl();
  if (!url) throw new Error('設定タブで GAS の URL を入力してください');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || '不明なエラー');
  return json;
}

/* ========== UI ヘルパー（トースト/スピナー/空状態/エラー） ========== */
function toast(html, type, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.innerHTML = html;
  let timer;
  const dismiss = () => { if (el._done) return; el._done = true; clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  if (opts.action) {
    const b = document.createElement('button'); b.className = 'tbtn'; b.textContent = opts.actionLabel || 'OK';
    b.addEventListener('click', () => { opts.action(); dismiss(); });
    el.appendChild(b);
  }
  $('toastwrap').appendChild(el);
  if (!opts.sticky) timer = setTimeout(dismiss, opts.duration || 3200);
  return dismiss;
}
const spinnerHtml = (text) => `<div class="loadrow"><span class="spinner"></span>${text || '読み込み中…'}</div>`;
function emptyStateHtml(emoji, ttl, desc, btnLabel, btnScreen) {
  return `<div class="emptystate"><div class="emoji">${emoji}</div><div class="ttl">${ttl}</div>` +
    `<div class="desc">${desc}</div>` +
    (btnLabel ? `<button class="primary" onclick="showScreen('${btnScreen}')">${btnLabel}</button>` : '') + `</div>`;
}
function renderError(el, msg, retryFn) {
  el.innerHTML = `<div class="errbox"><div class="emoji">😢</div><div class="desc">${escapeHtml(msg)}</div><button class="sub" data-retry="1">再試行</button></div>`;
  const b = el.querySelector('[data-retry]'); if (b) b.addEventListener('click', retryFn);
}

/* ========== タブ切り替え ========== */
const tabbar = $('tabbar');
tabbar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-screen]');
  if (!btn) return;
  showScreen(btn.dataset.screen);
});
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  tabbar.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
  if (name === 'home')    loadHome();
  if (name === 'graph')   loadAndRenderGraph();
  if (name === 'history') loadAndRenderHistory();
}

/* ========== 記録（撮影） ========== */
const video = $('video'), shot = $('shot'), fileInput = $('file');
const openBtn = $('open'), snapBtn = $('snap'), retakeBtn = $('retake');
const sendBtn = $('send'), msg = $('msg'), result = $('result');
const saveArea = $('saveArea'), mealType = $('mealType'), note = $('note'), saveBtn = $('save'), saveMsg = $('saveMsg');

let stream = null, dataUrl = null, captureTime = null, items = [], edited = false;

openBtn.addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    video.srcObject = stream; await video.play();
    video.style.display = 'block'; shot.style.display = 'none';
    snapBtn.disabled = false; retakeBtn.classList.add('hidden');
    msg.textContent = '料理を画面に入れて「撮影」を押してください。';
  } catch (err) {
    msg.textContent = '⚠️ カメラを起動できません: ' + err + '（HTTPS/localhost が必要。アルバム選択も使えます）';
  }
});
snapBtn.addEventListener('click', () => {
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  setPhoto(c.toDataURL('image/jpeg', 0.85));
  stopCam();
  snapBtn.disabled = true; retakeBtn.classList.remove('hidden');
});
retakeBtn.addEventListener('click', () => { openBtn.click(); sendBtn.disabled = true; result.innerHTML = ''; saveArea.classList.add('hidden'); });

// アルバムから選択（フォールバック）
fileInput.addEventListener('change', () => {
  const f = fileInput.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => { setPhoto(reader.result); stopCam(); video.style.display = 'none'; };
  reader.readAsDataURL(f);
});

function setPhoto(url) {
  dataUrl = url; captureTime = new Date().toISOString();
  shot.src = url; shot.style.display = 'block';
  sendBtn.disabled = false;
  msg.textContent = '撮影しました。「カロリーを推定する」を押してください。';
}
function stopCam() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.style.display = 'none';
  video.srcObject = null;
}
window.addEventListener('pagehide', stopCam);

sendBtn.addEventListener('click', async () => {
  if (!dataUrl) { alert('先に撮影/選択してください'); return; }
  sendBtn.disabled = true; msg.textContent = '推定中… ⏳';
  result.innerHTML = ''; saveArea.classList.add('hidden'); saveMsg.textContent = '';
  try {
    const json = await api({ action: 'estimate', imageData: dataUrl, mimeType: 'image/jpeg', clientTime: captureTime });
    const r = json.result;
    items = (r.items || []).map(it => ({ ...it, portion: 1 }));
    edited = false;
    msg.textContent = '確信度: ' + (r.confidence || '-') + '（料理名・取り分を確認して記録）';
    renderItems();
    mealType.value = r.meal_type || '間食'; note.value = '';
    saveBtn.disabled = false;
    saveArea.classList.toggle('hidden', !items.length);
  } catch (err) {
    msg.textContent = '⚠️ ' + err.message;
  } finally {
    sendBtn.disabled = false;
  }
});

mealType.addEventListener('change', () => { edited = true; });

saveBtn.addEventListener('click', async () => {
  if (!dataUrl || !items.length) return;
  saveBtn.disabled = true; saveMsg.textContent = '記録中… ⏳';
  const t = totals();
  try {
    const json = await api({
      action: 'save', imageData: dataUrl, mimeType: 'image/jpeg', clientTime: captureTime,
      meal_type: mealType.value, food_name: items.map(it => it.name).join('・'),
      calories: t.kcal, protein_g: t.p, fat_g: t.f, carbs_g: t.c, note: note.value, edited
    });
    recordsCache = null; // 次回グラフ/履歴で再取得
    toast('✅ ' + json.date + ' に記録しました（' + Math.round(t.kcal) + ' kcal）　' +
      '<a href="' + json.photo_url + '" target="_blank" rel="noopener">写真</a>', 'success', { duration: 5000 });
    resetCapture();
  } catch (err) {
    saveMsg.textContent = '';
    toast('⚠️ 記録に失敗しました: ' + escapeHtml(err.message), 'error');
    saveBtn.disabled = false;
  }
});

function resetCapture() {
  items = []; dataUrl = null; captureTime = null;
  result.innerHTML = ''; saveArea.classList.add('hidden');
  shot.style.display = 'none'; shot.removeAttribute('src');
  video.style.display = 'none'; video.srcObject = null;
  retakeBtn.classList.add('hidden'); snapBtn.disabled = true;
  sendBtn.disabled = true; saveMsg.textContent = '';
  msg.textContent = '記録しました 🎉 次の食事も撮影できます';
}

/* 料理ごとの内訳＋取り分 */
const PORTIONS = [
  { v: 1, label: '全部' }, { v: 0.5, label: '半分' },
  { v: 1/3, label: '1/3' }, { v: 0.25, label: '1/4' }, { v: 'share', label: '人数で割る' }
];
function renderItems() {
  if (!items.length) { result.innerHTML = '<div class="msg">料理を検出できませんでした。</div>'; return; }
  const rows = items.map((it, i) => {
    const opts = PORTIONS.map(p =>
      `<option value="${p.v}" ${String(p.v) === String(it.portionSel) ? 'selected' : ''}>${p.label}</option>`).join('');
    const eaten = Math.round(it.calories * it.portion);
    const ppl = it.portionSel === 'share'
      ? `<input class="ppl" type="number" min="2" value="${it.people || 2}" data-i="${i}" /> 人` : '';
    return `<div class="item">
      <div class="top">
        <input class="nameinp" data-name="${i}" value="${escapeHtml(it.name)}" />
        <span class="kc">${eaten} kcal</span>
        <button class="x" data-del="${i}">削除</button>
      </div>
      <div class="ctl">取り分: <select data-sel="${i}">${opts}</select> ${ppl}</div>
    </div>`;
  }).join('');
  result.innerHTML = totalHtml() + rows;

  result.querySelectorAll('select[data-sel]').forEach(sel => sel.addEventListener('change', () => {
    const i = +sel.dataset.sel, val = sel.value;
    items[i].portionSel = val;
    if (val === 'share') { items[i].people = items[i].people || 2; items[i].portion = 1 / items[i].people; }
    else items[i].portion = parseFloat(val);
    edited = true; renderItems();
  }));
  result.querySelectorAll('input.nameinp').forEach(inp => inp.addEventListener('input', () => {
    items[+inp.dataset.name].name = inp.value; edited = true;
  }));
  result.querySelectorAll('input.ppl').forEach(inp => inp.addEventListener('input', () => {
    const i = +inp.dataset.i, n = Math.max(2, parseInt(inp.value || '2', 10));
    items[i].people = n; items[i].portion = 1 / n;
    const el = $('total'); if (el) el.outerHTML = totalHtml();
    inp.closest('.item').querySelector('.kc').textContent = Math.round(items[i].calories * items[i].portion) + ' kcal';
  }));
  result.querySelectorAll('button[data-del]').forEach(b => b.addEventListener('click', () => {
    items.splice(+b.dataset.del, 1); edited = true; renderItems();
    if (!items.length) saveArea.classList.add('hidden');
  }));
}
function totals() {
  return items.reduce((a, it) => ({
    kcal: a.kcal + it.calories * it.portion, p: a.p + it.protein_g * it.portion,
    f: a.f + it.fat_g * it.portion, c: a.c + it.carbs_g * it.portion
  }), { kcal: 0, p: 0, f: 0, c: 0 });
}
function totalHtml() {
  const t = totals();
  return `<div class="total" id="total">
    <div class="kcal">${Math.round(t.kcal)} kcal</div>
    <div class="pfc">P ${t.p.toFixed(0)}g ・ F ${t.f.toFixed(0)}g ・ C ${t.c.toFixed(0)}g（自分の取り分）</div>
  </div>`;
}

/* ========== プロフィール / 設定 ========== */
const gasUrlInput = $('gasUrl');
gasUrlInput.value = getUrl();
gasUrlInput.addEventListener('change', () => { localStorage.setItem('gasUrl', gasUrlInput.value.trim()); });

let targetKcal = Number(localStorage.getItem('targetKcal')) || 0;

$('saveProfile').addEventListener('click', async () => {
  localStorage.setItem('gasUrl', gasUrlInput.value.trim());
  const profile = {
    age: $('p-age').value, sex: $('p-sex').value, height_cm: $('p-height').value,
    weight_kg: $('p-weight').value, activity_level: $('p-activity').value, goal_type: $('p-goal').value
  };
  $('profileMsg').textContent = '保存中… ⏳';
  try {
    const json = await api({ action: 'saveProfile', profile });
    targetKcal = json.target_kcal || 0;
    localStorage.setItem('targetKcal', targetKcal);
    $('targetKcal').textContent = targetKcal;
    $('targetCard').classList.remove('hidden');
    $('profileMsg').textContent = '';
    toast('✅ プロフィールを保存しました（目標 ' + targetKcal + ' kcal）', 'success');
  } catch (err) {
    $('profileMsg').textContent = '';
    toast('⚠️ 保存に失敗しました: ' + escapeHtml(err.message), 'error');
  }
});

async function loadProfile() {
  if (!getUrl()) return;
  try {
    const json = await api({ action: 'getProfile' });
    const p = json.profile;
    if (!p) return;
    $('p-age').value = p.age || ''; $('p-sex').value = p.sex || 'male';
    $('p-height').value = p.height_cm || ''; $('p-weight').value = p.weight_kg || '';
    $('p-activity').value = p.activity_level || 'moderate'; $('p-goal').value = p.goal_type || 'maintain';
    if (p.target_kcal) {
      targetKcal = Number(p.target_kcal); localStorage.setItem('targetKcal', targetKcal);
      $('targetKcal').textContent = targetKcal; $('targetCard').classList.remove('hidden');
    }
  } catch (_) { /* 未設定でも無視 */ }
}

/* ========== 記録一覧の取得（グラフ/履歴共用） ========== */
let recordsCache = null;
async function getRecords() {
  if (recordsCache) return recordsCache;
  const json = await api({ action: 'listRecords', limit: 300 });
  recordsCache = json.records || [];
  return recordsCache;
}

/* ========== ホーム（今日の摂取 + AI傾向分析） ========== */
function todayStr() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
let analysisLoadedDate = null; // 同日に何度も自動取得しない

async function loadHome(force) {
  // 今日の摂取サマリ
  const d = new Date();
  $('homeDate').textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日の摂取';
  try {
    const records = await getRecords();
    const today = Math.round(records.filter(r => r.date === todayStr())
      .reduce((s, r) => s + Number(r.calories || 0), 0));
    $('homeKcal').textContent = today;
    if (targetKcal) {
      const pct = Math.min(100, Math.round(today / targetKcal * 100));
      $('homeVsTarget').textContent = '目標 ' + targetKcal + ' kcal の ' + Math.round(today / targetKcal * 100) + '%';
      const bar = $('homeBar'); bar.style.width = pct + '%';
      bar.classList.toggle('over', today > targetKcal);
    } else {
      $('homeVsTarget').textContent = '設定タブでプロフィールを保存すると目標が出ます';
    }
  } catch (_) { /* URL未設定など */ }

  // AI分析（1日1回 / 手動更新で再取得）
  if (!force && analysisLoadedDate === todayStr()) return;
  await loadAnalysis(force);
}

async function loadAnalysis(force) {
  if (!getUrl()) {
    $('trendText').textContent = '設定タブで GAS の URL を入力すると、AIによる傾向分析が表示されます。';
    $('recommendText').textContent = '';
    return;
  }
  const btn = $('refreshAnalysis');
  btn.disabled = true;
  $('analysisMsg').textContent = '';
  $('trendText').innerHTML = spinnerHtml('分析中…');
  $('recommendText').textContent = '';
  try {
    const json = await api({ action: 'getAnalysis', force: !!force });
    const a = json.analysis;
    $('trendText').textContent = a.trend_text || '';
    $('recommendText').textContent = a.recommend_text || '';
    analysisLoadedDate = todayStr();
    $('analysisMsg').textContent = a.cached ? '（本日の分析・キャッシュ）'
      : a.empty ? '' : '（最新の分析を生成しました）';
    if (force && !a.empty) toast('🔄 分析を更新しました', 'success');
  } catch (err) {
    renderError($('trendText'), err.message, () => loadAnalysis(force));
  } finally {
    btn.disabled = false;
  }
}
$('refreshAnalysis').addEventListener('click', () => loadAnalysis(true));

let graphPeriod = 'day';
const pad2 = (n) => String(n).padStart(2, '0');
const dateKey = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
function weekStart(date) {
  const x = new Date(date); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // 月曜始まり
  return x;
}

const periodTabs = $('periodTabs');
periodTabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-period]'); if (!b) return;
  graphPeriod = b.dataset.period;
  periodTabs.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
  loadAndRenderGraph();
});

async function loadAndRenderGraph() {
  $('graphMsg').innerHTML = spinnerHtml();
  try {
    const records = await getRecords();

    // 今日カード
    const today = Math.round(records.filter(r => r.date === todayStr())
      .reduce((s, r) => s + Number(r.calories || 0), 0));
    $('todayKcal').textContent = today;
    if (targetKcal) {
      const pct = Math.min(100, Math.round(today / targetKcal * 100));
      $('todayVsTarget').textContent = '目標 ' + targetKcal + ' kcal の ' + Math.round(today / targetKcal * 100) + '%';
      const bar = $('todayBar'); bar.style.width = pct + '%'; bar.classList.toggle('over', today > targetKcal);
    } else {
      $('todayVsTarget').textContent = '設定タブでプロフィールを保存すると目標が表示されます';
    }

    const { bars, rangeStartKey, lineTarget, title } = buildBuckets(records, graphPeriod);
    $('chartTitle').textContent = title;
    drawChart(bars, lineTarget);

    const inRange = records.filter(r => r.date >= rangeStartKey);
    renderStats(inRange);
    renderPFC(inRange);
    renderMealType(inRange);

    $('graphMsg').innerHTML = records.length ? ''
      : '<div class="emptystate"><div class="emoji">📊</div><div class="ttl">まだデータがありません</div><div class="desc">食事を記録するとグラフが表示されます。</div><button class="primary" onclick="showScreen(\'capture\')">📷 記録する</button></div>';
  } catch (err) {
    renderError($('graphMsg'), err.message, loadAndRenderGraph);
  }
}

function buildBuckets(records, period) {
  const byDate = {};
  records.forEach(r => { byDate[r.date] = (byDate[r.date] || 0) + Number(r.calories || 0); });
  const sumRange = (sKey, eKey) => Object.keys(byDate)
    .reduce((s, k) => (k >= sKey && k < eKey) ? s + byDate[k] : s, 0);

  if (period === 'week') {
    const ws0 = weekStart(new Date()); const bars = [];
    for (let w = 7; w >= 0; w--) {
      const s = new Date(ws0); s.setDate(s.getDate() - 7 * w);
      const e = new Date(s); e.setDate(e.getDate() + 7);
      bars.push({ label: (s.getMonth() + 1) + '/' + s.getDate(), kcal: Math.round(sumRange(dateKey(s), dateKey(e))) });
    }
    const rs = new Date(ws0); rs.setDate(rs.getDate() - 7 * 7);
    return { bars, rangeStartKey: dateKey(rs), lineTarget: targetKcal ? targetKcal * 7 : 0, title: '週別 摂取カロリー（8週間）' };
  }
  if (period === 'month') {
    const now = new Date(); const bars = [];
    for (let m = 5; m >= 0; m--) {
      const s = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const e = new Date(now.getFullYear(), now.getMonth() - m + 1, 1);
      bars.push({ label: (s.getMonth() + 1) + '月', kcal: Math.round(sumRange(dateKey(s), dateKey(e))) });
    }
    const rs = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    return { bars, rangeStartKey: dateKey(rs), lineTarget: targetKcal ? targetKcal * 30 : 0, title: '月別 摂取カロリー（6ヶ月）' };
  }
  // day: 直近14日
  const bars = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    bars.push({ label: (d.getMonth() + 1) + '/' + d.getDate(), kcal: Math.round(byDate[dateKey(d)] || 0) });
  }
  const rs = new Date(); rs.setHours(0, 0, 0, 0); rs.setDate(rs.getDate() - 13);
  return { bars, rangeStartKey: dateKey(rs), lineTarget: targetKcal, title: '日別 摂取カロリー（2週間）' };
}

function renderStats(records) {
  const byDate = {};
  records.forEach(r => { byDate[r.date] = (byDate[r.date] || 0) + Number(r.calories || 0); });
  const dayCount = Object.keys(byDate).length;
  const totalKcal = Math.round(records.reduce((s, r) => s + Number(r.calories || 0), 0));
  const avg = dayCount ? Math.round(totalKcal / dayCount) : 0;
  const cells = [
    { v: dayCount + '日', k: '記録日数' },
    { v: avg.toLocaleString(), k: '平均kcal/日' },
    targetKcal
      ? { v: Object.values(byDate).filter(v => v <= targetKcal).length + '/' + dayCount, k: '目標以内の日' }
      : { v: totalKcal.toLocaleString(), k: '合計kcal' }
  ];
  $('statsRow').innerHTML = cells.map(c => `<div class="cell"><div class="v">${c.v}</div><div class="k">${c.k}</div></div>`).join('');
}

function renderPFC(records) {
  const sum = records.reduce((a, r) => ({
    p: a.p + Number(r.protein_g || 0), f: a.f + Number(r.fat_g || 0), c: a.c + Number(r.carbs_g || 0)
  }), { p: 0, f: 0, c: 0 });
  const segs = [
    { label: 'P タンパク質', grams: sum.p, cal: sum.p * 4, color: '#42a5f5' },
    { label: 'F 脂質',       grams: sum.f, cal: sum.f * 9, color: '#ffb74d' },
    { label: 'C 炭水化物',   grams: sum.c, cal: sum.c * 4, color: '#66bb6a' }
  ];
  const tot = segs.reduce((s, x) => s + x.cal, 0);
  drawDoughnut($('pfcChart'), segs.map(s => ({ value: s.cal, color: s.color })));
  $('pfcLegend').innerHTML = segs.map(s => {
    const pct = tot ? Math.round(s.cal / tot * 100) : 0;
    return `<span class="lg"><span class="dot" style="background:${s.color}"></span>${s.label} ${Math.round(s.grams)}g (${pct}%)</span>`;
  }).join('');
}

const MEAL_COLORS = { '朝': '#ffca28', '昼': '#29b6f6', '間食': '#ab47bc', '晩': '#5c6bc0' };
function renderMealType(records) {
  const mt = {};
  records.forEach(r => {
    const m = r.meal_type || '不明';
    mt[m] = (mt[m] || 0) + Number(r.calories || 0);
  });
  const order = ['朝', '昼', '間食', '晩'].filter(m => mt[m]);
  const tot = order.reduce((s, m) => s + mt[m], 0);
  drawDoughnut($('mealChart'), order.map(m => ({ value: mt[m], color: MEAL_COLORS[m] })));
  $('mealLegend').innerHTML = order.map(m => {
    const pct = tot ? Math.round(mt[m] / tot * 100) : 0;
    return `<span class="lg"><span class="dot" style="background:${MEAL_COLORS[m]}"></span>${m} ${Math.round(mt[m]).toLocaleString()}kcal (${pct}%)</span>`;
  }).join('') || '<span class="lg">データなし</span>';
}

function drawDoughnut(cv, segs) {
  const ctx = cv.getContext('2d'); const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 16, r = R * 0.58;
  const total = segs.reduce((s, x) => s + x.value, 0);
  if (!total) {
    ctx.fillStyle = '#bbb'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('データなし', cx, cy); return;
  }
  let a = -Math.PI / 2;
  segs.forEach(s => {
    const ang = s.value / total * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a, a + ang); ctx.closePath();
    ctx.fillStyle = s.color; ctx.fill(); a += ang;
  });
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
}

function roundRectTop(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, h));
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

function drawChart(days, target) {
  const cv = $('chart'), ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, padL = 48, padB = 28, padT = 16, padR = 12;
  ctx.clearRect(0, 0, W, H);
  const maxData = Math.max(target || 0, ...days.map(d => d.kcal), 100);
  const yMax = Math.ceil(maxData * 1.15 / 100) * 100;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const x0 = padL, y0 = H - padB;

  ctx.strokeStyle = '#eee'; ctx.fillStyle = '#999'; ctx.font = '12px sans-serif'; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = Math.round(yMax / 4 * i);
    const y = y0 - plotH * (i / 4);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillText(val.toLocaleString(), x0 - 6, y + 4);
  }
  const n = days.length, bw = plotW / n * 0.62, gap = plotW / n;
  ctx.textAlign = 'center';
  days.forEach((d, i) => {
    const x = x0 + gap * i + (gap - bw) / 2;
    const h = plotH * (d.kcal / yMax);
    let fill = '#34c97b';
    if (h > 0) {
      const g = ctx.createLinearGradient(0, y0 - h, 0, y0);
      g.addColorStop(0, (target && d.kcal > target) ? '#ff9472' : '#34c97b');
      g.addColorStop(1, (target && d.kcal > target) ? '#ef5350' : '#1f9d63');
      fill = g;
    }
    ctx.fillStyle = fill;
    roundRectTop(ctx, x, y0 - h, bw, h, Math.min(bw / 2, 6));
    ctx.fill();
    if (n <= 8 || i % 2 === 0) { ctx.fillStyle = '#999'; ctx.fillText(d.label, x + bw / 2, H - 8); }
  });
  if (target) {
    const y = y0 - plotH * (target / yMax);
    ctx.strokeStyle = '#fb8c00'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 1;
    ctx.fillStyle = '#fb8c00'; ctx.textAlign = 'left';
    ctx.fillText('目標 ' + target.toLocaleString(), x0 + 4, y - 5);
  }
}

/* ========== 履歴（編集・削除） ========== */
const findRec = (pid) => (recordsCache || []).find(x => x.photo_id === pid);

async function loadAndRenderHistory() {
  $('historyMsg').textContent = '';
  $('historyList').innerHTML = spinnerHtml();
  try {
    const records = await getRecords();
    $('historyList').innerHTML = records.length
      ? records.map(historyRowHtml).join('')
      : emptyStateHtml('🍽️', 'まだ記録がありません', '最初の食事を記録してみましょう！', '📷 記録する', 'capture');
  } catch (err) {
    renderError($('historyList'), err.message, loadAndRenderHistory);
  }
}

function historyRowHtml(r) {
  const dt = new Date(r.timestamp);
  const when = (dt.getMonth() + 1) + '/' + dt.getDate() + ' ' + pad2(dt.getHours()) + ':' + pad2(dt.getMinutes());
  const pid = escapeHtml(r.photo_id || '');
  const link = r.photo_url ? `<a class="thumb" href="${r.photo_url}" target="_blank" rel="noopener">写真</a>` : '';
  return `<div class="hrec" data-pid="${pid}">
    <div class="meta">
      <div class="date">${when}</div>
      <div class="food"><span class="badge">${escapeHtml(r.meal_type || '')}</span>${escapeHtml(r.food_name || '')}</div>
      <div class="sub2">${Math.round(Number(r.calories || 0))} kcal ・ P${Math.round(Number(r.protein_g || 0))} F${Math.round(Number(r.fat_g || 0))} C${Math.round(Number(r.carbs_g || 0))}</div>
    </div>
    <div class="acts">${link}
      <button class="act" data-act="edit">編集</button>
      <button class="act del" data-act="delete">削除</button>
    </div>
  </div>`;
}

function mealOptions(sel) {
  return ['朝', '昼', '間食', '晩'].map(m => `<option ${m === sel ? 'selected' : ''}>${m}</option>`).join('');
}
function editFormHtml(r) {
  const v = (x) => escapeHtml(x == null ? '' : x);
  return `<div class="hrec editing" data-pid="${escapeHtml(r.photo_id)}">
    <div class="hedit">
      <div class="erow"><label>区分</label><select data-f="meal_type">${mealOptions(r.meal_type)}</select></div>
      <label class="elab">料理名<input data-f="food_name" value="${v(r.food_name)}" /></label>
      <div class="grid4">
        <label>kcal<input type="number" data-f="calories" value="${v(Math.round(Number(r.calories || 0)))}" /></label>
        <label>P(g)<input type="number" data-f="protein_g" value="${v(Math.round(Number(r.protein_g || 0)))}" /></label>
        <label>F(g)<input type="number" data-f="fat_g" value="${v(Math.round(Number(r.fat_g || 0)))}" /></label>
        <label>C(g)<input type="number" data-f="carbs_g" value="${v(Math.round(Number(r.carbs_g || 0)))}" /></label>
      </div>
      <label class="elab">メモ<input data-f="note" value="${v(r.note)}" /></label>
      <div class="editbtns">
        <button class="act" data-act="cancel">キャンセル</button>
        <button class="act save" data-act="save">保存</button>
      </div>
    </div>
  </div>`;
}

$('historyList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]'); if (!btn) return;
  const row = e.target.closest('.hrec'); const pid = row.dataset.pid;
  const rec = findRec(pid); if (!rec) return;
  const act = btn.dataset.act;

  if (act === 'edit')   { row.outerHTML = editFormHtml(rec); return; }
  if (act === 'cancel') { row.outerHTML = historyRowHtml(rec); return; }

  if (act === 'delete') {
    if (!confirm('この記録を削除しますか？（写真も削除されます）')) return;
    btn.disabled = true;
    try {
      await api({ action: 'deleteRecord', photo_id: pid });
      recordsCache = recordsCache.filter(x => x.photo_id !== pid);
      row.remove();
      toast('🗑️ 記録を削除しました');
      if (!recordsCache.length) $('historyList').innerHTML = emptyStateHtml('🍽️', 'まだ記録がありません', '最初の食事を記録してみましょう！', '📷 記録する', 'capture');
    } catch (err) { toast('⚠️ 削除に失敗しました: ' + escapeHtml(err.message), 'error'); btn.disabled = false; }
    return;
  }

  if (act === 'save') {
    const get = (f) => row.querySelector(`[data-f="${f}"]`).value;
    const upd = {
      meal_type: get('meal_type'), food_name: get('food_name'), note: get('note'),
      calories: Number(get('calories')), protein_g: Number(get('protein_g')),
      fat_g: Number(get('fat_g')), carbs_g: Number(get('carbs_g'))
    };
    btn.disabled = true;
    try {
      await api({ action: 'updateRecord', photo_id: pid, ...upd });
      Object.assign(rec, upd, { edited: 'yes' });
      row.outerHTML = historyRowHtml(rec);
      toast('✅ 記録を更新しました', 'success');
    } catch (err) { toast('⚠️ 保存に失敗しました: ' + escapeHtml(err.message), 'error'); btn.disabled = false; }
    return;
  }
});

/* ========== 起動 ========== */
(async () => {
  await loadProfile();   // targetKcal を取得してからホームを描画
  loadHome();
})();
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return; reloading = true; location.reload();
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const notify = (worker) => {
        // 既存のコントローラがある＝更新。利用者に通知してから適用。
        if (navigator.serviceWorker.controller) {
          toast('✨ 新しいバージョンがあります', null,
            { sticky: true, actionLabel: '更新', action: () => worker.postMessage({ type: 'SKIP_WAITING' }) });
        }
      };
      if (reg.waiting) notify(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'installed') notify(nw); });
      });
    } catch (_) { /* SW未対応でも動く */ }
  });
}
