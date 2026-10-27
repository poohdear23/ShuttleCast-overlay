// หน้า Overlay สำหรับ PRISM / OBS Browser Source
// พารามิเตอร์: ?room=court1  &pos=tr|tl|br|bl  &sponsor=br|bl|tr|tl (ซ่อนไม่ได้)  &scale=1.2  &title=0  (ขนาด S/M ตั้งจากหน้าควบคุม)
(() => {
  const q = new URLSearchParams(location.search);
  const room = /^[A-Za-z0-9_-]{1,40}$/.test(q.get('room') || '') ? q.get('room') : 'court1';
  const pos = ['tr', 'tl', 'br', 'bl'].includes(q.get('pos')) ? q.get('pos') : 'tr';
  // ล็อกโลโก้สปอนเซอร์: เลือกได้แค่ตำแหน่ง ซ่อนไม่ได้ (ค่าอื่น รวมถึง 0 = ล่างขวา)
  const sponsorPos = ['br', 'bl', 'tr', 'tl'].includes(q.get('sponsor')) ? q.get('sponsor') : 'br';
  const scale = Math.max(0.4, Math.min(3, Number(q.get('scale')) || 1));
  const $ = (id) => document.getElementById(id);

  document.documentElement.style.setProperty('--scale', scale);
  $('board').classList.add(`pos-${pos}`);
  $('sponsor').hidden = false;
  $('sponsor').classList.add(`sp-${sponsorPos}`);

  const pad = (n) => String(n).padStart(2, '0');
  let lastRev = -1;
  let last = null;

  function bump(el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

  function render(state) {
    const board = $('board');
    if (!state) { board.classList.remove('ready'); return; }
    // ขนาด S/M/L มาจากหน้าควบคุม (เปลี่ยนสด) คูณกับ ?scale= ในลิงก์
    document.documentElement.style.setProperty('--scale', scale * ({ s: 0.85, m: 1 }[state.size] || 1));
    $('title').textContent = q.get('title') === '0' ? '' : state.title;
    $('nameA').textContent = state.sideA; $('nameB').textContent = state.sideB;
    $('dotA').style.background = state.colorA; $('dotB').style.background = state.colorB;
    $('winsA').textContent = state.winsA; $('winsB').textContent = state.winsB;
    $('scoreA').textContent = pad(state.scoreA); $('scoreB').textContent = pad(state.scoreB);
    if (last && last.scoreA !== state.scoreA && state.scoreA > last.scoreA) bump($('scoreA'));
    if (last && last.scoreB !== state.scoreB && state.scoreB > last.scoreB) bump($('scoreB'));
    const need = Math.ceil(state.matchGames / 2);
    const over = state.winsA >= need || state.winsB >= need || state.results.length >= state.matchGames;
    $('gameLabel').textContent = over ? 'FINAL' : `GAME ${state.game} / ${state.matchGames === 1 ? 'SINGLE' : `BEST OF ${state.matchGames}`}`;
    $('ruleLabel').textContent = `${state.target} • ${state.winByTwo ? 'นำ 2' : 'ถึงก่อนชนะ'} • MAX ${state.cap}`;
    $('history').innerHTML = state.results.slice().reverse().map((r) =>
      `<div class="h-row"><span>GAME ${r.game}</span><span class="pair"><b class="${r.winner === 'A' ? 'win' : ''}">${pad(r.scoreA)}</b><b class="${r.winner === 'B' ? 'win' : ''}">${pad(r.scoreB)}</b></span></div>`
    ).join('');
    last = state;
    board.classList.add('ready');
  }

  // เทียบเนื้อหาแทนเลข rev: ถ้าเซิร์ฟเวอร์รีสตาร์ท (Render หลับ) เลข rev เริ่มนับใหม่ จะไม่พลาดการอัปเดต
  let lastJson = null;
  function apply(data) {
    if (!data || typeof data.rev !== 'number') return;
    const json = JSON.stringify(data.state);
    if (json === lastJson) return;
    lastJson = json;
    render(data.state);
  }

  // o=1 บอกเซิร์ฟเวอร์ว่าเป็น overlay จริง (preview ในหน้าควบคุมใส่ ?preview=1 จึงไม่นับ)
  const flag = q.get('preview') === '1' ? '' : '?o=1';
  // SSE เป็นหลัก ต่อใหม่เองเมื่อหลุด + poll สำรองทุก 4 วินาที (เผื่อ proxy บัฟเฟอร์ SSE)
  function connect() {
    const source = new EventSource(`/api/room/${room}/events${flag}`);
    source.onmessage = (event) => { try { apply(JSON.parse(event.data)); } catch {} };
    source.onerror = () => { source.close(); setTimeout(connect, 2000); };
  }
  async function poll() {
    try { apply(await (await fetch(`/api/room/${room}/state${flag}`, { cache: 'no-store' })).json()); } catch {}
  }
  connect();
  poll();
  setInterval(poll, 4000);
})();
