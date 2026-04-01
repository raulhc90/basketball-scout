import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const QUARTERS = ['1Q', '2Q', '3Q', '4Q', 'OT'];
const STORAGE_KEY = 'bball_scout_games';
const FOUL_DISQUALIFY = 6;   // faltas para disqualificação
const FOUL_TROUBLE    = 4;   // faltas para foul trouble
const TEAM_FOUL_BONUS = 5;   // faltas coletivas para bonificação
const TECH_DISQUALIFY = 2;   // técnicas/antidesportivas para substituição obrigatória

const INITIAL_PLAYER = () => ({
  pts: 0, ast: 0, reb: 0, oreb: 0, stl: 0, blk: 0, to: 0,
  fg2a: 0, fg2m: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0,
  fouls: 0, techFouls: 0,
  shots: [],
});

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
  players: roster.map((p, i) => ({ id: i+1, ...p, active: i < 5, ...INITIAL_PLAYER() }))
});

const newGame = (nameA='Time A', nameB='Time B', rosterA=DEFAULT_TEAM_A, rosterB=DEFAULT_TEAM_B) => ({
  id: Date.now(),
  date: new Date().toLocaleDateString('pt-BR'),
  dateFull: new Date().toISOString(),
  teams: [mkTeam(nameA, rosterA), mkTeam(nameB, rosterB)],
  quarter: 0, clock: 600, log: [], finished: false,
  teamFouls: [[0,0,0,0,0],[0,0,0,0,0]],
});

const MISC_ACTIONS = [
  { id:'reb',  label:'Rebote',   pts:0, color:'#06b6d4' },
  { id:'oreb', label:'Reb.Of.',  pts:0, color:'#0891b2' },
  { id:'stl',  label:'Roubo',    pts:0, color:'#10b981' },
  { id:'blk',  label:'Toco',     pts:0, color:'#8b5cf6' },
  { id:'to',   label:'Turnov.',  pts:0, color:'#ef4444' },
  { id:'fouls',label:'Falta',    pts:0, color:'#f97316' },
];

const FT_ACTIONS = [
  { id:'ftm',    label:'LL certo', pts:1, color:'#f59e0b' },
  { id:'ftmiss', label:'LL erro',  pts:0, color:'#475569' },
];

const fmtTime = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
const pct = (m,a) => a===0 ? '—' : `${Math.round(m/a*100)}%`;
const totals = team => team.players.reduce((acc, p) => {
  ['pts','ast','reb','oreb','stl','blk','to','fg2m','fg2a','fg3m','fg3a','ftm','fta','fouls']
    .forEach(k => acc[k] = (acc[k]||0) + p[k]);
  return acc;
}, {});

function loadGames() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } }
function saveGames(g) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(g)); } catch {} }

function dl(content, filename) {
  const b = new Blob(['\ufeff'+content], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = filename; a.click();
}
function exportStatsCSV(game) {
  const lines = ['Atleta,Time,PTS,AST,REB,REB.OF,STL,BLK,TO,FG2M,FG2A,FG3M,FG3A,FTM,FTA,FG%,3P%,LL%,FALTAS'];
  game.teams.forEach(t => {
    t.players.forEach(p => lines.push(`"#${p.number} ${p.name}","${t.name}",${p.pts},${p.ast},${p.reb},${p.oreb},${p.stl},${p.blk},${p.to},${p.fg2m},${p.fg2a},${p.fg3m},${p.fg3a},${p.ftm},${p.fta},${pct(p.fg2m+p.fg3m,p.fg2a+p.fg3a)},${pct(p.fg3m,p.fg3a)},${pct(p.ftm,p.fta)},${p.fouls}`));
    const tot = totals(t);
    lines.push(`"TOTAL","${t.name}",${tot.pts},${tot.ast},${tot.reb},${tot.oreb},${tot.stl},${tot.blk},${tot.to},${tot.fg2m},${tot.fg2a},${tot.fg3m},${tot.fg3a},${tot.ftm},${tot.fta},${pct(tot.fg2m+tot.fg3m,tot.fg2a+tot.fg3a)},${pct(tot.fg3m,tot.fg3a)},${pct(tot.ftm,tot.fta)},${tot.fouls}`);
  });
  dl(lines.join('\n'), `stats_${game.teams[0].name}_vs_${game.teams[1].name}_${game.date.replace(/\//g,'-')}.csv`);
}
function exportShotsCSV(game) {
  const lines = ['Atleta,Time,Quarto,Tempo,X_pct,Y_pct,Convertido,Tipo,Assistencia'];
  game.teams.forEach(t => t.players.forEach(p =>
    (p.shots||[]).forEach(s => lines.push(`"#${p.number} ${p.name}","${t.name}","${s.q||''}","${s.time||''}",${s.x.toFixed(2)},${s.y.toFixed(2)},${s.made?'Sim':'Não'},${s.three?'3pts':'2pts'},"${s.assistedBy||''}"`))));
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
function isThreePointer(xPct, yPct) {
  const W = 600, H = 320, cy = 160;
  const cx1 = 34,  cx2 = 566;
  const arcR = 145;
  const arcX1 = 67, arcX2 = 533;
  const latY1 = 19, latY2 = 301;

  const px = xPct * W / 100;
  const py = yPct * H / 100;

  // Canto/fundo (corner three)
  if (py < latY1 || py > latY2) return true;

  const dL = Math.sqrt((px - cx1) ** 2 + (py - cy) ** 2);
  const dR = Math.sqrt((px - cx2) ** 2 + (py - cy) ** 2);

  if (dL <= dR) {
    // Lado esquerdo — corredor lateral ou além do arco
    if (px <= arcX1) return true;
    return dL > arcR;
  } else {
    // Lado direito
    if (px >= arcX2) return true;
    return dR > arcR;
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
function BasketballCourt({ shots=[], onCourtClick, hasPlayer=false }) {
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
      <g stroke="#4a5570" strokeWidth="1" fill="none">
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

      {/* Labels de zona */}
      <g fill="#4a5570" fontSize="8" fontFamily="sans-serif" textAnchor="middle">
        <text x="48"   y="18">3pts</text>
        <text x={W/2}  y="14">3pts topo</text>
        <text x="552"  y="18">3pts</text>
        <text x="62"   y={cy+4}>Garrafão</text>
        <text x="538"  y={cy+4}>Garrafão</text>
        <text x="220"  y={cy-10} fontSize="7">2pts médio</text>
        <text x="380"  y={cy-10} fontSize="7">2pts médio</text>
      </g>

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

// ─── Confirm Shot Modal (acerto/erro in-app, sem popup) ──────────────────────
function ConfirmShotModal({ three, onMade, onMissed, onCancel }) {
  return (
    <div className="confirm-overlay">
      <div className="confirm-modal">
        <div className="confirm-title">Arremesso de {three ? '3 pontos' : '2 pontos'}</div>
        <div className="confirm-btns">
          <button className="confirm-btn made" onClick={onMade}>Convertido</button>
          <button className="confirm-btn missed" onClick={onMissed}>Errado</button>
        </div>
        <button className="confirm-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── Assist Modal ─────────────────────────────────────────────────────────────
function AssistModal({ players, scorerIdx, onSelect, onNone, onCancel }) {
  return (
    <div className="assist-overlay">
      <div className="assist-modal">
        <div className="assist-modal-header">
          <span>Quem deu a assistência?</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="assist-modal-body">
          <button className="assist-none-btn" onClick={onNone}>Sem assistência</button>
          <div className="assist-players-grid">
            {players.map((p,i) => i===scorerIdx ? null : (
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
    { id:'pessoal',   label:'Falta Pessoal',  desc:'Contato durante jogo',   color:'#f97316', isTech: false },
    { id:'tecnica',   label:'Falta Técnica',   desc:'Conduta antidesportiva', color:'#ef4444', isTech: true  },
    { id:'flagrante', label:'Flagrante',        desc:'Contato excessivo',      color:'#dc2626', isTech: true  },
    { id:'ofensiva',  label:'Ofensiva',          desc:'Carrinho / fora da área',color:'#fb923c', isTech: false },
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

// ─── New Game Modal ───────────────────────────────────────────────────────────
function NewGameModal({ onStart, onClose }) {
  const [nameA, setNameA] = useState('Time A');
  const [nameB, setNameB] = useState('Time B');
  const [players, setPlayers] = useState({
    a: DEFAULT_TEAM_A.map(p=>({...p})), b: DEFAULT_TEAM_B.map(p=>({...p}))
  });
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
        </div>
        <div className="modal-footer">
          <button className="btn-start" onClick={()=>onStart(nameA,nameB,players.a,players.b)}>Iniciar Jogo</button>
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

  const courtRef = useRef(null);

  // Cronômetro
  useEffect(() => {
    if (!running || !game) return;
    const id = setInterval(() => setGame(g => {
      if (!g || g.clock <= 0) { setRunning(false); return g; }
      return { ...g, clock: g.clock - 1 };
    }), 1000);
    return () => clearInterval(id);
  }, [running, game]);

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

  const startGame = (nameA, nameB, rosterA, rosterB) => {
    setGame(newGame(nameA, nameB, rosterA, rosterB));
    setShowNewGame(false); setScreen('game'); setView('scout');
    setActiveTeam(0); setSelectedPlayer(null); setRunning(false); };

  const openGame = g => {
    setGame(g); setScreen('game'); setView('scout');
    setActiveTeam(0); setSelectedPlayer(null); setRunning(false); };

  // Avança quarto — zera faltas coletivas (exceto OT que continua)
  const nextQuarter = useCallback(() => {
    setGame(g => {
      if (!g) return g;
      const nextQ = Math.min(g.quarter + 1, 4);
      const nextClock = nextQ === 4 ? 300 : 600;
      // OT: não zera faltas; demais quartos: zera
      const teamFouls = nextQ === 4
        ? g.teamFouls
        : g.teamFouls.map(tf => tf.map((f,qi) => qi === nextQ ? 0 : f));
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
  }, [game, subModal, activeTeam]);

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

    setGame(g => {
      const teamFouls = (g.teamFouls || [[0,0,0,0,0],[0,0,0,0,0]]).map((tf, ti) =>
        ti === activeTeam ? tf.map((f,qi) => qi === g.quarter ? f+1 : f) : tf
      );
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
      const entry = { id: Date.now(), q: QUARTERS[g.quarter], time: fmtTime(g.clock),
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
  }, [selectedPlayer, activeTeam, game]);

  // ── Lance Livre ────────────────────────────────────────────────────────────
  // ftTeamIdx: time que ARREMESSA (adversário de quem fez a falta)
  const commitFT = useCallback((ftTeamIdx, playerIdx, made) => {
    if (!game) return;
    const pl = game.teams[ftTeamIdx].players[playerIdx];
    setGame(g => {
      const teams = g.teams.map((t, ti) => {
        if (ti !== ftTeamIdx) return t;
        return {
          ...t,
          score: t.score + (made ? 1 : 0),
          players: t.players.map((p, pi) => {
            if (pi !== playerIdx) return p;
            return { ...p, ftm: p.ftm + (made?1:0), fta: p.fta+1, pts: p.pts + (made?1:0) };
          })
        };
      });
      const entry = { id: Date.now(), q: QUARTERS[g.quarter], time: fmtTime(g.clock),
        team: g.teams[ftTeamIdx].name, player: `#${pl.number} ${pl.name.split(' ')[0]}`,
        action: made ? 'LL certo' : 'LL erro', pts: made?1:0, color: made?'#f59e0b':'#475569' };
      return { ...g, teams, log: [entry, ...g.log] };
    });
    if (made) showToast(`+1 LL — ${pl.name.split(' ')[0]}`);
    // Não fecha modal aqui — o controle de abrir/fechar fica no JSX (attempt counter)
    // O modal fechará quando attempt === total (controlado pelo onMade/onMissed no JSX)
  }, [game]);

  // ── Registra arremesso com assistência ────────────────────────────────────
  const commitShot = useCallback((playerIdx, xPct, yPct, made, three, assistIdx) => {
    const pts = made ? (three ? 3 : 2) : 0;
    const actionId = made ? (three?'fg3m':'fg2m') : (three?'fg3miss':'fg2miss');
    const col = made ? (three?'#3b82f6':'#22c55e') : '#475569';

    setGame(g => {
      const teams = g.teams.map((t, ti) => {
        if (ti !== activeTeam) return t;
        const players = t.players.map((p, pi) => {
          const n = { ...p };
          if (pi === assistIdx) n.ast = (n.ast||0)+1;
          if (pi === playerIdx) {
            if      (actionId==='fg2m')    { n.fg2m++; n.fg2a++; }
            else if (actionId==='fg2miss') { n.fg2a++; }
            else if (actionId==='fg3m')    { n.fg3m++; n.fg3a++; }
            else if (actionId==='fg3miss') { n.fg3a++; }
            n.pts = n.fg2m*2 + n.fg3m*3 + n.ftm;
            if (xPct !== null) {
              const apl = assistIdx !== null ? g.teams[activeTeam].players[assistIdx] : null;
              n.shots = [...(n.shots||[]), {
                x: xPct, y: yPct, made, three, zone: three?'3pts':'2pts',
                assistedBy: apl ? `#${apl.number} ${apl.name.split(' ')[0]}` : '',
                q: QUARTERS[g.quarter], time: fmtTime(g.clock),
              }];
            }
          }
          return n;
        });
        return { ...t, score: t.score + pts, players };
      });
      const sp = g.teams[activeTeam].players[playerIdx];
      const ap = assistIdx !== null ? g.teams[activeTeam].players[assistIdx] : null;
      const entries = [];
      if (ap) entries.push({ id: Date.now(), q: QUARTERS[g.quarter], time: fmtTime(g.clock),
        team: g.teams[activeTeam].name, player: `#${ap.number} ${ap.name.split(' ')[0]}`,
        action: 'Assist.', pts: 0, color: '#a855f7' });
      entries.push({ id: Date.now()+1, q: QUARTERS[g.quarter], time: fmtTime(g.clock),
        team: g.teams[activeTeam].name, player: `#${sp.number} ${sp.name.split(' ')[0]}`,
        action: made?(three?'3pts':'2pts'):(three?'3x falha':'2x falha'), pts, color: col });
      return { ...g, teams, log: [...entries, ...g.log] };
    });
    if (made) showToast(`+${pts}${assistIdx !== null ? ' + assist' : ''}`);
    setAssistPending(null); }, [activeTeam]);

  // ── Clique na quadra ───────────────────────────────────────────────────────
  // Sempre ativo quando há atleta selecionado — não precisa clicar em "+ Marcar"
  const handleCourtClick = useCallback(e => {
    if (selectedPlayer === null) return;
    if (confirmShot || assistPending || foulPending || ftModal || subModal) return;
    // Usar e.currentTarget (o SVG) para coordenadas precisas independente do wrapper
    const svgEl = e.currentTarget;
    const rect = svgEl.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width  * 100;
    const yPct = (e.clientY - rect.top)  / rect.height * 100;
    const three = isThreePointer(xPct, yPct);
    setConfirmShot({ xPct, yPct, three });
  }, [selectedPlayer, confirmShot, assistPending, foulPending, ftModal, subModal]);

  // ── Ações miscellâneas ─────────────────────────────────────────────────────
  const applyMisc = useCallback(action => {
    if (selectedPlayer === null) { showToast('Selecione um atleta'); return; }
    if (action.id === 'fouls') { setFoulPending(true); return; }
    setGame(g => {
      const teams = g.teams.map((t, ti) => {
        if (ti !== activeTeam) return t;
        return { ...t, players: t.players.map((p, pi) => {
          if (pi !== selectedPlayer) return p;
          return { ...p, [action.id]: (p[action.id]||0)+1 };
        })};
      });
      const pl = g.teams[activeTeam].players[selectedPlayer];
      const entry = { id: Date.now(), q: QUARTERS[g.quarter], time: fmtTime(g.clock),
        team: g.teams[activeTeam].name, player: `#${pl.number} ${pl.name.split(' ')[0]}`,
        action: action.label, pts: 0, color: action.color };
      return { ...g, teams, log: [entry, ...g.log] };
    });
  }, [selectedPlayer, activeTeam]);

  const applyFT = useCallback(action => {
    if (selectedPlayer === null) { showToast('Selecione um atleta'); return; }
    // LL manual: vai para o time do atleta selecionado (sem falta coletiva)
    commitFT(activeTeam, selectedPlayer, action.id === 'ftm');
  }, [selectedPlayer, activeTeam, commitFT]);

  // ─── HOME ──────────────────────────────────────────────────────────────────
  if (screen === 'home') return (
    <div className="app">
      {showNewGame && <NewGameModal onStart={startGame} onClose={() => setShowNewGame(false)}/>}
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
          <div className="home-title">Basketball Scout</div>
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
    </div>
  );

  // ─── GAME ──────────────────────────────────────────────────────────────────
  const td  = game.teams[activeTeam];
  const sp  = selectedPlayer !== null ? td.players[selectedPlayer] : null;
  const activeShots = sp ? (sp.shots||[]) : td.players.flatMap(p => p.shots||[]);
  const tfq = game.teamFouls?.[activeTeam]?.[game.quarter] || 0;
  const inBonus = tfq >= TEAM_FOUL_BONUS;

  return (
    <div className="app">
      {toast && <div className="toast">{toast}</div>}

      {/* ── Modais ── */}
      {confirmShot && (
        <ConfirmShotModal
          three={confirmShot.three}
          onMade={() => {
            setConfirmShot(null);
            setAssistPending({ scorerIdx: selectedPlayer, xPct: confirmShot.xPct, yPct: confirmShot.yPct, made: true, three: confirmShot.three });
          }}
          onMissed={() => {
            const s = confirmShot; setConfirmShot(null);
            commitShot(selectedPlayer, s.xPct, s.yPct, false, s.three, null);
          }}
          onCancel={() => setConfirmShot(null)}
        />
      )}
      {assistPending && (
        <AssistModal
          players={td.players} scorerIdx={assistPending.scorerIdx}
          onSelect={aIdx => commitShot(assistPending.scorerIdx, assistPending.xPct, assistPending.yPct, true, assistPending.three, aIdx)}
          onNone={() => commitShot(assistPending.scorerIdx, assistPending.xPct, assistPending.yPct, true, assistPending.three, null)}
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
      {subModal && (
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
                  data-filled={(game.teamFouls?.[0]?.[game.quarter]||0)>=n}
                  data-bonus={n===TEAM_FOUL_BONUS}/>
              ))}
            </div>
          </div>

          <div className="center-info">
            <span className="quarter-label">{QUARTERS[game.quarter]}</span>
            <div className="clock">{fmtTime(game.clock)}</div>
            <div className="clock-btns">
              <button onClick={() => setRunning(r=>!r)}>{running ? '⏸' : '▶'}</button>
              <button onClick={() => setGame(g=>({...g,clock:game.quarter===4?300:600}))}>↺</button>
              <button className="next-q-btn" onClick={nextQuarter} disabled={game.quarter>=4}>
                {game.quarter<4 ? `›${QUARTERS[game.quarter+1]}` : 'Fim'}
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
                  data-filled={(game.teamFouls?.[1]?.[game.quarter]||0)>=n}
                  data-bonus={n===TEAM_FOUL_BONUS}/>
              ))}
            </div>
          </div>
        </div>

        {inBonus && (
          <div className="bonus-bar">
            BONIFICAÇÃO — {game.teams[activeTeam].name} ({tfq} faltas no {QUARTERS[game.quarter]})
          </div>
        )}

        <nav className="nav">
          {[['scout','Scout'],['stats','Stats'],['log','Log']].map(([v,l])=>(
            <button key={v} className="nav-btn" data-active={view===v}
              onClick={() => { setView(v); }}>{l}</button>
          ))}
        </nav>
      </header>

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
              <button className="sub-quick-btn"
                onClick={() => {
                  if (selectedPlayer === null) { showToast('Selecione o atleta que SAI'); return; }
                  setSubModal({ reason: null, outIdx: selectedPlayer, canCancel: true });
                }}>
                ↕ Substituição
              </button>
            </div>
            <div className="players-grid">
              {td.players.map((p,pi)=>(
                <button key={pi} className="player-btn"
                  data-active={selectedPlayer===pi}
                  data-bench={!p.active}
                  data-trouble={p.fouls>=FOUL_TROUBLE && p.fouls<FOUL_DISQUALIFY}
                  data-disq={p.fouls>=FOUL_DISQUALIFY || (p.techFouls||0)>=TECH_DISQUALIFY}
                  onClick={() => setSelectedPlayer(pi)}>
                  <span className="pnum">#{p.number}</span>
                  <span className="pname">{p.name.split(' ')[0]}</span>
                  <span className="ppts">{p.pts}p</span>
                  {p.fouls>0 && (
                    <span className="pfoul-badge"
                      data-trouble={p.fouls>=FOUL_TROUBLE && p.fouls<FOUL_DISQUALIFY && (p.techFouls||0)<TECH_DISQUALIFY}
                      data-disq={p.fouls>=FOUL_DISQUALIFY || (p.techFouls||0)>=TECH_DISQUALIFY}>
                      {p.fouls}f{p.techFouls>0?`+${p.techFouls}t`:''}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>

          {sp && (
            <div className="selected-bar">
              <span className="sel-badge">#{sp.number} {sp.name}</span>
              <div className="sel-mini-stats">
                {[['PTS',sp.pts],['AST',sp.ast],['REB',sp.reb+sp.oreb],['STL',sp.stl],['TO',sp.to]].map(([k,v])=>(
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
            <div ref={courtRef} className="court-container">
              <BasketballCourt shots={activeShots} onCourtClick={handleCourtClick} hasPlayer={selectedPlayer !== null}/>
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
            <div className="fouls-summary-title">Faltas coletivas por quarto</div>
            <table className="fouls-table">
              <thead>
                <tr><th>Time</th>{QUARTERS.slice(0,game.quarter+1).map(q=><th key={q}>{q}</th>)}<th>Total</th></tr>
              </thead>
              <tbody>
                {game.teams.map((t,ti)=>{
                  const tf = game.teamFouls?.[ti]||[0,0,0,0,0];
                  const total = tf.reduce((a,b)=>a+b,0);
                  return (
                    <tr key={ti}>
                      <td className="player-cell">{t.name}</td>
                      {tf.slice(0,game.quarter+1).map((f,qi)=>(
                        <td key={qi} data-warn={f>=TEAM_FOUL_BONUS}>{f}</td>
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
            const active = team.players.filter(p=>p.pts||p.ast||p.reb||p.oreb||p.stl||p.blk||p.to||p.fg2a||p.fg3a||p.fouls);
            return (
              <div key={ti} className="stats-block">
                <div className="stats-header"><span>{team.name}</span><span className="stats-total-score">{team.score} pts</span></div>
                {active.length===0 && <div className="empty-stats">Sem dados ainda</div>}
                {active.length>0 && (
                  <div className="table-wrap">
                    <table className="stats-table">
                      <thead><tr><th>Atleta</th><th>PTS</th><th>AST</th><th>REB</th><th>STL</th><th>BLK</th><th>TO</th><th>FG%</th><th>3P%</th><th>LL%</th><th>FL</th></tr></thead>
                      <tbody>
                        {active.map(p=>(
                          <tr key={p.id} data-disq={p.fouls>=FOUL_DISQUALIFY || (p.techFouls||0)>=TECH_DISQUALIFY}>
                            <td className="player-cell">
                              <span className="num-badge">#{p.number}</span>{p.name}
                              {(p.fouls>=FOUL_DISQUALIFY || (p.techFouls||0)>=TECH_DISQUALIFY) && <span className="disq-tag">DQ</span>}
                            </td>
                            <td className="pts-cell">{p.pts}</td>
                            <td>{p.ast}</td><td>{p.reb+p.oreb}</td>
                            <td>{p.stl}</td><td>{p.blk}</td>
                            <td data-warn={p.to>2}>{p.to}</td>
                            <td>{pct(p.fg2m+p.fg3m,p.fg2a+p.fg3a)}</td>
                            <td>{pct(p.fg3m,p.fg3a)}</td>
                            <td>{pct(p.ftm,p.fta)}</td>
                            <td data-warn={p.fouls>=FOUL_TROUBLE && p.fouls<FOUL_DISQUALIFY} data-danger={p.fouls>=FOUL_DISQUALIFY || (p.techFouls||0)>=TECH_DISQUALIFY}>{p.fouls}{p.techFouls>0?`+${p.techFouls}t`:''}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>Time</td><td className="pts-cell">{tot.pts}</td>
                          <td>{tot.ast}</td><td>{tot.reb+tot.oreb}</td>
                          <td>{tot.stl}</td><td>{tot.blk}</td><td>{tot.to}</td>
                          <td>{pct(tot.fg2m+tot.fg3m,tot.fg2a+tot.fg3a)}</td>
                          <td>{pct(tot.fg3m,tot.fg3a)}</td>
                          <td>{pct(tot.ftm,tot.fta)}</td>
                          <td>{tot.fouls}</td>
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
    </div>
  );
}
