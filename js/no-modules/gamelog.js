// gamelog.js - Structured move-by-move game log

const gameLog = {
    entries: [],
    turnNumber: 0,
    totalMoves: 0,

    reset() {
        this.entries = [];
        this.turnNumber = 0;
        this.totalMoves = 0;
        this.initialBoard = null;
        localStorage.removeItem('skillego_last_game_log');
    },

    _advanceTurn() {
        this.totalMoves++;
        this.turnNumber = Math.ceil(this.totalMoves / ((typeof gameState !== 'undefined' && gameState.numPlayers) || 2));
    },

    _pieceLabel(piece) {
        return `${piece.type}[${piece.power}]`;
    },

    _coord(row, col) {
        return `(${row},${col})`;
    },

    recordInitialBoard() {
        const cols = Array.from({ length: BOARD_COLS }, (_, i) => i);
        const colHeader = '     ' + cols.join('    ');
        const rows = [colHeader];
        for (let r = 0; r < BOARD_ROWS; r++) {
            let row = `${r}  `;
            for (let c = 0; c < BOARD_COLS; c++) {
                const p = gameState.board[r][c];
                if (!p) { row += ' .   '; }
                else {
                    const t = p.type[0].toUpperCase();
                    row += `${t}${p.power}P${p.player} `;
                }
            }
            rows.push(row);
        }
        this.initialBoard = rows.join('\n');
    },

    _who(player) {
        return `P${player}`;
    },

    recordUncover(player, row, col, piece) {
        this._advanceTurn();
        this.entries.push(`T${this.turnNumber} ${this._who(player)}: UNCOVER ${this._coord(row, col)} → P${piece.player} ${this._pieceLabel(piece)}`);
    },

    recordMove(player, fromRow, fromCol, toRow, toCol, piece, capturedPiece) {
        this._advanceTurn();
        if (capturedPiece) {
            this.entries.push(
                `T${this.turnNumber} ${this._who(player)}: ${this._pieceLabel(piece)} ${this._coord(fromRow, fromCol)} → ${this._coord(toRow, toCol)}  CAPTURES ${this._pieceLabel(capturedPiece)}`
            );
        } else {
            this.entries.push(
                `T${this.turnNumber} ${this._who(player)}: ${this._pieceLabel(piece)} ${this._coord(fromRow, fromCol)} → ${this._coord(toRow, toCol)}`
            );
        }
    },

    recordTransform(player, wizRow, wizCol, mouseCells) {
        this._advanceTurn();
        const positions = mouseCells.map(c => this._coord(c.row, c.col)).join(' ');
        this.entries.push(`T${this.turnNumber} ${this._who(player)}: wizard[4] ${this._coord(wizRow, wizCol)} TRANSFORMS → mice at ${positions}`);
    },

    recordHop(player, fromRow, fromCol, destRow, destCol) {
        this._advanceTurn();
        this.entries.push(`T${this.turnNumber} ${this._who(player)}: mouse[1] HOP ${this._coord(fromRow, fromCol)} → ${this._coord(destRow, destCol)}`);
    },

    recordSnipe(player, robotRow, robotCol, targetRow, targetCol, captured) {
        this._advanceTurn();
        this.entries.push(`T${this.turnNumber} ${this._who(player)}: robot[5] ${this._coord(robotRow, robotCol)} SNIPES ${this._pieceLabel(captured)} ${this._coord(targetRow, targetCol)}`);
    },

    recordPyromania(player, fromRow, fromCol, targetRow, targetCol, targetPiece) {
        this._advanceTurn();
        this.entries.push(`T${this.turnNumber} ${this._who(player)}: burning ${this._coord(fromRow, fromCol)} IGNITES ${this._pieceLabel(targetPiece)} ${this._coord(targetRow, targetCol)}`);
    },

    recordEngulf(player, row, col) {
        this._advanceTurn();
        this.entries.push(`T${this.turnNumber} ${this._who(player)}: dragon[6] ENGULFS ${this._coord(row, col)} — on fire!`);
    },

    recordPush(player, dragonRow, dragonCol, enemyRow, enemyCol, destRow, destCol, pushedPiece) {
        this._advanceTurn();
        this.entries.push(
            `T${this.turnNumber} ${this._who(player)}: dragon[6] PUSHES ${this._pieceLabel(pushedPiece)} ${this._coord(enemyRow, enemyCol)} → ${this._coord(destRow, destCol)}`
        );
    },

    boardSnapshot() {
        const cols = Array.from({ length: BOARD_COLS }, (_, i) => i);
        const colHeader = '     ' + cols.join('    ');
        const rows = [colHeader];
        for (let r = 0; r < BOARD_ROWS; r++) {
            let row = `${r}  `;
            for (let c = 0; c < BOARD_COLS; c++) {
                const piece = gameState.board[r][c];
                const cell = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
                const covered = cell && cell.classList.contains('covered');
                if (!piece) {
                    row += ' .   ';
                } else if (covered) {
                    row += `?${piece.player}   `;
                } else {
                    const t = piece.type[0].toUpperCase(); // M,C,W,B,E,D
                    row += `${t}${piece.power}P${piece.player} `;
                }
            }
            rows.push(row);
        }
        return rows.join('\n');
    },

    _playerHeader() {
        const n = gameState.numPlayers || 2;
        const parts = [];
        for (let p = 1; p <= n; p++) {
            const cfg = gameState[`player${p}`];
            if (!cfg) continue;
            const label = cfg.type === 'cpu'
                ? `CPU/${cfg.difficulty.charAt(0).toUpperCase() + cfg.difficulty.slice(1)}`
                : 'Human';
            parts.push(`P${p}: ${label}`);
        }
        return parts.join('  |  ');
    },

    saveToStorage() {
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const logText = [
            `=== Game Log ${timestamp} ===`,
            this._playerHeader(),
            ...(this.initialBoard ? ['--- Initial Board ---', this.initialBoard, ''] : []),
            ...this.entries,
            '',
            '--- Final Board (piece[power]Player, ? = covered) ---',
            this.boardSnapshot()
        ].join('\n');

        localStorage.setItem('skillego_last_game_log', logText);
        return logText;
    },

    _pieceSummary() {
        const p1 = [], p2 = [], p1cov = [], p2cov = [];
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                const piece = gameState.board[r][c];
                if (!piece) continue;
                const el = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
                const covered = el && el.classList.contains('covered');
                const label = `${piece.type[0].toUpperCase()}${piece.power}`;
                if (piece.player === 1) { covered ? p1cov.push('?') : p1.push(label); }
                else                   { covered ? p2cov.push('?') : p2.push(label); }
            }
        }
        const who = gameState.player1 && gameState.player1.type === 'cpu' ? 'CPU' : 'P1';
        const cpu = gameState.player2 && gameState.player2.type === 'cpu' ? 'CPU' : 'P2';
        return `${who}: [${p1.join(' ')}] + ${p1cov.length} hidden | ${cpu}: [${p2.join(' ')}] + ${p2cov.length} hidden`;
    },

    addNote() {
        const input = document.getElementById('game-note-input');
        const text = input ? input.value.trim() : '';
        const recentMoves = this.entries.slice(-6).join('\n');
        const noteBlock = [
            ``,
            `*** NOTE (T${this.turnNumber})${text ? ': ' + text : ''} ***`,
            `Pieces: ${this._pieceSummary()}`,
            `Recent moves:`,
            recentMoves,
            `Board:`,
            this.boardSnapshot(),
            `*** END NOTE ***`,
            ``
        ].join('\n');

        this.entries.push(`--- NOTE at T${this.turnNumber}${text ? ': ' + text : ''} ---`);

        const existing = localStorage.getItem('skillego_last_game_log') || '';
        localStorage.setItem('skillego_last_game_log', existing + '\n' + noteBlock);

        if (input) input.value = '';
        const btn = document.getElementById('note-btn');
        if (btn) { btn.textContent = '✓ Saved!'; setTimeout(() => btn.textContent = '📝 Add Note', 1500); }
    },

    copyToClipboard() {
        const text = localStorage.getItem('skillego_last_game_log') || '(no game log saved yet — play a game first)';
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('copy-log-btn');
            if (btn) { btn.textContent = '✓ Copied!'; setTimeout(() => btn.textContent = '📋 Copy Game Log', 1500); }
        }).catch(() => {
            const btn = document.getElementById('copy-log-btn');
            if (btn) { btn.textContent = '✗ Failed'; setTimeout(() => btn.textContent = '📋 Copy Game Log', 1500); }
        });
    }
};
