'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const AVATARS = ['🧑‍💻', '👩‍💻', '🐧', '🦊', '🐢', '🤖', '🦉', '🐙'];
const LS_KEY = 'sre-relay-identity';

async function jpost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Request gagal');
  return data;
}

export default function Page() {
  const [identity, setIdentity] = useState(null); // {code, playerId}
  const [gs, setGs] = useState(null); // game state from server
  const [scenarios, setScenarios] = useState([]);
  const [err, setErr] = useState('');
  const pollRef = useRef(null);

  // Restore identity from localStorage on mount.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (saved?.code && saved?.playerId) setIdentity(saved);
    } catch {}
    fetch('/api/scenarios')
      .then((r) => r.json())
      .then((d) => setScenarios(d.scenarios || []))
      .catch(() => {});
  }, []);

  const saveIdentity = (id) => {
    localStorage.setItem(LS_KEY, JSON.stringify(id));
    setIdentity(id);
  };
  const leave = () => {
    localStorage.removeItem(LS_KEY);
    setIdentity(null);
    setGs(null);
  };

  const poll = useCallback(async () => {
    if (!identity?.code) return;
    try {
      const r = await fetch(
        `/api/rooms/${identity.code}/state?playerId=${identity.playerId}`
      );
      if (r.status === 404) {
        leave();
        return;
      }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'gagal');
      setGs(d);
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  }, [identity]);

  useEffect(() => {
    if (!identity?.code) return;
    poll();
    pollRef.current = setInterval(poll, 1500);
    return () => clearInterval(pollRef.current);
  }, [identity, poll]);

  return (
    <div className="wrap">
      <div className="title">
        <span className="dot">●</span> SRE Troubleshoot Relay
      </div>
      <p className="subtitle">
        Selesaikan incident bareng tim — bergiliran, dapat clue, divalidasi AI.
      </p>

      {err && <div className="err">⚠ {err}</div>}

      {!identity && <Home onJoined={saveIdentity} />}
      {identity && gs && gs.room?.status === 'lobby' && (
        <Lobby gs={gs} identity={identity} scenarios={scenarios} onLeave={leave} refresh={poll} />
      )}
      {identity && gs && gs.room?.status === 'playing' && (
        <Board gs={gs} identity={identity} onLeave={leave} refresh={poll} />
      )}
      {identity && gs && gs.room?.status === 'done' && (
        <Recap gs={gs} identity={identity} scenarios={scenarios} onLeave={leave} refresh={poll} />
      )}
      {identity && !gs && <div className="card muted">Memuat room…</div>}
    </div>
  );
}

function AvatarPicker({ value, onChange }) {
  return (
    <div className="avatars">
      {AVATARS.map((a) => (
        <div
          key={a}
          className={'av' + (a === value ? ' sel' : '')}
          onClick={() => onChange(a)}
        >
          {a}
        </div>
      ))}
    </div>
  );
}

function Home({ onJoined }) {
  const [tab, setTab] = useState('create');
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [e, setE] = useState('');

  const submit = async () => {
    setE('');
    setBusy(true);
    try {
      if (tab === 'create') {
        const d = await jpost('/api/rooms', { nickname, avatar });
        onJoined({ code: d.code, playerId: d.playerId });
      } else {
        const d = await jpost(`/api/rooms/${code.trim().toUpperCase()}/join`, {
          nickname,
          avatar,
        });
        onJoined({ code: d.code, playerId: d.playerId });
      }
    } catch (err) {
      setE(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 16 }}>
        <button
          className={tab === 'create' ? '' : 'ghost'}
          onClick={() => setTab('create')}
        >
          Buat Room
        </button>
        <button
          className={tab === 'join' ? '' : 'ghost'}
          onClick={() => setTab('join')}
        >
          Gabung Room
        </button>
      </div>

      <label>Nickname</label>
      <input
        type="text"
        value={nickname}
        maxLength={24}
        placeholder="mis. andi-sre"
        onChange={(e) => setNickname(e.target.value)}
      />

      {tab === 'join' && (
        <>
          <label style={{ marginTop: 12 }}>Kode Room</label>
          <input
            type="text"
            value={code}
            maxLength={6}
            placeholder="6 huruf, mis. K7P2QX"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </>
      )}

      <label style={{ marginTop: 12 }}>Pilih Karakter</label>
      <AvatarPicker value={avatar} onChange={setAvatar} />

      {e && <div className="err">⚠ {e}</div>}
      <div style={{ marginTop: 16 }}>
        <button onClick={submit} disabled={busy || !nickname.trim() || (tab === 'join' && code.length < 4)}>
          {busy ? '…' : tab === 'create' ? 'Buat & Masuk' : 'Gabung'}
        </button>
      </div>
    </div>
  );
}

function PlayersRow({ players, turnId }) {
  return (
    <div className="players">
      {players.map((p) => (
        <div key={p.id} className={'player' + (p.id === turnId ? ' turn' : '')}>
          <span className="em">{p.avatar}</span>
          <span>{p.nickname}</span>
          {p.is_host && <span className="you">host</span>}
          <span className="sc">{p.score}</span>
        </div>
      ))}
    </div>
  );
}

function ScenarioPicker({ scenarios, value, onChange }) {
  return (
    <div className="scn">
      {scenarios.map((s) => (
        <button
          key={s.id}
          className={'opt' + (s.id === value ? ' sel' : '')}
          onClick={() => onChange(s.id)}
        >
          <b>{s.title}</b> <span>· {s.difficulty} · {s.steps} langkah</span>
          <br />
          <span>{s.description}</span>
        </button>
      ))}
    </div>
  );
}

// Host-only: generate an AI scenario (or pick a ready-made one) then start the round.
function ScenarioSetup({ identity, scenarios, serverPreview, refresh, label = '▶ Mulai Game' }) {
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [preview, setPreview] = useState(serverPreview || null);
  const [fallback, setFallback] = useState(false);
  const [staticId, setStaticId] = useState('');
  const [showStatic, setShowStatic] = useState(false);
  const [e, setE] = useState('');

  const generate = async () => {
    setE('');
    setGenBusy(true);
    setStaticId('');
    try {
      const d = await jpost(`/api/rooms/${identity.code}/generate`, {
        playerId: identity.playerId,
        topic,
        difficulty,
      });
      setPreview(d.scenario);
      setFallback(!!d.fallback);
      await refresh();
    } catch (err) {
      setE(err.message);
    } finally {
      setGenBusy(false);
    }
  };

  const start = async () => {
    setE('');
    setStartBusy(true);
    try {
      await jpost(`/api/rooms/${identity.code}/start`, {
        playerId: identity.playerId,
        scenarioId: staticId || undefined,
      });
      await refresh();
    } catch (err) {
      setE(err.message);
    } finally {
      setStartBusy(false);
    }
  };

  const canStart = !!preview || !!staticId;

  return (
    <>
      <label>Generate Soal Incident (AI)</label>
      <div className="row">
        <input
          type="text"
          style={{ flex: 1, minWidth: 180 }}
          placeholder="Topik (opsional): redis, kafka, DNS…"
          value={topic}
          onChange={(ev) => setTopic(ev.target.value)}
        />
        <select value={difficulty} onChange={(ev) => setDifficulty(ev.target.value)} style={{ width: 150 }}>
          <option value="">Acak</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
      </div>
      <div style={{ marginTop: 10 }}>
        <button onClick={generate} disabled={genBusy}>
          {genBusy ? '⏳ Membuat soal…' : '✨ Generate Soal (AI)'}
        </button>
        <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
          Jumlah langkah menyesuaikan jumlah pemain.
        </span>
      </div>

      {preview && (
        <div className={'toast ' + (fallback ? 'rv' : 'ok')} style={{ marginTop: 12 }}>
          <b>{preview.title}</b> · {preview.difficulty || '—'} · {preview.totalSteps} langkah
          <div className="muted" style={{ marginTop: 4 }}>{preview.description}</div>
          {fallback && <div style={{ marginTop: 4 }}>⚠ AI gagal — memakai skenario cadangan.</div>}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button className="ghost" onClick={() => setShowStatic((v) => !v)}>
          {showStatic ? '− sembunyikan' : '+ atau pilih skenario siap-pakai'}
        </button>
      </div>
      {showStatic && (
        <div style={{ marginTop: 10 }}>
          <ScenarioPicker
            scenarios={scenarios}
            value={staticId}
            onChange={(id) => {
              setStaticId(id);
              setPreview(null);
            }}
          />
        </div>
      )}

      {e && <div className="err">⚠ {e}</div>}
      <div style={{ marginTop: 16 }}>
        <button onClick={start} disabled={startBusy || !canStart}>
          {startBusy ? '…' : label}
        </button>
      </div>
    </>
  );
}

function Lobby({ gs, identity, scenarios, onLeave, refresh }) {
  const me = gs.players.find((p) => p.id === identity.playerId);
  const isHost = me?.is_host;

  return (
    <>
      <div className="card center-text">
        <label>Bagikan kode ini ke tim SRE-mu</label>
        <div className="code-badge">{gs.room.code}</div>
        <div style={{ marginTop: 10 }}>
          <button className="ghost" onClick={() => navigator.clipboard?.writeText(gs.room.code)}>
            Salin Kode
          </button>
        </div>
      </div>

      <div className="card">
        <label>Pemain ({gs.players.length})</label>
        <PlayersRow players={gs.players} turnId={null} />
      </div>

      <div className="card">
        {isHost ? (
          <>
            <ScenarioSetup
              identity={identity}
              scenarios={scenarios}
              serverPreview={gs.scenario}
              refresh={refresh}
            />
            <div style={{ marginTop: 10 }}>
              <button className="ghost" onClick={onLeave}>Keluar</button>
            </div>
          </>
        ) : (
          <>
            {gs.scenario ? (
              <div className="toast ok">
                <b>{gs.scenario.title}</b> · {gs.scenario.totalSteps} langkah
                <div className="muted" style={{ marginTop: 4 }}>{gs.scenario.description}</div>
              </div>
            ) : (
              <span className="muted">Host sedang menyiapkan soal…</span>
            )}
            <div className="spread" style={{ marginTop: 10 }}>
              <span className="muted">Menunggu host memulai game…</span>
              <button className="ghost" onClick={onLeave}>Keluar</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Board({ gs, identity, onLeave, refresh }) {
  const { room, scenario, currentStep, players, log } = gs;
  const myTurn = room.current_turn_player_id === identity.playerId;
  const turnPlayer = players.find((p) => p.id === room.current_turn_player_id);
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const logEndRef = useRef(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log?.length]);

  const submit = async () => {
    if (!cmd.trim()) return;
    setBusy(true);
    setToast(null);
    try {
      const d = await jpost(`/api/rooms/${identity.code}/submit`, {
        playerId: identity.playerId,
        input: cmd,
      });
      if (d.correct) {
        setToast({ kind: 'ok', text: `✓ Benar! +${d.pointsGained} poin. ${d.feedback || ''}` });
      } else if (d.revealed) {
        setToast({ kind: 'rv', text: `Kesempatan habis. Jawaban: ${d.answer}` });
      } else {
        setToast({
          kind: 'no',
          text: `✗ ${d.feedback || 'Belum tepat.'}${d.next_clue ? ' Clue: ' + d.next_clue : ''} (sisa ${d.attemptsLeft}x)`,
        });
      }
      setCmd('');
      await refresh();
    } catch (err) {
      setToast({ kind: 'no', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <div className="spread">
          <div>
            <div className="step-objective" style={{ margin: 0 }}>{scenario?.title}</div>
            <div className="muted" style={{ fontSize: 13 }}>{scenario?.description}</div>
          </div>
          <div className="progress">
            Langkah {room.current_step_index + 1}/{scenario?.totalSteps}
          </div>
        </div>
      </div>

      <div className="card">
        <PlayersRow players={players} turnId={room.current_turn_player_id} />
      </div>

      {currentStep && (
        <div className="card">
          <span className="role-tag">{currentStep.role}</span>
          <div className="step-objective">{currentStep.objective}</div>
          {currentStep.clues.map((c, i) => (
            <div key={i} className="clue">
              <b>Clue {i + 1}:</b> {c}
            </div>
          ))}

          <div className="divider" />

          <div className={'turnbar ' + (myTurn ? 'mine' : 'theirs')}>
            {myTurn
              ? '▶ Giliran KAMU — masukkan command / jawaban:'
              : `⏳ Menunggu ${turnPlayer?.avatar || ''} ${turnPlayer?.nickname || '…'} menjawab…`}
          </div>

          <div className="row">
            <input
              className="cmd"
              style={{ flex: 1, minWidth: 220 }}
              placeholder={myTurn ? 'mis. kubectl get pods -n production' : 'bukan giliranmu'}
              value={cmd}
              disabled={!myTurn || busy}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && myTurn && submit()}
            />
            <button onClick={submit} disabled={!myTurn || busy || !cmd.trim()}>
              {busy ? '…' : 'Kirim'}
            </button>
          </div>

          {toast && <div className={'toast ' + toast.kind}>{toast.text}</div>}
        </div>
      )}

      <div className="card">
        <label>Activity Log</label>
        <div className="log">
          {(log || []).map((l, i) => (
            <div key={i} className={'logline ' + l.verdict}>
              <span className="who">{l.avatar} {l.nickname}</span>{' '}
              <span className="inp">→ {l.input}</span>
              {l.feedback && <span className="fb">{l.feedback}</span>}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="ghost" onClick={onLeave}>Keluar</button>
        </div>
      </div>
    </>
  );
}

function Recap({ gs, identity, scenarios, onLeave, refresh }) {
  const me = gs.players.find((p) => p.id === identity.playerId);
  const isHost = me?.is_host;
  const ranked = [...gs.players].sort((a, b) => b.score - a.score);
  const total = gs.players.reduce((s, p) => s + p.score, 0);

  return (
    <>
      <div className="card center-text">
        <div className="step-objective">🎉 Incident Resolved!</div>
        <div className="muted">{gs.scenario?.title}</div>
        <div className="big-score">{total}</div>
        <div className="muted">total skor tim</div>
      </div>

      <div className="card">
        <label>Papan Skor</label>
        {ranked.map((p, i) => (
          <div key={p.id} className="spread" style={{ padding: '6px 0' }}>
            <span>
              {i === 0 ? '🏆 ' : `${i + 1}. `}
              {p.avatar} {p.nickname}
            </span>
            <span className="sc" style={{ color: 'var(--amber)', fontWeight: 700 }}>{p.score}</span>
          </div>
        ))}
      </div>

      <div className="card">
        {isHost ? (
          <>
            <label>Main lagi — generate soal baru</label>
            <ScenarioSetup
              identity={identity}
              scenarios={scenarios}
              serverPreview={null}
              refresh={refresh}
              label="↻ Main Lagi"
            />
            <div style={{ marginTop: 10 }}>
              <button className="ghost" onClick={onLeave}>Keluar</button>
            </div>
          </>
        ) : (
          <div className="spread">
            <span className="muted">Menunggu host memulai ronde berikutnya…</span>
            <button className="ghost" onClick={onLeave}>Keluar</button>
          </div>
        )}
      </div>
    </>
  );
}
