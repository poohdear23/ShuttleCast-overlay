(() => {
  const $ = (selector) => document.querySelector(selector);
  const PRESETS = { 15: { target: 15, cap: 21 }, 21: { target: 21, cap: 30 } };
  const STORE = 'shuttlecast.overlay.setup';

  const defaults = () => ({
    title: '', sideA: 'ทีมฟ้า', sideB: 'ทีมแดง', colorA: '#d3a94f', colorB: '#ead7aa',
    matchGames: 3, target: 21, cap: 30, winByTwo: true,
    scoreA: 0, scoreB: 0, winsA: 0, winsB: 0, game: 1, results: []
  });
  let m = defaults();
  let room = 'court1';
  let history = [];
  let dirty = false;
  let sending = false;
  const view = { pos: 'tr', sponsor: 'br' };

  const toast = (message) => {
    const el = $('#toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
  };
  const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };
  const esc = (value) => String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const clampInt = (value, min, max, fallback) => { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; };

  // ---------- เชื่อมต่อเซิร์ฟเวอร์ ----------
  function setSync(kind, label) {
    $('#connectionDot').className = `connection-dot ${kind}`;
    setText('#connectionLabel', label);
    const chip = $('#syncChip');
    if (chip) { chip.classList.toggle('live', kind === 'live'); chip.lastChild.textContent = ` ${kind === 'live' ? 'SYNCED' : kind === 'ready' ? 'WAITING' : 'OFFLINE'}`; }
  }
  const apiUrl = (suffix) => `/api/room/${encodeURIComponent(room)}/${suffix}`;

  async function flush() {
    if (sending || !dirty) return;
    sending = true; dirty = false;
    try {
      const response = await fetch(apiUrl('state'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: m }) });
      if (!response.ok) throw new Error('send_failed');
      setSync('live', 'ส่งคะแนนแล้ว');
    } catch {
      dirty = true; setSync('', 'ส่งไม่สำเร็จ — ลองใหม่อัตโนมัติ');
    } finally { sending = false; }
  }
  const push = () => { dirty = true; flush(); };
  setInterval(() => { if (dirty) flush(); }, 3000);

  // ---------- กติกาและคะแนน ----------
  function normalizeRules() {
    m.target = clampInt(m.target, 1, 30, 21);
    m.cap = clampInt(m.cap, m.target, 99, Math.max(m.target, 30));
    m.matchGames = m.matchGames === 1 ? 1 : 3;
  }
  function snapshot() {
    history.push({ scoreA: m.scoreA, scoreB: m.scoreB, winsA: m.winsA, winsB: m.winsB, game: m.game, results: m.results.map((r) => ({ ...r })) });
    if (history.length > 30) history.shift();
  }
  function change(fn) { snapshot(); fn(); render(); push(); }
  // แมตช์จบเมื่อมีฝั่งชนะครบเกม หรือเล่นครบจำนวนเกมที่ตั้งไว้
  const gamesToWin = () => Math.ceil(m.matchGames / 2);
  const matchOver = () => m.winsA >= gamesToWin() || m.winsB >= gamesToWin() || m.results.length >= m.matchGames;
  const overToast = () => toast('แมตช์จบแล้ว — กด "ย้อนแต้ม" เพื่อแก้ หรือ "รีเซ็ตแมตช์" เพื่อเริ่มใหม่');
  const addPoint = (side) => { if (matchOver()) return overToast(); change(() => { m[`score${side}`] = Math.min(m.cap, m[`score${side}`] + 1); }); };
  const subPoint = (side) => { if (matchOver()) return overToast(); change(() => { m[`score${side}`] = Math.max(0, m[`score${side}`] - 1); }); };
  function undo() {
    const last = history.pop();
    if (!last) return toast('ยังไม่มีแต้มให้ย้อนกลับ');
    Object.assign(m, last); render(); push(); toast('ย้อนแต้มล่าสุดแล้ว');
  }
  function resetGame() {
    if (matchOver()) return overToast();
    change(() => { m.scoreA = 0; m.scoreB = 0; });
    toast('รีเซ็ตคะแนนเกมนี้แล้ว');
  }
  // รีเซ็ตทั้งแมตช์: คะแนน จำนวนเกมที่ชนะ และผลเกมที่ผ่านมา (ย้อนกลับด้วยปุ่ม "ย้อนแต้ม" ได้)
  function resetMatch() {
    if (!confirm('รีเซ็ตทั้งแมตช์?\nคะแนน จำนวนเกมที่ชนะ และผลเกมที่ผ่านมาจะถูกล้างทั้งหมด')) return;
    change(() => { m.scoreA = 0; m.scoreB = 0; m.winsA = 0; m.winsB = 0; m.game = 1; m.results = []; });
    toast('รีเซ็ตทั้งแมตช์แล้ว — กด "ย้อนแต้ม" ถ้ากดผิด');
  }
  function nextGame() {
    if (matchOver()) return overToast();
    const reached = m.scoreA >= m.target || m.scoreB >= m.target;
    const atCap = m.scoreA >= m.cap || m.scoreB >= m.cap;
    const complete = (reached && (!m.winByTwo || Math.abs(m.scoreA - m.scoreB) >= 2)) || atCap;
    if (!complete) return toast(`เกมยังไม่จบ: ต้องถึง ${m.target} แต้ม${m.winByTwo ? 'และนำ 2 แต้ม' : ''}`);
    const winner = m.scoreA > m.scoreB ? 'A' : m.scoreB > m.scoreA ? 'B' : null;
    if (!winner) return toast('คะแนนเท่ากัน ยังบันทึกผู้ชนะไม่ได้');
    const finished = m.game;
    snapshot();
    m.results.push({ game: m.game, scoreA: m.scoreA, scoreB: m.scoreB, winner });
    m[`wins${winner}`] += 1;
    const name = winner === 'A' ? m.sideA : m.sideB;
    if (matchOver()) {
      // จบเกมสุดท้าย: เก็บคะแนนเกมนี้ไว้บนจอ และนับจำนวนเกมที่ชนะตามจริง
      render(); push();
      return toast(`จบแมตช์: ${name} ชนะ ${Math.max(m.winsA, m.winsB)}–${Math.min(m.winsA, m.winsB)} เกม`);
    }
    m.scoreA = 0; m.scoreB = 0; m.game = Math.min(m.matchGames, m.game + 1);
    render(); push();
    toast(`บันทึกผู้ชนะเกม ${finished} แล้ว (${name})`);
  }

  // ---------- แสดงผล ----------
  function renderHistory() {
    const root = $('#gameHistory');
    if (!m.results.length) { root.hidden = true; root.innerHTML = ''; return; }
    root.hidden = false;
    root.innerHTML = `<div class="history-heading">ผลเกมที่ผ่านมา</div>${m.results.slice().reverse().map((r) =>
      `<div class="history-row"><span class="history-game">เกม ${r.game}</span><span class="history-name history-name-a">${esc(m.sideA)}</span><strong class="history-score ${r.winner === 'A' ? 'winner-score' : ''}">${r.scoreA}</strong><span class="history-sep">—</span><strong class="history-score ${r.winner === 'B' ? 'winner-score' : ''}">${r.scoreB}</strong><span class="history-name history-name-b">${esc(m.sideB)}</span></div>`).join('')}`;
  }
  function render() {
    setText('#scoreA', m.scoreA); setText('#scoreB', m.scoreB);
    setText('#gameWinsA', m.winsA); setText('#gameWinsB', m.winsB); setText('#gameNumber', m.game);
    setText('#scoreNameAText', m.sideA); setText('#scoreNameBText', m.sideB);
    $('#scoreColorA').style.background = m.colorA; $('#scoreColorB').style.background = m.colorB;
    setText('#studioTitle', m.title || 'SHUTTLECAST');
    const over = matchOver();
    setText('#scoreTitle', over ? 'MATCH END' : `GAME ${m.game} / ${m.matchGames === 1 ? 'SINGLE GAME' : `BEST OF ${m.matchGames}`}`);
    setText('#ruleSummary', `${m.target} แต้ม • ${m.winByTwo ? 'นำ 2' : 'แต้มถึงก่อน'} • สูงสุด ${m.cap}`);
    // กดตอนนี้แล้วแมตช์จะจบไหม: เป็นเกมสุดท้าย หรือฝั่งที่นำอยู่จะชนะครบเกมพอดี
    const leaderWins = m.scoreA > m.scoreB ? m.winsA : m.scoreB > m.scoreA ? m.winsB : -1;
    const endsMatch = m.game >= m.matchGames || leaderWins + 1 >= gamesToWin();
    setText('#nextGameButton', over ? 'แมตช์จบแล้ว' : endsMatch ? 'จบแมตช์ →' : 'เกมถัดไป →');
    const set = (selector, value) => { const el = $(selector); if (document.activeElement !== el) el.value = value; };
    set('#liveTarget', m.target); set('#liveCap', m.cap); set('#liveGames', String(m.matchGames));
    $('#liveWinByTwo').checked = m.winByTwo;
    renderHistory();
  }

  function overlayLink() {
    const params = new URLSearchParams({ room });
    if (view.pos !== 'tr') params.set('pos', view.pos);
    if (view.sponsor !== 'br') params.set('sponsor', view.sponsor);
    return `${location.origin}/overlay?${params}`;
  }
  function refreshLink() {
    setText('#overlayUrl', overlayLink());
    const src = `/overlay?${new URLSearchParams({ room, pos: view.pos, sponsor: view.sponsor })}`;
    const frame = $('#preview');
    if (frame.getAttribute('src') !== src) frame.setAttribute('src', src);
  }

  // ---------- หน้า setup ----------
  function updateSetupPreview() {
    setText('#previewA', $('#sideA').value || 'ฝั่ง A'); setText('#previewB', $('#sideB').value || 'ฝั่ง B');
    $('#previewColorA').style.background = $('#colorA').value; $('#previewColorB').style.background = $('#colorB').value;
  }
  function fillSetup() {
    $('#matchTitle').value = m.title; $('#room').value = room; $('#sideA').value = m.sideA; $('#sideB').value = m.sideB;
    $('#colorA').value = m.colorA; $('#colorB').value = m.colorB; $('#matchGames').value = String(m.matchGames);
    $('#target').value = m.target; $('#cap').value = m.cap; $('#winByTwo').checked = m.winByTwo;
    updateSetupPreview();
  }
  function persistSetup() {
    try { localStorage.setItem(STORE, JSON.stringify({ room, title: m.title, sideA: m.sideA, sideB: m.sideB, colorA: m.colorA, colorB: m.colorB, matchGames: m.matchGames, target: m.target, cap: m.cap, winByTwo: m.winByTwo, view })); } catch {}
  }
  function loadSetup() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE));
      if (!saved) return;
      room = /^[A-Za-z0-9_-]{1,40}$/.test(saved.room || '') ? saved.room : room;
      for (const key of ['title', 'sideA', 'sideB', 'colorA', 'colorB', 'matchGames', 'target', 'cap', 'winByTwo']) if (saved[key] !== undefined) m[key] = saved[key];
      if (saved.view) Object.assign(view, saved.view);
      normalizeRules();
    } catch {}
  }
  function showView(name) {
    $('#setupView').classList.toggle('active', name === 'setup');
    $('#studioView').classList.toggle('active', name === 'studio');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function setRules(target, cap) {
    m.target = target; m.cap = cap; normalizeRules(); render(); push(); persistSetup();
  }

  function applySetup(event) {
    event.preventDefault();
    const nextRoom = $('#room').value.trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(nextRoom)) return toast('ชื่อห้องใช้ได้เฉพาะ A–Z, 0–9, - และ _');
    const roomChanged = nextRoom !== room;
    room = nextRoom;
    const keepScore = !roomChanged && m.results.length + m.scoreA + m.scoreB > 0 && confirm('มีคะแนนค้างอยู่ — เก็บคะแนนเดิมไว้ใช่ไหม?\n(OK = เก็บ, Cancel = เริ่มใหม่)');
    const fresh = defaults();
    Object.assign(m, keepScore ? {} : { scoreA: fresh.scoreA, scoreB: fresh.scoreB, winsA: 0, winsB: 0, game: 1, results: [] });
    if (!keepScore) history = [];
    Object.assign(m, {
      title: $('#matchTitle').value.trim(), sideA: $('#sideA').value.trim() || 'ฝั่ง A', sideB: $('#sideB').value.trim() || 'ฝั่ง B',
      colorA: $('#colorA').value, colorB: $('#colorB').value, matchGames: Number($('#matchGames').value),
      target: Number($('#target').value), cap: Number($('#cap').value), winByTwo: $('#winByTwo').checked
    });
    normalizeRules();
    $('#target').value = m.target; $('#cap').value = m.cap;
    persistSetup(); render(); refreshLink(); showView('studio'); push();
  }

  async function resumeFromServer() {
    try {
      const data = await (await fetch(apiUrl('state'), { cache: 'no-store' })).json();
      setSync('ready', 'พร้อมตั้งค่า');
      if (data.state && data.rev > 0) {
        Object.assign(m, data.state); normalizeRules(); fillSetup(); render(); refreshLink(); showView('studio'); setSync('live', 'กลับเข้าห้องเดิมแล้ว');
      }
    } catch { setSync('', 'ติดต่อเซิร์ฟเวอร์ไม่ได้'); }
  }

  // ---------- events ----------
  loadSetup(); fillSetup(); render(); refreshLink();
  $('#sideA').addEventListener('input', updateSetupPreview); $('#sideB').addEventListener('input', updateSetupPreview);
  $('#colorA').addEventListener('input', updateSetupPreview); $('#colorB').addEventListener('input', updateSetupPreview);
  document.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => {
    const preset = PRESETS[button.dataset.preset]; $('#target').value = preset.target; $('#cap').value = preset.cap;
  }));
  document.querySelectorAll('[data-live-preset]').forEach((button) => button.addEventListener('click', () => {
    const preset = PRESETS[button.dataset.livePreset]; setRules(preset.target, preset.cap); toast(`ตั้งกติกา ${preset.target} แต้ม สูงสุด ${preset.cap}`);
  }));
  $('#target').addEventListener('change', () => { const t = clampInt($('#target').value, 1, 30, 21); $('#target').value = t; if (Number($('#cap').value) < t) $('#cap').value = t; });
  $('#cap').addEventListener('change', () => { $('#cap').value = clampInt($('#cap').value, Number($('#target').value) || 1, 99, 30); });
  $('#liveTarget').addEventListener('change', () => setRules(clampInt($('#liveTarget').value, 1, 30, m.target), m.cap));
  $('#liveCap').addEventListener('change', () => setRules(m.target, clampInt($('#liveCap').value, 1, 99, m.cap)));
  $('#liveGames').addEventListener('change', () => { m.matchGames = Number($('#liveGames').value); normalizeRules(); render(); push(); persistSetup(); });
  $('#liveWinByTwo').addEventListener('change', () => { m.winByTwo = $('#liveWinByTwo').checked; render(); push(); persistSetup(); });
  $('#setupForm').addEventListener('submit', applySetup);
  $('#backToSetup').addEventListener('click', () => { fillSetup(); showView('setup'); });
  $('#addA').addEventListener('click', () => addPoint('A')); $('#addB').addEventListener('click', () => addPoint('B'));
  $('#minusA').addEventListener('click', () => subPoint('A')); $('#minusB').addEventListener('click', () => subPoint('B'));
  $('#undoButton').addEventListener('click', undo); $('#resetButton').addEventListener('click', resetGame); $('#resetMatchButton').addEventListener('click', resetMatch); $('#nextGameButton').addEventListener('click', nextGame);
  $('#posSelect').value = view.pos; $('#sponsorSelect').value = view.sponsor;
  $('#posSelect').addEventListener('change', () => { view.pos = $('#posSelect').value; refreshLink(); persistSetup(); });
  $('#sponsorSelect').addEventListener('change', () => { view.sponsor = $('#sponsorSelect').value; refreshLink(); persistSetup(); });
  $('#copyLink').addEventListener('click', async () => {
    const link = overlayLink();
    try { await navigator.clipboard.writeText(link); toast('คัดลอกลิงก์ Overlay แล้ว'); }
    catch { const range = document.createRange(); range.selectNodeContents($('#overlayUrl')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); toast('เลือกลิงก์ไว้แล้ว — กดคัดลอกเอง'); }
  });
  $('#helpButton').addEventListener('click', () => { $('#helpModal').hidden = false; });
  $('#closeHelp').addEventListener('click', () => { $('#helpModal').hidden = true; });
  $('#helpModal').addEventListener('click', (event) => { if (event.target.id === 'helpModal') $('#helpModal').hidden = true; });

  resumeFromServer();
})();
