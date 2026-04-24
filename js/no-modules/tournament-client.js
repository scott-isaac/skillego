// tournament-client.js — MVP tournament UI (lobby, ready, spectate).
// Hooks into the existing serverMode.socket. Designed to run after
// socket-client.js so serverMode is already declared.

const tournamentMode = {
    active:       false,
    tournamentId: null,
    playerId:     null,
    token:        null,
    displayName:  null,
    isHost:       false,
    state:        null,  // last tournament-state payload
    spectatingMatchId: null,
    // When the between-games overlay is showing, this holds { matchId, role,
    // lastResult } so tournament-state broadcasts can refresh the overlay
    // (opponent's ready status, countdown) without losing it.
    betweenGames: null,
    // When a tournament match game is in progress (player or spectator),
    // this holds { nameA, nameB } so the turn indicator can show real names.
    // Cleared on return-to-lobby / stop-spectate.
    currentGame:  null,
};

function _generateDefaultName() {
    // Player1000..Player9999 — low collision for small tournaments, trivially human-rememberable
    return 'Player' + Math.floor(1000 + Math.random() * 9000);
}

// ─── Session persistence (basic — full wiring is step 8) ──────────────────────
function _saveTournamentSession() {
    sessionStorage.setItem('skillego_tournament_session', JSON.stringify({
        tournamentId: tournamentMode.tournamentId,
        playerId:     tournamentMode.playerId,
        token:        tournamentMode.token,
        displayName:  tournamentMode.displayName,
    }));
}
function _clearTournamentSession() {
    sessionStorage.removeItem('skillego_tournament_session');
}

// ─── Rendering ───────────────────────────────────────────────────────────────
function _el(id) { return document.getElementById(id); }

function _showTournamentLobby() {
    // Tournament page is a peer of #game-container — not an overlay.
    const game = document.getElementById('game-container');
    const page = _el('tournament-page');
    if (game) game.style.display = 'none';
    if (page) page.style.display = '';
}
function _hideTournamentLobby() {
    const game = document.getElementById('game-container');
    const page = _el('tournament-page');
    if (page) page.style.display = 'none';
    if (game) game.style.display = '';
}

function _renderLobby() {
    const s = tournamentMode.state;
    if (!s) return;

    _el('t-lobby-code').textContent = s.id;
    _el('t-lobby-status').textContent =
        s.status === 'lobby'    ? `Waiting for players — ${s.players.length} of ${s.config.playerCount} joined.`
      : s.status === 'running'  ? `Tournament in progress.`
      : s.status === 'done'     ? `Tournament complete.`
      : s.status;

    // Copy-invite link only makes sense while the tournament accepts joiners.
    const copyBtn = _el('t-copy-link-btn');
    if (copyBtn) copyBtn.style.display = s.status === 'lobby' ? '' : 'none';

    _renderConfig(s);

    _renderChampionHero(s);
    _renderNameRow(s);
    _renderPlayerList(s);
    _renderBracket(s);
    _renderYourMatch(s);
    _renderFooter(s);
}

function _renderChampionHero(s) {
    const hero = _el('t-champion-hero');
    if (!hero) return;
    if (s.status !== 'done' || !s.champion) { hero.style.display = 'none'; return; }
    hero.style.display = '';
    const champ = s.players.find(p => p.playerId === s.champion);
    _el('t-champion-name').textContent = champ ? champ.displayName : 'Unknown';
    const isYou = s.champion === tournamentMode.playerId;
    const sub = _el('t-champion-sub');
    if (sub) {
        sub.textContent = isYou ? 'Congratulations!' : '';
        sub.style.display = isYou ? '' : 'none';
    }
}

// Render one of the config items as either plain text (readonly) or a control
// (editable). Preserves the existing control (doesn't rebuild) if the right
// element is already there — avoids stomping on user input / focus mid-edit.
function _renderEditableSelect(elId, editable, value, options, onChange) {
    const container = _el(elId);
    if (!editable) {
        if (container.tagName !== 'SELECT' && !container.querySelector('select')) {
            const label = options.find(o => String(o.value) === String(value));
            container.textContent = label ? label.label : String(value);
            return;
        }
        // Was editable, now not — switch back to text
        const label = options.find(o => String(o.value) === String(value));
        container.textContent = label ? label.label : String(value);
        return;
    }
    let select = container.querySelector('select');
    if (!select) {
        container.innerHTML = `<select class="t-cfg-select">${
            options.map(o => `<option value="${o.value}">${_escape(o.label)}</option>`).join('')
        }</select>`;
        select = container.querySelector('select');
        select.addEventListener('change', e => onChange(e.target.value));
    }
    if (select.value !== String(value)) select.value = String(value);
}

function _renderEditableNumber(elId, editable, value, suffix, onChange) {
    const container = _el(elId);
    if (!editable) {
        container.textContent = `${value} ${suffix}`;
        return;
    }
    let input = container.querySelector('input');
    if (!input) {
        container.innerHTML = `<input type="number" class="t-cfg-number" min="1" max="30" step="1" /> <span>${_escape(suffix)}</span>`;
        input = container.querySelector('input');
        input.addEventListener('change', e => onChange(e.target.value));
    }
    if (document.activeElement !== input) input.value = String(value);
}

function _emitConfig(partial) {
    serverMode.socket.emit('update-tournament-config', {
        tournamentId: tournamentMode.tournamentId,
        token:        tournamentMode.token,
        config:       partial,
    });
}

function _renderConfig(s) {
    const editable = tournamentMode.isHost && s.status === 'lobby';
    const ALL_ABILITIES_LIST = (typeof ALL_ABILITIES !== 'undefined') ? ALL_ABILITIES : [];
    const supported = (typeof serverMode !== 'undefined' && serverMode.capabilities)
        ? serverMode.capabilities : new Set(ALL_ABILITIES_LIST.map(a => a.id));

    _renderEditableSelect('t-config-players', editable, s.config.playerCount, [
        { value: 2,  label: '2' },
        { value: 4,  label: '4' },
        { value: 8,  label: '8' },
        { value: 16, label: '16' },
    ], v => _emitConfig({ playerCount: Number(v) }));

    _renderEditableSelect('t-config-format', editable, s.config.matchFormat, [
        { value: 3, label: 'Best of 3' },
        { value: 5, label: 'Best of 5' },
        { value: 7, label: 'Best of 7' },
    ], v => _emitConfig({ matchFormat: Number(v) }));

    _renderEditableNumber('t-config-timeout', editable, Math.round(s.config.timeoutMs / 60000), 'min',
        v => {
            const min = Math.max(1, Math.min(30, parseInt(v, 10) || 5));
            _emitConfig({ timeoutMs: min * 60 * 1000 });
        });

    // Abilities: chips for readonly, checkboxes inside a <details> for editable.
    const abEl = _el('t-config-abilities');
    const enabled = new Set(s.config.enabledAbilities || []);
    if (editable) {
        const needsRebuild = !abEl.querySelector('.t-ab-edit');
        if (needsRebuild) {
            abEl.innerHTML = `<div class="t-ab-edit">
                <button type="button" class="t-ab-summary">Edit abilities</button>
                <div class="t-ab-list" style="display:none"></div>
            </div>`;
            const btn  = abEl.querySelector('.t-ab-summary');
            const list = abEl.querySelector('.t-ab-list');
            btn.addEventListener('click', () => {
                list.style.display = list.style.display === 'none' ? 'block' : 'none';
            });
        }
        const list = abEl.querySelector('.t-ab-list');
        const summaryBtn = abEl.querySelector('.t-ab-summary');
        const onCount = ALL_ABILITIES_LIST.filter(a => enabled.has(a.id) && supported.has(a.id)).length;
        summaryBtn.textContent = `Abilities (${onCount}) ▾`;
        list.innerHTML = ALL_ABILITIES_LIST.map(a => {
            const isOn  = enabled.has(a.id);
            const isOk  = supported.has(a.id);
            return `<label class="t-ab-row ${isOk ? '' : 'is-unsupported'}">
                <input type="checkbox" data-ability="${a.id}" ${isOn ? 'checked' : ''} ${isOk ? '' : 'disabled'} />
                <span>${_escape(a.name)}</span>
            </label>`;
        }).join('');
        list.querySelectorAll('input[data-ability]').forEach(cb => {
            cb.addEventListener('change', () => {
                const next = new Set(enabled);
                if (cb.checked) next.add(cb.dataset.ability);
                else next.delete(cb.dataset.ability);
                _emitConfig({ enabledAbilities: [...next] });
            });
        });
    } else {
        // Readonly chips
        const onList = [...enabled];
        abEl.innerHTML = onList.length
            ? onList.map(id => {
                const a = ALL_ABILITIES_LIST.find(ab => ab.id === id);
                return `<span class="t-ab-chip">${_escape(a ? a.name : id)}</span>`;
            }).join(' ')
            : '<em style="opacity:0.6">none</em>';
    }
}

function _renderNameRow(s) {
    const renameRow   = _el('t-name-row');
    const renameInput = _el('t-rename-input');
    const me = s.players.find(p => p.playerId === tournamentMode.playerId);
    if (s.status === 'lobby' && me) {
        renameRow.style.display = 'flex';
        if (renameInput && document.activeElement !== renameInput) {
            renameInput.value = me.displayName;
        }
        tournamentMode.displayName = me.displayName;
    } else {
        renameRow.style.display = 'none';
    }
}

function _renderPlayerList(s) {
    const plist = _el('t-player-list');
    const canRemove = tournamentMode.isHost && s.status === 'lobby';
    const standings = s.status === 'done' ? _computeStandings(s) : null;
    // Observers (join-after-start) aren't in the bracket; show them as a
    // small count above the player chips so the list stays uncluttered.
    const bracketPlayers = s.players.filter(p => p.type !== 'observer');
    const observerCount  = s.players.length - bracketPlayers.length;
    const sorted = bracketPlayers.slice().sort((a, b) => {
        if (standings) {
            const rA = standings[a.playerId]?.rank ?? 999;
            const rB = standings[b.playerId]?.rank ?? 999;
            if (rA !== rB) return rA - rB;
        }
        return a.seed - b.seed;
    });
    const chips = sorted.map(p => {
        const isMe   = p.playerId === tournamentMode.playerId;
        const isHost = p.playerId === s.hostPlayerId;
        const isCpu  = p.type === 'cpu';
        const tag = isHost
            ? '<span class="t-player-tag">host</span>'
            : (isCpu ? `<span class="t-player-tag">${_escape(p.difficulty)}</span>` : '');
        const removeBtn = canRemove && !isHost
            ? `<button class="t-player-remove-btn" data-remove="${p.playerId}" title="Remove">✕</button>`
            : '';
        const standing = standings?.[p.playerId];
        const standingBadge = standing
            ? `<span class="t-standing-badge t-rank-${Math.min(standing.rank, 5)}">${standing.label}</span>`
            : `<span class="t-status-pill status-${p.status}">${p.status}</span>`;
        return `<div class="t-player-chip ${isMe ? 'is-me' : ''} ${isCpu ? 'is-cpu' : ''}">
            <span class="t-player-name">${_escape(p.displayName)}${isMe ? ' (you)' : ''}</span>
            ${tag}
            ${standingBadge}
            ${removeBtn}
        </div>`;
    });

    // Show empty slots as placeholder chips in lobby phase so the full field is
    // visible at a glance (e.g., "4 of 8 joined, 4 empty slots").
    if (s.status === 'lobby') {
        const empty = Math.max(0, s.config.playerCount - sorted.length);
        for (let i = 0; i < empty; i++) {
            chips.push(`<div class="t-player-chip is-empty">
                <span class="t-player-name">— empty slot —</span>
                <span class="t-status-pill status-lobby">waiting</span>
            </div>`);
        }
    }

    const watchersRow = observerCount > 0
        ? `<div class="t-observers-count">👁 ${observerCount} watching</div>`
        : '';
    plist.innerHTML = watchersRow + chips.join('');

    if (canRemove) {
        plist.querySelectorAll('[data-remove]').forEach(btn => {
            btn.addEventListener('click', () => {
                serverMode.socket.emit('remove-tournament-player', {
                    tournamentId:   tournamentMode.tournamentId,
                    token:          tournamentMode.token,
                    targetPlayerId: btn.dataset.remove,
                });
            });
        });
    }

    // Add-CPU row visible only to host in lobby, when there's room
    const addRow = _el('t-add-cpu-row');
    if (addRow) {
        addRow.style.display = (tournamentMode.isHost && s.status === 'lobby' && s.players.length < s.config.playerCount)
            ? 'flex' : 'none';
    }
}

// Single-elimination rank inference: the round each player lost in determines
// their rank tier. The champion is 1st, the final loser is 2nd, semi losers
// tie for 3rd-4th, QF losers tie for 5th-8th, etc.
function _computeStandings(state) {
    if (!state || state.status !== 'done' || !state.bracket) return null;
    const totalRounds = state.bracket.rounds.length;
    const out = {};
    if (state.champion) out[state.champion] = { rank: 1, label: '🏆 Winner' };

    for (const p of state.players) {
        if (out[p.playerId]) continue;
        let lostRound = null;
        for (let r = 0; r < totalRounds; r++) {
            for (const m of state.bracket.rounds[r]) {
                if (m.status !== 'complete') continue;
                const aId = m.slotA && m.slotA.playerId;
                const bId = m.slotB && m.slotB.playerId;
                const inThisMatch = aId === p.playerId || bId === p.playerId;
                if (inThisMatch && m.winnerPlayerId !== p.playerId) { lostRound = r; break; }
            }
            if (lostRound !== null) break;
        }
        if (lostRound === null) continue; // Player never appeared in a resolved match
        const fromEnd = totalRounds - 1 - lostRound;  // 0 = final, 1 = semi, 2 = QF
        const rank = Math.pow(2, fromEnd) + 1;
        const tierTop = Math.pow(2, fromEnd + 1);
        let label;
        if (rank === 2)      label = '🥈 2nd';
        else if (rank === 3) label = '🥉 3rd' + (tierTop > rank ? `–${_ord(tierTop)}` : '');
        else                 label = `${_ord(rank)}` + (tierTop > rank ? `–${_ord(tierTop)}` : '');
        out[p.playerId] = { rank, label };
    }
    return out;
}
function _ord(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function _renderBracket(s) {
    const brackEl = _el('t-bracket');
    if (!s.bracket) { brackEl.innerHTML = ''; return; }

    const totalRounds = s.bracket.rounds.length;
    const roundLabels = [];
    for (let i = 0; i < totalRounds; i++) {
        if (i === totalRounds - 1)      roundLabels.push('Final');
        else if (i === totalRounds - 2) roundLabels.push('Semifinals');
        else if (i === totalRounds - 3) roundLabels.push('Quarterfinals');
        else                            roundLabels.push(`Round ${i + 1}`);
    }

    brackEl.innerHTML = s.bracket.rounds.map((round, ri) => {
        const cards = round.map(m => _renderMatchCard(s, m)).join('');
        return `<div class="t-round">
            <div class="t-round-label">${roundLabels[ri]}</div>
            ${cards}
        </div>`;
    }).join('');

    // Wire inline Watch buttons on playing matches.
    brackEl.querySelectorAll('[data-spectate]').forEach(btn => {
        btn.addEventListener('click', () => startSpectating(btn.dataset.spectate));
    });
}

function _renderMatchCard(s, m) {
    const aName = _slotLabel(s, m.slotA);
    const bName = _slotLabel(s, m.slotB);
    const aId   = m.slotA && m.slotA.playerId;
    const bId   = m.slotB && m.slotB.playerId;
    const mine  = aId === tournamentMode.playerId || bId === tournamentMode.playerId;

    const cardClass = [
        't-match-card',
        m.status === 'playing'  ? 'is-playing' : '',
        m.status === 'ready-up' ? 'is-ready-up' : '',
        m.status === 'complete' ? 'is-complete' : '',
        mine ? 'is-mine' : '',
    ].filter(Boolean).join(' ');

    const winnerSlot = m.winnerPlayerId
        ? (m.winnerPlayerId === aId ? 'A' : 'B')
        : null;
    const aCls = winnerSlot === 'A' ? 'is-winner' : (winnerSlot === 'B' ? 'is-loser' : '');
    const bCls = winnerSlot === 'B' ? 'is-winner' : (winnerSlot === 'A' ? 'is-loser' : '');

    let footer = '';
    if (m.status === 'complete') {
        footer = `<div class="t-match-footer">Winner: ${_escape(_nameOf(s, m.winnerPlayerId))}</div>`;
    } else if (m.status === 'playing') {
        // Offer a Watch button inline for viewers who aren't currently tied up
        // with their own match (not playing, not readied). Players in this
        // match see a neutral "In progress" label.
        const me = s.players.find(p => p.playerId === tournamentMode.playerId);
        const canWatch = !mine
            && me && me.status !== 'playing' && me.status !== 'ready'
            && !tournamentMode.spectatingMatchId;
        footer = canWatch
            ? `<div class="t-match-footer t-match-footer-watch">
                   <button class="t-watch-inline-btn" data-spectate="${m.id}">▶ Watch</button>
               </div>`
            : `<div class="t-match-footer">In progress</div>`;
    } else if (m.status === 'ready-up') {
        footer = `<div class="t-match-footer">Awaiting ready</div>`;
    }

    return `<div class="${cardClass}" data-match-id="${m.id}">
        <div class="t-match-slot ${aCls}">
            <span class="t-match-name">${_escape(aName)}</span>
            <span class="t-match-score">${m.scoreA}</span>
        </div>
        <div class="t-match-slot ${bCls}">
            <span class="t-match-name">${_escape(bName)}</span>
            <span class="t-match-score">${m.scoreB}</span>
        </div>
        ${footer}
    </div>`;
}

function _renderYourMatch(s) {
    const section    = _el('t-your-match-section');
    const bodyEl     = _el('t-your-match-body');
    const readyBtn   = _el('t-ready-btn');

    if (s.status !== 'running' || !s.bracket || tournamentMode.spectatingMatchId) {
        section.style.display = 'none';
        return;
    }
    const me = s.players.find(p => p.playerId === tournamentMode.playerId);
    if (me && me.type === 'observer') {
        section.style.display = '';
        bodyEl.innerHTML = `<em>You're watching this tournament. Click "Watch" on any live match below.</em>`;
        readyBtn.style.display = 'none';
        return;
    }
    const my = _findMyMatch(s);
    if (!my) {
        if (me && (me.status === 'eliminated' || me.status === 'forfeited')) {
            section.style.display = '';
            bodyEl.innerHTML = `<em>You've been ${me.status}.</em>`;
            readyBtn.style.display = 'none';
        } else {
            section.style.display = '';
            bodyEl.innerHTML = `<em>Waiting for your next opponent…</em>`;
            readyBtn.style.display = 'none';
        }
        return;
    }

    section.style.display = '';
    const mineA   = my.slotA.playerId === tournamentMode.playerId;
    const oppId   = mineA ? my.slotB.playerId : my.slotA.playerId;
    const oppName = _nameOf(s, oppId);
    const myName  = _nameOf(s, tournamentMode.playerId);
    const myScore = mineA ? my.scoreA : my.scoreB;
    const oppScore = mineA ? my.scoreB : my.scoreA;

    if (my.status === 'ready-up') {
        const iReady   = mineA ? my.readyA : my.readyB;
        const oppReady = mineA ? my.readyB : my.readyA;
        const deadline = my.readyDeadline;
        const remaining = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null;
        bodyEl.innerHTML =
            `<div class="t-vs-display">
                <span class="t-vs-name">${_escape(myName)}</span>
                <span class="t-vs-score">${myScore}–${oppScore}</span>
                <span class="t-vs-vs">vs</span>
                <span class="t-vs-name">${_escape(oppName)}</span>
            </div>
            <div class="t-ready-status">
                ${_readyLabelFor(myName + ' (you)', iReady)}
                ${_readyLabelFor(oppName, oppReady)}
            </div>
            ${_countdownRowHtml(remaining, iReady, oppReady)}`;
        readyBtn.style.display = '';
        readyBtn.disabled      = false;
        readyBtn.textContent   = iReady ? '✓ Ready' : 'Ready';
    } else if (my.status === 'playing') {
        bodyEl.innerHTML =
            `<div class="t-vs-display">
                <span class="t-vs-name">${_escape(myName)}</span>
                <span class="t-vs-score">${myScore}–${oppScore}</span>
                <span class="t-vs-vs">vs</span>
                <span class="t-vs-name">${_escape(oppName)}</span>
            </div>
            <div class="t-ready-status"><em>Match in progress…</em></div>`;
        readyBtn.style.display = 'none';
    } else {
        bodyEl.innerHTML = `<em>Preparing match…</em>`;
        readyBtn.style.display = 'none';
    }
}

function _renderFooter(s) {
    const startBtn = _el('t-start-btn');
    if (tournamentMode.isHost && s.status === 'lobby') {
        startBtn.style.display = '';
        startBtn.disabled = s.players.length < s.config.playerCount;
        startBtn.textContent = startBtn.disabled
            ? `Waiting for players (${s.players.length}/${s.config.playerCount})`
            : 'Start Tournament';
    } else {
        startBtn.style.display = 'none';
    }
}

function _slotLabel(s, slot) {
    if (slot && typeof slot.playerId === 'string') return _nameOf(s, slot.playerId);
    if (slot && slot.fromMatchId) return `(winner of ${slot.fromMatchId})`;
    return '?';
}
function _nameOf(s, playerId) {
    const p = s.players.find(pp => pp.playerId === playerId);
    return p ? p.displayName : `P${playerId}`;
}
function _findMyMatch(s) {
    for (const round of s.bracket.rounds) {
        for (const m of round) {
            if (m.status === 'complete') continue;
            const aId = m.slotA && m.slotA.playerId;
            const bId = m.slotB && m.slotB.playerId;
            if (aId === tournamentMode.playerId || bId === tournamentMode.playerId) return m;
        }
    }
    return null;
}

// True if the current player is either slotA or slotB of the given match.
// Used to decide whether a match-result event is about "my" match.
function _amInMatch(state, matchId) {
    if (!state || !state.bracket || !tournamentMode.playerId) return false;
    for (const round of state.bracket.rounds) {
        for (const m of round) {
            if (m.id !== matchId) continue;
            const aId = m.slotA && m.slotA.playerId;
            const bId = m.slotB && m.slotB.playerId;
            return aId === tournamentMode.playerId || bId === tournamentMode.playerId;
        }
    }
    return false;
}
function _escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

// ─── Spectating ──────────────────────────────────────────────────────────────
function startSpectating(matchId) {
    tournamentMode.spectatingMatchId = matchId;
    serverMode.socket.emit('spectate-match', {
        tournamentId: tournamentMode.tournamentId,
        matchId,
        token: tournamentMode.token,
    });
}
// Between-games overlay: shown when a game in a BO-N series ends but the
// match isn't yet decided. Reuses the existing winner-message DOM.
// The server transitions the match back to 'ready-up' on game-over, so the
// Ready button here emits match-ready (same event as the initial ready-up).
// Stores state on tournamentMode.betweenGames so tournament-state broadcasts
// and the per-second tick can refresh opponent-ready / countdown live.
function _showBetweenGamesOverlay(r, isPlayer, isSpectator) {
    tournamentMode.betweenGames = {
        matchId:     r.matchId,
        role:        isPlayer ? 'player' : (isSpectator ? 'spectator' : 'other'),
        lastResult:  { scoreA: r.scoreA, scoreB: r.scoreB, gameWinnerPlayerId: r.gameWinnerPlayerId },
    };
    _updateBetweenGamesOverlay();
}

function _updateBetweenGamesOverlay() {
    const bg = tournamentMode.betweenGames;
    if (!bg) return;
    const s = tournamentMode.state;
    if (!s || !s.bracket) return;

    let match = null;
    for (const round of s.bracket.rounds) {
        for (const m of round) { if (m.id === bg.matchId) { match = m; break; } }
        if (match) break;
    }
    if (!match) return;

    // If the match already completed (e.g., timeout forfeit, someone resigned)
    // we let the match-complete handler take over; tear down this overlay.
    if (match.status === 'complete') { tournamentMode.betweenGames = null; return; }

    const aName = _nameOf(s, match.slotA.playerId);
    const bName = _nameOf(s, match.slotB.playerId);
    const lr = bg.lastResult;
    const winnerName = _nameOf(s, lr.gameWinnerPlayerId);

    const mineA   = match.slotA.playerId === tournamentMode.playerId;
    const iReady  = bg.role === 'player' ? (mineA ? match.readyA : match.readyB) : false;
    const oppReady = bg.role === 'player' ? (mineA ? match.readyB : match.readyA) : false;
    const remaining = match.readyDeadline
        ? Math.max(0, Math.ceil((match.readyDeadline - Date.now()) / 1000))
        : null;

    const overlay  = document.getElementById('winner-message');
    const wt       = document.getElementById('winner-text');
    const ws       = document.getElementById('winner-score');
    const restart  = document.getElementById('restart-btn');
    const newGame  = document.getElementById('new-game-btn');
    const statusEl = document.getElementById('network-status');
    const watchBtn = document.getElementById('watch-replay-btn');

    if (wt) {
        if (bg.role === 'player') {
            const iWon = lr.gameWinnerPlayerId === tournamentMode.playerId;
            wt.textContent = iWon ? 'You won this game' : 'You lost this game';
        } else {
            wt.textContent = `${winnerName} won this game`;
        }
    }

    // Score + ready-status + countdown, all aligned around the score digits.
    if (ws) {
        const scoreRow  = _scoreRowHtml(aName, bName, match.scoreA, match.scoreB);
        const formatRow = `<div class="t-result-format">Best of ${s.config.matchFormat}</div>`;
        let readyRow = '';
        if (bg.role === 'player') {
            const myName   = _nameOf(s, tournamentMode.playerId);
            const mineA    = match.slotA.playerId === tournamentMode.playerId;
            const oppName  = _nameOf(s, mineA ? match.slotB.playerId : match.slotA.playerId);
            readyRow = `<div class="t-result-note">
                ${_readyLabelFor(myName + ' (you)', iReady)}
                ${_readyLabelFor(oppName, oppReady)}
            </div>`;
        } else {
            readyRow = `<div class="t-result-note">
                ${_readyLabelFor(aName, match.readyA)}
                ${_readyLabelFor(bName, match.readyB)}
            </div>`;
        }
        const countdownRow = _countdownRowHtml(remaining, iReady, oppReady, 'Next game');
        ws.innerHTML = scoreRow + formatRow + readyRow + countdownRow;
    }

    if (statusEl) statusEl.style.display = 'none';
    if (watchBtn) watchBtn.style.display = 'none';

    if (bg.role === 'player' && restart) {
        restart.style.display = '';
        restart.disabled      = false;
        restart.style.opacity = '';
        restart.textContent   = iReady ? '✓ Ready' : 'Ready for next game';
        restart.onclick = () => {
            // match-ready is a server-side toggle; we let tournament-state
            // drive the rendered label so the UI always reflects true state.
            serverMode.socket.emit('match-ready', {
                tournamentId: tournamentMode.tournamentId,
                token:        tournamentMode.token,
            });
        };
    } else if (restart) {
        restart.style.display = 'none';
    }

    if (newGame) {
        if (bg.role === 'spectator') {
            newGame.textContent = 'Back to lobby';
            newGame.onclick = stopSpectating;
        } else if (bg.role === 'player') {
            newGame.textContent = 'Forfeit match';
            newGame.onclick = () => {
                if (!confirm('Forfeit this match and return to lobby?')) return;
                serverMode.socket.emit('leave-game', {
                    gameId: serverMode.gameId,
                    token:  serverMode.token,
                });
            };
        }
    }

    overlay.style.display = '';
}

// Ready-status chip: "Alice (you): Ready" / "Bob: not ready".
// Displayed side-by-side in both the lobby Your-Match panel and the between-
// games overlay so the wording reads naturally regardless of viewpoint.
function _readyLabelFor(name, isReady) {
    const cls   = isReady ? 'is-ready' : '';
    const mark  = isReady ? '✓' : '○';
    const state = isReady ? 'Ready' : 'not ready';
    return `<span class="t-ready-chip ${cls}">${mark} ${_escape(name)}: ${state}</span>`;
}

// Countdown shown BELOW the ready-status row (not inline), so it doesn't push
// the Alice/Bob chips to the side. label defaults to "Timeout"; the target
// (who's about to forfeit) is inferred from which side is still unready.
function _countdownRowHtml(remaining, iReady, oppReady, label) {
    if (remaining === null || remaining === undefined) return '';
    const target = iReady && !oppReady ? 'opponent forfeits' : 'you forfeit';
    const header = label ? `${label} in` : 'Timeout in';
    return `<div class="t-result-countdown">${header} ${remaining}s — ${target}</div>`;
}

// Shared score-row markup used by between-games and match-complete overlays.
// Uses a 3-column grid so the "A–B" digits sit at the horizontal center of
// the overlay regardless of name lengths, and "Best of N" below stays aligned.
function _scoreRowHtml(nameA, nameB, scoreA, scoreB) {
    return `<div class="t-result-score">` +
        `<span class="t-result-name t-result-name-a">${_escape(nameA)}</span>` +
        `<span class="t-result-digits"><strong>${scoreA}</strong>–<strong>${scoreB}</strong></span>` +
        `<span class="t-result-name t-result-name-b">${_escape(nameB)}</span>` +
    `</div>`;
}

// Persistent "match complete" overlay shown when a BO-N series finishes.
// Dismissed by the user clicking "Return to lobby".
function _showMatchCompleteOverlay(r, isPlayer, isSpectator) {
    tournamentMode.matchComplete = {
        matchId: r.matchId,
        role:    isPlayer ? 'player' : (isSpectator ? 'spectator' : 'other'),
        result:  r,
    };
    _updateMatchCompleteOverlay();
}

function _updateMatchCompleteOverlay() {
    const mc = tournamentMode.matchComplete;
    if (!mc) return;
    const s = tournamentMode.state;

    // Render from mc.result directly — it always has scores + winner id even
    // if the tournament state snapshot is stale or the bracket hasn't arrived.
    // Player names come from state if available; fall back to "Player A"/"B".
    let aName = 'Player A', bName = 'Player B';
    if (s && s.bracket) {
        for (const round of s.bracket.rounds) {
            for (const m of round) {
                if (m.id !== mc.matchId) continue;
                if (m.slotA && m.slotA.playerId) aName = _nameOf(s, m.slotA.playerId);
                if (m.slotB && m.slotB.playerId) bName = _nameOf(s, m.slotB.playerId);
            }
        }
    }
    const matchFormat = s && s.config ? s.config.matchFormat : null;
    const winnerId    = mc.result.matchWinnerPlayerId;
    const winnerName  = s ? _nameOf(s, winnerId) : 'Winner';
    const forfeited   = !!mc.result.forfeited;
    const scoreA      = mc.result.scoreA;
    const scoreB      = mc.result.scoreB;

    const overlay  = document.getElementById('winner-message');
    const wt       = document.getElementById('winner-text');
    const ws       = document.getElementById('winner-score');
    const restart  = document.getElementById('restart-btn');
    const newGame  = document.getElementById('new-game-btn');
    const statusEl = document.getElementById('network-status');
    const watchBtn = document.getElementById('watch-replay-btn');

    if (wt) {
        if (mc.role === 'player') {
            const iWon = winnerId === tournamentMode.playerId;
            wt.textContent = iWon
                ? 'You won the match!'
                : (forfeited ? 'You forfeited the match' : 'You lost the match');
        } else {
            wt.textContent = `${winnerName} won the match`;
        }
    }
    if (ws) {
        ws.innerHTML =
            _scoreRowHtml(aName, bName, scoreA, scoreB) +
            (matchFormat ? `<div class="t-result-format">Best of ${matchFormat}</div>` : '');
    }

    if (statusEl) statusEl.style.display = 'none';
    if (watchBtn) watchBtn.style.display = 'none';
    if (restart)  restart.style.display  = 'none';

    if (newGame) {
        newGame.style.display = '';
        newGame.textContent   = 'Return to lobby';
        newGame.onclick = () => {
            tournamentMode.matchComplete     = null;
            tournamentMode.spectatingMatchId = null;
            tournamentMode.currentGame       = null;
            serverMode.active       = false;
            serverMode.gameId       = null;
            serverMode.token        = null;
            serverMode.playerNumber = null;
            sessionStorage.removeItem('skillego_session');
            document.getElementById('winner-message').style.display = 'none';
            _showTournamentLobby();
            _renderLobby();
        };
    }
    overlay.style.display = '';
}

function stopSpectating() {
    if (!tournamentMode.spectatingMatchId) return;
    serverMode.socket.emit('stop-spectate', {
        tournamentId: tournamentMode.tournamentId,
        matchId: tournamentMode.spectatingMatchId,
    });
    tournamentMode.spectatingMatchId = null;
    tournamentMode.currentGame       = null;
    // Drop the game-view state we were borrowing to render as spectator.
    serverMode.active       = false;
    serverMode.gameId       = null;
    serverMode.token        = null;
    serverMode.playerNumber = null;
    _el('t-stop-spectate-btn').style.display = 'none';
    document.getElementById('winner-message').style.display = 'none';
    document.getElementById('resign-button').style.display  = 'none';
    _showTournamentLobby();
    _renderLobby();
}

// ─── Countdown tick so the timer visibly counts down ─────────────────────────
setInterval(() => {
    if (!tournamentMode.active || !tournamentMode.state) return;
    if (tournamentMode.state.status === 'running') _renderLobby();
    if (tournamentMode.betweenGames) _updateBetweenGamesOverlay();
}, 1000);

// ─── Wiring ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const hostBtn = _el('host-tournament-btn');
    // Tournament settings (player count, match format, timeout, abilities) are
    // tuned from the lobby — the main screen is just the two Host buttons.
    const DEFAULT_PLAYER_COUNT = 4;
    const DEFAULT_MATCH_FORMAT = 3;
    const DEFAULT_TIMEOUT_MIN  = 5;

    // Gate the Host Tournament button on the server's declared feature support.
    // Old server (no handshake / no 'tournament' in features) → hide the button
    // so users don't create a tournament the server can't run. Re-evaluates on
    // every 'server-features-changed' event fired by socket-client.js.
    function _applyTournamentGate() {
        if (!hostBtn) return;
        // Before we've received / timed out the handshake, keep the button
        // visible-but-neutral. It flips once serverMode.features is populated.
        if (!serverMode.features) { hostBtn.style.display = ''; return; }
        hostBtn.style.display = serverMode.features.has('tournament') ? '' : 'none';
    }
    window.addEventListener('server-features-changed', _applyTournamentGate);
    _applyTournamentGate();
    const startBtn = _el('t-start-btn');
    const readyBtn = _el('t-ready-btn');
    const leaveBtn = _el('t-leave-btn');
    const copyLinkBtn = _el('t-copy-link-btn');
    const stopSpecBtn = _el('t-stop-spectate-btn');

    if (hostBtn) hostBtn.addEventListener('click', () => {
        const requested = new Set(
            Array.from(document.querySelectorAll('.ability-toggle:checked')).map(cb => cb.value)
        );
        const { filtered } = stripUnsupportedAbilities(requested);
        serverMode.socket.emit('create-tournament', {
            playerCount:    DEFAULT_PLAYER_COUNT,
            matchFormat:    DEFAULT_MATCH_FORMAT,
            timeoutMinutes: DEFAULT_TIMEOUT_MIN,
            enabledAbilities: [...filtered],
            hostName:       _generateDefaultName(),
        });
    });

    // Add CPU
    const addCpuBtn = _el('t-add-cpu-btn');
    const cpuDiff   = _el('t-cpu-difficulty');
    if (addCpuBtn && cpuDiff) {
        addCpuBtn.addEventListener('click', () => {
            if (!tournamentMode.active || !tournamentMode.isHost) return;
            serverMode.socket.emit('add-cpu-to-tournament', {
                tournamentId: tournamentMode.tournamentId,
                token:        tournamentMode.token,
                difficulty:   cpuDiff.value,
            });
        });
    }

    // Rename-in-lobby
    const renameBtn   = _el('t-rename-btn');
    const renameInput = _el('t-rename-input');
    if (renameBtn && renameInput) {
        const doRename = () => {
            const newName = renameInput.value.trim();
            if (!newName || newName === tournamentMode.displayName) return;
            serverMode.socket.emit('rename-tournament-player', {
                tournamentId: tournamentMode.tournamentId,
                token:        tournamentMode.token,
                displayName:  newName,
            });
        };
        renameBtn.addEventListener('click', doRename);
        renameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRename(); });
    }

    if (startBtn) startBtn.addEventListener('click', () => {
        serverMode.socket.emit('start-tournament', {
            tournamentId: tournamentMode.tournamentId,
            token: tournamentMode.token,
        });
    });

    if (readyBtn) readyBtn.addEventListener('click', () => {
        serverMode.socket.emit('match-ready', {
            tournamentId: tournamentMode.tournamentId,
            token: tournamentMode.token,
        });
    });

    if (leaveBtn) leaveBtn.addEventListener('click', () => {
        // MVP: just clear locally. Server-side leave + forfeit is a future hook.
        tournamentMode.active = false;
        tournamentMode.tournamentId = null;
        tournamentMode.playerId = null;
        tournamentMode.token = null;
        tournamentMode.state = null;
        _clearTournamentSession();
        _hideTournamentLobby();
        if (typeof showSetupScreen === 'function') showSetupScreen();
        else document.getElementById('setup-screen').style.display = '';
    });

    if (copyLinkBtn) copyLinkBtn.addEventListener('click', () => {
        if (!tournamentMode.tournamentId) return;
        const url = `${window.location.origin}${window.location.pathname}?tournament=${tournamentMode.tournamentId}`;
        navigator.clipboard?.writeText(url);
        copyLinkBtn.textContent = 'Copied!';
        setTimeout(() => { copyLinkBtn.textContent = 'Copy link'; }, 1500);
    });

    if (stopSpecBtn) stopSpecBtn.addEventListener('click', stopSpectating);
});

// ─── Socket listeners ────────────────────────────────────────────────────────
// Wait for serverMode.socket to exist (socket-client.js sets it when io is defined).
(function wireSockets() {
    if (typeof serverMode === 'undefined' || !serverMode.socket) {
        setTimeout(wireSockets, 50);
        return;
    }
    const s = serverMode.socket;

    s.on('tournament-created', (d) => {
        tournamentMode.active       = true;
        tournamentMode.tournamentId = d.tournamentId;
        tournamentMode.playerId     = d.playerId;
        tournamentMode.token        = d.token;
        tournamentMode.displayName  = d.state.players.find(p => p.playerId === d.playerId)?.displayName;
        tournamentMode.isHost       = d.isHost;
        tournamentMode.state        = d.state;
        _saveTournamentSession();
        _showTournamentLobby();
        _renderLobby();
    });

    s.on('tournament-joined', (d) => {
        tournamentMode.active       = true;
        tournamentMode.tournamentId = d.tournamentId;
        tournamentMode.playerId     = d.playerId;
        tournamentMode.token        = d.token;
        tournamentMode.displayName  = d.state.players.find(p => p.playerId === d.playerId)?.displayName;
        tournamentMode.isHost       = d.isHost;
        tournamentMode.state        = d.state;
        _saveTournamentSession();

        // If I was mid-match when I refreshed, rejoin the game directly rather
        // than flashing the lobby first.
        const me = d.state.players.find(p => p.playerId === d.playerId);
        if (me && me.status === 'playing') {
            const myMatch = _findMyMatch(d.state);
            if (myMatch && myMatch.gameRoomId) {
                const pNum = myMatch.slotA.playerId === d.playerId ? 1 : 2;
                serverMode.gameId       = myMatch.gameRoomId;
                serverMode.playerNumber = pNum;
                serverMode.token        = d.token;
                serverMode.active       = true;
                sessionStorage.setItem('skillego_session', JSON.stringify({
                    gameId:       myMatch.gameRoomId,
                    playerNumber: pNum,
                    token:        d.token,
                }));
                s.emit('rejoin-game', { gameId: myMatch.gameRoomId, token: d.token });
                return;  // game-rejoined will load the board; don't flash lobby
            }
        }

        _showTournamentLobby();
        _renderLobby();
    });

    s.on('tournament-state', ({ state }) => {
        tournamentMode.state = state;
        if (tournamentMode.active) _renderLobby();
        // If the between-games overlay is up, refresh it so the opponent's
        // ready status and the deadline appear as soon as the server broadcasts.
        if (tournamentMode.betweenGames) _updateBetweenGamesOverlay();
    });

    // Fallback paths for errors that involve tournament-client bookkeeping.
    s.on('error', ({ message }) => {
        if (message === 'Tournament not found or expired' ||
            message === 'Invalid tournament token') {
            // Stale session — don't keep retrying on each refresh.
            _clearTournamentSession();
        }
        if (message === 'Game not found or expired' && tournamentMode.active) {
            // The game we tried to rejoin is gone. Snap back to the tournament lobby.
            serverMode.active = false;
            serverMode.gameId = null;
            serverMode.token  = null;
            serverMode.playerNumber = null;
            sessionStorage.removeItem('skillego_session');
            _showTournamentLobby();
            _renderLobby();
        }
    });

    s.on('tournament-kicked', ({ reason }) => {
        tournamentMode.active = false;
        tournamentMode.tournamentId = null;
        tournamentMode.playerId = null;
        tournamentMode.token = null;
        tournamentMode.state = null;
        _clearTournamentSession();
        _hideTournamentLobby();
        if (typeof showSetupScreen === 'function') showSetupScreen();
        alert(`You were removed from the tournament: ${reason || 'Removed by host'}`);
    });

    s.on('tournament-over', ({ championName, championPlayerId }) => {
        // The champion hero section (_renderChampionHero) handles the celebration;
        // here we just ensure the lobby re-renders so that section appears.
        if (tournamentMode.state) _renderLobby();
    });

    // When a tournament match actually starts, socket-client.js's hook takes
    // over and renders the board. We just hide the lobby overlay and drop any
    // between-games overlay state so it doesn't leak into the next game.
    s.on('tournament-match-start', () => {
        tournamentMode.betweenGames  = null;
        tournamentMode.matchComplete = null;
        _hideTournamentLobby();
    });

    // If we rejoined a game that was in progress (tournament or standalone),
    // make sure the tournament lobby isn't left covering the board.
    s.on('game-rejoined', () => {
        if (tournamentMode.active) _hideTournamentLobby();
    });

    // On game-over inside a tournament match, the game screen's winner overlay
    // will appear briefly. If the match isn't done, the next tournament-match-start
    // arrives ~1.5s later. If the match IS done, return to the tournament lobby
    // so the player can see the bracket update / next-round ready button.
    s.on('tournament-match-result', (r) => {
        if (tournamentMode.state) _renderLobby();

        const wasMyMatch   = _amInMatch(tournamentMode.state, r.matchId);
        const wasSpectator = tournamentMode.spectatingMatchId === r.matchId;
        if (!wasMyMatch && !wasSpectator) return;

        if (r.matchComplete) {
            // Series is over — show a persistent "match complete" overlay.
            // User clicks "Return to lobby" to dismiss (no auto-timeout).
            tournamentMode.betweenGames = null;
            _showMatchCompleteOverlay(r, wasMyMatch, wasSpectator);
        } else {
            // Series continues — override the stock winner overlay with a
            // between-games view that shows match context + Ready / Forfeit.
            _showBetweenGamesOverlay(r, wasMyMatch, wasSpectator);
        }
    });

    // Priority on load:
    //   1. ?tournament=CODE URL param — explicit invite link, always joins
    //      (fresh or overrides any stored session for a different tournament).
    //   2. Saved tournament session in sessionStorage — try to rejoin so a
    //      page refresh mid-tournament doesn't drop the player.
    // If neither matches, fall through; socket-client.js handles standalone
    // game rejoin via its own saved session.
    const params = new URLSearchParams(window.location.search);
    const tCode  = params.get('tournament');
    if (tCode) {
        const tryJoin = () => {
            // If a stored session points at a different tournament, discard it —
            // an explicit link takes priority. Joiner always gets a default name;
            // they can rename from the lobby before the tournament starts.
            _clearTournamentSession();
            s.emit('join-tournament', {
                tournamentId: tCode.trim().toUpperCase(),
                displayName:  _generateDefaultName(),
            });
            window.history.replaceState({}, '', window.location.pathname);
        };
        if (s.connected) tryJoin();
        else s.once('connect', tryJoin);
    } else {
        const savedT = sessionStorage.getItem('skillego_tournament_session');
        if (savedT) {
            try {
                const sess = JSON.parse(savedT);
                if (sess.tournamentId && sess.token) {
                    // Wait for the capability handshake to resolve before
                    // emitting rejoin-tournament — if the server doesn't
                    // support tournaments, it'd silently drop the message and
                    // leave the user sitting on the setup screen. Once we know
                    // feature support, either try rejoin or clear stale session.
                    const tryRejoin = () => {
                        if (serverMode.features && !serverMode.features.has('tournament')) {
                            _clearTournamentSession();
                            return;
                        }
                        s.emit('rejoin-tournament', {
                            tournamentId: sess.tournamentId,
                            token:        sess.token,
                        });
                    };
                    const whenReady = () => {
                        if (serverMode.features) tryRejoin();
                        else window.addEventListener('server-features-changed', tryRejoin, { once: true });
                    };
                    if (s.connected) whenReady();
                    else s.once('connect', whenReady);
                }
            } catch (e) { _clearTournamentSession(); }
        }
    }

    s.on('spectate-state', (d) => {
        tournamentMode.spectatingMatchId = d.matchId;
        tournamentMode.currentGame       = { nameA: d.nameA, nameB: d.nameB };
        // Spectator mode: no playerNumber/token — make-move won't validate for us.
        serverMode.playerNumber = null;
        serverMode.active       = true;
        serverMode.gameId       = d.gameId;
        serverMode.token        = null;

        _hideTournamentLobby();
        // Route through _showGameScreen so the header controls (#resign-button
        // → "Leave" for spectators, #help-button, #turn-indicator) become
        // visible and labeled correctly.
        if (typeof _showGameScreen === 'function') {
            _showGameScreen(d.state);
        }
    });
})();
