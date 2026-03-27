import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const QUARTERS = ['1Q', '2Q', '3Q', '4Q', 'OT'];
const STORAGE_KEY = 'bball_scout_games';

const INITIAL_PLAYER = () => ({
  pts: 0, ast: 0, reb: 0, oreb: 0, stl: 0, blk: 0, to: 0,
  fg2a: 0, fg2m: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0, fouls: 0,
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
});

const ACTIONS = [
  { id:'fg2m',    label:'2pts',     pts:2, color:'#22c55e', group:'shoot' },
  { id:'fg2miss', label:'2x falha', pts:0, color:'#475569', group:'shoot' },
  { id:'fg3m',    label:'3pts',     pts:3, color:'#3b82f6', group:'shoot' },
  { id:'fg3miss', label:'3x falha', pts:0, color:'#475569', group:'shoot' },
  { id:'ftm',     label:'LL certo', pts:1, color:'#f59e0b', group:'ft'    },
  { id:'ftmiss',  label:'LL erro',  pts:0, color:'#475569', group:'ft'    },
  { id:'ast',     label:'Assist.',  pts:0, color:'#a855f7', group:'misc'  },
  { id:'reb',     label:'Rebote',   pts:0, color:'#06b6d4', group:'misc'  },
  { id:'oreb',    label:'Reb.Of.',  pts:0, color:'#0891b2', group:'misc'  },
  { id:'stl',     label:'Roubo',    pts:0, color:'#10b981', group:'misc'  },
  { id:'blk',     label:'Toco',     pts:0, color:'#8b5cf6', group:'misc'  },
  { id:'to',      label:'Turnov.',  pts:0, color:'#ef4444', group:'misc'  },
  { id:'fouls',   label:'Falta',    pts:0, color:'#f97316', group:'misc'  },
];

// Quadra NBA: 28.65m x 15.24m → viewBox 600x320
// Origem (0,0) = canto inferior esquerdo da quadra
// SVG y invertido: y_svg = 320 - y_real
// Cesta esquerda: x=155cm=~32px, Cesta direita: x=2710cm=~568px
// Linha de 3pts: raio 723cm do aro, linha lateral a 91cm do aro
// Garrafão: 490x580cm

const fmtTime = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
const pct = (m,a) => a===0 ? '—' : `${Math.round(m/a*100)}%`;

const totals = team => team.players.reduce((acc, p) => {
  ['pts','ast','reb','oreb','stl','blk','to','fg2m','fg2a','fg3m','fg3a','ftm','fta','fouls']
    .forEach(k => acc[k] = (acc[k]||0) + p[k]);
  return acc;
}, {});

function loadGames() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveGames(games) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(games)); } catch {}
}

// ─── CSV Exports ──────────────────────────────────────────────────────────────
function exportStatsCSV(game) {
  const lines = ['Atleta,Time,PTS,AST,REB,REB.OF,STL,BLK,TO,FG2M,FG2A,FG3M,FG3A,FTM,FTA,FG%,3P%,LL%,FALTAS'];
  game.teams.forEach(team => {
    team.players.forEach(p => {
      lines.push(`"#${p.number} ${p.name}","${team.name}",${p.pts},${p.ast},${p.reb},${p.oreb},${p.stl},${p.blk},${p.to},${p.fg2m},${p.fg2a},${p.fg3m},${p.fg3a},${p.ftm},${p.fta},${pct(p.fg2m+p.fg3m,p.fg2a+p.fg3a)},${pct(p.fg3m,p.fg3a)},${pct(p.ftm,p.fta)},${p.fouls}`);
    });
    const tot = totals(team);
    lines.push(`"TOTAL","${team.name}",${tot.pts},${tot.ast},${tot.reb},${tot.oreb},${tot.stl},${tot.blk},${tot.to},${tot.fg2m},${tot.fg2a},${tot.fg3m},${tot.fg3a},${tot.ftm},${tot.fta},${pct(tot.fg2m+tot.fg3m,tot.fg2a+tot.fg3a)},${pct(tot.fg3m,tot.fg3a)},${pct(tot.ftm,tot.fta)},${tot.fouls}`);
  });
  download(lines.join('\n'), `stats_${game.teams[0].name}_vs_${game.teams[1].name}_${game.date.replace(/\//g,'-')}.csv`);
}

function exportShotsCSV(game) {
  const lines = ['Atleta,Time,Quarto,Tempo,X_pct,Y_pct,Convertido,Tipo,Zona'];
  game.teams.forEach(team => {
    team.players.forEach(p => {
      (p.shots||[]).forEach(s => {
        lines.push(`"#${p.number} ${p.name}","${team.name}","${s.q||''}","${s.time||''}",${s.x.toFixed(2)},${s.y.toFixed(2)},${s.made?'Sim':'Não'},${s.three?'3pts':'2pts'},"${s.zone||''}"`);
      });
    });
  });
  download(lines.join('\n'), `arremessos_${game.teams[0].name}_vs_${game.teams[1].name}_${game.date.replace(/\//g,'-')}.csv`);
}

function download(content, filename) {
  const blob = new Blob(['\ufeff'+content], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ─── Basketball Court SVG ─────────────────────────────────────────────────────
// viewBox 0 0 600 320, orientação horizontal, ataque para direita
// Medidas baseadas na NBA/NBB: quadra 28m x 15m
// Escala: 600/2865 = 0.2094 px/cm | 320/1524 = 0.2100 px/cm ≈ 1px = 4.77cm
// Cesta: x=160(esq) e x=440(dir), y=160 (centro)
// Garrafão: 580x490cm → 122x103px
// Linha 3pts: raio 675cm → 141px, linha lateral a 65cm → 14px
// Linha central: x=300

function BasketballCourt({ shots=[], onCourtClick, shotMode=false, filterTeam=null }) {
  // Dimensões SVG
  const W = 600, H = 320;
  const cx1 = 57,  cy = 160; // cesta esquerda
  const cx2 = 543; // cesta direita

  // Garrafão esq: x0=0..122, y: cy±51
  const paint1 = { x:0, y:cy-51, w:122, h:103 };
  // Garrafão dir
  const paint2 = { x:W-122, y:cy-51, w:122, h:103 };

  // Zona de cor por tipo
  const getColor = (shot) => shot.made
    ? 'rgba(34,197,94,0.85)'
    : 'rgba(239,68,68,0.85)';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="court-svg"
      style={{cursor: shotMode ? 'crosshair' : 'default'}}
      onClick={onCourtClick}
    >
      {/* Fundo da quadra */}
      <rect x="0" y="0" width={W} height={H} fill="#1a1f2a"/>

      {/* Linhas da quadra - cor sutil */}
      <g stroke="#3a4560" strokeWidth="1.2" fill="none">
        {/* Borda da quadra */}
        <rect x="2" y="2" width={W-4} height={H-4} rx="2"/>

        {/* Linha central */}
        <line x1={W/2} y1="2" x2={W/2} y2={H-2}/>
        {/* Círculo central - raio 180cm → 38px */}
        <circle cx={W/2} cy={cy} r="38"/>

        {/* Garrafão esquerdo */}
        <rect x={paint1.x+2} y={paint1.y} width={paint1.w} height={paint1.h}/>
        {/* Linha de lance livre esq */}
        <line x1={paint1.x+paint1.w} y1={paint1.y} x2={paint1.x+paint1.w} y2={paint1.y+paint1.h}/>
        {/* Semicírculo lance livre esq (acima da linha) */}
        <path d={`M ${paint1.x+paint1.w} ${cy-51} A 51 51 0 0 1 ${paint1.x+paint1.w} ${cy+51}`} strokeDasharray="4 3"/>

        {/* Garrafão direito */}
        <rect x={paint2.x} y={paint2.y} width={paint2.w-2} height={paint2.h}/>
        {/* Linha de lance livre dir */}
        <line x1={paint2.x} y1={paint2.y} x2={paint2.x} y2={paint2.y+paint2.h}/>
        {/* Semicírculo lance livre dir */}
        <path d={`M ${paint2.x} ${cy-51} A 51 51 0 0 0 ${paint2.x} ${cy+51}`} strokeDasharray="4 3"/>

        {/* Linha de 3pts esquerda:
            NBB: raio 675cm do aro, reta lateral a 90cm do aro
            90cm → 19px; 675cm → 141px
            Linha reta lateral: x=cx1..cx1+38, y=cy±75
            Arco: de y=cy-75 até y=cy+75 */}
        {/* Retas laterais esq */}
        <line x1="2" y1={cy-75} x2={cx1+38} y2={cy-75}/>
        <line x1="2" y1={cy+75} x2={cx1+38} y2={cy+75}/>
        {/* Arco 3pts esq */}
        <path d={`M ${cx1+38} ${cy-75} A 141 141 0 0 1 ${cx1+38} ${cy+75}`}/>

        {/* Linha de 3pts direita */}
        <line x1={W-2} y1={cy-75} x2={cx2-38} y2={cy-75}/>
        <line x1={W-2} y1={cy+75} x2={cx2-38} y2={cy+75}/>
        <path d={`M ${cx2-38} ${cy-75} A 141 141 0 0 0 ${cx2-38} ${cy+75}`}/>

        {/* Área restrita esq (raio 125cm → 26px) */}
        <path d={`M ${cx1} ${cy-26} A 26 26 0 0 1 ${cx1} ${cy+26}`}/>
        {/* Área restrita dir */}
        <path d={`M ${cx2} ${cy-26} A 26 26 0 0 0 ${cx2} ${cy+26}`}/>
      </g>

      {/* Cestas */}
      <g stroke="#f97316" strokeWidth="1.5" fill="none">
        <circle cx={cx1} cy={cy} r="5"/>
        <line x1="2" y1={cy} x2={cx1-5} y2={cy}/>
        <circle cx={cx2} cy={cy} r="5"/>
        <line x1={W-2} y1={cy} x2={cx2+5} y2={cy}/>
      </g>

      {/* Rótulos das zonas (muito discretos) */}
      <g fill="#3a4560" fontSize="9" fontFamily="sans-serif" textAnchor="middle">
        <text x="60"  y="30">3pts</text>
        <text x="300" y="18">3pts topo</text>
        <text x="540" y="30">3pts</text>
        <text x="61"  y={cy+4}>Garrafão</text>
        <text x="539" y={cy+4}>Garrafão</text>
      </g>

      {/* Shots */}
      {shots.map((s, i) => {
        // x,y vêm em % do SVG
        const px = s.x * W / 100;
        const py = s.y * H / 100;
        return s.made ? (
          <circle key={i} cx={px} cy={py} r="5" fill={getColor(s)} stroke="#fff" strokeWidth="0.5" opacity="0.9"/>
        ) : (
          <g key={i} opacity="0.9">
            <line x1={px-4} y1={py-4} x2={px+4} y2={py+4} stroke={getColor(s)} strokeWidth="1.5" strokeLinecap="round"/>
            <line x1={px+4} y1={py-4} x2={px-4} y2={py+4} stroke={getColor(s)} strokeWidth="1.5" strokeLinecap="round"/>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Detecta se arremesso é de 3pts baseado na posição na quadra ──────────────
function isThreePointer(xPct, yPct) {
  const W = 600, H = 320;
  const px = xPct * W / 100;
  const py = yPct * H / 100;
  const cy = 160;

  // Cesta mais próxima
  const distLeft  = Math.sqrt((px-57)**2  + (py-cy)**2);
  const distRight = Math.sqrt((px-543)**2 + (py-cy)**2);

  if (distLeft < distRight) {
    // Lado esquerdo: linha reta a y<85 ou y>235, arco raio>141
    if (py < cy-75 || py > cy+75) return true; // acima/abaixo da reta lateral
    if (px < 57+38) return false; // dentro do garrafão
    return distLeft > 141;
  } else {
    if (py < cy-75 || py > cy+75) return true;
    if (px > 543-38) return false;
    return distRight > 141;
  }
}

// ─── New Game Modal ───────────────────────────────────────────────────────────
function NewGameModal({ onStart, onClose }) {
  const [nameA, setNameA] = useState('Time A');
  const [nameB, setNameB] = useState('Time B');
  const [players, setPlayers] = useState({
    a: DEFAULT_TEAM_A.map(p => ({...p})),
    b: DEFAULT_TEAM_B.map(p => ({...p})),
  });

  const updatePlayer = (team, idx, field, val) => {
    setPlayers(prev => ({
      ...prev,
      [team]: prev[team].map((p,i) => i===idx ? {...p,[field]:val} : p)
    }));
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <span>Novo Jogo</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="modal-teams">
            {[['a', nameA, setNameA], ['b', nameB, setNameB]].map(([key, name, setName]) => (
              <div key={key} className="modal-team-col">
                <input className="team-name-input" value={name} onChange={e => setName(e.target.value)} placeholder="Nome do time"/>
                <div className="modal-roster-header"><span>#</span><span>Nome</span></div>
                <div className="modal-roster">
                  {players[key].map((p, i) => (
                    <div key={i} className="modal-player-row">
                      <input className="num-input" value={p.number} maxLength={2}
                        onChange={e => updatePlayer(key, i, 'number', e.target.value)}/>
                      <input className="name-inp" value={p.name}
                        onChange={e => updatePlayer(key, i, 'name', e.target.value)}/>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-start" onClick={() => onStart(nameA, nameB, players.a, players.b)}>
            Iniciar Jogo
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
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
  const [shotMode, setShotMode]       = useState(false);
  const courtRef = useRef(null);

  useEffect(() => {
    if (!running || !game) return;
    const id = setInterval(() => {
      setGame(g => {
        if (!g || g.clock <= 0) { setRunning(false); return g; }
        return { ...g, clock: g.clock - 1 };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, game]);

  useEffect(() => {
    if (!game) return;
    setGames(prev => {
      const idx = prev.findIndex(g => g.id === game.id);
      const next = idx >= 0 ? prev.map((g,i) => i===idx ? game : g) : [game, ...prev];
      saveGames(next);
      return next;
    });
  }, [game]);

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 1600); };

  const startGame = (nameA, nameB, rosterA, rosterB) => {
    const g = newGame(nameA, nameB, rosterA, rosterB);
    setGame(g); setShowNewGame(false); setScreen('game');
    setView('scout'); setActiveTeam(0); setSelectedPlayer(null);
    setRunning(false); setShotMode(false);
  };

  const openGame = g => {
    setGame(g); setScreen('game'); setView('scout');
    setActiveTeam(0); setSelectedPlayer(null);
    setRunning(false); setShotMode(false);
  };

  const applyAction = useCallback(action => {
    if (selectedPlayer === null) { showToast('Selecione um atleta'); return; }
    setGame(g => {
      const teams = g.teams.map((t, ti) => {
        if (ti !== activeTeam) return t;
        const players = t.players.map((p, pi) => {
          if (pi !== selectedPlayer) return p;
          const n = { ...p };
          if      (action.id==='fg2m')    { n.fg2m++; n.fg2a++; }
          else if (action.id==='fg2miss') { n.fg2a++; }
          else if (action.id==='fg3m')    { n.fg3m++; n.fg3a++; }
          else if (action.id==='fg3miss') { n.fg3a++; }
          else if (action.id==='ftm')     { n.ftm++;  n.fta++;  }
          else if (action.id==='ftmiss')  { n.fta++;  }
          else                            { n[action.id] = (n[action.id]||0)+1; }
          n.pts = n.fg2m*2 + n.fg3m*3 + n.ftm;
          return n;
        });
        return { ...t, score: t.score + action.pts, players };
      });
      const pl = g.teams[activeTeam].players[selectedPlayer];
      const entry = {
        id: Date.now(), q: QUARTERS[g.quarter], time: fmtTime(g.clock),
        team: g.teams[activeTeam].name,
        player: `#${pl.number} ${pl.name.split(' ')[0]}`,
        action: action.label, pts: action.pts, color: action.color
      };
      return { ...g, teams, log: [entry, ...g.log] };
    });
    const p = game.teams[activeTeam].players[selectedPlayer];
    if (action.pts > 0) showToast(`+${action.pts} — ${p.name.split(' ')[0]}`);
  }, [selectedPlayer, activeTeam, game]);

  // Click na quadra para registrar arremesso com posição
  const handleCourtClick = useCallback(e => {
    if (!shotMode || selectedPlayer === null || !courtRef.current) return;
    const rect = courtRef.current.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width * 100;
    const yPct = (e.clientY - rect.top)  / rect.height * 100;
    const three = isThreePointer(xPct, yPct);
    const made = window.confirm(`Arremesso de ${three ? '3pts' : '2pts'} — Convertido?`);
    const actionId = made ? (three ? 'fg3m' : 'fg2m') : (three ? 'fg3miss' : 'fg2miss');
    const action = ACTIONS.find(a => a.id === actionId);

    setGame(g => {
      const teams = g.teams.map((t, ti) => {
        if (ti !== activeTeam) return t;
        const players = t.players.map((p, pi) => {
          if (pi !== selectedPlayer) return p;
          const n = { ...p };
          if      (actionId==='fg2m')    { n.fg2m++; n.fg2a++; }
          else if (actionId==='fg2miss') { n.fg2a++; }
          else if (actionId==='fg3m')    { n.fg3m++; n.fg3a++; }
          else if (actionId==='fg3miss') { n.fg3a++; }
          n.pts = n.fg2m*2 + n.fg3m*3 + n.ftm;
          n.shots = [...(n.shots||[]), {
            x: xPct, y: yPct, made, three,
            zone: three ? '3pts' : '2pts',
            q: QUARTERS[g.quarter],
            time: fmtTime(g.clock),
          }];
          return n;
        });
        return { ...t, score: t.score + (made ? (three?3:2) : 0), players };
      });
      const pl = g.teams[activeTeam].players[selectedPlayer];
      const entry = {
        id: Date.now(), q: QUARTERS[g.quarter], time: fmtTime(g.clock),
        team: g.teams[activeTeam].name,
        player: `#${pl.number} ${pl.name.split(' ')[0]}`,
        action: action.label, pts: action.pts, color: action.color
      };
      return { ...g, teams, log: [entry, ...g.log] };
    });
    const p = game.teams[activeTeam].players[selectedPlayer];
    if (made) showToast(`+${three?3:2} — ${p.name.split(' ')[0]}`);
  }, [shotMode, selectedPlayer, activeTeam, game]);

  // ── HOME ──────────────────────────────────────────────────────────────────
  if (screen === 'home') {
    return (
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
                    <span>{g.date}</span>
                    <span>{QUARTERS[g.quarter]}</span>
                    <span>{g.log.length} eventos</span>
                    <div className="export-btns" onClick={e => e.stopPropagation()}>
                      <button className="export-btn" onClick={() => exportStatsCSV(g)}>Stats</button>
                      <button className="export-btn green" onClick={() => exportShotsCSV(g)}>Arrem.</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── GAME ──────────────────────────────────────────────────────────────────
  const td = game.teams[activeTeam];
  const sp = selectedPlayer !== null ? td.players[selectedPlayer] : null;
  const activeShots = sp ? (sp.shots||[]) : td.players.flatMap(p => p.shots||[]);

  return (
    <div className="app">
      {toast && <div className="toast">{toast}</div>}

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
            onClick={() => { setActiveTeam(0); setSelectedPlayer(null); setShotMode(false); }}>
            <span className="team-name">{game.teams[0].name}</span>
            <span className="score">{game.teams[0].score}</span>
          </div>
          <div className="center-info">
            <span className="quarter-label">{QUARTERS[game.quarter]}</span>
            <div className="clock">{fmtTime(game.clock)}</div>
            <div className="clock-btns">
              <button onClick={() => setRunning(r => !r)}>{running ? '⏸' : '▶'}</button>
              <button onClick={() => setGame(g => ({...g, clock:600}))}>↺</button>
              <button onClick={() => setGame(g => ({...g, quarter:Math.min(g.quarter+1,4), clock:600}))}>
                ›{QUARTERS[Math.min(game.quarter+1,4)]}
              </button>
            </div>
          </div>
          <div className="team-score right" data-active={activeTeam===1}
            onClick={() => { setActiveTeam(1); setSelectedPlayer(null); setShotMode(false); }}>
            <span className="score">{game.teams[1].score}</span>
            <span className="team-name">{game.teams[1].name}</span>
          </div>
        </div>
        <nav className="nav">
          {[['scout','Scout'],['stats','Stats'],['log','Log']].map(([v,l]) => (
            <button key={v} className="nav-btn" data-active={view===v}
              onClick={() => { setView(v); if(v!=='scout') setShotMode(false); }}>{l}</button>
          ))}
        </nav>
      </header>

      {/* ── SCOUT ── */}
      {view==='scout' && (
        <main className="scout-view">
          <div className="team-tabs">
            {game.teams.map((t,ti) => (
              <button key={ti} className="team-tab" data-active={activeTeam===ti}
                onClick={() => { setActiveTeam(ti); setSelectedPlayer(null); setShotMode(false); }}>
                {t.name} <span className="tab-score">{t.score}</span>
              </button>
            ))}
          </div>

          <section className="players-section">
            <div className="section-label">Atleta</div>
            <div className="players-grid">
              {td.players.map((p,pi) => (
                <button key={pi} className="player-btn"
                  data-active={selectedPlayer===pi} data-bench={!p.active}
                  onClick={() => setSelectedPlayer(pi)}>
                  <span className="pnum">#{p.number}</span>
                  <span className="pname">{p.name.split(' ')[0]}</span>
                  <span className="ppts">{p.pts}p</span>
                </button>
              ))}
            </div>
          </section>

          {sp && (
            <div className="selected-bar">
              <span className="sel-badge">#{sp.number} {sp.name}</span>
              <div className="sel-mini-stats">
                {[['PTS',sp.pts],['AST',sp.ast],['REB',sp.reb+sp.oreb],
                  ['STL',sp.stl],['TO',sp.to],['FL',sp.fouls]].map(([k,v]) => (
                  <span key={k} className="mini-stat" data-warn={k==='TO'&&v>2} data-danger={k==='FL'&&v>=4}>
                    <b>{v}</b>{k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Mapa de arremessos inline no scout */}
          <section className="court-section">
            <div className="court-section-header">
              <div className="section-label" style={{padding:'8px 0 0'}}>
                Mapa de arremessos — {sp ? `#${sp.number} ${sp.name.split(' ')[0]}` : 'time inteiro'}
              </div>
              <button
                className={`shot-mode-btn ${shotMode ? 'active' : ''}`}
                disabled={selectedPlayer===null}
                onClick={() => setShotMode(m => !m)}>
                {shotMode ? '✓ Marcando' : '+ Marcar'}
              </button>
            </div>
            {shotMode && <div className="shot-hint">Toque na quadra para registrar o arremesso</div>}
            <div ref={courtRef} className="court-container">
              <BasketballCourt shots={activeShots} onCourtClick={handleCourtClick} shotMode={shotMode}/>
            </div>
            {activeShots.length > 0 && (
              <div className="shot-summary">
                <span className="shot-sum-item made">● {activeShots.filter(s=>s.made).length} convertidos</span>
                <span className="shot-sum-item missed">✕ {activeShots.filter(s=>!s.made).length} errados</span>
                <span className="shot-sum-item pct">
                  {pct(activeShots.filter(s=>s.made).length, activeShots.length)} FG
                </span>
                <span className="shot-sum-item three">
                  3pts: {pct(activeShots.filter(s=>s.made&&s.three).length, activeShots.filter(s=>s.three).length)}
                </span>
              </div>
            )}
          </section>

          <section className="actions-section">
            <div className="actions-group">
              <div className="actions-group-label">Arremessos</div>
              <div className="actions-row">
                {ACTIONS.filter(a=>a.group==='shoot').map(a => (
                  <button key={a.id} className="action-btn" style={{'--ac':a.color}} onClick={() => applyAction(a)}>{a.label}</button>
                ))}
              </div>
            </div>
            <div className="actions-group">
              <div className="actions-group-label">Lances Livres</div>
              <div className="actions-row">
                {ACTIONS.filter(a=>a.group==='ft').map(a => (
                  <button key={a.id} className="action-btn" style={{'--ac':a.color}} onClick={() => applyAction(a)}>{a.label}</button>
                ))}
              </div>
            </div>
            <div className="actions-group">
              <div className="actions-group-label">Outras Ações</div>
              <div className="actions-row wrap">
                {ACTIONS.filter(a=>a.group==='misc').map(a => (
                  <button key={a.id} className="action-btn" style={{'--ac':a.color}} onClick={() => applyAction(a)}>{a.label}</button>
                ))}
              </div>
            </div>
          </section>
        </main>
      )}

      {/* ── STATS ── */}
      {view==='stats' && (
        <main className="stats-view">
          {game.teams.map((team,ti) => {
            const tot = totals(team);
            const active = team.players.filter(p=>p.pts||p.ast||p.reb||p.oreb||p.stl||p.blk||p.to||p.fg2a||p.fg3a||p.fouls);
            return (
              <div key={ti} className="stats-block">
                <div className="stats-header">
                  <span>{team.name}</span>
                  <span className="stats-total-score">{team.score} pts</span>
                </div>
                {active.length===0 && <div className="empty-stats">Sem dados ainda</div>}
                {active.length>0 && (
                  <div className="table-wrap">
                    <table className="stats-table">
                      <thead>
                        <tr><th>Atleta</th><th>PTS</th><th>AST</th><th>REB</th><th>STL</th><th>BLK</th><th>TO</th><th>FG%</th><th>3P%</th><th>LL%</th><th>FL</th></tr>
                      </thead>
                      <tbody>
                        {active.map(p => (
                          <tr key={p.id}>
                            <td className="player-cell"><span className="num-badge">#{p.number}</span>{p.name}</td>
                            <td className="pts-cell">{p.pts}</td>
                            <td>{p.ast}</td><td>{p.reb+p.oreb}</td>
                            <td>{p.stl}</td><td>{p.blk}</td>
                            <td data-warn={p.to>2}>{p.to}</td>
                            <td>{pct(p.fg2m+p.fg3m,p.fg2a+p.fg3a)}</td>
                            <td>{pct(p.fg3m,p.fg3a)}</td>
                            <td>{pct(p.ftm,p.fta)}</td>
                            <td data-warn={p.fouls>=4}>{p.fouls}</td>
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
              <button className="clear-btn"
                onClick={() => window.confirm('Limpar histórico?') && setGame(g=>({...g,log:[]}))}>
                Limpar
              </button>
            )}
          </div>
          {game.log.length===0 && <div className="empty-log">Sem eventos. Inicie o scout.</div>}
          <div className="log-list">
            {game.log.map(e => (
              <div key={e.id} className="log-entry">
                <div className="log-meta">
                  <span className="log-q">{e.q}</span>
                  <span>{e.time}</span>
                  <span className="log-team-name">{e.team}</span>
                </div>
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