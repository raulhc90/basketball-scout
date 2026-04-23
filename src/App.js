import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import { supabase, signIn, signUp, signOut, onAuthChange, fetchGames, upsertGame, deleteGame } from './supabase';

const BASE_QUARTERS = ['1Q', '2Q', '3Q', '4Q'];
const getQuarterLabel = (q) => q < 4 ? BASE_QUARTERS[q] : `OT${q - 3}`;
const QUARTERS = BASE_QUARTERS;
const STORAGE_KEY = 'bball_scout_games';
const FOUL_DISQUALIFY = 4;   // 4 faltas = eliminação
const FOUL_TROUBLE    = 3;   // aviso na 3ª falta
const TEAM_FOUL_BONUS = 5;
const TECH_DISQUALIFY = 2;

const INITIAL_PLAYER = () => ({
  pts: 0, ast: 0, reb: 0, oreb: 0, stl: 0, blk: 0, to: 0,
  fg2a: 0, fg2m: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0,
  fouls: 0, techFouls: 0, foulsReceived: 0,
  plusMinus: 0,
  timeOnCourt: 0,
  entryTime: null,
  shots: [],
  possessions: 0
});

const calcPIR = p =>
  p.pts + (p.reb + p.oreb) + p.ast + p.stl + p.blk
  + (p.fg2m + p.fg3m - p.fg2a - p.fg3a)
  + (p.ftm - p.fta)
  - p.to - p.fouls;

const DEFAULT_TEAM_A = [
  {number:'04',name:'A. Silva'},{number:'07',name:'B. Costa'},{number:'10',name:'C. Lima'},
  {number:'11',name:'D. Rocha'},{number:'23',name:'E. Mendes'},{number:'06',name:'F. Santos'},
  {number:'08',name:'G. Alves'},{number:'09',name:'H. Nunes'},{number:'12',name:'I. Pires'},
  {number:'14',name:'J. Ferreira'},{number:'15',name:'K. Braga'},{number:'21',name:'L. Moura'},
  {number:'00',name:'M. Jogador'},{number:'02',name:'N. Jogador'},{number:'03',name:'O. Jogador'},
];
const DEFAULT_TEAM_B = [
  {number:'05',name:'M. Ribeiro'},{number:'08',name:'N. Cardoso'},{number:'13',name:'O. Dias'},
  {number:'17',name:'P. Carvalho'},{number:'22',name:'Q. Monteiro'},{number:'03',name:'R. Teixeira'},
  {number:'06',name:'S. Figueira'},{number:'09',name:'T. Brito'},{number:'16',name:'U. Correia'},
  {number:'18',name:'V. Barbosa'},{number:'20',name:'W. Cunha'},{number:'25',name:'X. Lopes'},
  {number:'01',name:'Y. Jogador'},{number:'07',name:'Z. Jogador'},{number:'11',name:'AA. Jogador'},
];

const mkTeam = (name, roster) => ({
  name, score: 0,
  players: roster.map((p, i) => ({ id: i+1, ...p, active: i < 5, ...INITIAL_PLAYER() }))
});

const newGame = (nameA='Time A', nameB='Time B', rosterA=DEFAULT_TEAM_A, rosterB=DEFAULT_TEAM_B) => ({
  id: Date.now(),
  date: new Date().toLocaleDateString('pt-BR'),
  dateFull: new Date().toISOString(),
  teams: [mkTeam(nameA, rosterA), mkTeam(nameB, rosterB)],
  quarter: 0, clock: 600, log: [], finished: false,
  teamFouls: [[0,0,0,0,0],[0,0,0,0,0]],
  possessions: [0, 0],
});

const MISC_ACTIONS = [
  { id:'reb',          label:'Rebote',        pts:0, color:'#06b6d4' },
  { id:'oreb',         label:'Reb.Of.',       pts:0, color:'#0891b2' },
  { id:'stl',          label:'Roubo',         pts:0, color:'#10b981' },
  { id:'blk',          label:'Toco',          pts:0, color:'#8b5cf6' },
  { id:'to',           label:'Turnov.',       pts:0, color:'#ef4444' },
  { id:'fouls',        label:'Falta',         pts:0, color:'#f97316' },
  { id:'foulsReceived',label:'Falta Sofrida', pts:0, color:'#c084fc' },
];

const fmtTime = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
const pct = (m,a) => { if (!a || a===0) return ''; return `${Math.round(m/a*100)}%`; };
const totals = team => team.players.reduce((acc, p) => {
  ['pts','ast','reb','oreb','stl','blk','to','fg2m','fg2a','fg3m','fg3a','ftm','fta','fouls','foulsReceived','possessions']
    .forEach(k => acc[k] = (acc[k]||0) + (p[k]||0));
  return acc;
}, {});

// localStorage como fallback offline
function loadGamesLocal() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } }
function saveGamesLocal(g) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(g)); } catch {} }

function dl(content, filename) {
  const b = new Blob(['\ufeff'+content], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = filename; a.click();
}

function exportStatsCSV(game) {
  const d = game.gameDate || game.date || '';
  const matchup = `${game.teams[0].name} vs ${game.teams[1].name}`;
  const lines = [`Data,Jogo,Numero,Atleta,Time,MIN,PTS,AST,REB,REB.OF,STL,BLK,TO,FG2M,FG2A,FG%,FG3M,FG3A,3P%,FTM,FTA,LL%,FALTAS,FALTAS.SOF,+/-,PIR,POSSES.ATL`];
  game.teams.forEach((t, ti) => {
    t.players.forEach(p => {
      const pm = (p.plusMinus||0) >= 0 ? `+${p.plusMinus||0}` : `${p.plusMinus||0}`;
      const min = `${Math.floor((p.timeOnCourt||0)/60)}:${String(Math.round((p.timeOnCourt||0)%60)).padStart(2,'0')}`;
      lines.push(`"${d}","${matchup}","${p.number}","${p.name}","${t.name}",${min},${p.pts},${p.ast},${p.reb},${p.oreb},${p.stl},${p.blk},${p.to},${p.fg2m},${p.fg2a},${pct(p.fg2m+p.fg3m,p.fg2a+p.fg3a)},${p.fg3m},${p.fg3a},${pct(p.fg3m,p.fg3a)},${p.ftm},${p.fta},${pct(p.ftm,p.fta)},${p.fouls},${p.foulsReceived||0},${pm},${calcPIR(p)},${p.possessions||0}`);
    });
    const tot = totals(t);
    const teamPoss = (game.possessions||[0,0])[ti]||0;
    lines.push(`"${d}","${matchup}","","TOTAL","${t.name}",,${tot.pts},${tot.ast},${tot.reb},${tot.oreb},${tot.stl},${tot.blk},${tot.to},${tot.fg2m},${tot.fg2a},${pct(tot.fg2m+tot.fg3m,tot.fg2a+tot.fg3a)},${tot.fg3m},${tot.fg3a},${pct(tot.fg3m,tot.fg3a)},${tot.ftm},${tot.fta},${pct(tot.ftm,tot.fta)},${tot.fouls},,,,${teamPoss}`);
  });
  dl(lines.join('\n'), `stats_${game.teams[0].name}_vs_${game.teams[1].name}_${game.date.replace(/\//g,'-')}.csv`);
}

function exportLogCSV(game) {
  const d = game.gameDate || game.date || '';
  const matchup = `${game.teams[0].name} vs ${game.teams[1].name}`;
  const lines = ['Data,Jogo,Quarto,Tempo,Time,Numero,Atleta,Acao,Pontos'];
  game.log.forEach(e => {
    // Separa "#07 Costa" em numero="07" e nome="Costa"
    const playerParts = (e.player||'').match(/^#?([\w]+)\s+(.+)$/);
    const pNum  = playerParts ? playerParts[1] : '';
    const pName = playerParts ? playerParts[2] : (e.player||'');
    lines.push(`"${d}","${matchup}","${e.q}","${e.time}","${e.team}","${pNum}","${pName}","${e.action}",${e.pts}`);
  });
  dl(lines.join('\n'), `log_${game.teams[0].name}_vs_${game.teams[1].name}_${game.date.replace(/\//g,'-')}.csv`);
}

function exportShotsCSV(game) {
  const d = game.gameDate || game.date || '';
  const matchup = `${game.teams[0].name} vs ${game.teams[1].name}`;
  const lines = ['Data,Jogo,Numero,Atleta,Time,Quarto,Tempo,X_pct,Y_pct,Convertido,Zona,Subtipo,Assistencia'];
  game.teams.forEach(t => t.players.forEach(p =>
    (p.shots||[]).forEach(s => {
      const subtipo = s.three ? 'Arremesso' : (s.shotType && s.shotType !== '3pts' ? s.shotType : 'Arremesso');
      lines.push(`"${d}","${matchup}","${p.number}","${p.name}","${t.name}","${s.q||''}","${s.time||''}",${s.x.toFixed(2)},${s.y.toFixed(2)},${s.made?'Sim':'Não'},${s.three?'3pts':'2pts'},"${subtipo}","${s.assistedBy||''}"`);
    })));
  dl(lines.join('\n'), `arremessos_${game.teams[0].name}_vs_${game.teams[1].name}_${game.date.replace(/\//g,'-')}.csv`);
}

// ─── classifyShot ─────────────────────────────────────────────────────────────
// Retorna direção de ataque considerando troca de lado no intervalo (Q2+)
function getAttackDir(teamIdx, quarter) {
  // Times trocam de lado a partir do 3Q (quarter index 2)
  // Time 0: Q0,Q1 → right; Q2+ → left
  // Time 1: Q0,Q1 → left;  Q2+ → right
  const baseRight = teamIdx === 0;
  const swapped = quarter >= 2;
  return (baseRight !== swapped) ? 'right' : 'left';
}

function classifyShot(xPct, yPct, attackDir) {
  const W = 600, H = 320, cy = 160;
  const cx1 = 34, cx2 = 566;
  const arcR = 145;
  const latY1 = 19, latY2 = 301;
  const midX = W / 2;
  const BORDER = 2;
  const ftX1 = 124, ftX2 = 476, paintH = 52;

  const px = xPct * W / 100;
  const py = yPct * H / 100;

  let inPaint = false;
  if (attackDir === 'right') {
    inPaint = px >= ftX2 && py >= cy - paintH && py <= cy + paintH;
  } else {
    inPaint = px <= ftX1 && py >= cy - paintH && py <= cy + paintH;
  }

  if (attackDir === 'right') {
    if (px <= midX) return { valid: true, three: true, inPaint: false };
    const d = Math.sqrt((px - cx2) ** 2 + (py - cy) ** 2);
    if (py <= latY1 || py >= latY2) return { valid: true, three: true, inPaint: false };
    if (px >= W - BORDER - 1) return { valid: true, three: true, inPaint: false };
    return { valid: true, three: d > arcR, inPaint };
  } else {
    if (px >= midX) return { valid: true, three: true, inPaint: false };
    const d = Math.sqrt((px - cx1) ** 2 + (py - cy) ** 2);
    if (py <= latY1 || py >= latY2) return { valid: true, three: true, inPaint: false };
    if (px <= BORDER + 1) return { valid: true, three: true, inPaint: false };
    return { valid: true, three: d > arcR, inPaint };
  }
}

// ─── BasketballCourt ─────────────────────────────────────────────────────────
function BasketballCourt({ shots=[], onCourtClick, hasPlayer=false, attackDir='right' }) {
  const W=600, H=320, cy=160;
  const cx1=34, cx2=566;
  const ftX1=124, ftX2=476;
  const ftR=39;
  const arcR=145;
  const latY1=19, latY2=301;
  const arcX1=67, arcX2=533;
  const paintH=52;

  const cornerTL = `M 2 2 L ${arcX1} 2 L ${arcX1} ${latY1} L 2 ${latY1} Z`;
  const cornerBL = `M 2 ${latY2} L ${arcX1} ${latY2} L ${arcX1} ${H-2} L 2 ${H-2} Z`;
  const corridorL = `M 2 ${latY1} L ${arcX1} ${latY1} L ${arcX1} ${latY2} L 2 ${latY2} Z`;
  const beyondL = `M ${arcX1} ${latY1} A ${arcR} ${arcR} 0 0 1 ${arcX1} ${latY2} L ${W/2} ${latY2} L ${W/2} ${latY1} Z`;
  const cornerTR = `M ${W-2} 2 L ${arcX2} 2 L ${arcX2} ${latY1} L ${W-2} ${latY1} Z`;
  const cornerBR = `M ${W-2} ${latY2} L ${arcX2} ${latY2} L ${arcX2} ${H-2} L ${W-2} ${H-2} Z`;
  const corridorR = `M ${arcX2} ${latY1} L ${W-2} ${latY1} L ${W-2} ${latY2} L ${arcX2} ${latY2} Z`;
  const beyondR = `M ${arcX2} ${latY1} A ${arcR} ${arcR} 0 0 0 ${arcX2} ${latY2} L ${W/2} ${latY2} L ${W/2} ${latY1} Z`;
  const z3L = cornerTL + ' ' + cornerBL + ' ' + corridorL + ' ' + beyondL;
  const z3R = cornerTR + ' ' + cornerBR + ' ' + corridorR + ' ' + beyondR;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="court-svg"
      style={{cursor: hasPlayer ? 'crosshair' : 'default'}}
      onClick={onCourtClick}>

      <rect x="0" y="0" width={W} height={H} fill="#1a1f2a"/>
      <path d={z3L} fill="rgba(59,130,246,0.11)"/>
      <path d={z3R} fill="rgba(59,130,246,0.11)"/>
      <rect x="2"    y={cy-paintH} width={ftX1}     height={paintH*2} fill="rgba(34,197,94,0.12)"/>
      <rect x={ftX2} y={cy-paintH} width={W-2-ftX2} height={paintH*2} fill="rgba(34,197,94,0.12)"/>

      <g stroke="#7a8fb8" strokeWidth="1.2" fill="none">
        <rect x="2" y="2" width={W-4} height={H-4} rx="2"/>
        <line x1={W/2} y1="2" x2={W/2} y2={H-2}/>
        <circle cx={W/2} cy={cy} r="38"/>
        <rect x="2" y={cy-paintH} width={ftX1} height={paintH*2}/>
        <path d={`M ${ftX1} ${cy-paintH} A ${ftR} ${ftR} 0 0 1 ${ftX1} ${cy+paintH}`} strokeDasharray="5 3"/>
        <rect x={ftX2} y={cy-paintH} width={W-2-ftX2} height={paintH*2}/>
        <path d={`M ${ftX2} ${cy-paintH} A ${ftR} ${ftR} 0 0 0 ${ftX2} ${cy+paintH}`} strokeDasharray="5 3"/>
        <path d={`M ${cx1} ${cy-23} A 23 23 0 0 1 ${cx1} ${cy+23}`}/>
        <path d={`M ${cx2} ${cy-23} A 23 23 0 0 0 ${cx2} ${cy+23}`}/>
      </g>

      <g stroke="#8899cc" strokeWidth="1.8" fill="none" strokeLinecap="round">
        <line x1="2" y1={latY1} x2={arcX1} y2={latY1}/>
        <path d={`M ${arcX1} ${latY1} A ${arcR} ${arcR} 0 0 1 ${arcX1} ${latY2}`}/>
        <line x1={arcX1} y1={latY2} x2="2" y2={latY2}/>
        <line x1={W-2} y1={latY1} x2={arcX2} y2={latY1}/>
        <path d={`M ${arcX2} ${latY1} A ${arcR} ${arcR} 0 0 0 ${arcX2} ${latY2}`}/>
        <line x1={arcX2} y1={latY2} x2={W-2} y2={latY2}/>
      </g>

      <g stroke="#f97316" strokeWidth="1.8" fill="none">
        <circle cx={cx1} cy={cy} r="5.5"/>
        <line x1="2" y1={cy} x2={cx1-5} y2={cy}/>
        <circle cx={cx2} cy={cy} r="5.5"/>
        <line x1={W-2} y1={cy} x2={cx2+5} y2={cy}/>
      </g>

      {attackDir === 'right' ? (
        <g opacity="0.85">
          <line x1="215" y1={cy} x2="348" y2={cy} stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 4"/>
          <polygon points={`348,${cy-11} 370,${cy} 348,${cy+11}`} fill="#f97316" opacity="0.9"/>
          <text x="290" y={cy-16} fill="#f97316" fontSize="9" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle" letterSpacing="2">ATAQUE</text>
          <line x1="252" y1={cy-11} x2="328" y2={cy-11} stroke="#f97316" strokeWidth="0.7" opacity="0.4"/>
        </g>
      ) : (
        <g opacity="0.85">
          <line x1="385" y1={cy} x2="252" y2={cy} stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 4"/>
          <polygon points={`252,${cy-11} 230,${cy} 252,${cy+11}`} fill="#f97316" opacity="0.9"/>
          <text x="310" y={cy-16} fill="#f97316" fontSize="9" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle" letterSpacing="2">ATAQUE</text>
          <line x1="272" y1={cy-11} x2="348" y2={cy-11} stroke="#f97316" strokeWidth="0.7" opacity="0.4"/>
        </g>
      )}

      {shots.map((s,i) => {
        const px=s.x*W/100, py=s.y*H/100;
        const color = s.made ? (s.three ? '#3b82f6' : '#22c55e') : '#ef4444';
        return s.made
          ? <circle key={i} cx={px} cy={py} r="5.5" fill={color} stroke="#fff" strokeWidth="0.5" opacity="0.92"/>
          : <g key={i} opacity="0.85">
              <line x1={px-4.5} y1={py-4.5} x2={px+4.5} y2={py+4.5} stroke={color} strokeWidth="2" strokeLinecap="round"/>
              <line x1={px+4.5} y1={py-4.5} x2={px-4.5} y2={py+4.5} stroke={color} strokeWidth="2" strokeLinecap="round"/>
            </g>;
      })}
    </svg>
  );
}

// ─── MissedShotReboundModal ──────────────────────────────────────────────────
// Aparece após arremesso errado: pergunta se algum jogador pegou o rebote ofensivo.
// Se sim: mantém posse (não chama endPossession adversário).
// Se não: posse vai para o adversário.
function MissedShotReboundModal({ attackingPlayers, onRebound, onNoRebound, onCancel }) {
  const [step, setStep] = useState('ask');  // 'ask' | 'pick'

  if (step === 'ask') {
    return (
      <div className="confirm-overlay">
        <div className="confirm-modal">
          <div className="confirm-title">Arremesso errado</div>
          <div className="confirm-btns">
            <button className="confirm-btn made" style={{background:'rgba(6,182,212,.15)',borderColor:'#06b6d4',color:'#06b6d4'}}
              onClick={() => setStep('pick')}>
              Rebote Ofensivo
            </button>
            <button className="confirm-btn missed"
              onClick={onNoRebound}>
              Adversário pegou
            </button>
          </div>
          <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    );
  }

  // step === 'pick': selecionar quem pegou o rebote ofensivo
  const eligible = attackingPlayers.filter(p => p.active && p.fouls < FOUL_DISQUALIFY);
  return (
    <div className="confirm-overlay">
      <div className="confirm-modal" style={{maxWidth:'380px',width:'94%'}}>
        <div className="confirm-title">Quem pegou o rebote?</div>
        <div style={{padding:'0 0 8px'}}>
          <button className="assist-none-btn" onClick={() => onRebound(null)}>Não identificado</button>
          <div className="assist-players-grid" style={{marginTop:'8px'}}>
            {eligible.map((p, i) => {
              const realIdx = attackingPlayers.indexOf(p);
              return (
                <button key={i} className="assist-player-btn" onClick={() => onRebound(realIdx)}>
                  <span className="assist-pnum">#{p.number}</span>
                  <span className="assist-pname">{p.name.split(' ')[0]}</span>
                  <span className="assist-past">{p.oreb}ro</span>
                </button>
              );
            })}
          </div>
        </div>
        <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── ConfirmShotModal ─────────────────────────────────────────────────────────
function ConfirmShotModal({ three, inPaint, onMade, onMissed, onCancel }) {
  const [step, setStep] = useState('result');
  const [madeResult, setMadeResult] = useState(null);

  if (step === 'result') {
    const label = three ? '3 pontos' : '2 pontos';
    return (
      <div className="confirm-overlay">
        <div className="confirm-modal">
          <div className="confirm-title">Arremesso de {label}</div>
          <div className="confirm-btns">
            <button className="confirm-btn made" onClick={() => {
              if (!three && inPaint) { setMadeResult(true); setStep('type'); }
              else onMade('Arremesso');
            }}>Convertido</button>
            <button className="confirm-btn missed" onClick={() => {
              if (!three && inPaint) { setMadeResult(false); setStep('type'); }
              else onMissed('Arremesso');
            }}>Errado</button>
          </div>
          <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="confirm-overlay">
      <div className="confirm-modal">
        <div className="confirm-title">{madeResult ? '✓ Convertido — ' : '✕ Errado — '}tipo?</div>
        <div className="confirm-btns" style={{flexDirection:'column',gap:'8px'}}>
          <button className="confirm-btn shot-type" onClick={() => madeResult ? onMade('Arremesso') : onMissed('Arremesso')}>Arremesso</button>
          <button className="confirm-btn shot-type" onClick={() => madeResult ? onMade('Bandeja') : onMissed('Bandeja')}>Bandeja</button>
          <button className="confirm-btn shot-type" onClick={() => madeResult ? onMade('Enterrada') : onMissed('Enterrada')}>Enterrada</button>
        </div>
        <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── AssistModal ──────────────────────────────────────────────────────────────
function AssistModal({ players, scorerIdx, onSelect, onNone, onCancel }) {
  const eligible = players
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i !== scorerIdx && p.active && p.fouls < FOUL_DISQUALIFY && (p.techFouls||0) < TECH_DISQUALIFY);
  return (
    <div className="confirm-overlay">
      <div className="confirm-modal" style={{maxWidth:'380px',width:'94%'}}>
        <div className="confirm-title">Assistência?</div>
        <div style={{padding:'4px 0 8px'}}>
          <button className="assist-none-btn" onClick={onNone}>Sem assistência</button>
          {eligible.length === 0 && <div style={{padding:'12px 4px',color:'var(--muted)',textAlign:'center'}}>Nenhum atleta elegível</div>}
          <div className="assist-players-grid" style={{marginTop:'8px'}}>
            {eligible.map(({ p, i }) => (
              <button key={i} className="assist-player-btn" onClick={() => onSelect(i)}>
                <span className="assist-pnum">#{p.number}</span>
                <span className="assist-pname">{p.name.split(' ')[0]}</span>
                <span className="assist-past">{p.ast}ast</span>
              </button>
            ))}
          </div>
        </div>
        <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── FreeThrowModal: seleciona jogador arremessador ───────────────────────────
function FreeThrowModal({ players, title, onSelect, onCancel }) {
  return (
    <div className="confirm-overlay">
      <div className="confirm-modal" style={{maxWidth:'380px',width:'94%'}}>
        <div className="confirm-title">{title || 'Lance Livre — quem arremessa?'}</div>
        <div style={{padding:'0 0 8px'}}>
          <div className="assist-players-grid" style={{marginTop:'4px'}}>
            {players.filter(p => p.active && p.fouls < FOUL_DISQUALIFY).map((p,i) => (
              <button key={i} className="assist-player-btn" onClick={() => onSelect(players.indexOf(p))}>
                <span className="assist-pnum">#{p.number}</span>
                <span className="assist-pname">{p.name.split(' ')[0]}</span>
                <span className="assist-past">{p.ftm}/{p.fta} LL</span>
              </button>
            ))}
          </div>
        </div>
        <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── FTQuantityModal: escolhe 2 ou 3 lances ───────────────────────────────────
function FTQuantityModal({ player, onChoose, onCancel }) {
  return (
    <div className="confirm-overlay">
      <div className="confirm-modal">
        <div className="confirm-title">Lances Livres</div>
        <div className="ft-player-label">#{player.number} {player.name.split(' ')[0]}</div>
        <div className="confirm-btns">
          <button className="confirm-btn shot-type" onClick={() => onChoose(2)}>2 Lances</button>
          <button className="confirm-btn shot-type" onClick={() => onChoose(3)}>3 Lances</button>
        </div>
        <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── FreeThrowResultModal: resultado de cada lance ────────────────────────────
function FreeThrowResultModal({ player, attempt, totalAttempts, onMade, onMissed, onCancel }) {
  return (
    <div className="confirm-overlay">
      <div className="confirm-modal">
        <div className="confirm-title">Lance Livre {attempt}/{totalAttempts}</div>
        <div className="ft-player-label">#{player.number} {player.name.split(' ')[0]}</div>
        <div className="confirm-btns">
          <button className="confirm-btn made" onClick={onMade}>✓ Convertido</button>
          <button className="confirm-btn missed" onClick={onMissed}>✕ Errado</button>
        </div>
        <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── FTReboundModal: após erro no último LL ───────────────────────────────────
function FTReboundModal({ attackingPlayers, onOwnRebound, onOpponentRebound, onCancel }) {
  const [step, setStep] = useState('ask');

  if (step === 'ask') {
    return (
      <div className="confirm-overlay">
        <div className="confirm-modal">
          <div className="confirm-title">Rebote no LL</div>
          <div className="confirm-btns">
            <button className="confirm-btn shot-type"
              style={{borderColor:'#06b6d4',color:'#06b6d4',background:'rgba(6,182,212,.1)'}}
              onClick={() => setStep('pick')}>
              Nosso Time
            </button>
            <button className="confirm-btn missed" onClick={onOpponentRebound}>
              Adversário
            </button>
          </div>
          <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    );
  }

  // Selecionar jogador que pegou o rebote
  const eligible = attackingPlayers.filter(p => p.active && p.fouls < FOUL_DISQUALIFY);
  return (
    <div className="confirm-overlay">
      <div className="confirm-modal" style={{maxWidth:'380px',width:'94%'}}>
        <div className="confirm-title">Quem pegou o rebote?</div>
        <div style={{padding:'0 0 8px'}}>
          <button className="assist-none-btn" onClick={() => onOwnRebound(null)}>Não identificado</button>
          <div className="assist-players-grid" style={{marginTop:'8px'}}>
            {eligible.map((p, i) => {
              const realIdx = attackingPlayers.indexOf(p);
              return (
                <button key={i} className="assist-player-btn" onClick={() => onOwnRebound(realIdx)}>
                  <span className="assist-pnum">#{p.number}</span>
                  <span className="assist-pname">{p.name.split(' ')[0]}</span>
                  <span className="assist-past">{p.oreb}ro</span>
                </button>
              );
            })}
          </div>
        </div>
        <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── FoulModal ────────────────────────────────────────────────────────────────
function FoulModal({ player, teamFoulsInQuarter, onType, onCancel }) {
  const bonus = teamFoulsInQuarter >= TEAM_FOUL_BONUS;
  const disq  = player.fouls >= FOUL_DISQUALIFY - 1;
  const types = [
    { id:'pessoal',        label:'Falta Pessoal',    desc:'Contato durante jogo',    color:'#f97316', isTech: false },
    { id:'tecnica',        label:'Falta Técnica',     desc:'Conduta antidesportiva',  color:'#ef4444', isTech: true  },
    { id:'antidesportiva', label:'Antidesportiva',    desc:'Contato intencional/duro',color:'#be185d', isTech: true  },
    { id:'flagrante',      label:'Flagrante',         desc:'Contato excessivo',       color:'#dc2626', isTech: true  },
    { id:'ofensiva',       label:'Ofensiva',          desc:'Carga / Empurrão / Bloqueio ilegal', color:'#fb923c', isTech: false },
  ];
  return (
    <div className="confirm-overlay">
      <div className="confirm-modal" style={{maxWidth:'380px',width:'94%'}}>
        <div className="confirm-title">Falta — #{player.number} {player.name.split(' ')[0]}</div>
        <div style={{padding:'0 0 8px'}}>
          {disq && <div className="foul-alert danger">ATENÇÃO: próxima falta = DISQUALIFICAÇÃO!</div>}
          {!disq && player.fouls >= FOUL_TROUBLE && <div className="foul-alert warn">Foul trouble: {player.fouls} faltas</div>}
          {bonus && <div className="foul-alert info">Bonificação! ({teamFoulsInQuarter} faltas no período)</div>}
          {(player.techFouls||0) >= TECH_DISQUALIFY - 1 && <div className="foul-alert danger">1 técnica = substituição obrigatória!</div>}
          <div className="foul-info-row">
            <span>FL: <b>{player.fouls}</b></span>
            <span>Téc: <b>{player.techFouls||0}</b></span>
          </div>
          <div className="foul-types-grid">
            {types.map(t => (
              <button key={t.id} className="foul-type-btn" style={{'--fc':t.color}} onClick={() => onType(t.id, t.isTech)}>
                <span className="foul-type-label">{t.label}</span>
                <span className="foul-type-desc">{t.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}


// ─── TurnoverModal ────────────────────────────────────────────────────────────
function TurnoverModal({ activeTeamPlayers, onType, onCancel }) {
  const [step, setStep] = useState('type');  // 'type' | 'stealer'
  const [, setToType] = useState(null);

  if (step === 'type') {
    return (
      <div className="confirm-overlay">
        <div className="confirm-modal" style={{maxWidth:'360px',width:'92%'}}>
          <div className="confirm-title">Tipo de Turnover</div>
          <div style={{padding:'0 0 8px'}}>
            <div className="foul-types-grid">
              <button className="foul-type-btn" style={{'--fc':'#10b981'}}
                onClick={() => { setToType('roubo'); setStep('stealer'); }}>
                <span className="foul-type-label">Roubo de Bola</span>
                <span className="foul-type-desc">Selecionar quem roubou</span>
              </button>
              <button className="foul-type-btn" style={{'--fc':'#ef4444'}}
                onClick={() => onType('infracao', null)}>
                <span className="foul-type-label">Infração</span>
                <span className="foul-type-desc">Passos, duplo drible...</span>
              </button>
              <button className="foul-type-btn" style={{'--fc':'#64748b'}}
                onClick={() => onType('outros', null)}>
                <span className="foul-type-label">Outros</span>
                <span className="foul-type-desc">Má passagem, saiu pela linha...</span>
              </button>
            </div>
          </div>
          <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    );
  }

  // step === 'stealer': selecionar jogador adversário que roubou
  const eligible = activeTeamPlayers.filter(p => p.active && p.fouls < FOUL_DISQUALIFY);
  return (
    <div className="confirm-overlay">
      <div className="confirm-modal" style={{maxWidth:'380px',width:'94%'}}>
        <div className="confirm-title">Quem roubou a bola?</div>
        <div style={{padding:'0 0 8px'}}>
          <button className="assist-none-btn" onClick={() => onType('roubo', null)}>Não identificado</button>
          <div className="assist-players-grid" style={{marginTop:'8px'}}>
            {eligible.map((p, i) => {
              const realIdx = activeTeamPlayers.indexOf(p);
              return (
                <button key={i} className="assist-player-btn"
                  onClick={() => onType('roubo', realIdx)}>
                  <span className="assist-pnum">#{p.number}</span>
                  <span className="assist-pname">{p.name.split(' ')[0]}</span>
                  <span className="assist-past">{p.stl}stl</span>
                </button>
              );
            })}
          </div>
        </div>
        <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── SubModal ─────────────────────────────────────────────────────────────────
function SubModal({ title, reason, players, outPlayerIdx, onSub, onCancel, canCancel=true }) {
  return (
    <div className="confirm-overlay">
      <div className="confirm-modal" style={{maxWidth:'380px',width:'94%'}}>
        <div className="confirm-title">{title}</div>
        <div style={{padding:'0 0 8px'}}>
          {reason && <div className="foul-alert warn" style={{marginBottom:'8px'}}>{reason}</div>}
          {outPlayerIdx !== null && (
            <div className="sub-out-row">
              <span className="sub-label">Saindo:</span>
              <span className="sub-player-name">#{players[outPlayerIdx]?.number} {players[outPlayerIdx]?.name}</span>
            </div>
          )}
          <div style={{fontSize:'11px',color:'var(--muted)',fontWeight:700,letterSpacing:'.1em',textTransform:'uppercase',padding:'8px 0 6px',textAlign:'center'}}>Selecione quem entra</div>
          <div className="assist-players-grid">
            {players.map((p,i) => {
              const available = outPlayerIdx !== null
                ? !p.active && p.fouls < FOUL_DISQUALIFY
                : p.active && p.fouls < FOUL_DISQUALIFY && i !== outPlayerIdx;
              if (!available) return null;
              return (
                <button key={i} className="assist-player-btn sub-in-btn" onClick={() => onSub(i)}>
                  <span className="assist-pnum">#{p.number}</span>
                  <span className="assist-pname">{p.name.split(' ')[0]}</span>
                  {p.pts > 0 && <span className="assist-past">{p.pts}pts</span>}
                </button>
              );
            })}
          </div>
        </div>
        {canCancel && <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>}
      </div>
    </div>
  );
}

// ─── HeatMap ──────────────────────────────────────────────────────────────────
function HeatMap({ shots, teamName, attackDir, teamIdx=0 }) {
  const W = 600, H = 320, cy = 160;
  const RADIUS = 38;
  const clusters = [];
  shots.forEach(s => {
    const sx = s.x * W / 100;
    const sy = s.y * H / 100;
    const existing = clusters.find(cl => Math.sqrt((cl.cx-sx)**2+(cl.cy-sy)**2) < RADIUS*0.7);
    if (existing) {
      existing.cx = (existing.cx*existing.total+sx)/(existing.total+1);
      existing.cy = (existing.cy*existing.total+sy)/(existing.total+1);
      existing.total++;
      if (s.made) existing.made++;
    } else {
      clusters.push({ cx:sx, cy:sy, total:1, made:s.made?1:0 });
    }
  });
  const maxTotal = Math.max(...clusters.map(cl=>cl.total),1);
  const shotColor = (p) => {
    if (p<0.35) return {r:239,g:68,b:68};
    if (p<0.5)  return {r:249,g:115,b:22};
    if (p<0.65) return {r:234,g:179,b:8};
    return {r:34,g:197,b:94};
  };
  return (
    <div className="heatmap-wrap">
      <div className="heatmap-title">{teamName} — {shots.length} arremessos</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="court-svg">
        <defs>
          {clusters.map((cl,i)=>{
            const col=shotColor(cl.made/cl.total);
            const intensity=cl.total/maxTotal;
            return (
              <radialGradient key={i} id={`hg${i}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stopColor={`rgb(${col.r},${col.g},${col.b})`} stopOpacity={0.55*intensity}/>
                <stop offset="45%"  stopColor={`rgb(${col.r},${col.g},${col.b})`} stopOpacity={0.3*intensity}/>
                <stop offset="100%" stopColor={`rgb(${col.r},${col.g},${col.b})`} stopOpacity={0}/>
              </radialGradient>
            );
          })}
        </defs>
        {/* Fundo */}
        <rect x="0" y="0" width={W} height={H} fill="#1a1f2a"/>

        {/* Blobs de calor (abaixo das linhas) */}
        {clusters.map((cl,i)=>{
          const r=RADIUS*(0.8+(cl.total/maxTotal)*0.6);
          return <circle key={i} cx={cl.cx} cy={cl.cy} r={r} fill={`url(#hg${i})`}/>;
        })}

        {/* Destaque de zona de ataque por período */}
        {(()=>{
          // Q1/Q2: time 0 ataca direita (x>300), time 1 ataca esquerda (x<300)
          // Q3/Q4: lados invertidos
          // Mostra overlay sutil: 1º tempo = left half, 2º tempo = right half (ou vice-versa)
          const halfW = W/2;
          // Q1/Q2 attack zone for this team
          const q12dir = teamIdx === 0 ? 'right' : 'left';
          // Q3/Q4 attack zone (inverted)
          const q34dir = teamIdx === 0 ? 'left' : 'right';
          return (<>
            {/* 1º Tempo — label */}
            <text x={q12dir==='right'? W*0.75 : W*0.25} y="14"
              fill="rgba(250,233,42,0.55)" fontSize="9" fontFamily="sans-serif"
              fontWeight="bold" textAnchor="middle" letterSpacing="1">1º TEMPO</text>
            <line x1={halfW} y1="2" x2={halfW} y2={H-2}
              stroke="rgba(250,233,42,0.3)" strokeWidth="2" strokeDasharray="6 4"/>
            {/* 2º Tempo — label */}
            <text x={q34dir==='right'? W*0.75 : W*0.25} y="14"
              fill="rgba(59,130,246,0.55)" fontSize="9" fontFamily="sans-serif"
              fontWeight="bold" textAnchor="middle" letterSpacing="1">2º TEMPO</text>
            {/* Tint sutil no lado de ataque do 1º tempo */}
            <rect
              x={q12dir==='right'? halfW : 0} y={0}
              width={halfW} height={H}
              fill="rgba(250,233,42,0.03)" pointerEvents="none"/>
            {/* Tint sutil no lado de ataque do 2º tempo */}
            <rect
              x={q34dir==='right'? halfW : 0} y={0}
              width={halfW} height={H}
              fill="rgba(59,130,246,0.03)" pointerEvents="none"/>
          </>);
        })()}

        {/* Zonas 3pts — mesmo que BasketballCourt */}
        {(()=>{
          const arcX1=67,arcX2=533,arcR=145,latY1=19,latY2=301,paintH=52;
          const cornerTL=`M 2 2 L ${arcX1} 2 L ${arcX1} ${latY1} L 2 ${latY1} Z`;
          const cornerBL=`M 2 ${latY2} L ${arcX1} ${latY2} L ${arcX1} ${H-2} L 2 ${H-2} Z`;
          const corridorL=`M 2 ${latY1} L ${arcX1} ${latY1} L ${arcX1} ${latY2} L 2 ${latY2} Z`;
          const beyondL=`M ${arcX1} ${latY1} A ${arcR} ${arcR} 0 0 1 ${arcX1} ${latY2} L ${W/2} ${latY2} L ${W/2} ${latY1} Z`;
          const cornerTR=`M ${W-2} 2 L ${arcX2} 2 L ${arcX2} ${latY1} L ${W-2} ${latY1} Z`;
          const cornerBR=`M ${W-2} ${latY2} L ${arcX2} ${latY2} L ${arcX2} ${H-2} L ${W-2} ${H-2} Z`;
          const corridorR=`M ${arcX2} ${latY1} L ${W-2} ${latY1} L ${W-2} ${latY2} L ${arcX2} ${latY2} Z`;
          const beyondR=`M ${arcX2} ${latY1} A ${arcR} ${arcR} 0 0 0 ${arcX2} ${latY2} L ${W/2} ${latY2} L ${W/2} ${latY1} Z`;
          const cx1=34,cx2=566,ftX1=124,ftX2=476;
          return (<>
            <path d={cornerTL+' '+cornerBL+' '+corridorL+' '+beyondL} fill="rgba(59,130,246,0.07)"/>
            <path d={cornerTR+' '+cornerBR+' '+corridorR+' '+beyondR} fill="rgba(59,130,246,0.07)"/>
            <rect x="2" y={cy-paintH} width={ftX1} height={paintH*2} fill="rgba(34,197,94,0.07)"/>
            <rect x={ftX2} y={cy-paintH} width={W-2-ftX2} height={paintH*2} fill="rgba(34,197,94,0.12)"/>
            {/* Linhas estruturais */}
            <g stroke="#4a5570" strokeWidth="1" fill="none">
              <rect x="2" y="2" width={W-4} height={H-4} rx="2"/>
              <line x1={W/2} y1="2" x2={W/2} y2={H-2}/>
              <circle cx={W/2} cy={cy} r="38"/>
              <rect x="2" y={cy-paintH} width={ftX1} height={paintH*2}/>
              <path d={`M ${ftX1} ${cy-paintH} A 39 39 0 0 1 ${ftX1} ${cy+paintH}`} strokeDasharray="5 3"/>
              <rect x={ftX2} y={cy-paintH} width={W-2-ftX2} height={paintH*2}/>
              <path d={`M ${ftX2} ${cy-paintH} A 39 39 0 0 0 ${ftX2} ${cy+paintH}`} strokeDasharray="5 3"/>
              <path d={`M ${cx1} ${cy-23} A 23 23 0 0 1 ${cx1} ${cy+23}`}/>
              <path d={`M ${cx2} ${cy-23} A 23 23 0 0 0 ${cx2} ${cy+23}`}/>
            </g>
            {/* Linha 3pts */}
            <g stroke="#8899cc" strokeWidth="1.8" fill="none" strokeLinecap="round">
              <line x1="2" y1={latY1} x2={arcX1} y2={latY1}/>
              <path d={`M ${arcX1} ${latY1} A ${arcR} ${arcR} 0 0 1 ${arcX1} ${latY2}`}/>
              <line x1={arcX1} y1={latY2} x2="2" y2={latY2}/>
              <line x1={W-2} y1={latY1} x2={arcX2} y2={latY1}/>
              <path d={`M ${arcX2} ${latY1} A ${arcR} ${arcR} 0 0 0 ${arcX2} ${latY2}`}/>
              <line x1={arcX2} y1={latY2} x2={W-2} y2={latY2}/>
            </g>
            {/* Cestas */}
            <g stroke="#f97316" strokeWidth="1.8" fill="none">
              <circle cx={cx1} cy={cy} r="5.5"/><line x1="2" y1={cy} x2={cx1-5} y2={cy}/>
              <circle cx={cx2} cy={cy} r="5.5"/><line x1={W-2} y1={cy} x2={cx2+5} y2={cy}/>
            </g>
            {/* Seta de ataque */}
            {attackDir==='right'?(
              <g opacity="0.85">
                <line x1="215" y1={cy} x2="348" y2={cy} stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 4"/>
                <polygon points={`348,${cy-11} 370,${cy} 348,${cy+11}`} fill="#f97316" opacity="0.9"/>
                <text x="290" y={cy-16} fill="#f97316" fontSize="9" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle" letterSpacing="2">ATAQUE</text>
              </g>
            ):(
              <g opacity="0.85">
                <line x1="385" y1={cy} x2="252" y2={cy} stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 4"/>
                <polygon points={`252,${cy-11} 230,${cy} 252,${cy+11}`} fill="#f97316" opacity="0.9"/>
                <text x="310" y={cy-16} fill="#f97316" fontSize="9" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle" letterSpacing="2">ATAQUE</text>
              </g>
            )}
          </>);
        })()}

        {/* Dots dos arremessos */}
        {shots.map((s,i)=>{
          const px=s.x*W/100,py=s.y*H/100;
          return s.made
            ?<circle key={i} cx={px} cy={py} r="4" fill="#22c55e" stroke="#fff" strokeWidth="0.5" opacity="0.85"/>
            :<g key={i} opacity="0.75">
              <line x1={px-3.5} y1={py-3.5} x2={px+3.5} y2={py+3.5} stroke="#ef4444" strokeWidth="1.6" strokeLinecap="round"/>
              <line x1={px+3.5} y1={py-3.5} x2={px-3.5} y2={py+3.5} stroke="#ef4444" strokeWidth="1.6" strokeLinecap="round"/>
            </g>;
        })}
      </svg>
      <div className="heatmap-legend">
        <span className="hml-item" style={{color:'#22c55e'}}>● Convertido ({shots.filter(s=>s.made).length})</span>
        <span className="hml-item" style={{color:'#ef4444'}}>✕ Errado ({shots.filter(s=>!s.made).length})</span>
        <span className="hml-item" style={{color:'#f97316'}}>FG: {shots.length>0?Math.round(shots.filter(s=>s.made).length/shots.length*100)+'%':''}</span>
        <span className="hml-item" style={{color:'#3b82f6'}}>3P: {(()=>{const t=shots.filter(s=>s.three);return t.length>0?Math.round(t.filter(s=>s.made).length/t.length*100)+'%':'';})()}</span>
      </div>
    </div>
  );
}


// ─── LoginScreen ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [mode, setMode]       = useState('login'); // 'login' | 'signup'
  const [email, setEmail]     = useState('');
  const [pass, setPass]       = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    setError(''); setLoading(true);
    try {
      if (mode === 'signup') {
        if (pass !== confirm) { setError('As senhas não coincidem.'); setLoading(false); return; }
        if (pass.length < 6)  { setError('Senha mínima: 6 caracteres.'); setLoading(false); return; }
        const { error: e } = await signUp(email, pass);
        if (e) throw e;
        setError('Confirme seu e-mail antes de entrar.');
        setMode('login');
      } else {
        const { error: e } = await signIn(email, pass);
        if (e) throw e;
        // onLogin será chamado pelo onAuthChange listener no App
      }
    } catch (e) {
      const msgs = {
        'Invalid login credentials': 'E-mail ou senha incorretos.',
        'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
        'User already registered': 'E-mail já cadastrado.',
      };
      setError(msgs[e.message] || e.message);
    }
    setLoading(false);
  };

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-logo">
          <svg viewBox="0 0 60 60" width="52" height="52">
            <circle cx="30" cy="30" r="28" fill="#f97316" stroke="#c2530a" strokeWidth="1"/>
            <path d="M30 2 Q30 30 30 58" fill="none" stroke="#c2530a" strokeWidth="1.5"/>
            <path d="M2 30 Q30 30 58 30" fill="none" stroke="#c2530a" strokeWidth="1.5"/>
            <path d="M8 12 Q20 22 30 30 Q40 38 52 48" fill="none" stroke="#c2530a" strokeWidth="1.5"/>
            <path d="M52 12 Q40 22 30 30 Q20 38 8 48" fill="none" stroke="#c2530a" strokeWidth="1.5"/>
          </svg>
          <div>
            <div className="login-title">WinFast</div>
            <div className="login-subtitle">Basketball Scout</div>
          </div>
        </div>

        <div className="login-tabs">
          <button className="login-tab" data-active={mode==='login'} onClick={()=>{setMode('login');setError('');}}>Entrar</button>
          <button className="login-tab" data-active={mode==='signup'} onClick={()=>{setMode('signup');setError('');}}>Cadastrar</button>
        </div>

        <div className="login-fields">
          <input className="login-input" type="email" placeholder="E-mail"
            value={email} onChange={e=>setEmail(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handle()}/>
          <input className="login-input" type="password" placeholder="Senha"
            value={pass} onChange={e=>setPass(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handle()}/>
          {mode==='signup' && (
            <input className="login-input" type="password" placeholder="Confirmar senha"
              value={confirm} onChange={e=>setConfirm(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&handle()}/>
          )}
        </div>

        {error && <div className="login-error">{error}</div>}

        <button className="login-btn" onClick={handle} disabled={loading||!email||!pass}>
          {loading ? 'Aguarde...' : mode==='login' ? 'Entrar' : 'Criar conta'}
        </button>
      </div>
    </div>
  );
}

// ─── NewGameModal ─────────────────────────────────────────────────────────────
const BLANK_PLAYER = () => ({ number: '', name: '' });
function NewGameModal({ onStart, onClose }) {
  const [startingTeam, setStartingTeam] = useState(0);
  const [nameA, setNameA] = useState('Time A');
  const [nameB, setNameB] = useState('Time B');
  // Data do jogo — padrão: hoje no formato DD/MM/AAAA
  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()}`;
  const [gameDate, setGameDate] = useState(todayStr);
  // Começa com 5 jogadores vazios por time
  const [players, setPlayers] = useState({
    a: Array.from({length:5}, BLANK_PLAYER),
    b: Array.from({length:5}, BLANK_PLAYER),
  });
  const upd = (t,i,f,v) => setPlayers(prev=>({...prev,[t]:prev[t].map((p,j)=>j===i?{...p,[f]:v}:p)}));
  const addPlayer = (t) => setPlayers(prev => {
    if (prev[t].length >= 15) return prev;
    return { ...prev, [t]: [...prev[t], BLANK_PLAYER()] };
  });
  const removePlayer = (t, i) => setPlayers(prev => ({
    ...prev, [t]: prev[t].filter((_,j) => j !== i)
  }));

  const handleStart = () => {
    // Filtra jogadores com número e nome preenchidos
    const rosterA = players.a.filter(p => p.number.trim() && p.name.trim());
    const rosterB = players.b.filter(p => p.number.trim() && p.name.trim());
    if (rosterA.length < 5 || rosterB.length < 5) {
      alert(`Cada time precisa ter ao menos 5 jogadores cadastrados.\n${rosterA.length < 5 ? nameA + ' tem ' + rosterA.length + ' jogador(es).' : ''}\n${rosterB.length < 5 ? nameB + ' tem ' + rosterB.length + ' jogador(es).' : ''}`);
      return;
    }
    onStart(nameA, nameB, rosterA, rosterB, startingTeam, gameDate);
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header"><span>Novo Jogo</span><button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          <div className="modal-teams">
            {[['a',nameA,setNameA],['b',nameB,setNameB]].map(([key,name,setName])=>(
              <div key={key} className="modal-team-col">
                <input className="team-name-input" value={name} onChange={e=>setName(e.target.value)}/>
                <div className="modal-roster-header"><span>#</span><span>Nome</span></div>
                <div className="modal-roster">
                  {players[key].map((p,i)=>(
                    <div key={i} className="modal-player-row">
                      <input className="num-input" value={p.number} maxLength={2} placeholder="#" onChange={e=>upd(key,i,'number',e.target.value)}/>
                      <input className="name-inp" value={p.name} placeholder="Nome" onChange={e=>upd(key,i,'name',e.target.value)}/>
                      {players[key].length > 1 && (
                        <button className="rm-player-btn" onClick={()=>removePlayer(key,i)} title="Remover">✕</button>
                      )}
                    </div>
                  ))}
                  {players[key].length < 15 && (
                    <button className="add-player-btn" onClick={()=>addPlayer(key)}>+ Jogador</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div style={{marginTop:12}}>
            <div style={{marginBottom:6,fontWeight:'bold',color:'var(--text)'}}>Data do jogo:</div>
            <input
              className="login-input"
              type="text"
              placeholder="DD/MM/AAAA"
              value={gameDate}
              maxLength={10}
              onChange={e => {
                // Auto-formatar: inserir / automaticamente
                let v = e.target.value.replace(/\D/g,'');
                if (v.length > 2) v = v.slice(0,2)+'/'+v.slice(2);
                if (v.length > 5) v = v.slice(0,5)+'/'+v.slice(5,9);
                setGameDate(v);
              }}
              style={{width:'100%',boxSizing:'border-box',marginBottom:0}}
            />
          </div>
          <div style={{marginTop:12}}>
            <div style={{marginBottom:6,fontWeight:'bold',color:'var(--text)'}}>Posse inicial:</div>
            <div style={{display:'flex',gap:8}}>
              <button type="button" onClick={()=>setStartingTeam(0)}
                style={{flex:1,padding:'10px',background:startingTeam===0?'#22c55e':'var(--bg3)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'6px'}}>
                {nameA}
              </button>
              <button type="button" onClick={()=>setStartingTeam(1)}
                style={{flex:1,padding:'10px',background:startingTeam===1?'#22c55e':'var(--bg3)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:'6px'}}>
                {nameB}
              </button>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-start" onClick={handleStart}>Iniciar Jogo</button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]       = useState('home');
  const [games, setGames]         = useState(loadGamesLocal);
  const [user, setUser]           = useState(null);      // usuário autenticado
  const [authLoading, setAuthLoading] = useState(true);  // aguardando sessão
  const [syncStatus, setSyncStatus]   = useState('');    // 'syncing' | 'saved' | 'error' | ''
  const [game, setGame]     = useState(null);
  const [running, setRunning] = useState(false);
  const [activeTeam, setActiveTeam] = useState(0);
  const [selectedPlayerA, setSelectedPlayerA] = useState(null);
  const [selectedPlayerB, setSelectedPlayerB] = useState(null);
  const [view, setView]     = useState('scout');
  const [toast, setToast]   = useState(null);
  const [showNewGame, setShowNewGame] = useState(false);
  const [confirmShot, setConfirmShot]   = useState(null);
  const [assistPending, setAssistPending] = useState(null);
  const [foulPending, setFoulPending]   = useState(false);
  // ftFlow: controla o fluxo completo de lances livres
  // { step, teamIdx, playerIdx, total, attempt, made[], fromBonus }
  const [ftFlow, setFtFlow] = useState(null);
  const [subModal, setSubModal]         = useState(null);
  const [dragPlayer, setDragPlayer]     = useState(null);
  const [dragTeam, setDragTeam]         = useState(null);
  const dragLongPress = useRef(null);
  const dragPos = useRef({ x:0, y:0 });
  const [turnoverPending, setTurnoverPending] = useState(false);
  // reboundPending: { playerIdx, three, shotType } quando arremesso errado aguarda rebote
  const [reboundPending, setReboundPending] = useState(null);
  const undoStack = useRef([]);
  const syncTimer = useRef(null);   // debounce do sync para Supabase

  // Helper: índice do atleta selecionado no time ativo
  const selectedPlayer = activeTeam === 0 ? selectedPlayerA : selectedPlayerB;
  // ── Cronômetro ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!running || !game) return;
    const id = setInterval(() => {
      setGame(g => {
        if (!g) return g;
        if (g.clock <= 1) { setRunning(false); return { ...g, clock: 0 }; }
        return { ...g, clock: g.clock - 1 };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, game]);

  // ── Minutagem: pausa → acumula ──────────────────────────────────────────────
  useEffect(() => {
    if (!game || running) return;
    setGame(g => {
      if (!g) return g;
      const now = g.clock;
      const teams = g.teams.map(t => ({
        ...t,
        players: t.players.map(p => {
          if (!p.active || p.entryTime === null) return p;
          const elapsed = p.entryTime - now;
          return { ...p, timeOnCourt: (p.timeOnCourt||0)+Math.max(elapsed,0), entryTime: now };
        })
      }));
      return { ...g, teams };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // ── Minutagem: start → registra entryTime ──────────────────────────────────
  useEffect(() => {
    if (!game || !running) return;
    setGame(g => {
      if (!g) return g;
      const teams = g.teams.map(t => ({
        ...t,
        players: t.players.map(p => ({
          ...p,
          entryTime: p.active && p.entryTime === null ? g.clock : p.entryTime,
        }))
      }));
      return { ...g, teams };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // ── Auth listener ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Verifica sessão existente ao iniciar
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });
    // Escuta mudanças de auth (login/logout)
    const { data: { subscription } } = onAuthChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Carrega jogos do Supabase quando usuário loga ───────────────────────────
  useEffect(() => {
    if (!user) return;
    fetchGames(user.id)
      .then(cloudGames => {
        if (cloudGames.length > 0) {
          setGames(cloudGames);
          saveGamesLocal(cloudGames);
        }
      })
      .catch(() => {
        // fallback: usa localStorage
        setGames(loadGamesLocal());
      });
  }, [user]);

  // ── Auto-save: localStorage + Supabase com debounce ────────────────────────
  useEffect(() => {
    if (!game) return;
    // Salva localmente sempre e imediatamente
    setGames(prev => {
      const idx = prev.findIndex(g => g.id === game.id);
      const next = idx >= 0 ? prev.map((g,i)=>i===idx?game:g) : [game,...prev];
      saveGamesLocal(next);
      return next;
    });
    // Sync para nuvem: debounce de 4s para não disparar a cada ação durante o jogo
    if (user) {
      clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        setSyncStatus('syncing');
        upsertGame(game, user.id)
          .then(() => {
            setSyncStatus('saved');
            setTimeout(() => setSyncStatus(''), 3000);
          })
          .catch(() => setSyncStatus('error'));
      }, 4000);
    }
  }, [game, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(null),1800); };

  // ── Posse: incrementa possessions respeitando regra da 1ª posse ──────────
  // O time que iniciou o jogo só conta nova posse após o adversário ter tido 1.
  const endPossession = useCallback((g, teamIdx, playerIdx = null) => {
    const fpt = g.firstPossTeam !== undefined ? g.firstPossTeam : -1;
    let adversaryHadPoss = g.adversaryHadPoss || false;

    // Se o adversário do firstPossTeam está tendo sua primeira posse, marcar
    if (fpt !== -1 && !adversaryHadPoss && teamIdx !== fpt) {
      adversaryHadPoss = true;
    }

    // firstPossTeam tentando contar nova posse antes do adversário ter jogado → ignorar
    const shouldSkip = fpt !== -1 && teamIdx === fpt && !adversaryHadPoss;
    if (shouldSkip) {
      return { ...g, adversaryHadPoss };
    }

    const possessions = [...(g.possessions || [0,0])];
    possessions[teamIdx] = (possessions[teamIdx]||0) + 1;
    const teams = g.teams.map((t, ti) => {
      if (ti !== teamIdx || playerIdx === null) return t;
      return {
        ...t,
        players: t.players.map((p, pi) =>
          pi === playerIdx ? { ...p, possessions: (p.possessions||0)+1 } : p
        )
      };
    });
    return { ...g, possessions, teams, adversaryHadPoss };
  }, []);

  // ── setGameWithUndo ─────────────────────────────────────────────────────────
  const setGameWithUndo = useCallback((updater) => {
    setGame(prev => {
      if (prev) undoStack.current = [prev, ...undoStack.current].slice(0,8);
      return typeof updater === 'function' ? updater(prev) : updater;
    });
  }, []);

  const undoLastAction = useCallback(() => {
    if (undoStack.current.length === 0) { showToast('Nada para desfazer'); return; }
    const prev = undoStack.current[0];
    // Descobrir qual foi a última ação comparando o log
    const currentLog = game?.log || [];
    const prevLog    = prev?.log    || [];
    let msg = 'Ação desfeita';
    if (currentLog.length > prevLog.length) {
      const lastEntry = currentLog[0]; // log é prepend, então [0] é o mais recente
      if (lastEntry) {
        const player = lastEntry.player || '';
        const action = lastEntry.action || '';
        msg = `Desfeito: ${action} ${player}`.trim();
      }
    }
    setGame(prev);
    undoStack.current = undoStack.current.slice(1);
    showToast(msg);
  }, [game]);

  // commitTurnover: chamado pelo TurnoverModal
  // toType: 'roubo' | 'infracao' | 'outros'
  // stealerIdx: índice do jogador adversário que roubou (ou null)
  const commitTurnover = useCallback((toType, stealerIdx) => {
    const pIdx = activeTeam === 0 ? selectedPlayerA : selectedPlayerB;
    if (pIdx === null) return;
    const teamIdx = activeTeam;
    const oppIdx  = 1 - teamIdx;

    setGameWithUndo(g => {
      // Incrementa TO do atleta que perdeu a bola
      const teams = g.teams.map((t, ti) => {
        if (ti === teamIdx) return {
          ...t, players: t.players.map((p, pi) =>
            pi === pIdx ? { ...p, to: (p.to||0)+1 } : p
          )
        };
        // Se for roubo, incrementa STL do ladrão
        if (ti === oppIdx && stealerIdx !== null) return {
          ...t, players: t.players.map((p, pi) =>
            pi === stealerIdx ? { ...p, stl: (p.stl||0)+1 } : p
          )
        };
        return t;
      });

      const pl = g.teams[teamIdx].players[pIdx];
      const stealerLabel = stealerIdx !== null
        ? ` (roubo: #${g.teams[oppIdx].players[stealerIdx].number})`
        : toType === 'roubo' ? ' (roubo)' : toType === 'infracao' ? ' (infração)' : ' (outros)';

      const entry = { id:Date.now(), q:getQuarterLabel(g.quarter), time:fmtTime(g.clock),
        team:g.teams[teamIdx].name, player:`#${pl.number} ${pl.name.split(' ')[0]}`,
        action:`Turnover${stealerLabel}`, pts:0, color:'#ef4444' };

      // Se for roubo com jogador identificado, também loga STL
      const entries = [entry];
      if (toType === 'roubo' && stealerIdx !== null) {
        const stealer = g.teams[oppIdx].players[stealerIdx];
        entries.push({ id:Date.now()+1, q:getQuarterLabel(g.quarter), time:fmtTime(g.clock),
          team:g.teams[oppIdx].name, player:`#${stealer.number} ${stealer.name.split(' ')[0]}`,
          action:'Roubo', pts:0, color:'#10b981' });
      }

      // Posse vai para o adversário; se roubo identificado, conta para o ladrão
      return endPossession(
        { ...g, teams, log:[...entries,...g.log] },
        oppIdx,
        toType === 'roubo' ? stealerIdx : null
      );
    });

    setTurnoverPending(false);
    const toastType = toType==='roubo' ? 'Roubo' : toType==='infracao' ? 'Infração' : 'Turnover';
    showToast(`${toastType} — #${game.teams[activeTeam].players[pIdx].number}`);
    setActiveTeam(oppIdx => 1 - oppIdx);
    setSelectedPlayerA(null);
    setSelectedPlayerB(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeam, selectedPlayerA, selectedPlayerB, setGameWithUndo, endPossession]);

  // ── startGame ───────────────────────────────────────────────────────────────
  const startGame = (nameA, nameB, rosterA, rosterB, startingTeam, gameDate) => {
    const g = {
      ...newGame(nameA, nameB, rosterA, rosterB),
      possessions: startingTeam === 0 ? [1,0] : [0,1],
      firstPossTeam: startingTeam,
      adversaryHadPoss: false,
      gameDate: gameDate || new Date().toLocaleDateString('pt-BR'),
    };
    setGame(g);
    setShowNewGame(false);
    setScreen('game');
    setView('scout');
    setActiveTeam(startingTeam);
    setSelectedPlayerA(null);
    setSelectedPlayerB(null);
    setRunning(false);
  };

  const openGame = g => {
    const patched = g.possessions ? g : { ...g, possessions:[0,0] };
    setGame(patched);
    setScreen('game'); setView('scout');
    setActiveTeam(0); setSelectedPlayerA(null); setSelectedPlayerB(null); setRunning(false);
  };

  // ── nextQuarter ─────────────────────────────────────────────────────────────
  const nextQuarter = useCallback(() => {
    setGame(g => {
      if (!g) return g;
      const nextQ = g.quarter + 1;
      const nextClock = nextQ >= 4 ? 300 : 600;
      let teamFouls = g.teamFouls || [[0,0,0,0,0],[0,0,0,0,0]];
      teamFouls = teamFouls.map(tf => {
        const arr = [...tf];
        while (arr.length <= nextQ) arr.push(0);
        if (nextQ < 4) arr[nextQ] = 0;
        return arr;
      });
      return { ...g, quarter: nextQ, clock: nextClock, teamFouls };
    });
    setRunning(false);
  }, []);

  // ── Substituição ─────────────────────────────────────────────────────────────
  const executeSub = useCallback((inIdx) => {
    if (!game || !subModal) return;
    const outIdx = subModal.outIdx;
    setGame(g => ({
      ...g,
      teams: g.teams.map((t, ti) => {
        if (ti !== activeTeam) return t;
        return {
          ...t,
          players: t.players.map((p, pi) => {
            if (pi === outIdx) {
              const elapsed = running && p.entryTime !== null ? p.entryTime - g.clock : 0;
              return { ...p, active:false, entryTime:null, timeOnCourt:(p.timeOnCourt||0)+Math.max(elapsed,0) };
            }
            if (pi === inIdx) return { ...p, active:true, entryTime: running ? g.clock : null };
            return p;
          })
        };
      })
    }));
    const out = game.teams[activeTeam].players[outIdx];
    const inn = game.teams[activeTeam].players[inIdx];
    // Log da substituição
    setGame(g => {
      const entry = {
        id: Date.now(),
        q: getQuarterLabel(g.quarter),
        time: fmtTime(g.clock),
        team: g.teams[activeTeam].name,
        player: `#${out.number} ${out.name.split(' ')[0]}`,
        action: `↕ Saiu → #${inn.number} ${inn.name.split(' ')[0]}`,
        pts: 0, color: '#64748b'
      };
      return { ...g, log: [entry, ...g.log] };
    });
    showToast(`↕ ${out.name.split(' ')[0]} → ${inn.name.split(' ')[0]}`);
    setSubModal(null); setSelectedPlayerA(null); setSelectedPlayerB(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, subModal, activeTeam, running]);

  const executeDirectSub = useCallback((outIdx, inIdx) => {
    if (!game) return;
    setGame(g => ({
      ...g,
      teams: g.teams.map((t, ti) => {
        if (ti !== activeTeam) return t;
        return {
          ...t,
          players: t.players.map((p, pi) => {
            if (pi === outIdx) return { ...p, active:false, entryTime:null };
            if (pi === inIdx)  return { ...p, active:true,  entryTime: running ? g.clock : null };
            return p;
          })
        };
      })
    }));
    const out = game.teams[activeTeam].players[outIdx];
    const inn = game.teams[activeTeam].players[inIdx];
    setGame(g => {
      const entry = {
        id: Date.now(),
        q: getQuarterLabel(g.quarter),
        time: fmtTime(g.clock),
        team: g.teams[activeTeam].name,
        player: `#${out.number} ${out.name.split(' ')[0]}`,
        action: `↕ Saiu → #${inn.number} ${inn.name.split(' ')[0]}`,
        pts: 0, color: '#64748b'
      };
      return { ...g, log: [entry, ...g.log] };
    });
    showToast(`↕ ${out.name.split(' ')[0]} → ${inn.name.split(' ')[0]}`);
    setSubModal(null); setSelectedPlayerA(null); setSelectedPlayerB(null);
  }, [game, activeTeam, running]);

  // ── commitFoul ──────────────────────────────────────────────────────────────
  const commitFoul = useCallback((foulType, isTech) => {
    if (selectedPlayer === null || !game) return;
    const pl = game.teams[activeTeam].players[selectedPlayer];
    const newFouls     = (pl.fouls||0) + 1;
    const newTechFouls = isTech ? (pl.techFouls||0)+1 : (pl.techFouls||0);
    const isDisq       = newFouls >= FOUL_DISQUALIFY;
    const isTechDisq   = newTechFouls >= TECH_DISQUALIFY;
    const needsSub     = isDisq || isTechDisq;
    const newTfq       = ((game.teamFouls?.[activeTeam]||[])[game.quarter]||0) + 1;
    const nowBonus     = newTfq >= TEAM_FOUL_BONUS;

    setGameWithUndo(g => {
      const teamFouls = (g.teamFouls||[[0,0,0,0,0],[0,0,0,0,0]]).map((tf,ti) => {
        if (ti !== activeTeam) return tf;
        const arr = [...tf];
        while (arr.length <= g.quarter) arr.push(0);
        arr[g.quarter] = (arr[g.quarter]||0)+1;
        return arr;
      });
      const teams = g.teams.map((t,ti) => {
        if (ti !== activeTeam) return t;
        return { ...t, players: t.players.map((p,pi) => {
          if (pi !== selectedPlayer) return p;
          return { ...p, fouls:newFouls, techFouls:newTechFouls, active: isDisq?false:p.active };
        })};
      });
      const entry = { id:Date.now(), q:getQuarterLabel(g.quarter), time:fmtTime(g.clock),
        team:g.teams[activeTeam].name, player:`#${pl.number} ${pl.name.split(' ')[0]}`,
        action:`Falta ${foulType}`, pts:0, color:'#f97316' };
      // Falta gera posse para o adversário (quem sofreu a falta)
      const gUpdated = { ...g, teams, teamFouls, log:[entry,...g.log] };
      return endPossession(gUpdated, 1 - activeTeam, null);
    });

    setFoulPending(false);
    if (needsSub) {
      const reason = isDisq
        ? `#${pl.number} ${pl.name.split(' ')[0]} atingiu ${newFouls} faltas — DISQUALIFICADO`
        : `#${pl.number} ${pl.name.split(' ')[0]} atingiu ${newTechFouls} técnicas — substituição obrigatória`;
      setSubModal({ reason, outIdx: selectedPlayer, canCancel:false });
    } else if (nowBonus) {
      // Bonificação: adversário arremessa 2 LLs — selecionar arremessador
      setFtFlow({ step:'pick_player', teamIdx: 1 - activeTeam, playerIdx:null, total:2, attempt:1, made:[], fromBonus:true });
    } else if (newFouls >= FOUL_TROUBLE) {
      showToast(`Foul trouble — #${pl.number} ${pl.name.split(' ')[0]} (${newFouls} faltas)`);
    } else {
      showToast(`Falta ${foulType} — #${pl.number} ${pl.name.split(' ')[0]}`);
    }
  }, [selectedPlayer, activeTeam, game, setGameWithUndo, endPossession]);

  // ── commitFT: registra um lance livre nas stats (sem lógica de posse) ────────
  const commitFT = useCallback((ftTeamIdx, playerIdx, made) => {
    if (!game) return;
    const pl = game.teams[ftTeamIdx].players[playerIdx];
    const scoringTeam  = ftTeamIdx;
    const opposingTeam = 1 - ftTeamIdx;
    setGameWithUndo(g => {
      const teams = g.teams.map((t,ti) => {
        if (ti === scoringTeam) return {
          ...t,
          score: t.score + (made?1:0),
          players: t.players.map((p,pi) => {
            const n = { ...p };
            if (pi === playerIdx) { n.ftm += made?1:0; n.fta += 1; n.pts += made?1:0; }
            if (made && p.active) n.plusMinus = (n.plusMinus||0)+1;
            return n;
          })
        };
        if (ti === opposingTeam) return {
          ...t,
          players: t.players.map(p => (!p.active||!made)?p:{ ...p, plusMinus:(p.plusMinus||0)-1 })
        };
        return t;
      });
      const entry = { id:Date.now(), q:getQuarterLabel(g.quarter), time:fmtTime(g.clock),
        team:g.teams[ftTeamIdx].name, player:`#${pl.number} ${pl.name.split(' ')[0]}`,
        action:made?'LL ✓ +1':'LL ✕', pts:made?1:0, color:made?'#f59e0b':'#475569' };
      return { ...g, teams, log:[entry,...g.log] };
    });
    if (made) showToast(`+1 LL — ${pl.name.split(' ')[0]}`);
    else showToast(`LL erro — ${pl.name.split(' ')[0]}`);
  }, [game, setGameWithUndo]);

  // ── Finaliza sequência de LL com lógica de posse/rebote ──────────────────────
  const finishFTSequence = useCallback((ftTeamIdx, allMade) => {
    // allMade: último arremesso convertido → posse adversário, troca seletor
    // allMade=false: abrir FTReboundModal (gerenciado pelo ftFlow.step='rebound')
    if (allMade) {
      setGame(g => endPossession(g, 1 - ftTeamIdx, null));
      setActiveTeam(1 - ftTeamIdx);
      setSelectedPlayerA(null);
      setSelectedPlayerB(null);
      setFtFlow(null);
    } else {
      // Mostrar modal de rebote (step gerenciado externamente)
      setFtFlow(prev => ({ ...prev, step: 'rebound' }));
    }
  }, [endPossession]);

  // ── commitShot ──────────────────────────────────────────────────────────────
  // keepPossession=true: arremesso errado mas com rebote ofensivo → não dá posse ao adversário
  const commitShot = useCallback((playerIdx, xPct, yPct, made, three, assistIdx, shotType='Arremesso', keepPossession=false) => {
    const pts = made ? (three?3:2) : 0;
    const actionId = made ? (three?'fg3m':'fg2m') : (three?'fg3miss':'fg2miss');
    const col = made ? (three?'#3b82f6':'#22c55e') : '#475569';

    setGameWithUndo(g => {
      const teams = g.teams.map((t,ti) => {
        const players = t.players.map((p,pi) => {
          const n = { ...p };
          if (ti === activeTeam) {
            if (pi === assistIdx) n.ast = (n.ast||0)+1;
            if (pi === playerIdx) {
              if      (actionId==='fg2m')    { n.fg2m++; n.fg2a++; }
              else if (actionId==='fg2miss') { n.fg2a++; }
              else if (actionId==='fg3m')    { n.fg3m++; n.fg3a++; }
              else if (actionId==='fg3miss') { n.fg3a++; }
              n.pts = n.fg2m*2 + n.fg3m*3 + n.ftm;
              if (xPct !== null) {
                const apl = assistIdx!==null ? g.teams[activeTeam].players[assistIdx] : null;
                n.shots = [...(n.shots||[]), {
                  x:xPct, y:yPct, made, three, zone:three?'3pts':'2pts',
                  shotType: three?'3pts':(shotType||'Arremesso'),
                  assistedBy: apl?`#${apl.number} ${apl.name.split(' ')[0]}`:'',
                  q:getQuarterLabel(g.quarter), time:fmtTime(g.clock),
                }];
              }
            }
            if (made && p.active) n.plusMinus = (n.plusMinus||0)+pts;
          } else {
            if (made && p.active) n.plusMinus = (n.plusMinus||0)-pts;
          }
          return n;
        });
        return { ...t, score: ti===activeTeam?t.score+pts:t.score, players };
      });

      const sp = g.teams[activeTeam].players[playerIdx];
      const ap = assistIdx!==null ? g.teams[activeTeam].players[assistIdx] : null;
      const entries = [];
      if (ap) entries.push({ id:Date.now(), q:getQuarterLabel(g.quarter), time:fmtTime(g.clock),
        team:g.teams[activeTeam].name, player:`#${ap.number} ${ap.name.split(' ')[0]}`,
        action:'Assist.', pts:0, color:'#a855f7' });
      entries.push({ id:Date.now()+1, q:getQuarterLabel(g.quarter), time:fmtTime(g.clock),
        team:g.teams[activeTeam].name, player:`#${sp.number} ${sp.name.split(' ')[0]}`,
        action:made?(three?'3pts':'2pts'):(three?'3x falha':'2x falha'), pts, color:col });

      const gBase = { ...g, teams, log:[...entries,...g.log] };
      if (keepPossession) return gBase;
      if (made) {
        // Cesto: o time que marcou USOU a posse dele → próxima posse é do adversário
        return endPossession(gBase, 1 - activeTeam, null);
      }
      // Erro: adversário pega a bola → posse do adversário
      return endPossession(gBase, 1 - activeTeam, null);
    });

    if (made) {
      showToast(`+${pts}${assistIdx!==null?' + assist':''}`);
      setActiveTeam(prev => 1 - prev);
      setSelectedPlayerA(null);
      setSelectedPlayerB(null);
    }
    setAssistPending(null);
  }, [activeTeam, setGameWithUndo, endPossession]);

  // ── handleCourtClick ────────────────────────────────────────────────────────
  const handleCourtClick = useCallback(e => {
    if (selectedPlayer === null) return;
    if (confirmShot||assistPending||foulPending||ftFlow||subModal||turnoverPending||reboundPending) return;
    if (game?.finished) { showToast('Jogo finalizado'); return; }
    if (!running) { showToast('Inicie o cronômetro para marcar'); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = (e.clientX-rect.left)/rect.width*100;
    const yPct = (e.clientY-rect.top)/rect.height*100;
    const dir = getAttackDir(activeTeam, game.quarter);
    const { valid, three, inPaint } = classifyShot(xPct,yPct,dir);
    if (!valid) { showToast('Arremesso no lado errado da quadra'); return; }
    setConfirmShot({ xPct, yPct, three, inPaint });
  }, [selectedPlayer, confirmShot, assistPending, foulPending, ftFlow, subModal, turnoverPending, reboundPending, running, activeTeam, game]);

  // ── applyMisc ───────────────────────────────────────────────────────────────
  const applyMisc = useCallback((action, teamIdx = activeTeam) => {
    const pIdx = teamIdx === 0 ? selectedPlayerA : selectedPlayerB;
    if (pIdx === null) { showToast('Selecione um atleta'); return; }

    if (action.id === 'fouls') { setFoulPending(true); return; }

    if (action.id === 'to') {
      // Abre modal para tipo de turnover
      setTurnoverPending(true);
      return;
    }

    if (action.id === 'reb') {
      setGameWithUndo(g => {
        const teams = g.teams.map((t,ti) => ti!==teamIdx?t:{ ...t, players: t.players.map((p,pi) => pi!==pIdx?p:{ ...p, reb:(p.reb||0)+1 }) });
        const pl = g.teams[teamIdx].players[pIdx];
        const entry = { id:Date.now(), q:getQuarterLabel(g.quarter), time:fmtTime(g.clock), team:g.teams[teamIdx].name, player:`#${pl.number} ${pl.name.split(' ')[0]}`, action:'Rebote', pts:0, color:'#06b6d4' };
        return endPossession({ ...g, teams, log:[entry,...g.log] }, teamIdx, pIdx);
      });
      showToast(`Rebote — #${game.teams[teamIdx].players[pIdx].number}`);
      return;
    }

    if (action.id === 'stl') {
      setGameWithUndo(g => {
        const teams = g.teams.map((t,ti) => ti!==teamIdx?t:{ ...t, players: t.players.map((p,pi) => pi!==pIdx?p:{ ...p, stl:(p.stl||0)+1 }) });
        const pl = g.teams[teamIdx].players[pIdx];
        const entry = { id:Date.now(), q:getQuarterLabel(g.quarter), time:fmtTime(g.clock), team:g.teams[teamIdx].name, player:`#${pl.number} ${pl.name.split(' ')[0]}`, action:'Roubo de Bola', pts:0, color:'#10b981' };
        return endPossession({ ...g, teams, log:[entry,...g.log] }, teamIdx, pIdx);
      });
      showToast(`Roubo — #${game.teams[teamIdx].players[pIdx].number}`);
      return;
    }

    if (action.id === 'foulsReceived') {
      setGameWithUndo(g => {
        const teams = g.teams.map((t,ti) => ti!==teamIdx?t:{ ...t, players: t.players.map((p,pi) => pi!==pIdx?p:{ ...p, foulsReceived:(p.foulsReceived||0)+1 }) });
        const pl = g.teams[teamIdx].players[pIdx];
        const entry = { id:Date.now(), q:getQuarterLabel(g.quarter), time:fmtTime(g.clock), team:g.teams[teamIdx].name, player:`#${pl.number} ${pl.name.split(' ')[0]}`, action:'Falta Sofrida', pts:0, color:'#c084fc' };
        return endPossession({ ...g, teams, log:[entry,...g.log] }, teamIdx, pIdx);
      });
      showToast(`Falta sofrida — #${game.teams[teamIdx].players[pIdx].number}`);
      return;
    }

    // Ações genéricas — com toast
    const toastLabels = { oreb:'Reb. ofensivo', blk:'Toco', to:'Turnover' };
    setGameWithUndo(g => {
      const teams = g.teams.map((t,ti) => ti!==teamIdx?t:{ ...t, players: t.players.map((p,pi) => pi!==pIdx?p:{ ...p, [action.id]:(p[action.id]||0)+1 }) });
      const pl = g.teams[teamIdx].players[pIdx];
      const entry = { id:Date.now(), q:getQuarterLabel(g.quarter), time:fmtTime(g.clock), team:g.teams[teamIdx].name, player:`#${pl.number} ${pl.name.split(' ')[0]}`, action:action.label, pts:0, color:action.color };
      return { ...g, teams, log:[entry,...g.log] };
    });
    const pl = game.teams[teamIdx].players[pIdx];
    showToast(`${toastLabels[action.id]||action.label} — #${pl.number} ${pl.name.split(' ')[0]}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeam, selectedPlayerA, selectedPlayerB, setGameWithUndo, endPossession, game]);

  // ── Render ──────────────────────────────────────────────────────────────────
  // Aguardando sessão do Supabase
  if (authLoading) return (
    <div className="app" style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}>
      <div style={{textAlign:'center',color:'var(--muted)',fontFamily:'var(--fd)'}}>
        <div style={{fontSize:'32px',marginBottom:'8px'}}>⏳</div>
        <div>Carregando...</div>
      </div>
    </div>
  );

  // Tela de login se não autenticado
  if (!user) return <LoginScreen onLogin={u => setUser(u)} />;

  if (screen === 'home') return (
    <div className="app">
      {showNewGame && <NewGameModal onStart={startGame} onClose={()=>setShowNewGame(false)}/>}
      <div className="home-screen">
        <div className="home-logo">
          <div className="logo-ball">
            <svg viewBox="0 0 60 60" width="60" height="60">
              <circle cx="30" cy="30" r="28" fill="#f97316" stroke="#c2530a" strokeWidth="1"/>
              <path d="M30 2 Q30 30 30 58" fill="none" stroke="#c2530a" strokeWidth="1.5"/>
              <path d="M2 30 Q30 30 58 30" fill="none" stroke="#c2530a" strokeWidth="1.5"/>
              <path d="M8 12 Q20 22 30 30 Q40 38 52 48" fill="none" stroke="#c2530a" strokeWidth="1.5"/>
              <path d="M52 12 Q40 22 30 30 Q20 38 8 48" fill="none" stroke="#c2530a" strokeWidth="1.5"/>
            </svg>
          </div>
          <div className="home-title">WinFast Basketball Scout</div>
          <div className="home-sub">Análise ao vivo · Open Source · PWA</div>
        </div>
        <div className="home-user-bar">
          <span className="home-user-email">{user.email}</span>
          <button className="home-logout-btn" onClick={async()=>{await signOut();setUser(null);setGames([]);}}>
            Sair
          </button>
        </div>
        <button className="btn-new-game" onClick={()=>setShowNewGame(true)}>+ Novo Jogo</button>
        {games.length > 0 && (
          <div className="recent-games">
            <div className="recent-label">Jogos Salvos</div>
            {games.slice(0,8).map(g=>(
              <div key={g.id} className="game-card" onClick={()=>openGame(g)}
                style={{position:'relative'}}>
                {user && <button className="delete-game-btn" title="Excluir jogo"
                  onClick={async e=>{
                    e.stopPropagation();
                    if(!window.confirm('Excluir este jogo?'))return;
                    await deleteGame(g.id).catch(()=>{});
                    setGames(prev=>{const n=prev.filter(x=>x.id!==g.id);saveGamesLocal(n);return n;});
                  }}>✕</button>}
                <div className="game-card-teams">
                  <span>{g.teams[0].name}</span>
                  <span className="game-card-score">{g.teams[0].score} — {g.teams[1].score}</span>
                  <span>{g.teams[1].name}</span>
                </div>
                <div className="game-card-meta">
                  <span>{g.gameDate||g.date}</span><span>{QUARTERS[g.quarter]||'OT'}</span><span>{g.log.length} eventos</span>
                  <div className="export-btns" onClick={e=>e.stopPropagation()}>
                    <button className="export-btn" onClick={()=>exportStatsCSV(g)}>Stats</button>
                    <button className="export-btn green" onClick={()=>exportShotsCSV(g)}>Arrem.</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ── GAME ────────────────────────────────────────────────────────────────────
  const td = game.teams[activeTeam];
  const sp = selectedPlayer !== null ? td.players[selectedPlayer] : null;
  const activeShots = sp ? (sp.shots||[]) : td.players.flatMap(p=>p.shots||[]);
  const tfq = (game.teamFouls?.[activeTeam]||[])[game.quarter]||0;
  const inBonus = tfq >= TEAM_FOUL_BONUS;

  // Renderiza painel de ações de um time
  const renderTeamPanel = (teamIdx) => {
    const team = game.teams[teamIdx];
    const pIdx = teamIdx===0 ? selectedPlayerA : selectedPlayerB;
    return (
      <div className="team-panel">
        <div className="team-title">{team.name}</div>
        <div className="players-grid">
          {team.players.map((p,pi)=>(
            <button key={pi} className="player-btn"
              data-active={(teamIdx===0?selectedPlayerA:selectedPlayerB)===pi}
              data-bench={!p.active}
              data-trouble={p.fouls>=FOUL_TROUBLE&&p.fouls<FOUL_DISQUALIFY}
              data-disq={p.fouls>=FOUL_DISQUALIFY||(p.techFouls||0)>=TECH_DISQUALIFY}
              data-drag-over={dragPlayer!==null&&dragTeam===teamIdx&&dragPlayer!==pi&&
                ((team.players[dragPlayer]?.active&&!p.active)||(!team.players[dragPlayer]?.active&&p.active))}
              data-dragging={dragPlayer===pi&&dragTeam===teamIdx}
              onClick={()=>{
                // Se há drag ativo: finaliza substituição
                if(dragPlayer!==null && dragTeam===teamIdx && dragPlayer!==pi){
                  const src=team.players[dragPlayer],dst=team.players[pi];
                  if(src.active!==dst.active){
                    const outIdx=src.active?dragPlayer:pi,inIdx=src.active?pi:dragPlayer;
                    setActiveTeam(teamIdx);
                    setSubModal({reason:null,outIdx,directInIdx:inIdx,canCancel:true});
                  } else {
                    showToast('Arraste titular ↔ reserva');
                  }
                  setDragPlayer(null); setDragTeam(null);
                  return;
                }
                // Seleção normal
                setActiveTeam(teamIdx);
                if(teamIdx===0)setSelectedPlayerA(pi); else setSelectedPlayerB(pi);
              }}
              onPointerDown={(e)=>{
                // Inicia long-press para arrastar (funciona em iOS, Android e desktop)
                e.currentTarget.setPointerCapture(e.pointerId);
                dragPos.current = { x:e.clientX, y:e.clientY };
                dragLongPress.current = setTimeout(()=>{
                  setDragPlayer(pi);
                  setDragTeam(teamIdx);
                  showToast('Segure e toque outro jogador para substituir');
                }, 500);
              }}
              onPointerMove={(e)=>{
                // Cancela long-press se moveu muito
                const dx=Math.abs(e.clientX-dragPos.current.x);
                const dy=Math.abs(e.clientY-dragPos.current.y);
                if(dx>10||dy>10) clearTimeout(dragLongPress.current);
              }}
              onPointerUp={()=>{ clearTimeout(dragLongPress.current); }}
              onPointerCancel={()=>{ clearTimeout(dragLongPress.current); setDragPlayer(null); setDragTeam(null); }}>
              <span className="pnum">#{p.number}</span>
              <span className="pname">{p.name.split(' ')[0]}</span>
              <span className="ppts">{p.pts}p</span>
              {p.fouls>0&&<span className="pfoul-badge"
                data-trouble={p.fouls>=FOUL_TROUBLE&&p.fouls<FOUL_DISQUALIFY&&(p.techFouls||0)<TECH_DISQUALIFY}
                data-disq={p.fouls>=FOUL_DISQUALIFY||(p.techFouls||0)>=TECH_DISQUALIFY}>
                {p.fouls}f{p.techFouls>0?`+${p.techFouls}t`:''}
              </span>}
            </button>
          ))}
        </div>
        <section className="actions-section">
          <div className="actions-group">
            <div className="actions-group-label">Lances Livres</div>
            <div className="actions-row">
              <button className="action-btn" style={{'--ac':'#f59e0b'}} onClick={()=>{
                if(pIdx===null){showToast('Selecione um atleta');return;}
                setActiveTeam(teamIdx);
                // Abre fluxo: sabe o jogador, pede a quantidade
                setFtFlow({ step:'pick_quantity', teamIdx, playerIdx:pIdx, total:0, attempt:1, made:[], fromBonus:false });
              }}>Lance Livre</button>
            </div>
          </div>
          <div className="actions-group">
            <div className="actions-group-label">Outras Ações</div>
            <div className="actions-row wrap">
              {MISC_ACTIONS.map(a=>(
                <button key={a.id} className="action-btn" style={{'--ac':a.color}}
                  onClick={()=>{ setActiveTeam(teamIdx); applyMisc(a, teamIdx); }}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    );
  };

  return (
    <div className="app">
      {toast && <div className="toast">{toast}</div>}

      {/* Modais */}
      {confirmShot && (
        <ConfirmShotModal
          three={confirmShot.three} inPaint={confirmShot.inPaint}
          onMade={(shotType)=>{ const s=confirmShot; setConfirmShot(null); setAssistPending({scorerIdx:selectedPlayer,xPct:s.xPct,yPct:s.yPct,made:true,three:s.three,shotType}); }}
          onMissed={(shotType)=>{ const s=confirmShot; setConfirmShot(null); setReboundPending({ playerIdx:selectedPlayer, xPct:s.xPct, yPct:s.yPct, three:s.three, shotType }); }}
          onCancel={()=>setConfirmShot(null)}
        />
      )}
      {assistPending && (
        <AssistModal players={td.players} scorerIdx={assistPending.scorerIdx}
          onSelect={aIdx=>commitShot(assistPending.scorerIdx,assistPending.xPct,assistPending.yPct,true,assistPending.three,aIdx,assistPending.shotType)}
          onNone={()=>commitShot(assistPending.scorerIdx,assistPending.xPct,assistPending.yPct,true,assistPending.three,null,assistPending.shotType)}
          onCancel={()=>setAssistPending(null)}
        />
      )}
      {foulPending && sp && (
        <FoulModal player={sp} teamFoulsInQuarter={tfq} onType={commitFoul} onCancel={()=>setFoulPending(false)}/>
      )}
      {turnoverPending && (
        <TurnoverModal
          activeTeamPlayers={game.teams[1-activeTeam].players}
          onType={(toType, stealerIdx) => commitTurnover(toType, stealerIdx)}
          onCancel={() => setTurnoverPending(false)}
        />
      )}
      {reboundPending && (
        <MissedShotReboundModal
          attackingPlayers={game.teams[activeTeam].players}
          onRebound={(rebPlayerIdx) => {
            // Rebote ofensivo: registra arremesso errado + rebote, mantém posse
            const r = reboundPending;
            commitShot(r.playerIdx, r.xPct, r.yPct, false, r.three, null, r.shotType, true /* keepPossession */);
            if (rebPlayerIdx !== null) {
              // Credita rebote ofensivo ao jogador
              setGameWithUndo(g => {
                const teams = g.teams.map((t, ti) => {
                  if (ti !== activeTeam) return t;
                  return { ...t, players: t.players.map((p, pi) =>
                    pi === rebPlayerIdx ? { ...p, oreb: (p.oreb||0)+1 } : p
                  )};
                });
                const pl = g.teams[activeTeam].players[rebPlayerIdx];
                const entry = { id: Date.now(), q: getQuarterLabel(g.quarter), time: fmtTime(g.clock),
                  team: g.teams[activeTeam].name, player: `#${pl.number} ${pl.name.split(' ')[0]}`,
                  action: 'Reb. Ofensivo', pts: 0, color: '#0891b2' };
                return { ...g, teams, log: [entry, ...g.log] };
              });
              // Troca seletor para o jogador que pegou o rebote
              if (activeTeam === 0) setSelectedPlayerA(rebPlayerIdx);
              else setSelectedPlayerB(rebPlayerIdx);
            }
            setReboundPending(null);
          }}
          onNoRebound={() => {
            const r = reboundPending;
            const opp = 1 - activeTeam;
            commitShot(r.playerIdx, r.xPct, r.yPct, false, r.three, null, r.shotType, false);
            setReboundPending(null);
            // Adversário pegou: troca seletor para o time adversário
            setActiveTeam(opp);
            setSelectedPlayerA(null);
            setSelectedPlayerB(null);
          }}
          onCancel={() => setReboundPending(null)}
        />
      )}
      {/* ── Fluxo completo de Lance Livre ── */}
      {ftFlow?.step==='pick_player' && (
        <FreeThrowModal
          players={game.teams[ftFlow.teamIdx].players}
          title={ftFlow.fromBonus ? 'Bonificação — quem arremessa?' : 'Lance Livre — quem arremessa?'}
          onSelect={idx => setFtFlow(f => ({...f, step:'pick_quantity', playerIdx:idx}))}
          onCancel={() => setFtFlow(null)}
        />
      )}
      {ftFlow?.step==='pick_quantity' && ftFlow.playerIdx !== null && (
        <FTQuantityModal
          player={game.teams[ftFlow.teamIdx].players[ftFlow.playerIdx]}
          onChoose={n => setFtFlow(f => ({...f, total:n, attempt:1, step:'result'}))}
          onCancel={() => setFtFlow(null)}
        />
      )}
      {ftFlow?.step==='result' && ftFlow.playerIdx !== null && (()=>{
        const pl = game.teams[ftFlow.teamIdx].players[ftFlow.playerIdx];
        const isLast = ftFlow.attempt === ftFlow.total;
        return (
          <FreeThrowResultModal
            player={pl}
            attempt={ftFlow.attempt}
            totalAttempts={ftFlow.total}
            onMade={() => {
              commitFT(ftFlow.teamIdx, ftFlow.playerIdx, true);
              if (!isLast) {
                setFtFlow(f => ({...f, attempt: f.attempt+1, made:[...f.made, true]}));
              } else {
                // Último LL convertido → posse adversário, troca seletor
                finishFTSequence(ftFlow.teamIdx, true);
              }
            }}
            onMissed={() => {
              commitFT(ftFlow.teamIdx, ftFlow.playerIdx, false);
              if (!isLast) {
                setFtFlow(f => ({...f, attempt: f.attempt+1, made:[...f.made, false]}));
              } else {
                // Último LL errado → abre modal de rebote
                finishFTSequence(ftFlow.teamIdx, false);
              }
            }}
            onCancel={() => setFtFlow(null)}
          />
        );
      })()}
      {ftFlow?.step==='rebound' && (
        <FTReboundModal
          attackingPlayers={game.teams[ftFlow.teamIdx].players}
          onOwnRebound={(rebIdx) => {
            // Nosso time pegou o rebote: soma posse pro time do LL, mantém seletor
            setGame(g => {
              let updated = endPossession(g, ftFlow.teamIdx, null);
              if (rebIdx !== null) {
                const teams = updated.teams.map((t,ti) => ti!==ftFlow.teamIdx ? t : ({
                  ...t, players: t.players.map((p,pi) =>
                    pi===rebIdx ? {...p, oreb:(p.oreb||0)+1} : p)
                }));
                const rp = updated.teams[ftFlow.teamIdx].players[rebIdx];
                const entry = {id:Date.now(),q:getQuarterLabel(updated.quarter),time:fmtTime(updated.clock),
                  team:updated.teams[ftFlow.teamIdx].name,player:`#${rp.number} ${rp.name.split(' ')[0]}`,
                  action:'Reb. LL',pts:0,color:'#0891b2'};
                updated = {...updated, teams, log:[entry,...updated.log]};
              }
              return updated;
            });
            showToast('Rebote LL — segue posse');
            setFtFlow(null);
          }}
          onOpponentRebound={() => {
            // Adversário pegou: posse + seletor pro adversário
            const opp = 1 - ftFlow.teamIdx;
            setGame(g => endPossession(g, opp, null));
            setActiveTeam(opp);
            setSelectedPlayerA(null);
            setSelectedPlayerB(null);
            showToast('Rebote adversário — posse trocada');
            setFtFlow(null);
          }}
          onCancel={() => setFtFlow(null)}
        />
      )}
      {subModal&&subModal.directInIdx!==undefined&&(
        <div className="confirm-overlay"><div className="confirm-modal">
          <div className="confirm-title">Confirmar substituição?</div>
          <div className="ft-player-label">
            #{td.players[subModal.outIdx]?.number} {td.players[subModal.outIdx]?.name.split(' ')[0]} → #{td.players[subModal.directInIdx]?.number} {td.players[subModal.directInIdx]?.name.split(' ')[0]}
          </div>
          <div className="confirm-btns">
            <button className="confirm-btn made" onClick={()=>executeDirectSub(subModal.outIdx,subModal.directInIdx)}>Confirmar</button>
            <button className="confirm-btn missed" onClick={()=>setSubModal(null)}>Cancelar</button>
          </div>
        </div></div>
      )}
      {subModal&&subModal.directInIdx===undefined&&(
        <SubModal title="Substituição" reason={subModal.reason} players={td.players}
          outPlayerIdx={subModal.outIdx} onSub={executeSub}
          onCancel={()=>setSubModal(null)} canCancel={subModal.canCancel!==false}/>
      )}

      {/* Header */}
      <header className="header">
        <div className="header-top">
          <button className="back-btn" onClick={()=>{setRunning(false);setScreen('home');}}>‹ Voltar</button>
          <div className="header-game-label">
            {game.teams[0].name} vs {game.teams[1].name}
            {user && running && <span className="sync-badge online">● online</span>}
            {user && !running && syncStatus==='syncing' && <span className="sync-badge syncing">↑ salvando</span>}
            {user && !running && syncStatus==='saved'   && <span className="sync-badge saved">✓ salvo</span>}
            {user && !running && syncStatus==='error'   && <span className="sync-badge error">✗ offline</span>}
          </div>
          <div className="export-btns">
            <button className="export-btn-sm" onClick={()=>exportStatsCSV(game)}>Stats</button>
            <button className="export-btn-sm green" onClick={()=>exportShotsCSV(game)}>Arrem.</button>
            <button className="export-btn-sm" style={{color:'var(--blue)'}} onClick={()=>exportLogCSV(game)}>Log</button>
          </div>
        </div>
        <div className="scoreboard">
          {/* Time A + botão Sub */}
          <div className="team-score-wrap">
            <div className="team-score" data-active={activeTeam===0}
              onClick={()=>{setActiveTeam(0);setSelectedPlayerA(null);setSelectedPlayerB(null);}}>
              <span className="team-name">{game.teams[0].name}</span>
              <span className="score">{game.teams[0].score}</span>
              <div className="team-foul-dots">
                {[1,2,3,4,5].map(n=><span key={n} className="foul-dot"
                  data-filled={((game.teamFouls?.[0]||[])[game.quarter]||0)>=n}
                  data-bonus={n===TEAM_FOUL_BONUS}/>)}
              </div>
            </div>
            <button className="sub-score-btn" onClick={()=>{
              setActiveTeam(0);
              if(selectedPlayerA===null){showToast('Selecione atleta do Time A');return;}
              setSubModal({reason:null,outIdx:selectedPlayerA,canCancel:true});
            }} title="Substituição Time A">↕</button>
          </div>

          {/* Centro: play | tempo | next-q | desfazer */}
          <div className="center-info">
            <span className="quarter-label">{getQuarterLabel(game.quarter)}</span>
            <div className="clock-row">
              <button className={`clock-play-btn ${running?'playing':'paused'}`} onClick={()=>setRunning(r=>!r)}>
                {running?'⏸':'▶'}
              </button>
              <div className="clock">{fmtTime(game.clock)}</div>
              <button className="next-q-btn"
                data-finished={game.quarter>=3&&game.teams[0].score!==game.teams[1].score}
                onClick={()=>{
                  // Bloquear se o tempo não acabou
                  if(game.clock > 0){
                    const periodName = getQuarterLabel(game.quarter);
                    const remaining = fmtTime(game.clock);
                    showToast(`Ainda faltam ${remaining} no ${periodName}`);
                    return;
                  }
                  const[s0,s1]=[game.teams[0].score,game.teams[1].score];
                  // Após 4T ou qualquer OT: se desempatado finaliza
                  if(game.quarter>=3 && s0!==s1){
                    setGame(g=>({...g,finished:true}));
                    return;
                  }
                  // Empatado: próxima prorrogação
                  nextQuarter();
                }}>
                {game.quarter>=3&&game.teams[0].score!==game.teams[1].score
                  ? (game.clock>0 ? `${fmtTime(game.clock)}` : 'Finalizar')
                  : (game.clock>0 ? `${fmtTime(game.clock)}` : `›${getQuarterLabel(game.quarter+1)}`)}
              </button>
              <button className="undo-btn-clock" onClick={undoLastAction} title="Desfazer">↩</button>
            </div>
          </div>

          {/* Time B + botão Sub */}
          <div className="team-score-wrap">
            <button className="sub-score-btn" onClick={()=>{
              setActiveTeam(1);
              if(selectedPlayerB===null){showToast('Selecione atleta do Time B');return;}
              setSubModal({reason:null,outIdx:selectedPlayerB,canCancel:true});
            }} title="Substituição Time B">↕</button>
            <div className="team-score right" data-active={activeTeam===1}
              onClick={()=>{setActiveTeam(1);setSelectedPlayerA(null);setSelectedPlayerB(null);}}>
              <span className="score">{game.teams[1].score}</span>
              <span className="team-name">{game.teams[1].name}</span>
              <div className="team-foul-dots">
                {[1,2,3,4,5].map(n=><span key={n} className="foul-dot"
                  data-filled={((game.teamFouls?.[1]||[])[game.quarter]||0)>=n}
                  data-bonus={n===TEAM_FOUL_BONUS}/>)}
              </div>
            </div>
          </div>
        </div>
        {inBonus&&<div className="bonus-bar">BONIFICAÇÃO — {game.teams[activeTeam].name} ({tfq} faltas no {getQuarterLabel(game.quarter)})</div>}
        <nav className="nav">
          {[['scout','Scout'],['stats','Stats'],['heatmap','Mapa'],['log','Log']].map(([v,l])=>(
            <button key={v} className="nav-btn" data-active={view===v} onClick={()=>setView(v)}>{l}</button>
          ))}
        </nav>
      </header>

      {game.finished&&(()=>{
        const[s0,s1]=[game.teams[0].score,game.teams[1].score];
        const winner=s0>s1?game.teams[0].name:game.teams[1].name;
        const ws=Math.max(s0,s1),ls=Math.min(s0,s1);
        return (
          <div className="game-over-banner">
            <div className="game-over-title">Jogo Finalizado</div>
            <div className="game-over-winner">{winner}</div>
            <div className="game-over-score">{ws} — {ls}</div>
            <button className="game-over-reset" onClick={()=>setGame(g=>({...g,finished:false}))}>Continuar editando</button>
          </div>
        );
      })()}

      {/* Scout */}
      {view==='scout'&&(
        <main className="scout-view" onClick={(e)=>{
          // If drag is active and click is not on a player button, cancel
          if(dragPlayer!==null && !e.target.closest('.player-btn')){
            setDragPlayer(null); setDragTeam(null);
          }
        }}>
          <section className="court-section" style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
            <div className="court-section-header">
              <div className="section-label" style={{padding:'8px 0 0'}}>
                {selectedPlayer!==null?`Toque na quadra — #${sp?.number} ${sp?.name.split(' ')[0]}`:'Mapa — selecione um atleta'}
              </div>
              {selectedPlayer!==null&&<div className="court-active-badge">● ao vivo</div>}
            </div>
            <div className="game-layout" style={{flex:1,minHeight:0}}>
              {renderTeamPanel(0)}
              <div className="court-container">
                <BasketballCourt shots={activeShots} onCourtClick={handleCourtClick}
                  hasPlayer={selectedPlayer!==null} attackDir={getAttackDir(activeTeam, game.quarter)}/>
              </div>
              {renderTeamPanel(1)}
            </div>

            {/* Estatísticas de arremesso — imediatamente abaixo da quadra */}
            {activeShots.length>0&&(()=>{
              const twos  = activeShots.filter(s=>!s.three);
              const threes= activeShots.filter(s=>s.three);
              const sp2m  = twos.filter(s=>s.made).length;
              const sp3m  = threes.filter(s=>s.made).length;
              // LL vem das stats do atleta ou soma dos shots não tem LL
              const ftm   = sp ? (sp.ftm||0) : td.players.reduce((a,p)=>a+(p.ftm||0),0);
              const fta   = sp ? (sp.fta||0) : td.players.reduce((a,p)=>a+(p.fta||0),0);
              return (
                <div className="shot-summary-full">
                  <div className="shot-sum-row">
                    <span className="shot-sum-label">FG</span>
                    <span className="shot-sum-val">{pct(activeShots.filter(s=>s.made).length,activeShots.length)}</span>
                    <span className="shot-sum-sub">{activeShots.filter(s=>s.made).length}/{activeShots.length}</span>
                  </div>
                  <div className="shot-sum-divider"/>
                  <div className="shot-sum-row">
                    <span className="shot-sum-label">2pts</span>
                    <span className="shot-sum-val">{pct(sp2m,twos.length)}</span>
                    <span className="shot-sum-sub">{sp2m}/{twos.length}</span>
                  </div>
                  <div className="shot-sum-divider"/>
                  <div className="shot-sum-row">
                    <span className="shot-sum-label">3pts</span>
                    <span className="shot-sum-val">{pct(sp3m,threes.length)}</span>
                    <span className="shot-sum-sub">{sp3m}/{threes.length}</span>
                  </div>
                  <div className="shot-sum-divider"/>
                  <div className="shot-sum-row">
                    <span className="shot-sum-label">LL</span>
                    <span className="shot-sum-val">{pct(ftm,fta)}</span>
                    <span className="shot-sum-sub">{ftm}/{fta}</span>
                  </div>
                </div>
              );
            })()}

            {/* Stats do atleta — abaixo das estatísticas de arremesso */}
            {sp&&(
              <div className="selected-bar below-court">
                <span className="sel-badge">#{sp.number} {sp.name}</span>
                <div className="sel-mini-stats">
                  {[['PTS',sp.pts],['AST',sp.ast],['REB',sp.reb],['RO',sp.oreb],['STL',sp.stl],['BLK',sp.blk],['TO',sp.to]].map(([k,v])=>(
                    <span key={k} className="mini-stat" data-warn={k==='TO'&&v>2}><b>{v}</b>{k}</span>
                  ))}
                  <span className="mini-stat" data-warn={sp.fouls>=FOUL_TROUBLE} data-danger={sp.fouls>=FOUL_DISQUALIFY}>
                    <b>{sp.fouls}</b>FL
                  </span>
                  <span className="mini-stat"><b>{sp.foulsReceived||0}</b>FS</span>
                  <span className="mini-stat" style={{color:'var(--muted)'}}><b>{sp.possessions||0}</b>POS</span>
                  <span className="mini-stat" style={{color:sp.plusMinus>0?'var(--green)':sp.plusMinus<0?'var(--red)':''}}><b>{sp.plusMinus>=0?`+${sp.plusMinus}`:sp.plusMinus}</b>+/-</span>
                </div>
              </div>
            )}
          </section>
        </main>
      )}

      {/* Stats */}
      {view==='stats'&&(
        <main className="stats-view">
          <div className="fouls-summary">
            <div className="fouls-summary-title">Faltas coletivas por período</div>
            <table className="fouls-table">
              <thead><tr>
                <th>Time</th>
                {Array.from({length:game.quarter+1},(_,i)=><th key={i}>{getQuarterLabel(i)}</th>)}
                <th>Total</th>
              </tr></thead>
              <tbody>
                {game.teams.map((t,ti)=>{
                  const tf=game.teamFouls?.[ti]||[];
                  return <tr key={ti}>
                    <td className="player-cell">{t.name}</td>
                    {Array.from({length:game.quarter+1},(_,qi)=><td key={qi} data-warn={(tf[qi]||0)>=TEAM_FOUL_BONUS}>{tf[qi]||0}</td>)}
                    <td className="pts-cell">{tf.reduce((a,b)=>a+b,0)}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {game.teams.map((team,ti)=>{
            const tot=totals(team);
            const active=team.players.filter(p=>
              p.active||p.pts||p.ast||p.reb||p.oreb||p.stl||p.blk||
              p.to||p.fg2a||p.fg3a||p.ftm||p.fta||p.fouls||(p.plusMinus||0)!==0||(p.possessions||0)>0
            );
            return (
              <div key={ti} className="stats-block">
                <div className="stats-header">
                  <span>{team.name}</span>
                  <div style={{display:'flex',gap:'16px',alignItems:'center'}}>
                    <span className="stats-possessions">{(game.possessions||[0,0])[ti]||0} posses</span>
                    <span className="stats-total-score">{team.score} pts</span>
                  </div>
                </div>
                {active.length===0&&<div className="empty-stats">Sem dados ainda</div>}
                {active.length>0&&(
                  <div className="table-wrap">
                    <table className="stats-table">
                      <thead><tr>
                        <th>Atleta</th><th>MIN</th><th>POS</th><th>PTS</th><th>AST</th>
                        <th>REB</th><th>RO</th><th>STL</th><th>BLK</th><th>TO</th>
                        <th>2P</th><th>FG%</th><th>3P</th><th>3P%</th>
                        <th>LL</th><th>LL%</th><th>FL</th><th>FS</th><th>+/-</th><th>PIR</th>
                      </tr></thead>
                      <tbody>
                        {active.map(p=>(
                          <tr key={p.id} data-disq={p.fouls>=FOUL_DISQUALIFY||(p.techFouls||0)>=TECH_DISQUALIFY}>
                            <td className="player-cell">
                              <span className="num-badge">#{p.number}</span>{p.name}
                              {(p.fouls>=FOUL_DISQUALIFY||(p.techFouls||0)>=TECH_DISQUALIFY)&&<span className="disq-tag">DQ</span>}
                            </td>
                            <td className="min-cell">{Math.floor((p.timeOnCourt||0)/60)}:{String(Math.round((p.timeOnCourt||0)%60)).padStart(2,'0')}</td>
                            <td style={{fontWeight:600,color:'var(--muted)'}}>{p.possessions||0}</td>
                            <td className="pts-cell">{p.pts}</td>
                            <td>{p.ast}</td><td>{p.reb}</td><td>{p.oreb}</td>
                            <td>{p.stl}</td><td>{p.blk}</td>
                            <td data-warn={p.to>2}>{p.to}</td>
                            <td className="shot-cell">{p.fg2m}/{p.fg2a}</td>
                            <td>{pct(p.fg2m,p.fg2a)}</td>
                            <td className="shot-cell">{p.fg3m}/{p.fg3a}</td>
                            <td>{pct(p.fg3m,p.fg3a)}</td>
                            <td className="shot-cell">{p.ftm}/{p.fta}</td>
                            <td>{pct(p.ftm,p.fta)}</td>
                            <td data-warn={p.fouls>=FOUL_TROUBLE&&p.fouls<FOUL_DISQUALIFY} data-danger={p.fouls>=FOUL_DISQUALIFY||(p.techFouls||0)>=TECH_DISQUALIFY}>{p.fouls}{p.techFouls>0?`+${p.techFouls}t`:''}</td>
                            <td style={{color:'var(--blue)'}}>{p.foulsReceived||0}</td>
                            <td className={(p.plusMinus||0)>0?'pm-pos':(p.plusMinus||0)<0?'pm-neg':''}>{(p.plusMinus||0)>=0?`+${p.plusMinus||0}`:p.plusMinus||0}</td>
                            <td className={calcPIR(p)>0?'pm-pos':calcPIR(p)<0?'pm-neg':''}>{calcPIR(p)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr>
                        <td>Time</td><td className="min-cell"></td>
                        <td style={{fontWeight:600}}>{tot.possessions||0}</td>
                        <td className="pts-cell">{tot.pts}</td>
                        <td>{tot.ast}</td><td>{tot.reb}</td><td>{tot.oreb}</td>
                        <td>{tot.stl}</td><td>{tot.blk}</td><td>{tot.to}</td>
                        <td className="shot-cell">{tot.fg2m}/{tot.fg2a}</td>
                        <td>{pct(tot.fg2m,tot.fg2a)}</td>
                        <td className="shot-cell">{tot.fg3m}/{tot.fg3a}</td>
                        <td>{pct(tot.fg3m,tot.fg3a)}</td>
                        <td className="shot-cell">{tot.ftm}/{tot.fta}</td>
                        <td>{pct(tot.ftm,tot.fta)}</td>
                        <td>{tot.fouls}</td><td></td><td></td><td></td>
                      </tr></tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </main>
      )}

      {/* Heatmap */}
      {view==='heatmap'&&(
        <main className="heatmap-view">
          {game.teams.map((team,ti)=>(
            <HeatMap key={ti} shots={team.players.flatMap(p=>p.shots||[])}
              teamName={team.name} attackDir={getAttackDir(ti, game.quarter)}
              teamIdx={ti}/>
          ))}
        </main>
      )}

      {/* Log */}
      {view==='log'&&(
        <main className="log-view">
          <div className="log-top">
            <span>{game.log.length} eventos</span>
            {game.log.length>0&&<button className="clear-btn" onClick={()=>window.confirm('Limpar?')&&setGame(g=>({...g,log:[]}))}>Limpar</button>}
          </div>
          {game.log.length===0&&<div className="empty-log">Sem eventos.</div>}
          <div className="log-list">
            {game.log.map(e=>(
              <div key={e.id} className="log-entry">
                <div className="log-meta"><span className="log-q">{e.q}</span><span>{e.time}</span><span className="log-team-name">{e.team}</span></div>
                <div className="log-body">
                  <span className="log-player">{e.player}</span>
                  <span className="log-action" style={{color:e.color}}>{e.action}</span>
                  {e.pts>0&&<span className="log-pts">+{e.pts}</span>}
                </div>
              </div>
            ))}
          </div>
        </main>
      )}
    </div>
  );
}
