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
  players: roster.map((p, i) => ({
    id: i+1, ...p, active: i < 5, ...INITIAL_PLAYER()
  }))
});

const newGame = (nameA='Time A', nameB='Time B', rosterA=DEFAULT_TEAM_A, rosterB=DEFAULT_TEAM_B) => ({
  id: Date.now(),
  date: new Date().toLocaleDateString('pt-BR'),
  dateFull: new Date().toISOString(),
  teams: [mkTeam(nameA, rosterA), mkTeam(nameB, rosterB)],
  quarter: 0,
  clock: 600,
  log: [],
  finished: false,
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

const COURT_ZONES = [
  { id:'paint_l',  label:'Garrafão E', x:8,  y:35, w:22, h:30 },
  { id:'paint_r',  label:'Garrafão D', x:70, y:35, w:22, h:30 },
  { id:'mid_l',    label:'Médio E',    x:5,  y:15, w:30, h:20 },
  { id:'mid_c',    label:'Médio C',    x:35, y:10, w:30, h:25 },
  { id:'mid_r',    label:'Médio D',    x:65, y:15, w:30, h:20 },
  { id:'3pt_lc',   label:'3pt LE',     x:0,  y:55, w:20, h:25, three:true },
  { id:'3pt_lw',   label:'3pt LW E',   x:5,  y:5,  w:25, h:18, three:true },
  { id:'3pt_top',  label:'3pt Topo',   x:30, y:0,  w:40, h:14, three:true },
  { id:'3pt_rw',   label:'3pt LW D',   x:70, y:5,  w:25, h:18, three:true },
  { id:'3pt_rc',   label:'3pt RC',     x:80, y:55, w:20, h:25, three:true },
];

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

// ─── CSV Export ───────────────────────────────────────────────────────────────
function exportCSV(game) {
  const lines = ['Atleta,Time,PTS,AST,REB,REB.OF,STL,BLK,TO,FG2M,FG2A,FG3M,FG3A,FTM,FTA,FG%,3P%,LL%,FALTAS'];
  game.teams.forEach(team => {
    team.players.forEach(p => {
      const fg = pct(p.fg2m+p.fg3m, p.fg2a+p.fg3a);
      const tp = pct(p.fg3m, p.fg3a);
      const ft = pct(p.ftm, p.fta);
      lines.push(`"#${p.number} ${p.name}","${team.name}",${p.pts},${p.ast},${p.reb},${p.oreb},${p.stl},${p.blk},${p.to},${p.fg2m},${p.fg2a},${p.fg3m},${p.fg3a},${p.ftm},${p.fta},${fg},${tp},${ft},${p.fouls}`);
    });
    const tot = totals(team);
    lines.push(`"TOTAL","${team.name}",${tot.pts},${tot.ast},${tot.reb},${tot.oreb},${tot.stl},${tot.blk},${tot.to},${tot.fg2m},${tot.fg2a},${tot.fg3m},${tot.fg3a},${tot.ftm},${tot.fta},${pct(tot.fg2m+tot.fg3m,tot.fg2a+tot.fg3a)},${pct(tot.fg3m,tot.fg3a)},${pct(tot.ftm,tot.fta)},${tot.fouls}`);
  });
  const blob = new Blob(['\ufeff'+lines.join('\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `scout_${game.teams[0].name}_vs_${game.teams[1].name}_${game.date.replace(/\//g,'-')}.csv`;
  a.click();
}

// ─── Shot Map Component ───────────────────────────────────────────────────────
function ShotMap({ shots = [] }) {
  const made   = shots.filter(s => s.made);
  const missed = shots.filter(s => !s.made);

  const zoneSummary = COURT_ZONES.map(z => {
    const zShots = shots.filter(s => s.zone === z.id);
    const zMade  = zShots.filter(s => s.made).length;
    return { ...z, made: zMade, total: zShots.length };
  });

  return (
    <div className="shot-map-wrap">
      <svg viewBox="0 0 100 80" className="court-svg" preserveAspectRatio="xMidYMid meet">
        {/* Court outline */}
        <rect x="0" y="0" width="100" height="80" fill="#1a1f2a" rx="2"/>
        {/* Paint */}
        <rect x="0" y="30" width="19" height="35" fill="none" stroke="#2a3040" strokeWidth="0.5"/>
        <rect x="81" y="30" width="19" height="35" fill="none" stroke="#2a3040" strokeWidth="0.5"/>
        {/* 3pt arc approximate */}
        <path d="M 0,25 Q 30,5 50,5 Q 70,5 100,25" fill="none" stroke="#2a3040" strokeWidth="0.5"/>
        <line x1="0" y1="25" x2="0" y2="80" stroke="#2a3040" strokeWidth="0.5"/>
        <line x1="100" y1="25" x2="100" y2="80" stroke="#2a3040" strokeWidth="0.5"/>
        {/* Basket */}
        <circle cx="7" cy="55" r="2" fill="none" stroke="#f97316" strokeWidth="0.6"/>
        <circle cx="93" cy="55" r="2" fill="none" stroke="#f97316" strokeWidth="0.6"/>

        {/* Zone heatmap */}
        {zoneSummary.map(z => z.total > 0 && (
          <g key={z.id}>
            <rect x={z.x} y={z.y} width={z.w} height={z.h}
              fill={z.made/z.total > 0.5 ? '#22c55e' : '#ef4444'}
              opacity={0.15 + Math.min(z.total/5, 0.4)} rx="1"/>
            <text x={z.x+z.w/2} y={z.y+z.h/2+1}
              textAnchor="middle" fontSize="4" fill="#e2e8f0" fontWeight="bold">
              {z.made}/{z.total}
            </text>
          </g>
        ))}

        {/* Shot dots */}
        {missed.map((s, i) => (
          <g key={`m${i}`}>
            <line x1={s.x-1.2} y1={s.y-1.2} x2={s.x+1.2} y2={s.y+1.2} stroke="#ef4444" strokeWidth="0.7"/>
            <line x1={s.x+1.2} y1={s.y-1.2} x2={s.x-1.2} y2={s.y+1.2} stroke="#ef4444" strokeWidth="0.7"/>
          </g>
        ))}
        {made.map((s, i) => (
          <circle key={`k${i}`} cx={s.x} cy={s.y} r="1.3" fill="#22c55e" opacity="0.9"/>
        ))}
      </svg>

      <div className="shot-legend">
        <span className="legend-item made">● Convertido ({made.length})</span>
        <span className="legend-item missed">✕ Errado ({missed.length})</span>
        {made.length + missed.length > 0 &&
          <span className="legend-item pct">{pct(made.length, made.length+missed.length)} FG</span>}
      </div>
    </div>
  );
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
                <div className="modal-roster-header">
                  <span>#</span><span>Nome</span>
                </div>
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
  const [screen, setScreen]     = useState('home'); // home | game | history
  const [games, setGames]       = useState(loadGames);
  const [game, setGame]         = useState(null);
  const [running, setRunning]   = useState(false);
  const [activeTeam, setActiveTeam]       = useState(0);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [view, setView]         = useState('scout'); // scout | stats | map | log
  const [toast, setToast]       = useState(null);
  const [showNewGame, setShowNewGame]     = useState(false);
  const [shotMode, setShotMode] = useState(false);
  const [shotPlayer, setShotPlayer]       = useState(null);
  const courtRef = useRef(null);

  // Clock
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

  // Auto-save
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
    setGame(g);
    setShowNewGame(false);
    setScreen('game');
    setView('scout');
    setActiveTeam(0);
    setSelectedPlayer(null);
    setRunning(false);
  };

  const openGame = (g) => {
    setGame(g);
    setScreen('game');
    setView('scout');
    setActiveTeam(0);
    setSelectedPlayer(null);
    setRunning(false);
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
      const entry = {
        id: Date.now(), q: QUARTERS[g.quarter], time: fmtTime(g.clock),
        team: g.teams[activeTeam].name,
        player: `#${g.teams[activeTeam].players[selectedPlayer].number} ${g.teams[activeTeam].players[selectedPlayer].name.split(' ')[0]}`,
        action: action.label, pts: action.pts, color: action.color
      };
      return { ...g, teams, log: [entry, ...g.log] };
    });
    const p = game.teams[activeTeam].players[selectedPlayer];
    if (action.pts > 0) showToast(`+${action.pts} — ${p.name.split(' ')[0]}`);
  }, [selectedPlayer, activeTeam, game]);

  const handleCourtClick = useCallback(e => {
    if (!shotMode || shotPlayer === null || !courtRef.current) return;
    const rect = courtRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width * 100);
    const y = ((e.clientY - rect.top) / rect.height * 80);
    const isThree = y < 25 || (x < 20 && y > 25) || (x > 80 && y > 25);
    const zone = COURT_ZONES.find(z => x>=z.x && x<=z.x+z.w && y>=z.y && y<=z.y+z.h)?.id || 'unknown';
    const made = window.confirm(`Arremesso ${isThree?'de 3':'de 2'} convertido?`);
    const actionId = made ? (isThree?'fg3m':'fg2m') : (isThree?'fg3miss':'fg2miss');
    const action = ACTIONS.find(a => a.id === actionId);

    // Save shot position
    setGame(g => {
      const teams = g.teams.map((t, ti) => {
        if (ti !== activeTeam) return t;
        const players = t.players.map((p, pi) => {
          if (pi !== shotPlayer) return p;
          const n = { ...p };
          if      (actionId==='fg2m')    { n.fg2m++; n.fg2a++; }
          else if (actionId==='fg2miss') { n.fg2a++; }
          else if (actionId==='fg3m')    { n.fg3m++; n.fg3a++; }
          else if (actionId==='fg3miss') { n.fg3a++; }
          n.pts = n.fg2m*2 + n.fg3m*3 + n.ftm;
          n.shots = [...(n.shots||[]), { x, y, made, zone, three: isThree }];
          return n;
        });
        return { ...t, score: t.score + (made ? (isThree?3:2) : 0), players };
      });
      const pl = g.teams[activeTeam].players[shotPlayer];
      const entry = {
        id: Date.now(), q: QUARTERS[g.quarter], time: fmtTime(g.clock),
        team: g.teams[activeTeam].name,
        player: `#${pl.number} ${pl.name.split(' ')[0]}`,
        action: action.label, pts: action.pts, color: action.color
      };
      return { ...g, teams, log: [entry, ...g.log] };
    });
    if (made) showToast(`+${isThree?3:2} — ${game.teams[activeTeam].players[shotPlayer].name.split(' ')[0]}`);
  }, [shotMode, shotPlayer, activeTeam, game]);

  // ── HOME SCREEN ────────────────────────────────────────────────────────────
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

          <button className="btn-new-game" onClick={() => setShowNewGame(true)}>
            + Novo Jogo
          </button>

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
                    <button className="export-btn" onClick={e => { e.stopPropagation(); exportCSV(g); }}>
                      CSV
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── GAME SCREEN ────────────────────────────────────────────────────────────
  const td = game.teams[activeTeam];
  const sp = selectedPlayer !== null ? td.players[selectedPlayer] : null;
  //const allShots = game.teams.flatMap(t => t.players.flatMap(p => (p.shots||[]).map(s => ({...s, team: t.name}))));

  return (
    <div className="app">
      {toast && <div className="toast">{toast}</div>}

      {/* HEADER */}
      <header className="header">
        <div className="header-top">
          <button className="back-btn" onClick={() => { setRunning(false); setScreen('home'); }}>‹ Voltar</button>
          <div className="header-game-label">{game.teams[0].name} vs {game.teams[1].name}</div>
          <button className="export-btn-sm" onClick={() => exportCSV(game)}>CSV</button>
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
          {[['scout','Scout'],['stats','Stats'],['map','Mapa'],['log','Log']].map(([v,l]) => (
            <button key={v} className="nav-btn" data-active={view===v} onClick={() => { setView(v); setShotMode(false); }}>{l}</button>
          ))}
        </nav>
      </header>

      {/* SCOUT */}
      {view==='scout' && (
        <main className="scout-view">
          <div className="team-tabs">
            {game.teams.map((t,ti) => (
              <button key={ti} className="team-tab" data-active={activeTeam===ti}
                onClick={() => { setActiveTeam(ti); setSelectedPlayer(null); }}>
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

      {/* STATS */}
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

      {/* SHOT MAP */}
      {view==='map' && (
        <main className="map-view">
          <div className="map-controls">
            <div className="team-tabs">
              {game.teams.map((t,ti) => (
                <button key={ti} className="team-tab" data-active={activeTeam===ti}
                  onClick={() => { setActiveTeam(ti); setSelectedPlayer(null); setShotMode(false); }}>
                  {t.name}
                </button>
              ))}
            </div>
            <div className="map-player-row">
              <select className="map-player-select"
                value={shotPlayer ?? ''}
                onChange={e => setShotPlayer(e.target.value==='' ? null : Number(e.target.value))}>
                <option value="">— Selecionar atleta —</option>
                {td.players.map((p,pi) => (
                  <option key={pi} value={pi}>#{p.number} {p.name}</option>
                ))}
              </select>
              <button
                className={`shot-mode-btn ${shotMode ? 'active' : ''}`}
                disabled={shotPlayer===null}
                onClick={() => setShotMode(m => !m)}>
                {shotMode ? '✓ Marcando' : '+ Marcar arremesso'}
              </button>
            </div>
            {shotMode && <div className="shot-hint">Toque na quadra para marcar o arremesso</div>}
          </div>

          <div className="court-container" ref={courtRef} onClick={handleCourtClick}
            style={{cursor: shotMode ? 'crosshair' : 'default'}}>
            <ShotMap shots={shotPlayer!==null
              ? (td.players[shotPlayer]?.shots || [])
              : td.players.flatMap(p => p.shots||[])}/>
          </div>

          <div className="map-team-summary">
            {game.teams.map((t,ti) => {
              const tot = totals(t);
              return (
                <div key={ti} className="map-team-stat">
                  <span className="map-team-name">{t.name}</span>
                  <span>FG: {pct(tot.fg2m+tot.fg3m, tot.fg2a+tot.fg3a)}</span>
                  <span>3P: {pct(tot.fg3m, tot.fg3a)}</span>
                  <span>{tot.pts}pts</span>
                </div>
              );
            })}
          </div>
        </main>
      )}

      {/* LOG */}
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
