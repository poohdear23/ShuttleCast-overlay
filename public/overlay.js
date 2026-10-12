// หน้า Overlay สำหรับ PRISM / OBS Browser Source
// พารามิเตอร์: ?room=court1  &pos=tr|tl|br|bl  &sponsor=br|bl|tr|tl|0  &scale=1.2  &title=0
(() => {
  const q = new URLSearchParams(location.search);
  const room = /^[A-Za-z0-9_-]{1,40}$/.test(q.get('room') || '') ? q.get('room') : 'court1';
  const pos = ['tr', 'tl', 'br', 'bl'].includes(q.get('pos')) ? q.get('pos') : 'tr';
  const sponsorPos = q.get('sponsor') === null ? 'br' : q.get('sponsor');
  const scale = Math.max(0.4, Math.min(3, Number(q.get('scale')) || 1));
  const $ = (id) => document.getElementById(id);

  document.documentElement.style.setProperty('--scale', scale);
  $('board').classList.add(`pos-${pos}`);
  if (sponsorPos === '0') $('sponsor').hidden = true; else $('sponsor').classList.add(`sp-${sponsorPos}`);

  const pad = (n) => String(n).padStart(2, '0');
  let lastRev = -1;
  let last = null;

  function bump(el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

  function render(state) {
    const board = $('board');
    if (!state) { board.classList.remove('ready'); return; }
    $('title').textContent = q.get('title') === '0' ? '' : state.title;
    $('nameA').textContent = state.sideA; $('nameB').textContent = state.sideB;
    $('dotA').style.background = state.colorA; $('dotB').style.background = state.colorB;
    $('winsA').textContent = state.winsA; $('winsB').textContent = state.winsB;
    $('scoreA').textContent = pad(state.scoreA); $('scoreB').textContent = pad(state.scoreB);
    if (last && last.scoreA !== state.scoreA && state.scoreA > last.scoreA) bump($('scoreA'));
    if (last && last.scoreB !== state.scoreB && state.scoreB > last.scoreB) bump($('scoreB'));
    $('gameLabel').textContent = `GAME ${state.game} / ${state.matchGames === 1 ? 'SINGLE' : `BEST OF ${state.matchGames}`}`;
    $('ruleLabel').textContent = `${state.target} • ${state.winByTwo ? 'นำ 2' : 'ถึงก่อนชนะ'} • MAX ${state.cap}`;
    $('history').innerHTML = state.results.slice().reverse().map((r) =>
      `<div class="h-row"><span>GAME ${r.game}</span><span class="pair"><b class="${r.winner === 'A' ? 'win' : ''}">${pad(r.scoreA)}</b><b class="${r.winner === 'B' ? 'win' : ''}">${pad(r.scoreB)}</b></span></div>`
    ).join('');
    last = state;
    board.classList.add('ready');
  }

  function apply(data) {
    if (!data || typeof data.rev !== 'number' || data.rev === lastRev) return;
    lastRev = data.rev;
    render(data.state);
  }

  // SSE เป็นหลัก ต่อใหม่เองเมื่อหลุด + poll สำรองทุก 4 วินาที (เผื่อ proxy บัฟเฟอร์ SSE)
  function connect() {
    const source = new EventSource(`/api/room/${room}/events`);
    source.onmessage = (event) => { try { apply(JSON.parse(event.data)); } catch {} };
    source.onerror = () => { source.close(); setTimeout(connect, 2000); };
  }
  async function poll() {
    try { apply(await (await fetch(`/api/room/${room}/state`, { cache: 'no-store' })).json()); } catch {}
  }
  connect();
  poll();
  setInterval(poll, 4000);
})();
