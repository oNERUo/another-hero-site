/* =====================================================================
   Another Hero · 웹 게임 (Unity 프로젝트 → 브라우저 이식)
   UI는 index.html(시안)의 화면을 그대로 쓰고, 이 파일이 Unity 쪽 게임 규칙을 붙여요.
     - BattleManager / BattleUnit / BattleUnitView  → 로비 가운데 자동 전투
     - Currency · CharacterProgress · AdventurerRoster · AdventurerRecruit → 저장되는 진행 상태
     - StoryBook (스토리 우편 도착) · OfflineRewardSystem (오프라인 보상)
   데이터(캐릭터·스킬·몬스터·지역·스테이지)는 data.js (build.py 가 Unity 에셋에서 생성)
   ===================================================================== */
(function(){
'use strict';
const UD = window.UNITY_DATA;

/* ---------- Unity 데이터 ↔ 시안 이름 연결 ---------- */
// CharacterDatabase 순서 = 시안 MODELS 순서 (발테아스, 쉐리안, 레티온 …)
const CHAR_BY_MODEL = {};
UD.characterOrder.forEach((key, i) => { CHAR_BY_MODEL[MODELS[i].name] = UD.characters.find(c => c.key === key); });
// Unity Element enum: 0 없음 · 1 물 · 2 불 · 3 얼음 · 4 풀 · 5 빛 · 6 어둠
const EL_NAME = ['', '물', '불', '얼음', '풀', '빛', '어둠'];
const elOf = name => Math.max(0, EL_NAME.indexOf(name || ''));
const COUNTER = {1: 2, 2: 3, 3: 4, 4: 1, 5: 6, 6: 5};   // 물→불→얼음→풀→물, 빛↔어둠
const isCounter = (a, d) => COUNTER[a] === d;
const STAGE_BG = ['bgField', 'bgSnow', 'bgRuin'];

/* ---------- 스킬 · 기본공격 효과음 (assets/sfx/코드_번호.wav, 0 = 기본공격, 1~3 = 스킬 1~3) ---------- */
const SFX_CODE = {Valteas: 'VAL', Shirian: 'SHE', Retion: 'RET', Arben: 'ARB', Nemesis: 'NEM',
  Runtein: 'RUN', Lumiel: 'LUM', Orpheia: 'ORP', Serapia: 'SER', Astrion: 'AST'};
const BSFX = {ctx: null, buf: {}, playing: 0, MAX: 6};
function battleAudioOk(){
  return typeof SND !== 'undefined' && SND.sfx && SND.unlocked && S.screen === 'lobby' && !S.popup && !(typeof IN !== 'undefined' && IN.open);
}
/* 전투 소리는 로비(전투 화면)에 있을 때만 (다른 창을 볼 때 시끄럽지 않게) */
function battleSfx(k, vol = 1){ if(battleAudioOk()) sfx(k, vol); }
function skillSfx(model, slot, vol = 1){
  const c = CHAR_BY_MODEL[model], code = c && SFX_CODE[c.key];
  if(!code || !battleAudioOk()) return;
  const name = `${code}_${slot}`;
  try {
    if(!BSFX.ctx) BSFX.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = BSFX.ctx;
    if(ctx.state === 'suspended') ctx.resume();
    const go = buf => {
      if(!buf || BSFX.playing >= BSFX.MAX) return;   // 동시에 너무 많이 겹치지 않게
      const src = ctx.createBufferSource(), g = ctx.createGain();
      g.gain.value = Math.max(0, Math.min(1, SND.sfxVol * vol));
      src.buffer = buf; src.connect(g).connect(ctx.destination);
      BSFX.playing++; src.onended = () => BSFX.playing--;
      src.start();
    };
    const b = BSFX.buf[name];
    if(b instanceof AudioBuffer) go(b);
    else if(!b) BSFX.buf[name] = fetch(`assets/sfx/${name}.wav`).then(r => r.arrayBuffer()).then(a => ctx.decodeAudioData(a))
      .then(x => { BSFX.buf[name] = x; go(x); }).catch(() => { BSFX.buf[name] = 'fail'; });
  } catch(e){}
}

/* 규칙 상수 (Unity BattleManager 인스펙터 값) */
const R = {
  minDamage: 1, critMul: 1.5, waveDelay: 1.2, waveRestHeal: .15, walkIn: .7,
  clearDelay: 1.5, wipeDelay: 2, deadExpRate: .8, skillCdPerLv: .02, skillMaxLv: 10,
  offlineMaxHours: 8, offlineRate: {gold: 17, shard: 17, stone: 0},
  /* HARD 난이도: Unity 에는 없어 웹에서 정한 값 (몬스터 체력·공격 ×2, 방어 ×1.5, 보상 ×2, 보석 같음) */
  hard: {hp: 2, atk: 2, def: 1.5, reward: 2},
};
/* 화면 배치 (1920×1080 기준) */
const L = {charH: 240, monSize: 210, bossSize: 380, artRef: 300,
  partyFrontX: 820, partySpacing: 160, enemyFrontX: 1080, enemySpacing: 170, offRight: 2120};

/* ---------- 저장 ---------- */
const SAVE_KEY = 'ah_web_save_v1';
const G = {   // S(시안 상태)에 없는 진행 정보
  region: 0, stage: 0, diff: 'EASY', repeating: false,
  maxCleared: 0, lastCleared: 0, hardCleared: [0, 0, 0],
  delivered: new Set(), lastAccess: 0, createdAny: false, freeLast: [], speed: 1,
};
function save(){
  G.lastAccess = Date.now();
  const data = {v: 1, cur: S.cur, inv: S.inv, adv: S.adv, parties: S.parties, pIdx: S.pIdx, pActive: S.pActive,
    mails: S.mails, read: [...S.read],
    g: {...G, delivered: [...G.delivered]}};
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch(e){}
}
function load(){
  let d = null;
  try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch(e){}
  if(!d) return false;
  S.cur = d.cur; S.inv = d.inv; S.adv = d.adv; S.parties = d.parties; S.pIdx = d.pIdx || 0; S.pActive = d.pActive || 0;
  S.mails = d.mails || []; S.read = new Set(d.read || []);
  Object.assign(G, d.g, {delivered: new Set(d.g.delivered || [])});
  return true;
}
function newGame(){
  S.cur = {gold: 0, stone: 0, shard: 0};
  S.inv = []; S.mails = []; S.read = new Set();
  /* 처음 실행: 모델 10종 기본 모험가 (Unity AdventurerRoster 기본 모험가) · 앞 4명이 출전 파티 */
  S.adv = MODELS.map(m => ({id: 'st-' + CHAR_BY_MODEL[m.name].key, name: m.name, g: 'M', model: m.name, attr: '', pers: '',
    fx: defaultFx(m.name), face: false, photo: null, power: 0, lv: 1, exp: 0, slv: {hp: 0, atk: 0, def: 0, crit: 0, aspd: 0, cdr: 0},
    skill: [0, 0, 0], starter: true}));
  const p = S.adv.slice(0, 4).map(a => a.id);
  S.parties = [{name: '파티 1', m: [...p], saved: [...p]}]; S.pIdx = 0; S.pActive = 0;
}

/* ---------- 계산 도우미 ---------- */
const regionOf = i => UD.regions[i];
const stageInfo = (r, s) => UD.regions[r].stages[s];
const numberOf = (r, s) => r * 10 + s + 1;   // 1-1 = 1 … 3-10 = 30
const TOTAL = UD.regions.reduce((n, r) => n + r.stages.length, 0);
const frontier = () => Math.min(G.maxCleared + 1, TOTAL);
const hardOpen = r => G.maxCleared >= (r + 1) * 10;   // HARD: 같은 스테이지 EASY 10 클리어 시 해금
const hardReach = r => hardOpen(r) ? Math.min(10, G.hardCleared[r] + 1) : 0;
const advById = id => S.adv.find(a => a.id === id);
function finalStat(a, k){ return BASE_STAT[a.model][k] + (a.slv[k] || 0) * STAT_GAIN[k]; }
function combatPower(a){
  const hp = finalStat(a, 'hp'), atk = finalStat(a, 'atk'), def = finalStat(a, 'def'), crit = finalStat(a, 'crit'), aspd = finalStat(a, 'aspd');
  return Math.round(hp * .2 + atk * aspd * 4 + def * 3 + crit * 2);
}
function rewardsOf(r, s, diff){
  const rw = {...stageInfo(r, s).rewards};
  if(diff === 'HARD') ['expPerKill','bossExp','goldPerKill','manaShardPerKill','bossGold','bossManaShard'].forEach(k => rw[k] = Math.round(rw[k] * R.hard.reward));
  return rw;
}
const fmtDur = sec => { const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return `${String(h).padStart(2,'0')}시간 ${String(m).padStart(2,'0')}분`; };

/* 시안 상태(S.stageProg · S.battle · S.prog …)를 진행 정보에서 다시 계산 */
function syncDerived(){
  const f = frontier();
  S.stageProg = {EASY: {}, HARD: {}};
  UD.regions.forEach((_, r) => { S.stageProg.EASY[r + 1] = Math.max(0, Math.min(10, f - r * 10)); S.stageProg.HARD[r + 1] = hardReach(r); });
  S.battle = {stage: G.region + 1, round: G.stage + 1, diff: G.diff};
  S.prog = {ch: G.region + 1, round: G.stage};
  S.free10 = !G.createdAny;
  S.adv.forEach(a => { a.power = combatPower(a); });
  const now = Date.now(), DAY = 864e5;
  S.mails = S.mails.filter(m => m.type === 'story' || !m.at || now - m.at < MAIL_KEEP_DAYS * DAY);
  S.mails.forEach(m => { if(!m.at) return; m.age = Math.floor((now - m.at) / DAY);
    const min = Math.floor((now - m.at) / 6e4); m.time = min < 1 ? '방금' : min < 60 ? `${min}분 전` : min < 1440 ? `${Math.floor(min / 60)}시간 전` : `${m.age}일 전`; });
}

/* ---------- 스토리 (StoryBook) ---------- */
function deliver(id, quiet){
  const e = STORY.find(x => x.id === id);
  if(!e || G.delivered.has(id)) return false;
  G.delivered.add(id);
  S.mails.unshift({id: 'm-' + id, type: 'story', story: id, title: e.title, from: '카이렌 모험가 길드', time: e.label, age: 0, done: false});
  if(!quiet){ toast(`새 이야기가 우편함에 도착했어요 · ${e.label}`); if(S.screen === 'lobby' && !S.popup) render(); }
  save();
  return true;
}
isUnlocked = e => G.delivered.has(e.id);
/* 오프라인 보상 알림 (우편함 기록) */
addOfflineNotice = function(){
  S.mails.unshift({id: 'm-off-' + Date.now(), type: 'notice', title: '오프라인 보상 자동 수령 완료', from: '오프라인 보상', time: '방금', age: 0, at: Date.now(),
    note: `${S.offline.basis} 기준 · 누적 ${S.offline.hours}`, items: {...S.offline.items}, done: false});
};

/* ---------- 오프라인 보상 (OfflineRewardSystem) ---------- */
/* basis = 기준 스테이지 번호(1-1 = 1), off = 오프라인 시간(초). 생략하면 저장된 마지막 접속 기준 */
function calcOffline(basis, off){
  S.offline = {shown: true, items: {}, hours: '', rate: R.offlineRate.gold, basis: ''};
  if(basis === undefined){
    if(!G.lastAccess || G.lastCleared <= 0) return;
    basis = G.lastCleared; off = (Date.now() - G.lastAccess) / 1000;
  }
  const eff = Math.min(off, R.offlineMaxHours * 3600);
  const n = basis - 1, r = Math.floor(n / 10), s = n % 10, st = stageInfo(r, s), rw = st.rewards;
  const clears = Math.floor(eff / Math.max(1, rw.avgClearSeconds));
  if(clears < 1) return;
  const boss = !!st.boss;
  const per = {gold: st.kills * rw.goldPerKill + (boss ? rw.bossGold : 0),
               shard: st.kills * rw.manaShardDropChance * rw.manaShardPerKill + (boss ? rw.bossManaShard : 0),
               stone: boss ? rw.bossGem : 0};
  const items = {};
  ['gold', 'shard', 'stone'].forEach(k => { const v = Math.floor(clears * per[k] * R.offlineRate[k] / 100); if(v > 0) items[k] = v; });
  if(!Object.keys(items).length) return;
  Object.assign(S.offline, {shown: false, items, hours: fmtDur(off) + (off > eff ? ` (최대 ${R.offlineMaxHours}시간 인정)` : ''),
    basis: `${r + 1}-${s + 1} ${regionOf(r).name}`});
}

/* =====================================================================
   전투 (BattleManager · BattleUnit · BattleUnitView)
   ===================================================================== */
const B = {party: [], enemies: [], state: 'fight', wait: 0, after: null, waveTimer: 0, kills: 0,
  bossSpawned: false, bossDefeated: false, waveRested: true, walking: false, groundY: 886, layer: null, field: null,
  bannerT: 0, paused: false, hitSfxT: 0};
const curStage = () => stageInfo(G.region, G.stage);

function makeUnitFromAdv(a, slot){
  const c = CHAR_BY_MODEL[a.model];
  const u = {team: 'party', adv: a, name: a.name, isBoss: false, slot, element: elOf(a.attr),
    skills: c.skills.map(k => UD.skills[k]), statuses: [], gauge: 0, spawnDelay: 0};
  refreshFromProgress(u, true);
  u.cds = u.skills.map(() => 0);
  u.hp = u.maxHp;
  return u;
}
function refreshFromProgress(u, first){
  const a = u.adv, old = u.maxHp || 0;
  u.maxHp = finalStat(a, 'hp'); u.baseAtk = finalStat(a, 'atk'); u.baseDef = finalStat(a, 'def');
  u.baseCrit = finalStat(a, 'crit'); u.baseAspd = Math.max(.05, finalStat(a, 'aspd'));
  u.name = a.name; u.element = elOf(a.attr);
  if(!first){ if(u.hp > 0 && u.maxHp > old) u.hp = Math.min(u.maxHp, u.hp + (u.maxHp - old)); if(u.hp > u.maxHp) u.hp = u.maxHp; }
}
function cooldownOf(u, i){
  const s = u.skills[i];
  if(!u.adv) return s.cd;
  const lv = i < 3 ? (u.adv.skill[i] || 0) : 0;
  return s.cd * (1 - R.skillCdPerLv * Math.min(lv, R.skillMaxLv));
}
function makeMonster(spawn, hard){
  const m = UD.monsters[spawn.monster], k = hard ? R.hard : {hp: 1, atk: 1, def: 1};
  return {team: 'enemy', monster: m, name: m.name, isBoss: m.boss, maxHp: Math.round(spawn.hp * k.hp), baseAtk: spawn.atk * k.atk,
    baseDef: spawn.def * k.def, baseCrit: 0, baseAspd: Math.max(.05, m.aspd), skills: [], cds: [], statuses: [], gauge: 0, spawnDelay: 0};
}
const isDead = u => u.hp <= 0;
const statMul = (u, stat) => u.statuses.reduce((m, s) => s.kind === 'StatBuff' && (s.stat === stat || s.stat === 3) ? m * s.value : m, 1);
const atkOf = u => u.baseAtk * statMul(u, 0);
const defOf = u => u.baseDef * statMul(u, 1);
const aspdOf = u => u.baseAspd * statMul(u, 2);
const critOf = u => u.statuses.reduce((c, s) => s.kind === 'CritBuff' ? c + s.value : c, u.baseCrit);
const has = (u, kind) => u.statuses.some(s => s.kind === kind);
function dmgTakenMul(t, attacker){
  let m = 1;
  t.statuses.forEach(s => {
    if(s.kind === 'Mark') m *= 1 + s.value;
    else if(s.kind === 'RuneMark' && s.source === attacker){ const b = attacker.statuses.find(x => x.kind === 'ElementBoost'); m *= 1 + (b ? b.value : s.value); }
    else if(s.kind === 'DamageReduction') m *= 1 - Math.min(1, Math.max(0, s.value));
  });
  return m;
}
function addStatus(u, kind, value, duration, source, stat = 0){
  if(isDead(u)) return;
  const s = u.statuses.find(x => x.kind === kind && x.source === source && x.stat === stat);
  if(s){ s.value = value; s.remaining = duration; }
  else u.statuses.push({kind, value, remaining: duration, source, stat, tick: 0});
  statusText(u);
}
function resetForStage(u){
  const wasDead = isDead(u);
  u.hp = u.maxHp; u.statuses = []; u.gauge = Math.random() * .5;
  u.cds = u.skills.map((s, i) => cooldownOf(u, i) * .5);
  if(u.view){ if(wasDead) viewAlive(u); viewHp(u); statusText(u); }
}
const allies = u => u.team === 'party' ? B.party : B.enemies;
const opponents = u => u.team === 'party' ? B.enemies : B.party;
/* 걸어 들어오는 중인 몬스터는 아직 화면 밖이라 노리지 않음 (웹 화면이 넓어서 추가한 규칙) */
const target = u => opponents(u).find(o => !isDead(o) && !(o.team === 'enemy' && o.spawnDelay > 0)) || null;
const pickRandom = list => list.length ? list[Math.floor(Math.random() * list.length)] : null;

function dealDamage(att, t, mul, forceCrit){
  if(!t || isDead(t)) return 0;
  if(has(t, 'Invulnerable')){ popup(t, 'MISS', '#cccccc', 30); return 0; }
  let dmg = Math.max(R.minDamage, atkOf(att) * mul * (1 - Math.min(.9, Math.max(0, defOf(t) * .5 / 100))));
  const crit = forceCrit || Math.random() * 100 < critOf(att);
  if(crit) dmg *= R.critMul;
  dmg *= dmgTakenMul(t, att);
  const counter = isCounter(att.element, t.element);
  if(counter) dmg *= 1.2;
  const fin = Math.max(1, Math.round(dmg));
  t.hp = Math.max(0, t.hp - fin);
  if(t.team === 'enemy' && performance.now() - B.hitSfxT > 90){ B.hitSfxT = performance.now(); battleSfx(crit ? 'S34' : 'S33', crit ? .6 : .25); }
  viewHp(t); viewFlash(t);
  popup(t, (crit ? fin + '!' : '' + fin) + (counter ? '▲' : ''), t.team === 'party' ? '#ff6b6b' : crit ? '#ffa020' : '#ffffff', crit ? 44 : 32);
  if(isDead(t)){ t.statuses = []; statusText(t); viewDead(t); onUnitDied(t); }
  return fin;
}
function heal(t, amount, show){
  if(!t || isDead(t)) return 0;
  const before = t.hp; t.hp = Math.min(t.maxHp, t.hp + amount); viewHp(t);
  const h = t.hp - before;
  if(show && h >= 1) popup(t, '+' + Math.round(h), '#66ff80', 32);
  return h;
}
function canCast(u, sk){
  let needsEnemy = false, onlyHeal = true;
  for(const e of sk.effects){
    if(e.type === 11 && !allies(u).some(isDead)) return false;   // 부활: 다 살아있으면 아껴둠
    if(e.target === 1 || e.target === 2) needsEnemy = true;
    if(e.type !== 1) onlyHeal = false;
  }
  if(needsEnemy && !target(u)) return false;
  if(onlyHeal && !allies(u).some(a => !isDead(a) && a.hp < a.maxHp)) return false;
  return true;
}
function castSkill(u, sk){
  floatText(u.view && viewTop(u, 70), sk.name, '#fff27f', 30);
  const single = target(u), rAlly = pickRandom(allies(u).filter(a => !isDead(a))), dAlly = pickRandom(allies(u).filter(isDead));
  sk.effects.forEach(e => {
    let ts = [];
    switch(e.target){
      case 0: ts = [u]; break;
      case 1: if(single && !isDead(single)) ts = [single]; break;
      case 2: ts = opponents(u).filter(o => !isDead(o)); break;
      case 3: if(rAlly && !isDead(rAlly)) ts = [rAlly]; break;
      case 4: ts = allies(u).filter(a => !isDead(a)); break;
      case 5: if(dAlly && isDead(dAlly)) ts = [dAlly]; break;
    }
    skillFx(u, sk, e, ts);
    ts.forEach(t => applyEffect(u, e, t));
  });
}
const KIND = {2: 'Stun', 3: 'Mark', 4: 'RuneMark', 6: 'CritBuff', 7: 'DamageReduction', 8: 'Invulnerable', 9: 'ElementBoost', 10: 'Summon'};
function applyEffect(c, e, t){
  switch(e.type){
    case 0: for(let i = 0; i < Math.max(1, e.hits) && !isDead(t); i++) dealDamage(c, t, e.value, !!e.guaranteedCrit); break;
    case 1: if(e.duration > 0) addStatus(t, 'HealOverTime', t.maxHp * e.value / e.duration, e.duration, c); else heal(t, t.maxHp * e.value, true); break;
    case 5: { let stat = e.stat; if(stat === 4) stat = [0, 1, 2][Math.floor(Math.random() * 3)]; addStatus(t, 'StatBuff', e.value, e.duration, c, stat); break; }
    case 11: if(isDead(t)){ t.hp = Math.max(1, t.maxHp * e.value); t.gauge = 0; viewAlive(t); viewHp(t); popup(t, '부활!', '#ffff99', 38); } break;
    default: if(KIND[e.type]) addStatus(t, KIND[e.type], e.type === 2 || e.type === 8 ? 0 : e.value, e.duration, c);
  }
}
function tickUnit(u, dt){
  // 상태 이상
  let changed = false;
  for(let i = u.statuses.length - 1; i >= 0; i--){
    const s = u.statuses[i]; if(!s) continue;
    const step = Math.min(dt, Math.max(0, s.remaining));
    s.remaining -= dt;
    if(s.kind === 'HealOverTime' && !isDead(u)) heal(u, s.value * step, false);
    else if(s.kind === 'Summon' && !isDead(u)){
      s.tick += dt;
      if(s.tick >= 1){ s.tick -= 1; const t = target(u); if(t){ if(t.view) ring(viewCenter(t), 110, [.75, .55, 1], .25); dealDamage(u, t, s.value, false); } }
    }
    if(u.statuses[i] === s && s.remaining <= 0){ u.statuses.splice(i, 1); changed = true; }
  }
  if(changed) statusText(u);
  if(isDead(u)) return;
  if(u.spawnDelay > 0){ u.spawnDelay -= dt; return; }
  for(let i = 0; i < u.cds.length; i++) u.cds[i] -= dt;
  if(has(u, 'Stun')) return;
  for(let i = 0; i < u.skills.length; i++){
    const sk = u.skills[i];
    if(u.cds[i] > 0 || !canCast(u, sk)) continue;
    castSkill(u, sk);
    if(u.adv && i < 3) skillSfx(u.adv.model, i + 1, .9);
    u.cds[i] = cooldownOf(u, i) + (sk.cdAfter ? Math.max(0, ...sk.effects.map(e => e.duration)) : 0);
    break;
  }
  if(isDead(u)) return;
  u.gauge += dt * aspdOf(u);
  if(u.gauge >= 1){
    const t = target(u);
    if(t){ u.gauge -= 1; if(t.view) viewLunge(u, t); if(u.adv) skillSfx(u.adv.model, 0, .45); dealDamage(u, t, 1, false); }
    else u.gauge = 1;
  }
}

/* ---- 스테이지 진행 ---- */
function buildParty(){
  B.party.forEach(u => u.view && u.view.el.remove());
  B.party = [];
  const p = S.parties[S.pActive] || S.parties[0];
  let ids = (p ? p.saved : []).filter(id => id && advById(id));
  if(!ids.length && S.adv[0]) ids = [S.adv[0].id];
  ids.slice(0, 4).forEach((id, slot) => { const u = makeUnitFromAdv(advById(id), slot); createView(u, partyPos(slot)); B.party.push(u); });
  B.walking = false;
}
const partyPos = slot => L.partyFrontX - slot * L.partySpacing;
const enemyPos = (i, size) => L.enemyFrontX + size * .5 - L.monSize * .5 + i * L.enemySpacing;
function setWalking(on){
  if(B.walking === on) return;
  B.walking = on;
  B.party.forEach(u => { if(u.view) u.view.walking = on && !isDead(u); });
}
function startStage(){
  clearEnemies();
  B.party.forEach(resetForStage);
  B.kills = 0; B.bossSpawned = false; B.bossDefeated = false; B.waveRested = true; B.waveTimer = R.waveDelay; B.state = 'fight';
  B.walking = false; setWalking(true);
  applyGround();
  banner(curStage().boss ? `${G.region + 1}-${G.stage + 1} 보스 스테이지` : `${G.region + 1}-${G.stage + 1} 시작`, 1.2);
  deliver('p', true); deliver(`${G.region + 1}-0`);
  hud(); save();
}
function nextStage(){
  if(G.repeating){ startStage(); return; }
  if(G.diff === 'HARD'){
    if(G.stage < 9) G.stage++; startStage(); return;
  }
  G.stage++;
  if(G.stage >= regionOf(G.region).stages.length){
    if(G.region + 1 < UD.regions.length){ G.region++; G.stage = 0; }
    else G.stage = regionOf(G.region).stages.length - 1;   // 마지막 스테이지 반복
  }
  startStage();
  if(S.screen === 'lobby' && !S.popup) render();
}
function selectStage(region, stage, diff){
  const num = numberOf(region, stage);
  if(diff === 'HARD'){ if(stage + 1 > hardReach(region)) return false; G.repeating = stage + 1 < hardReach(region) || G.hardCleared[region] >= 10; }
  else { if(num > frontier()) return false; G.repeating = num < frontier(); }
  G.region = region; G.stage = stage; G.diff = diff;
  startStage();
  return true;
}
function spawnWave(){
  clearEnemies();
  const st = curStage(); if(!st.monsters.length) return;
  const count = Math.min(Math.max(1, Math.min(3, st.minPerWave + Math.floor(Math.random() * (st.maxPerWave - st.minPerWave + 1)))), st.kills - B.kills);
  for(let i = 0; i < count; i++) addEnemy(pickRandom(st.monsters), enemyPos(i, L.monSize), L.monSize, i);
  B.waveTimer = R.waveDelay; B.waveRested = false; setWalking(false);
}
function spawnBoss(){
  clearEnemies();
  B.bossSpawned = true;
  const boss = curStage().boss;
  addEnemy(boss, enemyPos(0, L.bossSize), L.bossSize, 0);
  B.waveRested = false; setWalking(false);
  banner(`보스 등장! ${UD.monsters[boss.monster].name}`, 1.5);
  battleSfx('S36');
  hud();
}
function addEnemy(spawn, x, size, index){
  const u = makeMonster(spawn, G.diff === 'HARD');
  u.slot = B.enemies.length;
  const els = regionOf(G.region).elements;
  u.element = u.monster.element || (els.length ? els[Math.floor(Math.random() * els.length)] : 0);
  u.hp = u.maxHp; u.size = size;
  createView(u, L.offRight + index * L.enemySpacing);
  u.view.moveFrom = L.offRight + index * L.enemySpacing; u.view.moveTo = x; u.view.moveT = 0; u.view.moveDur = R.walkIn;
  resetForStage(u);
  u.spawnDelay = R.walkIn;
  B.enemies.push(u);
}
function clearEnemies(){ B.enemies.forEach(u => u.view && u.view.el.remove()); B.enemies = []; }

function onUnitDied(u){
  if(u.team !== 'enemy') return;
  battleSfx('S35', u.isBoss ? 1 : .7);
  if(u.isBoss) B.bossDefeated = true; else B.kills++;
  const rw = rewardsOf(G.region, G.stage, G.diff), at = viewTop(u, 30);
  if(u.isBoss){ drop('gold', rw.bossGold, at, 0); drop('shard', rw.bossManaShard, at, 1); drop('stone', rw.bossGem, at, 2); }
  else { drop('gold', rw.goldPerKill, at, 0); if(Math.random() < rw.manaShardDropChance) drop('shard', rw.manaShardPerKill, at, 1); }
  giveExp(u.isBoss ? rw.bossExp : rw.expPerKill);
  hud();
}
const CUR_COL = {gold: '#ffd940', shard: '#c08cff', stone: '#73f2ff'};
function drop(k, n, at, line){
  if(!(n > 0)) return;
  S.cur[k] += n;
  if(at) floatText({x: at.x, y: at.y - 40 - line * 34}, `+${fmt(n)} ${curName[k]}`, CUR_COL[k], 26);
}
function giveExp(amount){
  if(!(amount > 0)) return;
  B.party.forEach(u => {
    const a = u.adv; if(!a || a.lv >= LV_MAX) return;
    a.exp = (a.exp || 0) + (isDead(u) ? Math.max(1, Math.round(amount * R.deadExpRate)) : amount);
    let up = 0;
    while(a.lv < LV_MAX && a.exp >= expNeed(a.lv)){ a.exp -= expNeed(a.lv); a.lv++; up++; }
    if(a.lv >= LV_MAX) a.exp = 0;
    if(up && u.view){
      battleSfx('S38'); nameText(u);
      floatText(viewTop(u, 110), `LEVEL UP! Lv.${a.lv}`, '#8cff8c', 32);
      ring(viewCenter(u), u.view.w * 2, [.55, 1, .55], .6);
    }
  });
}
function grantFirstClear(){
  if(G.diff === 'HARD'){
    if(G.stage + 1 <= G.hardCleared[G.region]) return false;
    G.hardCleared[G.region] = G.stage + 1;
  } else {
    const num = numberOf(G.region, G.stage);
    if(num <= G.maxCleared) return false;
    G.maxCleared = num;
  }
  const rw = rewardsOf(G.region, G.stage, G.diff);
  S.cur.gold += rw.firstClearGold; S.cur.shard += rw.firstClearManaShard; S.cur.stone += rw.firstClearGem;
  floatText({x: 960, y: B.groundY - 420}, `골드 +${rw.firstClearGold}   마력 파편 +${rw.firstClearManaShard}   보석 +${rw.firstClearGem}`, '#ffeb73', 34);
  return true;
}
function battleTick(dt){
  if(B.state === 'wait'){
    B.wait -= dt;
    if(B.wait <= 0){ B.state = 'fight'; const a = B.after; B.after = null; a && a(); }
    return;
  }
  B.party.forEach(u => tickUnit(u, dt));
  B.enemies.forEach(u => tickUnit(u, dt));
  if(B.party.every(isDead)){
    setWalking(false);
    banner('전멸! 다시 도전합니다', R.wipeDelay);
    wait(R.wipeDelay, startStage);
    return;
  }
  if(B.enemies.every(isDead)){
    if(!B.waveRested){
      B.waveRested = true;
      if(B.enemies.length) B.party.forEach(u => { if(!isDead(u)) heal(u, u.maxHp * R.waveRestHeal, false); });
    }
    setWalking(true);
    const st = curStage();
    if(B.kills >= st.kills){
      if(st.boss && !B.bossDefeated){
        if(!B.bossSpawned){ B.waveTimer -= dt; if(B.waveTimer <= 0) spawnBoss(); }
      } else {
        const first = grantFirstClear();
        if(G.diff === 'EASY') G.lastCleared = numberOf(G.region, G.stage);
        const last = G.region === UD.regions.length - 1 && G.stage === regionOf(G.region).stages.length - 1;
        if(G.diff === 'EASY'){ deliver(`${G.region + 1}-${G.stage + 1}`); if(last) deliver('e'); }
        battleSfx('J1', .8);
        banner(first ? `${G.region + 1}-${G.stage + 1} 최초 클리어! 보상 획득` : `${G.region + 1}-${G.stage + 1} 클리어!`, R.clearDelay);
        save();
        wait(R.clearDelay, nextStage);
      }
    } else {
      B.waveTimer -= dt;
      if(B.waveTimer <= 0) spawnWave();
    }
  }
}
function wait(sec, then){ B.state = 'wait'; B.wait = sec; B.after = then; }

/* ---------- 전투 화면 (BattleUnitView) ---------- */
function applyGround(){
  const key = STAGE_BG[G.region], img = new Image(), line = regionOf(G.region).groundLine;
  const set = () => {
    const w = img.naturalWidth || 1920, h = img.naturalHeight || 1080, sc = Math.max(1920 / w, 1080 / h);
    B.groundY = Math.round(1080 - line * h * sc);
    B.tile = {src: A[key], w: Math.ceil(w * sc), h: Math.ceil(h * sc)};
    buildTrack();
  };
  img.onload = set; img.src = A[key]; if(img.complete) set();
}
/* ---------- 횡스크롤 배경 (Unity GroundScroller: 걷는 동안 1초에 160px) ----------
   배경 한 장을 정방향 · 좌우반전 번갈아 이어 붙여서 이음새 없이 왼쪽으로 흘려요 */
const SCROLL_SPEED = 160;
function buildTrack(){
  const track = document.querySelector('#game .bbg-track');
  B.track = track;
  if(!track || !B.tile) return;
  const t = B.tile;
  if(track.dataset.src === t.src) return;
  track.dataset.src = t.src;
  track.innerHTML = [0, 1, 2, 3].map(i => `<i class="${i % 2 ? 'mir' : ''}" style="width:${t.w}px;height:${t.h}px;background-image:url(${t.src})"></i>`).join('');
  scrollTick(0);
}
function scrollTick(dx){
  B.scrollX = (B.scrollX || 0) + dx;
  if(!B.track || !B.tile) return;
  const loop = B.tile.w * 2, x = B.scrollX % loop;
  B.track.style.transform = `translateX(${-x - (B.tile.w - 1920) / 2}px)`;
}
function createView(u, x){
  const el = document.createElement('div');
  el.className = 'bu ' + u.team + (u.isBoss ? ' boss' : '');
  let w, h, body;
  if(u.team === 'party'){
    h = L.charH; w = Math.round(h * 300 / 510);
    body = `<img class="bu-fig" src="${figFor(u.adv.model, u.adv.g, false)}" alt="">`;
  } else {
    const an = UD.anims[u.monster.anim], sc = u.size / L.artRef;
    w = Math.round(u.size * .9); h = Math.round(an.bodyHeight * sc);
    body = `<div class="bu-sheet" style="width:${an.cell[0] * sc}px;height:${an.cell[1] * sc}px;left:calc(50% - ${an.pivot[0] * sc}px);top:calc(100% - ${an.pivot[1] * sc}px)"></div>`;
  }
  const hpw = Math.max(110, Math.round(w * .95));
  el.innerHTML = `<div class="bu-body" style="width:${w}px;height:${h}px">${body}<span class="bu-summon" hidden>✦</span></div>
    <div class="bu-top" style="bottom:${h + 10}px"><span class="bu-st"></span><span class="bu-hpwrap">${u.element ? attrDot(EL_NAME[u.element], 34) : ''}<span class="bu-hp" style="width:${hpw}px"><i></i></span></span></div>
    <div class="bu-name"></div>`;
  u.view = {el, x, w, h, body: el.querySelector('.bu-body'), sheet: el.querySelector('.bu-sheet'), hpFill: el.querySelector('.bu-hp i'),
    st: el.querySelector('.bu-st'), nm: el.querySelector('.bu-name'), summon: el.querySelector('.bu-summon'),
    walking: false, phase: Math.random() * 6, lungeT: -1, lungeDir: 1, flashT: 0, dead: false, fade: -1,
    anim: u.monster ? UD.anims[u.monster.anim] : null, motion: null, key: 0, keyT: 0, moveT: -1};
  if(u.view.anim){ const sc = u.size / L.artRef; u.view.sc = sc; play(u, 'walk'); }
  nameText(u); viewHp(u);
  B.field.appendChild(el);
}
function play(u, name){
  const v = u.view, m = v.anim[name];
  if(!m || !m.sheet){ if(name !== 'walk') play(u, 'walk'); return; }
  v.motion = name; v.key = 0; v.keyT = 0;
  const rows = Math.ceil(m.keyposes / m.cols);
  v.sheet.style.backgroundImage = `url(${m.sheet})`;
  v.sheet.style.backgroundSize = `${m.cols * v.anim.cell[0] * v.sc}px ${rows * v.anim.cell[1] * v.sc}px`;
  setFrame(u);
}
function setFrame(u){
  const v = u.view, m = v.anim[v.motion], c = v.key % m.cols, r = Math.floor(v.key / m.cols);
  v.sheet.style.backgroundPosition = `${-c * v.anim.cell[0] * v.sc}px ${-r * v.anim.cell[1] * v.sc}px`;
}
function nameText(u){
  if(!u.view) return;
  u.view.nm.innerHTML = u.adv ? `<small>Lv.${u.adv.lv}</small>${esc(u.adv.name)}` : esc(u.name);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
function viewHp(u){ if(u.view){ const r = Math.max(0, Math.min(1, u.hp / u.maxHp)); u.view.hpFill.style.width = r * 100 + '%'; } }
function viewFlash(u){ if(u.view) u.view.flashT = .08; }
function viewLunge(u, t){
  const v = u.view; if(!v || v.dead) return;
  if(v.anim) play(u, 'attack');
  v.lungeT = 0; v.lungeDir = Math.sign(t.view.x - v.x) || 1;
}
function viewDead(u){
  const v = u.view; if(!v) return;
  v.walking = false; v.lungeT = -1; v.dead = true;
  if(v.anim){ play(u, 'death'); const d = v.anim.death.holds.reduce((s, h) => s + Math.max(1, h), 0) / v.anim.fps; v.fade = d + .25; }
  else if(u.team === 'enemy') v.fade = 0;
  else v.el.classList.add('down');
}
function viewAlive(u){
  const v = u.view; if(!v) return;
  v.dead = false; v.fade = -1; v.el.classList.remove('down'); v.el.style.opacity = ''; v.el.hidden = false;
  if(v.anim) play(u, 'walk');
}
function statusText(u){
  if(!u.view) return;
  const L2 = {Stun: '기절', Mark: '표식', RuneMark: '룬', Invulnerable: '무적', DamageReduction: '피해감소', CritBuff: '치명↑', ElementBoost: '속성↑', HealOverTime: '회복'};
  u.view.st.textContent = u.statuses.map(s => s.kind === 'StatBuff' ? (['공↑', '방↑', '공속↑', '강화'][s.stat] || '강화') : L2[s.kind] || '').filter(Boolean).join(' ');
  u.view.summon.hidden = !has(u, 'Summon');
  u.view.el.classList.toggle('ghost', has(u, 'Invulnerable') && u.team === 'party');
}
const viewTop = (u, up = 0) => u.view ? {x: u.view.x, y: B.groundY - u.view.h - up} : null;
const viewCenter = u => ({x: u.view.x, y: B.groundY - u.view.h / 2});
function viewTick(u, dt){
  const v = u.view; if(!v) return;
  if(v.moveT >= 0){ v.moveT += dt; const k = Math.min(1, v.moveT / v.moveDur); v.x = v.moveFrom + (v.moveTo - v.moveFrom) * k; if(k >= 1) v.moveT = -1; }
  let ox = 0, oy = 0;
  if(v.lungeT >= 0){
    v.lungeT += dt; const t = v.lungeT, d = 50 * v.lungeDir;
    ox = t < .07 ? d * t / .07 : t < .19 ? d * (1 - (t - .07) / .12) : 0;
    if(t >= .19) v.lungeT = -1;
  } else if(!v.anim && (v.walking || v.moveT >= 0) && !v.dead){
    v.phase += dt * 11; oy = -Math.abs(Math.sin(v.phase)) * 12;
  }
  if(v.anim && v.motion){
    const m = v.anim[v.motion], frames = m.keyposes;
    v.keyT += dt * (v.motion === 'walk' && !v.walking && v.moveT < 0 ? .6 : 1);
    const dur = k => Math.max(1, m.holds[k] || 1) / v.anim.fps;
    while(v.keyT >= dur(v.key)){
      v.keyT -= dur(v.key);
      if(v.key + 1 < frames) v.key++;
      else if(m.loop) v.key = 0;
      else if(v.motion === 'death'){ v.keyT = 0; break; }
      else { play(u, 'walk'); break; }
    }
    if(v.motion) setFrame(u);
  }
  if(v.fade >= 0){
    v.fade -= dt;
    if(v.fade < .35) v.el.style.opacity = Math.max(0, v.fade / .35);
    if(v.fade <= 0){ v.el.hidden = true; v.fade = -1; }
  }
  if(v.flashT > 0){ v.flashT -= dt; v.body.classList.toggle('flash', v.flashT > 0); }
  v.el.style.transform = `translate(${v.x}px,${B.groundY}px)`;
  v.body.style.transform = `translate(${ox}px,${oy}px)`;
}
function floatText(at, text, color, size){
  if(!at || !B.fx) return;
  const d = document.createElement('div');
  d.className = 'bfx-txt'; d.textContent = text;
  d.style.cssText = `left:${at.x}px;top:${at.y}px;color:${color};font-size:${size}px`;
  B.fx.appendChild(d); setTimeout(() => d.remove(), 1000);
}
const popup = (u, text, color, size) => u.view && floatText(viewTop(u, 30), text, color, size);
function ring(at, size, col, life = .35){
  if(!B.fx) return;
  const d = document.createElement('div'), c = `rgb(${col.map(x => Math.round(x * 255)).join(',')})`;
  d.className = 'bfx-ring';
  d.style.cssText = `left:${at.x}px;top:${at.y}px;width:${size}px;height:${size}px;--c:${c};animation-duration:${life}s`;
  B.fx.appendChild(d); setTimeout(() => d.remove(), life * 1000 + 50);
}
function skillFx(c, sk, e, ts){
  if(!ts.length) return;
  if(e.target === 2 || e.target === 4){
    const pts = ts.filter(t => t.view).map(viewCenter);
    if(pts.length) ring({x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length}, 560, sk.color, .45);
  } else ts.forEach(t => t.view && ring(viewCenter(t), t.view.w * 1.8, sk.color));
  if((e.target === 1 || e.target === 2) && ts[0].view && c.view) viewLunge(c, ts[0]);
}
function banner(text, sec){
  B.bannerT = sec;
  if(B.bannerEl){ B.bannerEl.textContent = text; B.bannerEl.hidden = false; }
}
function hud(){
  if(!B.hudEl) return;
  const st = curStage();
  const txt = B.bossSpawned && !B.bossDefeated ? `보스 · ${UD.monsters[st.boss.monster].name}`
    : `처치 ${Math.min(B.kills, st.kills)} / ${st.kills}` + (st.boss ? ' · 이후 보스' : '');
  const w = B.bossSpawned ? 100 : Math.round(Math.min(B.kills, st.kills) / st.kills * 100);
  B.hudEl.innerHTML = `<span>${txt}</span><i style="--w:${w}%"></i>`;
}

/* 전투 층: 로비를 다시 그려도 같은 요소를 다시 끼움 */
function buildLayer(){
  const el = document.createElement('div');
  el.className = 'battle-layer';
  el.innerHTML = '<div class="bfield"></div><div class="bfx"></div><div class="ribbon bbanner" hidden></div>';
  B.layer = el; B.field = el.querySelector('.bfield'); B.fx = el.querySelector('.bfx'); B.bannerEl = el.querySelector('.bbanner');
}

/* ---------- 매 프레임 ---------- */
let lastT = performance.now(), saveT = 0, uiT = 0;
function frame(now){
  const dt = Math.min(.1, (now - lastT) / 1000); lastT = now;
  const paused = (typeof IN !== 'undefined' && IN.open) || (S.popup && S.popup.kind === 'quitdone');
  if(!paused){
    battleTick(dt * G.speed);
    if(B.walking) scrollTick(SCROLL_SPEED * dt * G.speed);
    if(B.bannerT > 0){ B.bannerT -= dt; if(B.bannerT <= 0 && B.bannerEl) B.bannerEl.hidden = true; }
  }
  [...B.party, ...B.enemies].forEach(u => viewTick(u, paused ? 0 : dt));
  uiT += dt; saveT += dt;
  if(uiT > .25){ uiT = 0; liveCurrency(); }
  if(saveT > 10){ saveT = 0; if(!paused) save(); }
  requestAnimationFrame(frame);
}
/* 재화 표시만 제자리에서 갱신 (화면 전체를 다시 그리지 않음) */
function liveCurrency(){
  const keys = ['gold', 'stone', 'shard'];
  document.querySelectorAll('#game .curbar .cur').forEach((el, i) => { const t = el.lastChild; if(t && t.nodeType === 3) t.nodeValue = fmt(S.cur[keys[i]]); });
  document.querySelectorAll('#game .mini-cur span').forEach((el, i) => { const t = el.lastChild; if(t && t.nodeType === 3) t.nodeValue = fmt(S.cur[keys[i]]); });
  const gg = document.querySelector('#game .ggem b'); if(gg) gg.textContent = fmt(S.cur.stone);
}

/* =====================================================================
   시안 화면 덮어쓰기
   ===================================================================== */
const _attrDot = attrDot;
attrDot = (a, size = 40) => a ? _attrDot(a, size) : `<span class="attr noattr" style="width:${size}px;height:${size}px;font-size:${size * .45}px" title="속성 없음">-</span>`;

renderLobby = function(){
  const unread = S.mails.filter(m => !m.done).length;
  const b = S.battle, st = stageOf(b.stage);
  return `
  <div class="bbg-scroll"><div class="bbg-track"></div></div>
  ${b.diff === 'HARD' ? '<div class="bbg-tint hard"></div>' : '<div class="bbg-tint easy"></div>'}
  <div id="battle-slot"></div>
  <div class="battle-tag" style="--tone:${st.tone}"><b>${st.no}-${b.round}</b> ${st.name} <span class="diff ${b.diff}">${b.diff}</span>${G.repeating ? '<span class="diff rep">반복</span>' : ''}</div>
  <div class="bhud"></div>
  <button class="gearbtn" data-act="sndOpen" aria-label="설정 · 사운드">${GEAR_SVG}</button>
  <button class="spdbtn" data-act="speed" aria-label="전투 속도">×${G.speed}</button>
  <div class="curbar">${['gold','stone','shard'].map(k => `<div class="cur ${k}"><img src="${curIcon[k]}" alt="${curName[k]}">${fmt(S.cur[k])}</div>`).join('')}</div>
  <div class="menu left">
    ${[['recruit','recruit'],['create','create'],['party','party'],['codex','codex'],['story','story']].map(([go, ic]) => `<button class="mbtn" data-go="${go}" aria-label="${SCREENS[go]}"><img src="${A[ic]}" alt="">${go === 'recruit' && S.free10 ? '<span class="badge">무료</span>' : ''}</button>`).join('')}
  </div>
  <div class="menu right">
    <button class="mbtn" data-go="mail" aria-label="우편함"><img src="${A.mail}" alt="">${unread ? `<span class="badge">${unread}</span>` : ''}</button>
    <button class="mbtn" data-go="inven" aria-label="인벤토리"><img src="${A.inven}" alt=""></button>
    <button class="mbtn" data-go="enhance" aria-label="강화"><img src="${A.enhance}" alt=""></button>
  </div>
  <div class="menu right" style="top:auto;bottom:40px"><button class="mbtn" data-go="stage" aria-label="균열"><img src="${A.rift}" alt=""></button></div>
  ${!S.offline.shown ? offlinePopup() : ''}`;
};
const _render = render;
render = function(){
  syncDerived();
  _render();
  if(S.screen === 'lobby'){
    const slot = document.getElementById('battle-slot');
    if(slot){ slot.replaceWith(B.layer); B.hudEl = document.querySelector('#game .bhud'); hud(); }
    buildTrack();
  }
};
const _go = go;
go = function(s){ if(s === 'stage' && S.screen !== 'stage') S.stageView = {stage: G.region + 1, diff: G.diff}; _go(s); };
/* 보스와 싸우는 동안 보스곡, 아니면 지역곡 (Unity: 보스 등장 시 보스 BGM) */
const _bgmKeyFor = bgmKeyFor;
bgmKeyFor = function(){
  const k = _bgmKeyFor();
  if(!k || (typeof IN !== 'undefined' && IN.open) || SCREEN_BGM[S.screen] || S.screen === 'stage') return k;
  if(B.bossSpawned && !B.bossDefeated) return 'b' + (G.region * 2 + (G.stage === 4 ? 1 : 2));
  return ['field', 'snow', 'ruin'][G.region];
};
/* 모집 (AdventurerRecruit): 무료 10회는 다시 돌리면 이전 무료 결과를 회수 */
pull = function(n){
  const t = S.gTab, free = S.free10 && n === 10, cost = free ? 0 : n * PULL_GEM;
  if(S.cur.stone < cost){ S.popup = {kind: 'lack', need: {stone: cost}, sub: '모험가 모집에 필요한 보석이 모자라요'}; return; }
  if(free) G.freeLast.forEach(([cat, name]) => { const it = S.inv.find(x => x.cat === cat && x.name === name); if(it && --it.count <= 0) S.inv.splice(S.inv.indexOf(it), 1); });
  S.cur.stone -= cost;
  const list = [];
  for(let i = 0; i < n; i++){
    const name = POOL[t][Math.floor(Math.random() * POOL[t].length)];
    let it = S.inv.find(x => x.cat === t && x.name === name);
    const dup = !!it;
    if(it) it.count++; else S.inv.push(it = {cat: t, name, count: 1});
    list.push({name, dup, count: it.count});
  }
  if(free) G.freeLast = list.map(x => [t, x.name]);
  S.sel.gResult = {tab: t, list, open: false, free};
  save();
};

/* ---------- 클릭 가로채기 (시안 동작 앞/뒤에 게임 규칙) ---------- */
function stop(e){ e.stopImmediatePropagation(); e.preventDefault(); }
document.addEventListener('click', e => {
  const el = e.target.closest('button,[data-pslot],[data-act],[data-go]'); if(!el || el.disabled) return;
  const d = el.dataset;
  // 균열: 라운드 고르기 → 그 라운드로 전투 (이미 깬 라운드면 반복 사냥)
  if(d.round){
    stop(e);
    const v = S.stageView, r = +d.round;
    if(!selectStage(v.stage - 1, r - 1, v.diff)){ toast('아직 해금되지 않은 라운드입니다'); return; }
    go('lobby'); toast(`${stageOf(v.stage).name} ${v.stage}-${r} · ${v.diff} 전투 시작${G.repeating ? ' (반복)' : ''}`); return;
  }
  switch(d.act){
    case 'speed': stop(e); G.speed = G.speed === 1 ? 2 : G.speed === 2 ? 4 : 1; render(); return;
    case 'saveParty': {
      const p = S.parties[S.pIdx];
      if(!p.m.some(Boolean)){ stop(e); toast('파티에는 최소 1명이 있어야 해요'); return; }
      after(() => { if(S.pIdx === S.pActive){ buildParty(); startStage(); } }); return;
    }
    case 'partyUse': {
      const p = S.parties[S.pIdx];
      if(!p.saved.some(Boolean)){ stop(e); toast('저장된 편성이 비어 있어요 · 먼저 편성 저장'); return; }
      after(() => { buildParty(); startStage(); }); return;
    }
    case 'deleteOk': {
      const a = advById(S.sel.advId) || S.adv[0], p = S.parties[S.pActive];
      if(a && p.saved.includes(a.id) && p.saved.filter(Boolean).length <= 1){ stop(e); S.sel.codexModal = null; render(); toast('출전 파티의 마지막 1명은 삭제할 수 없어요'); return; }
      if(S.adv.length <= 1){ stop(e); S.sel.codexModal = null; render(); toast('마지막 모험가는 삭제할 수 없어요'); return; }
      after(() => { buildParty(); startStage(); }); return;
    }
    case 'saveAdv': after(() => { G.createdAny = true; G.freeLast = []; save(); }); return;
    case 'skillUp': case 'statApply': case 'statResetOk': case 'renameOk':
      after(() => { B.party.forEach(u => { refreshFromProgress(u); viewHp(u); nameText(u); }); }); return;
    case 'offlineOk': after(() => {}); return;
    case 'quitOk': save(); return;
    case 'quitRestart': stop(e); calcOffline(); S.popup = null; go('lobby'); return;
    case 'resetGame': stop(e); S.popup = {kind: 'resetAsk'}; render(); return;
    case 'resetOk': stop(e); try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem('ah_intro_done'); } catch(_){} location.reload(); return;
  }
  if(d.act && /^(checkNotice|checkAll|takeStory|readStory|pull|closeResult)$/.test(d.act)) after(() => {});
}, true);
function after(fn){ setTimeout(() => { fn(); save(); }, 0); }

/* 설정 팝업에 '처음부터 다시' 추가 */
const _globalPopup = globalPopup;
globalPopup = function(){
  const p = S.popup;
  if(p && p.kind === 'resetAsk') return popShell({title: '처음부터 다시', sub: '이 브라우저에 저장된 진행을 지워요', icon: '!',
    body: `<b style="font-size:30px">모든 진행을 지우고 1-1부터 시작할까요?</b><span class="mutet" style="font-size:20px">재화 · 모험가 · 인벤토리 · 우편 · 스토리 기록이 모두 사라져요</span>`,
    note: '되돌릴 수 없어요 · 버튼을 1초 누르면 실행', btns: `<button class="btn ghost" data-act="sndOpen">취소</button>${holdBtn('resetOk', '초기화')}`});
  let html = _globalPopup();
  if(p && p.kind === 'sound') html = html.replace('<button class="btn quitbtn" data-act="quitAsk">', '<button class="btn ghost" data-act="resetGame" style="margin-right:12px">처음부터 다시</button><button class="btn quitbtn" data-act="quitAsk">');
  return html;
};

/* ---------- 저장 시점 ---------- */
window.addEventListener('beforeunload', save);
document.addEventListener('visibilitychange', () => { if(document.hidden) save(); });

/* =====================================================================
   부팅
   ===================================================================== */
/* 시연용: 사이트에 들어올 때마다 처음부터 (오프닝 만화 → 로비 + 오프라인 보상 팝업).
   false 로 바꾸면 저장된 진행을 이어서 하고, 오프닝은 처음 한 번만 나와요. */
const FRESH_EACH_VISIT = true;
/* 시연용 오프라인 보상 기준: 1-1 들판에서 최대 8시간 (Unity 규칙 그대로 계산) */
const DEMO_OFFLINE = {basis: 1, hours: 8};
function boot(){
  if(FRESH_EACH_VISIT){ try { localStorage.removeItem(SAVE_KEY); } catch(e){} }
  const loaded = !FRESH_EACH_VISIT && load();
  if(!loaded) newGame();
  S.screen = 'lobby'; S.gTab = 'model'; S.sel = {}; S.popup = null;
  /* 저장이 깨졌을 때 안전장치 */
  if(!S.parties || !S.parties.length){ S.parties = [{name: '파티 1', m: [null, null, null, null], saved: [null, null, null, null]}]; S.pIdx = S.pActive = 0; }
  G.region = Math.max(0, Math.min(UD.regions.length - 1, G.region | 0));
  G.stage = Math.max(0, Math.min(9, G.stage | 0));
  S.stageView = {stage: G.region + 1, diff: G.diff};
  if(FRESH_EACH_VISIT) calcOffline(DEMO_OFFLINE.basis, DEMO_OFFLINE.hours * 3600); else calcOffline();
  buildLayer();
  buildParty();
  startStage();
  render(); fit();
  requestAnimationFrame(t => { lastT = t; requestAnimationFrame(frame); });
  let introSeen = false;
  if(!FRESH_EACH_VISIT){ try { introSeen = localStorage.getItem('ah_intro_done') === '1'; } catch(e){} }
  if(!introSeen){
    /* 만화가 끝나면 로비 → 오프라인 보상 팝업부터 */
    const op = () => introOpen('pro', () => { go('lobby'); });
    if(document.readyState === 'complete') op(); else window.addEventListener('load', op, {once: true});
  }
}
window.AH = {G, B, S, save, selectStage};   // 콘솔 디버그용
boot();
})();
