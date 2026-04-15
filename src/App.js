import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const BASE_QUARTERS = ['1Q', '2Q', '3Q', '4Q'];
const getQuarterLabel = (q) => q < 4 ? BASE_QUARTERS[q] : `OT${q - 3}`;
const QUARTERS = BASE_QUARTERS; // mantido para compatibilidade de log
const STORAGE_KEY = 'bball_scout_games';
const FOUL_DISQUALIFY = 6;   // faltas para disqualificação
const FOUL_TROUBLE    = 4;   // faltas para foul trouble
const TEAM_FOUL_BONUS = 5;   // faltas coletivas para bonificação
const TECH_DISQUALIFY = 2;   // técnicas/antidesportivas para substituição obrigatória

const INITIAL_PLAYER = () => ({
  pts: 0, ast: 0, reb: 0, oreb: 0, stl: 0, blk: 0, to: 0,
  fg2a: 0, fg2m: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0,
  fouls: 0, techFouls: 0, foulsReceived: 0,
  plusMinus: 0,
  timeOnCourt: 0,
  entryTime: null,
  shots: [],
  possessions: 0 // ✅ NOVO
});

// PIR = PTS + REB + AST + STL + BLK + (FGM - FGA) + (FTM - FTA) - TO - FOULS
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
];
const DEFAULT_TEAM_B = [
  {number:'05',name:'M. Ribeiro'},{number:'08',name:'N. Cardoso'},{number:'13',name:'O. Dias'},
  {number:'17',name:'P. Carvalho'},{number:'22',name:'Q. Monteiro'},{number:'03',name:'R. Teixeira'},
  {number:'06',name:'S. Figueira'},{number:'09',name:'T. Brito'},{number:'16',name:'U. Correia'},
  {number:'18',name:'V. Barbosa'},{number:'20',name:'W. Cunha'},{number:'25',name:'X. Lopes'},
];

const mkTeam = (name, roster) => ({
  name, score: 0,
  players: roster.map((p, i) => ({
    id: i+1, ...p, active: i < 5, ...INITIAL_PLAYER(),
    // Titulares começam com entryTime = null (começa quando clock inicia)
  }))
});

const newGame = (nameA='Time A', nameB='Time B', rosterA=DEFAULT_TEAM_A, rosterB=DEFAULT_TEAM_B) => ({
  id: Date.now(),
  date: new Date().toLocaleDateString('pt-BR'),
  dateFull: new Date().toISOString(),
  teams: [mkTeam(nameA, rosterA), mkTeam(nameB, rosterB)],
  quarter: 0, clock: 600, log: [], finished: false,
  teamFouls: [[0,0,0,0,0],[0,0,0,0,0]],
  possessions: [0, 0],  // posses por time
  lastActionWasTurnover: false // ✅ NOVO
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

const FT_ACTIONS = [
  { id:'ftm',    label:'LL certo', pts:1, color:'#f59e0b' },
  { id:'ftmiss', label:'LL erro',  pts:0, color:'#475569' },
];

const fmtTime = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
const pct = (m,a) => { if (!a || a===0) return '—'; const v = m/a*100; return `${Math.round(v)}%`; };
const totals = team => team.players.reduce((acc, p) => {
  ['pts','ast','reb','oreb','stl','blk','to','fg2m','fg2a','fg3m','fg3a','ftm','fta','fouls','foulsReceived']
    .forEach(k => acc[k] = (acc[k]||0) + (p[k]||0));
  return acc;
}, {});

function loadGames() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } }
function saveGames(g) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(g)); } catch {} }

function dl(content, filename) {
  const b = new Blob(['\ufeff'+content], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = filename; a.click();
}
function exportStatsCSV(game) {
  const lines = ['Atleta,Time,MIN,PTS,AST,REB,REB.OF,STL,BLK,TO,FG2M,FG2A,FG%,FG3M,FG3A,3P%,FTM,FTA,LL%,FALTAS,FALTAS.SOF,+/-,PIR,POSSES'];
  game.teams.forEach((t, ti) => {
    t.players.forEach(p => {
      const pm = (p.plusMinus||0) >= 0 ? `+${p.plusMinus||0}` : `${p.plusMinus||0}`;
      const min = `${Math.floor((p.timeOnCourt||0)/60)}:${String(Math.round((p.timeOnCourt||0)%60)).padStart(2,'0')}`;
      lines.push(`"#${p.number} ${p.name}","${t.name}",${min},${p.pts},${p.ast},${p.reb},${p.oreb},${p.stl},${p.blk},${p.to},${p.fg2m},${p.fg2a},${pct(p.fg2m+p.fg3m,p.fg2a+p.fg3a)},${p.fg3m},${p.fg3a},${pct(p.fg3m,p.fg3a)},${p.ftm},${p.fta},${pct(p.ftm,p.fta)},${p.fouls},${p.foulsReceived||0},${pm},${calcPIR(p)},${p.possessions || 0}`);
    });
    const tot = totals(t);
    const teamPoss = (game.possessions||[0,0])[ti]||0;
    lines.push(`"TOTAL","${t.name}",,${tot.pts},${tot.ast},${tot.reb},${tot.oreb},${tot.stl},${tot.blk},${tot.to},${tot.fg2m},${tot.fg2a},${tot.fg3m},${tot.fg3a},${tot.ftm},${tot.fta},${pct(tot.fg2m+tot.fg3m,tot.fg2a+tot.fg3a)},${pct(tot.fg3m,tot.fg3a)},${pct(tot.ftm,tot.fta)},${tot.fouls},,,${teamPoss}`);
  });
  dl(lines.join('\n'), `stats_${game.teams[0].name}_vs_${game.teams[1].name}_${game.date.replace(/\//g,'-')}.csv`);
}
function exportLogCSV(game) {
  const lines = ['Quarto,Tempo,Time,Atleta,Acao,Pontos'];
  game.log.forEach(e => {
    lines.push(`"${e.q}","${e.time}","${e.team}","${e.player}","${e.action}",${e.pts}`);
  });
  dl(lines.join('\n'), `log_${game.teams[0].name}_vs_${game.teams[1].name}_${game.date.replace(/\//g,'-')}.csv`);
}

function exportShotsCSV(game) {
  const lines = ['Atleta,Time,Quarto,Tempo,X_pct,Y_pct,Convertido,Zona,Subtipo,Assistencia'];
  game.teams.forEach(t => t.players.forEach(p =>
    (p.shots||[]).forEach(s => {
      // Subtipo: 3pts → Arremesso | 2pts fora garrafão → Arremesso | 2pts garrafão → tipo selecionado
      const subtipo = s.three ? 'Arremesso' : (s.shotType && s.shotType !== '3pts' ? s.shotType : 'Arremesso');
      lines.push(`"#${p.number} ${p.name}","${t.name}","${s.q||''}","${s.time||''}",${s.x.toFixed(2)},${s.y.toFixed(2)},${s.made?'Sim':'Não'},${s.three?'3pts':'2pts'},"${subtipo}","${s.assistedBy||''}"`);
    })));
  dl(lines.join('\n'), `arremessos_${game.teams[0].name}_vs_${game.teams[1].name}_${game.date.replace(/\//g,'-')}.csv`);
}

// ─── isThreePointer ──────────────────────────────────────────────────────────
// SVG 600x320 — NBB oficial
// Cesta esq: cx1=34, cy=160 | Cesta dir: cx2=566, cy=160
// Garrafão: ftX1=124 (esq), ftX2=476 (dir)
// Linha 3pts: latY1=19 (topo), latY2=301 (base) — 90cm das laterais
// Arco 3pts: raio arcR=145 | arcX1=67, arcX2=533 (onde arco toca latY)
//
// Regra: ponto é 3pts se:
//   1) py < latY1 ou py > latY2 (acima/abaixo da linha lateral — corner)
//   2) px <= arcX1 (lado esq) ou px >= arcX2 (lado dir) — corredor lateral
//   3) distância da cesta mais próxima > arcR
// attackDir: 'right' = time ataca para a cesta da direita (cx2=566)
//            'left'  = time ataca para a cesta da esquerda (cx1=34)
// Valida também se o clique está no lado de ataque correto.
// Retorna { valid, three } — valid=false se clicou no lado errado.
// attackDir: 'right' = time ataca cesta direita | 'left' = cesta esquerda
// Regras:
//   - Qualquer clique é válido (ambos os lados da quadra)
//   - Na metade de DEFESA (lado oposto à cesta de ataque) = sempre 3pts
//   - Na metade de ATAQUE = classifica normalmente (2 ou 3 pela linha de 3pts)
function classifyShot(xPct, yPct, attackDir) {
  const W = 600, H = 320, cy = 160;
  const cx1 = 34,  cx2 = 566;
  const arcR = 145;
  const latY1 = 19, latY2 = 301;
  const midX = W / 2;
  const BORDER = 2;
  // Garrafão: ftX1=124 (esq), ftX2=476 (dir), paintH=52px (cy±52)
  const ftX1 = 124, ftX2 = 476, paintH = 52;

  const px = xPct * W / 100;
  const py = yPct * H / 100;

  // Detecta se está no garrafão do lado de ataque
  let inPaint = false;
  if (attackDir === 'right') {
    // Garrafão direito: x entre ftX2 e W, y entre cy-paintH e cy+paintH
    inPaint = px >= ftX2 && py >= cy - paintH && py <= cy + paintH;
  } else {
    // Garrafão esquerdo: x entre 0 e ftX1, y entre cy-paintH e cy+paintH
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

// ─── Quadra SVG ──────────────────────────────────────────────────────────────
// Medidas NBB oficiais — SVG 600x320
// sx=0.2143px/cm, sy=0.2133px/cm
// Cesta: (34,160) esq | (566,160) dir
// Garrafão: 124x104px | LL: x=124 (esq), x=476 (dir) | Raio LL: 39px
// Linha 3pts lateral: y=19 (topo), y=301 (base)
// Arco 3pts: raio=145px, início x=67 (esq), x=533 (dir)
// Área restrita: raio=23px
function BasketballCourt({ shots=[], onCourtClick, hasPlayer=false, attackDir='right' }) {
  // attackDir: 'right' = time ataca para direita (cesta dir), 'left' = ataca para esquerda (cesta esq)
  const W=600, H=320, cy=160;
  const cx1=34,  cx2=566;   // cestas
  const ftX1=124, ftX2=476; // linha de LL
  const ftR=39;              // raio semicírculo LL
  const arcR=145;            // raio arco 3pts
  const latY1=19, latY2=301; // linha lateral de 3pts
  const arcX1=67, arcX2=533; // x onde arco toca y=latY1/latY2
  const paintH=52;           // metade altura garrafão (cy±52)

  // Zona de 3pts: corners + área além do arco
  // Esq corner topo: retângulo entre borda e início do arco, acima da linha lateral
  const cornerTL = `M 2 2 L ${arcX1} 2 L ${arcX1} ${latY1} L 2 ${latY1} Z`;
  const cornerBL = `M 2 ${latY2} L ${arcX1} ${latY2} L ${arcX1} ${H-2} L 2 ${H-2} Z`;
  // Esq corredor: entre borda e arcX1, entre latY1 e latY2
  const corridorL = `M 2 ${latY1} L ${arcX1} ${latY1} L ${arcX1} ${latY2} L 2 ${latY2} Z`;
  // Esq além do arco: entre arcX1 e W/2, além do arco
  // Representado como: arco vai de (arcX1,latY1) até (arcX1,latY2) sweep=1 (grande arco)
  // A zona além fica entre o arco e W/2
  const beyondL = `M ${arcX1} ${latY1} A ${arcR} ${arcR} 0 0 1 ${arcX1} ${latY2} L ${W/2} ${latY2} L ${W/2} ${latY1} Z`;

  // Dir mirrors
  const cornerTR = `M ${W-2} 2 L ${arcX2} 2 L ${arcX2} ${latY1} L ${W-2} ${latY1} Z`;
  const cornerBR = `M ${W-2} ${latY2} L ${arcX2} ${latY2} L ${arcX2} ${H-2} L ${W-2} ${H-2} Z`;
  const corridorR = `M ${arcX2} ${latY1} L ${W-2} ${latY1} L ${W-2} ${latY2} L ${arcX2} ${latY2} Z`;
  const beyondR = `M ${arcX2} ${latY1} A ${arcR} ${arcR} 0 0 0 ${arcX2} ${latY2} L ${W/2} ${latY2} L ${W/2} ${latY1} Z`;

  // Combined zones
  const z3L = cornerTL + ' ' + cornerBL + ' ' + corridorL + ' ' + beyondL;
  const z3R = cornerTR + ' ' + cornerBR + ' ' + corridorR + ' ' + beyondR;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="court-svg"
      style={{cursor: hasPlayer ? 'crosshair' : 'default'}}
      onClick={onCourtClick}
      data-court="true">

      {/* Fundo */}
      <rect x="0" y="0" width={W} height={H} fill="#1a1f2a"/>

      {/* Zona 3pts — azul sutil */}
      <path d={z3L} fill="rgba(59,130,246,0.07)"/>
      <path d={z3R} fill="rgba(59,130,246,0.07)"/>

      {/* Garrafão — verde sutil */}
      <rect x="2"       y={cy-paintH} width={ftX1}       height={paintH*2} fill="rgba(34,197,94,0.07)"/>
      <rect x={ftX2}    y={cy-paintH} width={W-2-ftX2}   height={paintH*2} fill="rgba(34,197,94,0.07)"/>

      {/* Linhas estruturais */}
      <g stroke="#ffffff" strokeWidth="1" fill="none">
        <rect x="2" y="2" width={W-4} height={H-4} rx="2"/>
        <line x1={W/2} y1="2" x2={W/2} y2={H-2}/>
        <circle cx={W/2} cy={cy} r="38"/>

        {/* Garrafão esq */}
        <rect x="2" y={cy-paintH} width={ftX1} height={paintH*2}/>
        <path d={`M ${ftX1} ${cy-paintH} A ${ftR} ${ftR} 0 0 1 ${ftX1} ${cy+paintH}`} strokeDasharray="5 3"/>

        {/* Garrafão dir */}
        <rect x={ftX2} y={cy-paintH} width={W-2-ftX2} height={paintH*2}/>
        <path d={`M ${ftX2} ${cy-paintH} A ${ftR} ${ftR} 0 0 0 ${ftX2} ${cy+paintH}`} strokeDasharray="5 3"/>

        {/* Área restrita */}
        <path d={`M ${cx1} ${cy-23} A 23 23 0 0 1 ${cx1} ${cy+23}`}/>
        <path d={`M ${cx2} ${cy-23} A 23 23 0 0 0 ${cx2} ${cy+23}`}/>
      </g>

      {/* Linha de 3pts — destacada */}
      <g stroke="#5a6a95" strokeWidth="1.6" fill="none" strokeLinecap="round">
        {/* Esq: lateral topo + arco + lateral base */}
        <line x1="2"    y1={latY1} x2={arcX1}   y2={latY1}/>
        <path d={`M ${arcX1} ${latY1} A ${arcR} ${arcR} 0 0 1 ${arcX1} ${latY2}`}/>
        <line x1={arcX1} y1={latY2} x2="2"     y2={latY2}/>
        {/* Dir: lateral topo + arco + lateral base */}
        <line x1={W-2}  y1={latY1} x2={arcX2}   y2={latY1}/>
        <path d={`M ${arcX2} ${latY1} A ${arcR} ${arcR} 0 0 0 ${arcX2} ${latY2}`}/>
        <line x1={arcX2} y1={latY2} x2={W-2}   y2={latY2}/>
      </g>

      {/* Cestas */}
      <g stroke="#f97316" strokeWidth="1.8" fill="none">
        <circle cx={cx1} cy={cy} r="5.5"/>
        <line x1="2"   y1={cy} x2={cx1-5} y2={cy}/>
        <circle cx={cx2} cy={cy} r="5.5"/>
        <line x1={W-2} y1={cy} x2={cx2+5} y2={cy}/>
      </g>

      {/* Seta de ataque estilizada */}
      {attackDir === 'right' ? (
        <g opacity="0.85">
          {/* Trilha da seta */}
          <line x1="215" y1={cy} x2="348" y2={cy} stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 4"/>
          {/* Cabeça da seta preenchida */}
          <polygon points={`348,${cy-11} 370,${cy} 348,${cy+11}`} fill="#f97316" opacity="0.9"/>
          {/* Label acima */}
          <text x="290" y={cy-16} fill="#f97316" fontSize="9" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle" letterSpacing="2">ATAQUE</text>
          {/* Linha decorativa sob o label */}
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

      {/* Shots */}
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

// ─── Confirm Shot Modal ──────────────────────────────────────────────────────
function ConfirmShotModal({ three, inPaint, onMade, onMissed, onCancel }) {
  // step: 'result' | 'type'
  const [step, setStep]         = useState('result');
  const [madeResult, setMadeResult] = useState(null);

  // Passo 1: convertido ou errado
  if (step === 'result') {
    const label = three ? '3 pontos' : '2 pontos';
    return (
      <div className="confirm-overlay">
        <div className="confirm-modal">
          <div className="confirm-title">Arremesso de {label}</div>
          <div className="confirm-btns">
            <button className="confirm-btn made" onClick={() => {
              if (!three && inPaint) { setMadeResult(true);  setStep('type'); }
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

  // Passo 2 (só garrafão 2pts): tipo
  return (
    <div className="confirm-overlay">
      <div className="confirm-modal">
        <div className="confirm-title">
          {madeResult ? '✓ Convertido — ' : '✕ Errado — '}tipo?
        </div>
        <div className="confirm-btns" style={{flexDirection:'column',gap:'8px'}}>
          <button className="confirm-btn shot-type" onClick={() => madeResult ? onMade('Arremesso')  : onMissed('Arremesso')}>Arremesso</button>
          <button className="confirm-btn shot-type" onClick={() => madeResult ? onMade('Bandeja')    : onMissed('Bandeja')}>Bandeja</button>
          <button className="confirm-btn shot-type" onClick={() => madeResult ? onMade('Enterrada')  : onMissed('Enterrada')}>Enterrada</button>
        </div>
        <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── Assist Modal ─────────────────────────────────────────────────────────────
function AssistModal({ players, scorerIdx, onSelect, onNone, onCancel }) {
  // Apenas atletas em quadra, exceto o próprio pontuador
  const eligible = players
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => i !== scorerIdx && p.active && p.fouls < FOUL_DISQUALIFY && (p.techFouls||0) < TECH_DISQUALIFY);
  return (
    <div className="assist-overlay">
      <div className="assist-modal">
        <div className="assist-modal-header">
          <span>Quem deu a assistência?</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="assist-modal-body">
          <button className="assist-none-btn" onClick={onNone}>Sem assistência</button>
          {eligible.length === 0 && (
            <div className="assist-label" style={{padding:'12px 4px',color:'var(--muted)'}}>
              Nenhum atleta elegível em quadra
            </div>
          )}
          <div className="assist-players-grid">
            {eligible.map(({ p, i }) => (
              <button key={i} className="assist-player-btn" onClick={() => onSelect(i)}>
                <span className="assist-pnum">#{p.number}</span>
                <span className="assist-pname">{p.name.split(' ')[0]}</span>
                <span className="assist-past">{p.ast}ast</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Free Throw Modal (bonificação) ──────────────────────────────────────────
function FreeThrowModal({ players, onSelect, onCancel }) {
  return (
    <div className="assist-overlay">
      <div className="assist-modal">
        <div className="assist-modal-header">
          <span>Lance Livre — quem arremessa?</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="assist-modal-body">
          <div className="assist-label">Time em bonificação — selecione o arremessador</div>
          <div className="assist-players-grid">
            {players.filter(p => p.active && p.fouls < FOUL_DISQUALIFY).map((p,i) => (
              <button key={i} className="assist-player-btn" onClick={() => onSelect(players.indexOf(p))}>
                <span className="assist-pnum">#{p.number}</span>
                <span className="assist-pname">{p.name.split(' ')[0]}</span>
                <span className="assist-past">{p.ftm}/{p.fta} LL</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Free Throw Result Modal ──────────────────────────────────────────────────
function FreeThrowResultModal({ player, attempt, totalAttempts, onMade, onMissed, onCancel }) {
  return (
    <div className="confirm-overlay">
      <div className="confirm-modal">
        <div className="confirm-title">
          Lance Livre {attempt}/{totalAttempts}
        </div>
        <div className="ft-player-label">#{player.number} {player.name.split(' ')[0]}</div>
        <div className="confirm-btns">
          <button className="confirm-btn made" onClick={onMade}>Convertido +1</button>
          <button className="confirm-btn missed" onClick={onMissed}>Errado</button>
        </div>
        <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── Foul Modal ───────────────────────────────────────────────────────────────
function FoulModal({ player, teamFoulsInQuarter, onType, onCancel }) {
  const bonus = teamFoulsInQuarter >= TEAM_FOUL_BONUS;
  const disq  = player.fouls >= FOUL_DISQUALIFY - 1;
  const types = [
    { id:'pessoal',        label:'Falta Pessoal',    desc:'Contato durante jogo',    color:'#f97316', isTech: false },
    { id:'tecnica',        label:'Falta Técnica',     desc:'Conduta antidesportiva',  color:'#ef4444', isTech: true  },
    { id:'antidesportiva', label:'Antidesportiva',    desc:'Contato intencional/duro',color:'#be185d', isTech: true  },
    { id:'flagrante',      label:'Flagrante',          desc:'Contato excessivo',       color:'#dc2626', isTech: true  },
    { id:'ofensiva',       label:'Ofensiva',           desc:'Carrinho / fora da área', color:'#fb923c', isTech: false },
  ];
  return (
    <div className="assist-overlay">
      <div className="assist-modal">
        <div className="assist-modal-header">
          <span>Falta — #{player.number} {player.name.split(' ')[0]}</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="assist-modal-body">
          {disq && <div className="foul-alert danger">ATENÇÃO: próxima falta = DISQUALIFICAÇÃO!</div>}
          {!disq && player.fouls >= FOUL_TROUBLE && <div className="foul-alert warn">Foul trouble: {player.fouls} faltas</div>}
          {bonus && <div className="foul-alert info">Time em bonificação! ({teamFoulsInQuarter} faltas no quarto)</div>}
          {player.techFouls >= TECH_DISQUALIFY - 1 && <div className="foul-alert danger">ATENÇÃO: 1 técnica/antidesportiva = substituição obrigatória!</div>}
          <div className="foul-info-row">
            <span>Faltas: <b>{player.fouls}</b></span>
            <span>Técnicas: <b>{player.techFouls||0}</b></span>
            <span>Time no quarto: <b>{teamFoulsInQuarter}</b></span>
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
      </div>
    </div>
  );
}

// ─── Substitution Modal ───────────────────────────────────────────────────────
function SubModal({ title, reason, players, outPlayerIdx, onSub, onCancel, canCancel=true }) {
  return (
    <div className="assist-overlay">
      <div className="assist-modal">
        <div className="assist-modal-header">
          <span>{title}</span>
          {canCancel && <button className="modal-close" onClick={onCancel}>✕</button>}
        </div>
        <div className="assist-modal-body">
          {reason && <div className="foul-alert warn">{reason}</div>}
          {outPlayerIdx !== null && (
            <div className="sub-out-row">
              <span className="sub-label">Saindo:</span>
              <span className="sub-player-name">
                #{players[outPlayerIdx]?.number} {players[outPlayerIdx]?.name}
              </span>
            </div>
          )}
          <div className="assist-label">Selecione quem entra:</div>
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
      </div>
    </div>
  );
}

// ─── HeatMap Component ───────────────────────────────────────────────────────
function HeatMap({ shots, teamName, attackDir }) {
  const W = 600, H = 320, cy = 160, midX = 300;
  // Mapa de calor: cada arremesso contribui com um "blob" gaussiano
  // Renderizado como círculos concêntricos com opacidade decrescente
  const RADIUS = 38; // raio de influência de cada arremesso em px

  // Agrupa arremessos por posição real (sem grid)
  // Usa clustering simples: pontos dentro de RADIUS/2 são agrupados
  const clusters = [];
  shots.forEach(s => {
    const sx = s.x * W / 100;
    const sy = s.y * H / 100;
    const existing = clusters.find(cl =>
      Math.sqrt((cl.cx - sx)**2 + (cl.cy - sy)**2) < RADIUS * 0.7
    );
    if (existing) {
      existing.cx = (existing.cx * existing.total + sx) / (existing.total + 1);
      existing.cy = (existing.cy * existing.total + sy) / (existing.total + 1);
      existing.total++;
      if (s.made) existing.made++;
    } else {
      clusters.push({ cx: sx, cy: sy, total: 1, made: s.made ? 1 : 0 });
    }
  });

  const maxTotal = Math.max(...clusters.map(cl => cl.total), 1);

  // Interpola cor entre vermelho (0%) → laranja (50%) → verde (100%) de aproveitamento
  const shotColor = (pctMade) => {
    if (pctMade < 0.35) return { r: 239, g: 68,  b: 68  }; // vermelho
    if (pctMade < 0.5)  return { r: 249, g: 115, b: 22  }; // laranja
    if (pctMade < 0.65) return { r: 234, g: 179, b: 8   }; // amarelo
    return                     { r: 34,  g: 197, b: 94  }; // verde
  };

  return (
    <div className="heatmap-wrap">
      <div className="heatmap-title">{teamName} — {shots.length} arremessos</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="court-svg">
        <defs>
          {clusters.map((cl, i) => {
            const col = shotColor(cl.made / cl.total);
            const intensity = cl.total / maxTotal;
            return (
              <radialGradient key={i} id={`hg${i}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stopColor={`rgb(${col.r},${col.g},${col.b})`} stopOpacity={0.55 * intensity}/>
                <stop offset="45%"  stopColor={`rgb(${col.r},${col.g},${col.b})`} stopOpacity={0.3 * intensity}/>
                <stop offset="100%" stopColor={`rgb(${col.r},${col.g},${col.b})`} stopOpacity={0}/>
              </radialGradient>
            );
          })}
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="#1a1f2a"/>

        {/* Blobs de calor — círculos com gradiente radial suave */}
        {clusters.map((cl, i) => {
          const r = RADIUS * (0.8 + (cl.total / maxTotal) * 0.6);
          return (
            <circle key={i}
              cx={cl.cx} cy={cl.cy} r={r}
              fill={`url(#hg${i})`}
            />
          );
        })}

        {/* Linhas da quadra */}
        <g stroke="#4a5570" strokeWidth="1" fill="none">
          <rect x="2" y="2" width={W-4} height={H-4} rx="2"/>
          <line x1={midX} y1="2" x2={midX} y2={H-2} strokeDasharray="4 3"/>
          <circle cx={W/2} cy={cy} r="38"/>
          <rect x="2" y={cy-52} width="124" height="104"/>
          <rect x="476" y={cy-52} width="122" height="104"/>
          <line x1="2"   y1="19" x2="67"  y2="19"/><path d="M 67 19 A 145 145 0 0 1 67 301"/><line x1="67"  y1="301" x2="2"   y2="301"/>
          <line x1="533" y1="19" x2="598" y2="19"/><path d="M 533 19 A 145 145 0 0 0 533 301"/><line x1="533" y1="301" x2="598" y2="301"/>
        </g>

        {/* Linha de meio campo destacada */}
        <line x1={midX} y1="2" x2={midX} y2={H-2} stroke="#5a6a95" strokeWidth="1.5"/>

        {/* Cestas */}
        <g stroke="#f97316" strokeWidth="1.8" fill="none">
          <circle cx="34"  cy={cy} r="5.5"/><line x1="2"   y1={cy} x2="29"  y2={cy}/>
          <circle cx="566" cy={cy} r="5.5"/><line x1="571" y1={cy} x2="598" y2={cy}/>
        </g>

        {/* Seta de ataque */}
        {attackDir === 'right' ? (
          <g opacity="0.7">
            <line x1="215" y1={cy} x2="345" y2={cy} stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 4"/>
            <polygon points={`345,${cy-9} 362,${cy} 345,${cy+9}`} fill="#f97316"/>
          </g>
        ) : (
          <g opacity="0.7">
            <line x1="385" y1={cy} x2="255" y2={cy} stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 4"/>
            <polygon points={`255,${cy-9} 238,${cy} 255,${cy+9}`} fill="#f97316"/>
          </g>
        )}

        {/* Dots individuais */}
        {shots.map((s,i) => {
          const px = s.x * W / 100, py = s.y * H / 100;
          return s.made
            ? <circle key={i} cx={px} cy={py} r="4" fill="#22c55e" stroke="#fff" strokeWidth="0.5" opacity="0.85"/>
            : <g key={i} opacity="0.75">
                <line x1={px-3.5} y1={py-3.5} x2={px+3.5} y2={py+3.5} stroke="#ef4444" strokeWidth="1.6" strokeLinecap="round"/>
                <line x1={px+3.5} y1={py-3.5} x2={px-3.5} y2={py+3.5} stroke="#ef4444" strokeWidth="1.6" strokeLinecap="round"/>
              </g>;
        })}
      </svg>
      <div className="heatmap-legend">
        <span className="hml-item" style={{color:'#22c55e'}}>● Convertido ({shots.filter(s=>s.made).length})</span>
        <span className="hml-item" style={{color:'#ef4444'}}>✕ Errado ({shots.filter(s=>!s.made).length})</span>
        <span className="hml-item" style={{color:'#f97316'}}>FG: {shots.length>0 ? Math.round(shots.filter(s=>s.made).length/shots.length*100)+'%' : '—'}</span>
        <span className="hml-item" style={{color:'#3b82f6'}}>3P: {(() => { const t=shots.filter(s=>s.three); return t.length>0 ? Math.round(t.filter(s=>s.made).length/t.length*100)+'%' : '—'; })()}</span>
      </div>
    </div>
  );
}

// ─── New Game Modal ───────────────────────────────────────────────────────────
function NewGameModal({ onStart, onClose }) {
  const [startingTeam, setStartingTeam] = useState(0);
  const [nameA, setNameA] = useState('Time A');
  const [nameB, setNameB] = useState('Time B');
  const [players, setPlayers] = useState({
    a: DEFAULT_TEAM_A.map(p=>({...p})), b: DEFAULT_TEAM_B.map(p=>({...p}))
  });
  const rosterA = players.a;
  const rosterB = players.b;
  const upd = (t,i,f,v) => setPlayers(prev=>({...prev,[t]:prev[t].map((p,j)=>j===i?{...p,[f]:v}:p)}));
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
                      <input className="num-input" value={p.number} maxLength={2} onChange={e=>upd(key,i,'number',e.target.value)}/>
                      <input className="name-inp" value={p.name} onChange={e=>upd(key,i,'name',e.target.value)}/>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 6, fontWeight: 'bold' }}>
                Posse inicial:
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setStartingTeam(0)}
                    style={{
                    flex: 1,
                    padding: '10px',
                    background: startingTeam === 0 ? '#22c55e' : '#1f2937',
                    color: '#fff',
                    borderRadius: '6px'
                    }}
                    >
                    {nameA}
                </button>

                <button type="button" onClick={() => setStartingTeam(1)}
                    style={{
                    flex: 1,
                    padding: '10px',
                    background: startingTeam === 1 ? '#22c55e' : '#1f2937',
                    color: '#fff',
                    borderRadius: '6px'
                    }}
                    >
                    {nameB}
                </button>
            </div>
          </div>

        </div>
        <div className="modal-footer">
          <button className="btn-start" onClick={()=>onStart(nameA, nameB, rosterA, rosterB, startingTeam)}>Iniciar Jogo</button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]   = useState('home');
  const [games, setGames]     = useState(loadGames);
  const [game, setGame]       = useState(null);
  const [running, setRunning] = useState(false);
  const [activeTeam, setActiveTeam]         = useState(0);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [view, setView]       = useState('scout');
  const [toast, setToast]     = useState(null);
  const [showNewGame, setShowNewGame] = useState(false);
  const [showPeriodEnd, setShowPeriodEnd] = useState(false);
  // shotMode removido — quadra sempre ativa quando atleta selecionado

  // Modal states
  // confirmShot: { xPct, yPct, three } | null
  const [confirmShot, setConfirmShot]   = useState(null);
  // assistPending: { scorerIdx, xPct, yPct, made, three } | null
  const [assistPending, setAssistPending] = useState(null);
  // foulPending: true/false
  const [foulPending, setFoulPending]     = useState(false);
  // ftModal: 'pick_player' | 'result' | null
  const [ftModal, setFtModal]             = useState(null);
  const [ftPlayer, setFtPlayer]           = useState(null);
  // subModal: { reason, outIdx, canCancel } | null
  const [subModal, setSubModal]           = useState(null);
  // drag & drop substituição
  const [dragPlayer, setDragPlayer]       = useState(null);
  // Undo: guarda até 5 estados anteriores do jogo


  const undoStack = useRef([]);

    const courtRef = useRef(null);

    const buzzerRef = useRef(null);

const renderTeamPanel = (teamIdx) => {
  const team = game.teams[teamIdx];

  return (
    <div className="team-panel">
      <div className="team-title">
        {team.name}
      </div>

      <div className="players-grid">
        {team.players.map((p, pi) => (
          <button
            key={pi}
            className="player-btn"
            data-active={activeTeam === teamIdx && selectedPlayer === pi}
            data-bench={!p.active}
            onClick={() => {
              setActiveTeam(teamIdx);
              setSelectedPlayer(pi);
            }}
          >
            <span className="pnum">#{p.number}</span>
            <span className="pname">{p.name.split(' ')[0]}</span>
            <span className="ppts">{p.pts}p</span>
          </button>
        ))}
      </div>
    </div>
  );
};

    useEffect(() => {
      buzzerRef.current = new Audio('/buzzer.mp3');
      buzzerRef.current.volume = 0.8;
      buzzerRef.current.load();
    }, []);

    const playBuzzer = () => {
      if (!buzzerRef.current) return;

      buzzerRef.current.currentTime = 0; // 🔁 reinicia
      buzzerRef.current.play();
    };

      // Cronômetro
    useEffect(() => {
      if (!running || !game) return;

      const id = setInterval(() => {
        setGame(g => {
          if (!g) return g;

          // 🔥 QUANDO CHEGA NO FINAL
          if (g.clock <= 1) {
            setRunning(false);

            playBuzzer();           // 🔊 buzzer
            setShowPeriodEnd(true); // 🪟 modal

            return {
              ...g,
              clock: 0
            };
          }

          return {
            ...g,
            clock: g.clock - 1
          };
        });
      }, 1000);

      return () => clearInterval(id);
    }, [running, game]);

  // Minutagem: quando pausa, adiciona tempo jogado aos atletas ativos
  useEffect(() => {
    if (!game || running) return;
    // running acabou de virar false — registra tempo acumulado
    setGame(g => {
      if (!g) return g;
      const now = g.clock;
      const teams = g.teams.map(t => ({
        ...t,
        players: t.players.map(p => {
          if (!p.active || p.entryTime === null) return p;
          const elapsed = p.entryTime - now; // clock decresce
          return {
            ...p,
            timeOnCourt: (p.timeOnCourt||0) + Math.max(elapsed, 0),
            entryTime: now,
          };
        })
      }));
      return { ...g, teams };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // Minutagem: quando running inicia, registra entryTime dos ativos
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

  // Auto-save
  useEffect(() => {
    if (!game) return;
    setGames(prev => {
      const idx = prev.findIndex(g => g.id === game.id);
      const next = idx >= 0 ? prev.map((g,i) => i===idx ? game : g) : [game, ...prev];
      saveGames(next); return next;
    });
  }, [game]);

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 1800); };

function endPossession(g, nextTeam, playerIdx = null) {
  const possessions = [...(g.possessions || [0, 0])];
  possessions[nextTeam] = (possessions[nextTeam] || 0) + 1;

  const teams = g.teams.map((t, ti) => {
    if (ti !== nextTeam) return t;

    return {
      ...t,
      players: t.players.map((p, pi) =>
        pi === playerIdx
          ? { ...p, possessions: (p.possessions || 0) + 1 }
          : p
      )
    };
  });

  return {
    ...g,
    possessions,
    teams,
    activeTeam: nextTeam
  };
}

  // setGameWithUndo: salva snapshot antes de aplicar mudança
  const setGameWithUndo = useCallback((updater) => {
    setGame(prev => {
      if (prev) {
        undoStack.current = [prev, ...undoStack.current].slice(0, 8);
      }
      return typeof updater === 'function' ? updater(prev) : updater;
    });
  }, []);

  const undoLastAction = useCallback(() => {
    if (undoStack.current.length === 0) { showToast('Nada para desfazer'); return; }
    const prev = undoStack.current[0];
    undoStack.current = undoStack.current.slice(1);
    setGame(prev);
    showToast('Ação desfeita');
  }, []);

const startGame = (nameA, nameB, rosterA, rosterB, startingTeam) => {

  const g = newGame(nameA, nameB, rosterA, rosterB);

  g.possessions = startingTeam === 0 ? [1, 0] : [0, 1];

  setGame(g);
  setShowNewGame(false);
  setScreen('game');
  setView('scout');

  setActiveTeam(startingTeam);

  setSelectedPlayer(null);
  setRunning(true);
};

  const openGame = g => {
    // Compatibilidade: jogos antigos sem possessions
    const patched = g.possessions ? g : { ...g, possessions: [0,0] };
    setGame(patched); setScreen('game'); setView('scout');
    setActiveTeam(0); setSelectedPlayer(null); setRunning(false); };

  // Avança quarto — zera faltas coletivas (exceto OT que continua)
  const nextQuarter = useCallback(() => {
    setGame(g => {
      if (!g) return g;
      const nextQ = g.quarter + 1;
      // Regulares: 10min | OTs: 5min
      const nextClock = nextQ >= 4 ? 300 : 600;
      // Quartos regulares: zera faltas coletivas para o próximo quarto
      // OT: mantém (faltas não zeram em prorrogação)
      let teamFouls = g.teamFouls || [[0,0,0,0,0],[0,0,0,0,0]];
      if (nextQ < 4) {
        // Garante que o array tem espaço para o próximo quarto
        teamFouls = teamFouls.map(tf => {
          const arr = [...tf];
          while (arr.length <= nextQ) arr.push(0);
          arr[nextQ] = 0;
          return arr;
        });
      } else {
        // OT: expande o array se necessário, sem zerar
        teamFouls = teamFouls.map(tf => {
          const arr = [...tf];
          while (arr.length <= nextQ) arr.push(0);
          return arr;
        });
      }
      return { ...g, quarter: nextQ, clock: nextClock, teamFouls };
    });
    setRunning(false);
  }, []);

  // ── Substituição ───────────────────────────────────────────────────────────
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
              // Saindo: acumula tempo jogado
              const elapsed = running && p.entryTime !== null ? p.entryTime - g.clock : 0;
              return { ...p, active: false, entryTime: null, timeOnCourt: (p.timeOnCourt||0) + Math.max(elapsed,0) };
            }
            if (pi === inIdx) {
              // Entrando: registra entryTime se cronômetro rodando
              return { ...p, active: true, entryTime: running ? g.clock : null };
            }
            return p;
          })
        };
      })
    }));
    const out = game.teams[activeTeam].players[outIdx];
    const inn = game.teams[activeTeam].players[inIdx];
    showToast(`↕ ${out.name.split(' ')[0]} → ${inn.name.split(' ')[0]}`);
    setSubModal(null);
    setSelectedPlayer(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, subModal, activeTeam]);

  // Drag-to-sub: confirma substituição direta (já sabe quem sai e entra)
  const executeDirectSub = useCallback((outIdx, inIdx) => {
    if (!game) return;
    setGame(g => ({
      ...g,
      teams: g.teams.map((t, ti) => {
        if (ti !== activeTeam) return t;
        return {
          ...t,
          players: t.players.map((p, pi) => {
            if (pi === outIdx) return { ...p, active: false };
            if (pi === inIdx)  return { ...p, active: true  };
            return p;
          })
        };
      })
    }));
    const out = game.teams[activeTeam].players[outIdx];
    const inn = game.teams[activeTeam].players[inIdx];
    showToast(`↕ ${out.name.split(' ')[0]} → ${inn.name.split(' ')[0]}`);
    setSubModal(null);
    setSelectedPlayer(null);
  }, [game, activeTeam]);

  // ── Falta ──────────────────────────────────────────────────────────────────
  const commitFoul = useCallback((foulType, isTech) => {
    if (selectedPlayer === null || !game) return;
    const pl = game.teams[activeTeam].players[selectedPlayer];
    const newFouls     = (pl.fouls     || 0) + 1;
    const newTechFouls = isTech ? (pl.techFouls || 0) + 1 : (pl.techFouls || 0);
    const isDisq       = newFouls >= FOUL_DISQUALIFY;
    const isTechDisq   = newTechFouls >= TECH_DISQUALIFY;
    const needsSub     = isDisq || isTechDisq;

    const newTfq = (game.teamFouls?.[activeTeam]?.[game.quarter] || 0) + 1;
    const nowBonus = newTfq >= TEAM_FOUL_BONUS;

    setGameWithUndo(g => {
      const teamFouls = (g.teamFouls || [[0,0,0,0,0],[0,0,0,0,0]]).map((tf, ti) => {
        if (ti !== activeTeam) return tf;
        const arr = [...tf];
        while (arr.length <= g.quarter) arr.push(0);
        arr[g.quarter] = (arr[g.quarter] || 0) + 1;
        return arr;
      });
      const teams = g.teams.map((t, ti) => {
        if (ti !== activeTeam) return t;
        return {
          ...t,
          players: t.players.map((p, pi) => {
            if (pi !== selectedPlayer) return p;
            return { ...p, fouls: newFouls, techFouls: newTechFouls, active: isDisq ? false : p.active };
          })
        };
      });
      const entry = { id: Date.now(), q: getQuarterLabel(g.quarter), time: fmtTime(g.clock),
        team: g.teams[activeTeam].name,
        player: `#${pl.number} ${pl.name.split(' ')[0]}`,
        action: `Falta ${foulType}`, pts: 0, color: '#f97316' };
      return { ...g, teams, teamFouls, log: [entry, ...g.log] };
    });

    setFoulPending(false);

    if (needsSub) {
      const reason = isDisq
        ? `#${pl.number} ${pl.name.split(' ')[0]} atingiu ${newFouls} faltas — DISQUALIFICADO`
        : `#${pl.number} ${pl.name.split(' ')[0]} atingiu ${newTechFouls} técnicas — substituição obrigatória`;
      setSubModal({ reason, outIdx: selectedPlayer, canCancel: false });
    } else if (nowBonus) {
      // Bonificação: abre LL imediatamente
      setFtModal('pick_player');
    } else if (newFouls >= FOUL_TROUBLE) {
      showToast(`Foul trouble — ${pl.name.split(' ')[0]} (${newFouls} faltas)`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlayer, activeTeam, game, setGameWithUndo]);

  // ── Lance Livre ────────────────────────────────────────────────────────────
  // ftTeamIdx: time que ARREMESSA (adversário de quem fez a falta)
const commitFT = useCallback((ftTeamIdx, playerIdx, made) => {
  if (!game) return;

  const pl = game.teams[ftTeamIdx].players[playerIdx];
  const scoringTeam = ftTeamIdx;
  const opposingTeam = 1 - ftTeamIdx;

  setGameWithUndo(g => {

    const base = g; // ✅ corrigido

    const teams = base.teams.map((t, ti) => {
      if (ti === scoringTeam) {
        return {
          ...t,
          score: t.score + (made ? 1 : 0),
          players: t.players.map((p, pi) => {
            const n = { ...p };
            if (pi === playerIdx) {
              n.ftm += made ? 1 : 0;
              n.fta += 1;
              n.pts += made ? 1 : 0;
            }
            if (made && p.active) n.plusMinus = (n.plusMinus || 0) + 1;
            return n;
          })
        };
      }

      if (ti === opposingTeam) {
        return {
          ...t,
          players: t.players.map(p => {
            if (!p.active || !made) return p;
            return { ...p, plusMinus: (p.plusMinus || 0) - 1 };
          })
        };
      }

      return t;
    });

    const entry = {
      id: Date.now(),
      q: getQuarterLabel(base.quarter),
      time: fmtTime(base.clock),
      team: base.teams[ftTeamIdx].name,
      player: `#${pl.number} ${pl.name.split(' ')[0]}`,
      action: made ? 'LL certo' : 'LL erro',
      pts: made ? 1 : 0,
      color: made ? '#f59e0b' : '#475569'
    };

    let updated = {
      ...base,
      teams,
      log: [entry, ...base.log]
    };

    // 🚫 NÃO mexe na posse aqui (automático via rebote / turnover)

    return updated;
  });

  if (made) showToast(`+1 LL — ${pl.name.split(' ')[0]}`);

}, [game, setGameWithUndo]);

  // ── Registra arremesso com assistência ────────────────────────────────────
const commitShot = useCallback((playerIdx, xPct, yPct, made, three, assistIdx, shotType='Arremesso') => {
  const pts = made ? (three ? 3 : 2) : 0;
  const actionId = made ? (three?'fg3m':'fg2m') : (three?'fg3miss':'fg2miss');
  const col = made ? (three?'#3b82f6':'#22c55e') : '#475569';

  setGameWithUndo(g => {

    const base = g; // ✅ corrigido

    const teams = base.teams.map((t, ti) => {
      const players = t.players.map((p, pi) => {
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
              const apl = assistIdx !== null ? base.teams[activeTeam].players[assistIdx] : null;
              n.shots = [...(n.shots||[]), {
                x: xPct,
                y: yPct,
                made,
                three,
                zone: three?'3pts':'2pts',
                shotType: three ? '3pts' : (shotType||'Arremesso'),
                assistedBy: apl ? `#${apl.number} ${apl.name.split(' ')[0]}` : '',
                q: getQuarterLabel(base.quarter),
                time: fmtTime(base.clock),
              }];
            }
          }

          if (made && p.active) n.plusMinus = (n.plusMinus||0) + pts;

        } else {
          if (made && p.active) n.plusMinus = (n.plusMinus||0) - pts;
        }

        return n;
      });

      return {
        ...t,
        score: ti === activeTeam ? t.score + pts : t.score,
        players
      };
    });

    const sp = base.teams[activeTeam].players[playerIdx];
    const ap = assistIdx !== null ? base.teams[activeTeam].players[assistIdx] : null;

    const entries = [];

    if (ap) {
      entries.push({
        id: Date.now(),
        q: getQuarterLabel(base.quarter),
        time: fmtTime(base.clock),
        team: base.teams[activeTeam].name,
        player: `#${ap.number} ${ap.name.split(' ')[0]}`,
        action: 'Assist.',
        pts: 0,
        color: '#a855f7'
      });
    }

    entries.push({
      id: Date.now()+1,
      q: getQuarterLabel(base.quarter),
      time: fmtTime(base.clock),
      team: base.teams[activeTeam].name,
      player: `#${sp.number} ${sp.name.split(' ')[0]}`,
      action: made ? (three?'3pts':'2pts') : (three?'3x falha':'2x falha'),
      pts,
      color: col
    });

    let updated = {
      ...base,
      teams,
      log: [...entries, ...base.log]
    };

    // 🔥 POSSE AUTOMÁTICA
    if (made) {
      updated = endPossession(updated, 1 - activeTeam);
    }

    return updated;

  });
  if (made) {
    setActiveTeam(prev => 1 - prev);
  }

  if (made) showToast(`+${pts}${assistIdx !== null ? ' + assist' : ''}`);
  setAssistPending(null);

}, [activeTeam, setGameWithUndo]);

  // ── Clique na quadra ───────────────────────────────────────────────────────
  // Sempre ativo quando há atleta selecionado — não precisa clicar em "+ Marcar"
  const handleCourtClick = useCallback(e => {
    if (selectedPlayer === null) return;
    if (confirmShot || assistPending || foulPending || ftModal || subModal) return;
    if (game?.finished) { showToast('Jogo finalizado'); return; }
    // Só registra se o cronômetro estiver rodando
    if (!running) { showToast('Inicie o cronômetro para marcar'); return; }
    const svgEl = e.currentTarget;
    const rect = svgEl.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width  * 100;
    const yPct = (e.clientY - rect.top)  / rect.height * 100;
    const dir = activeTeam === 0 ? 'right' : 'left';
    const { valid, three, inPaint } = classifyShot(xPct, yPct, dir);
    if (!valid) { showToast('Arremesso no lado errado da quadra'); return; }
    setConfirmShot({ xPct, yPct, three, inPaint });
  }, [selectedPlayer, confirmShot, assistPending, foulPending, ftModal, subModal, running, activeTeam, game]);

  // ── Ações miscellâneas ─────────────────────────────────────────────────────
const applyMisc = useCallback(action => {

  // 1. valida jogador
  if (selectedPlayer === null) {
    showToast('Selecione um atleta');
    return;
  }

  // 2. faltas (modal)
  if (action.id === 'fouls') {
    setFoulPending(true);
    return;
  }

  // 🔥 3. TURNOVER (AQUI!)
  if (action.id === 'to') {
    setGameWithUndo(g => endPossession(g, 1 - activeTeam));
    setActiveTeam(1 - activeTeam);
    return;
  }

  // 🔥 4. REBOTE
if (action.id === 'reb' || action.id === 'oreb') {

  setGameWithUndo(g => {

    const isOffensive = action.id === 'oreb';

    // 👉 rebote defensivo = nova posse
    if (!isOffensive) {
      return endPossession(g, activeTeam, selectedPlayer);
    }

    // 👉 rebote ofensivo = mesma posse
    return g;
  });

  return;
}

  // 🔥 5. ROUBO
if (action.id === 'stl') {
  setGameWithUndo(g => endPossession(g, activeTeam, selectedPlayer));
  return;
}

  // 6. resto das ações (stats simples)
  setGameWithUndo(g => {
    const teams = g.teams.map((t, ti) => {
      if (ti !== activeTeam) return t;

      return {
        ...t,
        players: t.players.map((p, pi) => {
          if (pi !== selectedPlayer) return p;
          return {
            ...p,
            [action.id]: (p[action.id] || 0) + 1
          };
        })
      };
    });

    const pl = g.teams[activeTeam].players[selectedPlayer];

    const entry = {
      id: Date.now(),
      q: getQuarterLabel(g.quarter),
      time: fmtTime(g.clock),
      team: g.teams[activeTeam].name,
      player: `#${pl.number} ${pl.name.split(' ')[0]}`,
      action: action.label,
      pts: 0,
      color: action.color
    };

    return {
      ...g,
      teams,
      log: [entry, ...g.log]
    };
  });

}, [selectedPlayer, activeTeam, setGameWithUndo]);

  const applyFT = useCallback(action => {
    if (selectedPlayer === null) { showToast('Selecione um atleta'); return; }
    // LL manual: vai para o time do atleta selecionado (sem falta coletiva)
    commitFT(activeTeam, selectedPlayer, action.id === 'ftm');
  }, [selectedPlayer, activeTeam, commitFT]);

  // ─── HOME ──────────────────────────────────────────────────────────────────
  if (screen === 'home') return (
    <div className="app">
      {showNewGame && <NewGameModal onStart={(nameA, nameB, rosterA, rosterB, startingTeam) => startGame(nameA, nameB, rosterA, rosterB, startingTeam)}
      onClose={() => setShowNewGame(false)}
    />}
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
        <button className="btn-new-game" onClick={() => setShowNewGame(true)}>+ Novo Jogo</button>
        {games.length > 0 && (
          <div className="recent-games">
            <div className="recent-label">Jogos Salvos</div>
            {games.slice(0,8).map(g => (
              <div key={g.id} className="game-card" onClick={() => openGame(g)}>
                <div className="game-card-teams">
                  <span>{g.teams[0].name}</span>
                  <span className="game-card-score">{g.teams[0].score} — {g.teams[1].score}</span>
                  <span>{g.teams[1].name}</span>
                </div>
                <div className="game-card-meta">
                  <span>{g.date}</span><span>{QUARTERS[g.quarter]}</span><span>{g.log.length} eventos</span>
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
      <img src="/logo_winfast.png" alt="logo" className="app-logo"/>
    </div>
  );

  // ─── GAME ──────────────────────────────────────────────────────────────────
  const td  = game.teams[activeTeam];
  const sp  = selectedPlayer !== null ? td.players[selectedPlayer] : null;
  const activeShots = sp ? (sp.shots||[]) : td.players.flatMap(p => p.shots||[]);
  const tfq = (game.teamFouls?.[activeTeam] || [])[game.quarter] || 0;
  const inBonus = tfq >= TEAM_FOUL_BONUS;

  return (
    <div className="app">
      {toast && <div className="toast">{toast}</div>}

      {/* ── Modais ── */}
      {confirmShot && (
        <ConfirmShotModal
          three={confirmShot.three}
          inPaint={confirmShot.inPaint}
          onMade={(shotType) => {
            const s = confirmShot; setConfirmShot(null);
            setAssistPending({ scorerIdx: selectedPlayer, xPct: s.xPct, yPct: s.yPct, made: true, three: s.three, shotType });
          }}
          onMissed={(shotType) => {
            const s = confirmShot; setConfirmShot(null);
            commitShot(selectedPlayer, s.xPct, s.yPct, false, s.three, null, shotType);
          }}
          onCancel={() => setConfirmShot(null)}
        />
      )}
      {assistPending && (
        <AssistModal
          players={td.players} scorerIdx={assistPending.scorerIdx}
          onSelect={aIdx => commitShot(assistPending.scorerIdx, assistPending.xPct, assistPending.yPct, true, assistPending.three, aIdx, assistPending.shotType)}
          onNone={() => commitShot(assistPending.scorerIdx, assistPending.xPct, assistPending.yPct, true, assistPending.three, null, assistPending.shotType)}
          onCancel={() => setAssistPending(null)}
        />
      )}
      {foulPending && sp && (
        <FoulModal player={sp} teamFoulsInQuarter={tfq} onType={commitFoul} onCancel={() => setFoulPending(false)}/>
      )}
      {ftModal === 'pick_player' && (() => {
        // LL vai para o ADVERSÁRIO de quem fez a falta
        const ftTeamIdx = 1 - activeTeam;
        const ftPlayers = game.teams[ftTeamIdx].players;
        return (
          <FreeThrowModal
            players={ftPlayers}
            teamName={game.teams[ftTeamIdx].name}
            onSelect={idx => { setFtPlayer({ teamIdx: ftTeamIdx, playerIdx: idx, attempt: 1, total: 2 }); setFtModal('result'); }}
            onCancel={() => setFtModal(null)}
          />
        );
      })()}
      {ftModal === 'result' && ftPlayer !== null && (
        <FreeThrowResultModal
          player={game.teams[ftPlayer.teamIdx].players[ftPlayer.playerIdx]}
          attempt={ftPlayer.attempt}
          totalAttempts={ftPlayer.total}
          onMade={() => {
            commitFT(ftPlayer.teamIdx, ftPlayer.playerIdx, true);
            if (ftPlayer.attempt < ftPlayer.total) {
              setFtPlayer(prev => ({ ...prev, attempt: prev.attempt + 1 }));
            } else {
              setFtModal(null); setFtPlayer(null);
            }
          }}
          onMissed={() => {
            commitFT(ftPlayer.teamIdx, ftPlayer.playerIdx, false);
            if (ftPlayer.attempt < ftPlayer.total) {
              setFtPlayer(prev => ({ ...prev, attempt: prev.attempt + 1 }));
            } else {
              setFtModal(null); setFtPlayer(null);
            }
          }}
          onCancel={() => { setFtModal(null); setFtPlayer(null); }}
        />
      )}
      {subModal && subModal.directInIdx !== undefined && (
        <div className="confirm-overlay">
          <div className="confirm-modal">
            <div className="confirm-title">Confirmar substituição?</div>
            <div className="ft-player-label">
              #{td.players[subModal.outIdx]?.number} {td.players[subModal.outIdx]?.name.split(' ')[0]} → #{td.players[subModal.directInIdx]?.number} {td.players[subModal.directInIdx]?.name.split(' ')[0]}
            </div>
            <div className="confirm-btns">
              <button className="confirm-btn made" onClick={() => executeDirectSub(subModal.outIdx, subModal.directInIdx)}>Confirmar</button>
              <button className="confirm-btn missed" onClick={() => setSubModal(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
      {subModal && subModal.directInIdx === undefined && (
        <SubModal
          title="Substituição"
          reason={subModal.reason}
          players={td.players}
          outPlayerIdx={subModal.outIdx}
          onSub={executeSub}
          onCancel={() => setSubModal(null)}
          canCancel={subModal.canCancel !== false}
        />
      )}

      {/* ── Header ── */}
      <header className="header">
        <div className="header-top">
          <button className="back-btn" onClick={() => { setRunning(false); setScreen('home'); }}>‹ Voltar</button>
          <div className="header-game-label">{game.teams[0].name} vs {game.teams[1].name}</div>
          <div className="export-btns">
            <button className="export-btn-sm" onClick={() => exportStatsCSV(game)}>Stats</button>
            <button className="export-btn-sm green" onClick={() => exportShotsCSV(game)}>Arrem.</button>
            <button className="export-btn-sm" style={{color:'var(--blue)'}} onClick={() => exportLogCSV(game)}>Log</button>
          </div>
        </div>

        <div className="scoreboard">
          <div className="team-score" data-active={activeTeam===0}
            onClick={() => { setActiveTeam(0); setSelectedPlayer(null); }}>
            <span className="team-name">{game.teams[0].name}</span>
            <span className="score">{game.teams[0].score}</span>
            <div className="team-foul-dots">
              {[1,2,3,4,5].map(n=>(
                <span key={n} className="foul-dot"
                  data-filled={((game.teamFouls?.[0]||[])[game.quarter]||0)>=n}
                  data-bonus={n===TEAM_FOUL_BONUS}/>
              ))}
            </div>
          </div>

          <div className="center-info">
            <span className="quarter-label">{getQuarterLabel(game.quarter)}</span>
            <div className="clock">{fmtTime(game.clock)}</div>
            <div className="clock-btns">
              <button className={`clock-play-btn ${running ? 'playing' : 'paused'}`}
                onClick={() => setRunning(r=>!r)}>
                {running ? '⏸' : '▶'}
              </button>
              <button className="next-q-btn"
                data-finished={game.quarter >= 3 && game.teams[0].score !== game.teams[1].score}
                onClick={() => {
                  // Após 4T ou qualquer OT: só avança se empatado
                  if (game.quarter >= 3) {
                    const [s0, s1] = [game.teams[0].score, game.teams[1].score];
                    if (s0 !== s1) {
                      setGame(g => ({ ...g, finished: true }));
                      return;
                    }
                  }
                  nextQuarter();
                }}>
                {game.quarter >= 3 && game.teams[0].score !== game.teams[1].score ? 'Finalizar' : `›${getQuarterLabel(game.quarter + 1)}`}
              </button>
            </div>
          </div>

          <div className="team-score right" data-active={activeTeam===1}
            onClick={() => { setActiveTeam(1); setSelectedPlayer(null); }}>
            <span className="score">{game.teams[1].score}</span>
            <span className="team-name">{game.teams[1].name}</span>
            <div className="team-foul-dots">
              {[1,2,3,4,5].map(n=>(
                <span key={n} className="foul-dot"
                  data-filled={((game.teamFouls?.[1]||[])[game.quarter]||0)>=n}
                  data-bonus={n===TEAM_FOUL_BONUS}/>
              ))}
            </div>
          </div>
        </div>

        {inBonus && (
          <div className="bonus-bar">
            BONIFICAÇÃO — {game.teams[activeTeam].name} ({tfq} faltas no {getQuarterLabel(game.quarter)})
          </div>
        )}

        <nav className="nav">
          {[['scout','Scout'],['stats','Stats'],['heatmap','Mapa'],['log','Log']].map(([v,l])=>(
            <button key={v} className="nav-btn" data-active={view===v}
              onClick={() => { setView(v); }}>{l}</button>
          ))}
        </nav>
      </header>

      {/* ── Banner Jogo Finalizado ── */}
      {game.finished && (() => {
        const [s0, s1] = [game.teams[0].score, game.teams[1].score];
        const winner = s0 > s1 ? game.teams[0].name : game.teams[1].name;
        const loser  = s0 > s1 ? game.teams[1].name : game.teams[0].name;
        const ws = s0 > s1 ? s0 : s1;
        const ls = s0 > s1 ? s1 : s0;
        return (
          <div className="game-over-banner">
            <div className="game-over-title">Jogo Finalizado</div>
            <div className="game-over-winner">{winner}</div>
            <div className="game-over-score">{ws} — {ls}</div>
            <div className="game-over-loser">{loser}</div>
            <button className="game-over-reset" onClick={() => setGame(g => ({ ...g, finished: false }))}>
              Continuar editando
            </button>
          </div>
        );
      })()}

      {/* ── SCOUT ── */}
      {view==='scout' && (
        <main className="scout-view">
          <div className="team-tabs">
            {game.teams.map((t,ti)=>(
              <button key={ti} className="team-tab" data-active={activeTeam===ti}
                onClick={() => { setActiveTeam(ti); setSelectedPlayer(null); }}>
                {t.name} <span className="tab-score">{t.score}</span>
              </button>
            ))}
          </div>

          <section className="players-section">
            <div className="section-label-row">
              <span className="section-label" style={{padding:0}}>Atleta</span>
              <div style={{display:'flex',gap:'6px'}}>
                <button className="undo-btn" onClick={undoLastAction} title="Desfazer última ação">
                  ↩ Desfazer
                </button>
                <button className="sub-quick-btn"
                  onClick={() => {
                    if (selectedPlayer === null) { showToast('Selecione o atleta que SAI'); return; }
                    setSubModal({ reason: null, outIdx: selectedPlayer, canCancel: true });
                  }}>
                  ↕ Sub
                </button>
              </div>
            </div>

          </section>

          {sp && (
            <div className="selected-bar">
              <span className="sel-badge">#{sp.number} {sp.name}</span>
              <div className="sel-mini-stats">
                {[['PTS',sp.pts],['AST',sp.ast],['REB',sp.reb],['RO',sp.oreb],['STL',sp.stl],['TO',sp.to]].map(([k,v])=>(
                  <span key={k} className="mini-stat" data-warn={k==='TO'&&v>2}><b>{v}</b>{k}</span>
                ))}
                <span className="mini-stat" data-warn={sp.fouls>=FOUL_TROUBLE} data-danger={sp.fouls>=FOUL_DISQUALIFY}>
                  <b>{sp.fouls}</b>FL
                </span>
              </div>
            </div>
          )}

          {/* Mapa — clique direto quando atleta selecionado */}
          <section className="court-section">
            <div className="court-section-header">
              <div className="section-label" style={{padding:'8px 0 0'}}>
                {selectedPlayer !== null
                  ? `Toque na quadra — #${sp?.number} ${sp?.name.split(' ')[0]}`
                  : `Mapa — selecione um atleta para marcar`}
              </div>
              {selectedPlayer !== null && (
                <div className="court-active-badge">● ao vivo</div>
              )}
            </div>
            <div className="game-layout">

              {renderTeamPanel(0)}

              <div className="court-container">
                <BasketballCourt
                  shots={activeShots}
                  onCourtClick={handleCourtClick}
                  hasPlayer={selectedPlayer !== null}
                  attackDir={activeTeam === 0 ? 'right' : 'left'}
                />
              </div>

              {renderTeamPanel(1)}

            </div>
            {activeShots.length>0 && (
              <div className="shot-summary">
                <span className="shot-sum-item made">● {activeShots.filter(s=>s.made).length} certos</span>
                <span className="shot-sum-item missed">✕ {activeShots.filter(s=>!s.made).length} errados</span>
                <span className="shot-sum-item pct">{pct(activeShots.filter(s=>s.made).length, activeShots.length)} FG</span>
                <span className="shot-sum-item three">3pts: {pct(activeShots.filter(s=>s.made&&s.three).length, activeShots.filter(s=>s.three).length)}</span>
              </div>
            )}
          </section>

          {/* Ações — sem botões 2pts/3pts, somente LL + misc */}
          <section className="actions-section">
            <div className="actions-group">
              <div className="actions-group-label">Lances Livres</div>
              <div className="actions-row">
                {FT_ACTIONS.map(a=>(
                  <button key={a.id} className="action-btn" style={{'--ac':a.color}} onClick={()=>applyFT(a)}>{a.label}</button>
                ))}
                {inBonus && (
                  <button className="action-btn bonus-ft-btn" onClick={()=>setFtModal('pick_player')}>
                    LL Bonif.
                  </button>
                )}
              </div>
            </div>
            <div className="actions-group">
              <div className="actions-group-label">Outras Ações</div>
              <div className="actions-row wrap">
                {MISC_ACTIONS.map(a=>(
                  <button key={a.id} className="action-btn" style={{'--ac':a.color}} onClick={()=>applyMisc(a)}>{a.label}</button>
                ))}
              </div>
            </div>
          </section>
        </main>
      )}

      {/* ── STATS ── */}
      {view==='stats' && (
        <main className="stats-view">
          <div className="fouls-summary">
            <div className="fouls-summary-title">Faltas coletivas por período</div>
            <table className="fouls-table">
              <thead>
                <tr>
                  <th>Time</th>
                  {Array.from({length: game.quarter+1}, (_,i) => (
                    <th key={i}>{getQuarterLabel(i)}</th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {game.teams.map((t,ti)=>{
                  const tf = game.teamFouls?.[ti] || [];
                  const total = tf.reduce((a,b)=>a+b,0);
                  return (
                    <tr key={ti}>
                      <td className="player-cell">{t.name}</td>
                      {Array.from({length: game.quarter+1}, (_,qi) => (
                        <td key={qi} data-warn={(tf[qi]||0)>=TEAM_FOUL_BONUS}>{tf[qi]||0}</td>
                      ))}
                      <td className="pts-cell">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {game.teams.map((team,ti)=>{
            const tot = totals(team);
            // Mostra atletas que entraram em quadra: active=true OU teve qualquer stat registrada
            const active = team.players.filter(p =>
              p.active || p.pts || p.ast || p.reb || p.oreb || p.stl || p.blk ||
              p.to || p.fg2a || p.fg3a || p.ftm || p.fta || p.fouls ||
              (p.plusMinus||0) !== 0
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
                {active.length===0 && <div className="empty-stats">Sem dados ainda</div>}
                {active.length>0 && (
                  <div className="table-wrap">
                    <table className="stats-table">
                      <thead><tr><th>Atleta</th><th>MIN</th><th>PTS</th><th>AST</th><th>REB</th><th>RO</th><th>STL</th><th>BLK</th><th>TO</th><th>2P</th><th>FG%</th><th>3P</th><th>3P%</th><th>LL</th><th>LL%</th><th>FL</th><th>FS</th><th>+/-</th><th>PIR</th></tr></thead>
                      <tbody>
                        {active.map(p=>(
                          <tr key={p.id} data-disq={p.fouls>=FOUL_DISQUALIFY || (p.techFouls||0)>=TECH_DISQUALIFY}>
                            <td className="player-cell">
                              <span className="num-badge">#{p.number}</span>{p.name}
                              {(p.fouls>=FOUL_DISQUALIFY || (p.techFouls||0)>=TECH_DISQUALIFY) && <span className="disq-tag">DQ</span>}
                            </td>
                            <td className="min-cell">{Math.floor((p.timeOnCourt||0)/60)}:{String(Math.round((p.timeOnCourt||0)%60)).padStart(2,'0')}</td>
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
                            <td data-warn={p.fouls>=FOUL_TROUBLE && p.fouls<FOUL_DISQUALIFY} data-danger={p.fouls>=FOUL_DISQUALIFY || (p.techFouls||0)>=TECH_DISQUALIFY}>{p.fouls}{p.techFouls>0?`+${p.techFouls}t`:''}</td>
                            <td style={{color:'var(--blue)'}}>{p.foulsReceived||0}</td>
                            <td className={(p.plusMinus||0)>0?'pm-pos':(p.plusMinus||0)<0?'pm-neg':''}>{(p.plusMinus||0)>=0?`+${p.plusMinus||0}`:p.plusMinus||0}</td>
                            <td className={calcPIR(p)>0?'pm-pos':calcPIR(p)<0?'pm-neg':''}>{calcPIR(p)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>Time</td><td className="min-cell">—</td><td className="pts-cell">{tot.pts}</td>
                          <td>{tot.ast}</td><td>{tot.reb}</td><td>{tot.oreb}</td>
                          <td>{tot.stl}</td><td>{tot.blk}</td><td>{tot.to}</td>
                          <td className="shot-cell">{tot.fg2m}/{tot.fg2a}</td>
                          <td>{pct(tot.fg2m,tot.fg2a)}</td>
                          <td className="shot-cell">{tot.fg3m}/{tot.fg3a}</td>
                          <td>{pct(tot.fg3m,tot.fg3a)}</td>
                          <td className="shot-cell">{tot.ftm}/{tot.fta}</td>
                          <td>{pct(tot.ftm,tot.fta)}</td>
                          <td>{tot.fouls}</td>
                          <td></td>
                          <td></td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </main>
      )}

      {/* ── HEATMAP ── */}
      {view==='heatmap' && (
        <main className="heatmap-view">
          {game.teams.map((team, ti) => (
            <HeatMap
              key={ti}
              shots={team.players.flatMap(p => p.shots||[])}
              teamName={team.name}
              attackDir={ti === 0 ? 'right' : 'left'}
            />
          ))}
        </main>
      )}

      {/* ── LOG ── */}
      {view==='log' && (
        <main className="log-view">
          <div className="log-top">
            <span>{game.log.length} eventos</span>
            {game.log.length>0 && (
              <button className="clear-btn" onClick={()=>window.confirm('Limpar?')&&setGame(g=>({...g,log:[]}))}>Limpar</button>
            )}
          </div>
          {game.log.length===0 && <div className="empty-log">Sem eventos.</div>}
          <div className="log-list">
            {game.log.map(e=>(
              <div key={e.id} className="log-entry">
                <div className="log-meta"><span className="log-q">{e.q}</span><span>{e.time}</span><span className="log-team-name">{e.team}</span></div>
                <div className="log-body">
                  <span className="log-player">{e.player}</span>
                  <span className="log-action" style={{color:e.color}}>{e.action}</span>
                  {e.pts>0 && <span className="log-pts">+{e.pts}</span>}
                </div>
              </div>
            ))}
          </div>
        </main>
      )}

      {showPeriodEnd && (
      <div className="modal-overlay">
        <div className="modal">
          <div className="modal-header">
            <span>Fim do período</span>
          </div>

          <div className="modal-body">
            <p>{game ? `Fim do ${QUARTERS[game.quarter]}` : ''}</p>
          </div>

          <div className="modal-footer">
            <button
              className="btn-start"
              onClick={() => {
                setGame(g => ({
                  ...g,
                  quarter: Math.min(g.quarter + 1, 3),
                  clock: 600
                }));

                setShowPeriodEnd(false);
                setRunning(true);
              }}
            >
              Próximo Período
            </button>
          </div>
        </div>
      </div>
    )}

    </div>
  );
}
