// gamelog.js - Structured move-by-move game log

const gameLog = {
    entries: [],
    turnNumber: 0,

    reset() {
        this.entries = [];
        this.turnNumber = 0;
        localStorage.removeItem('skillego_last_game_log');
    },

    _pieceLabel(piece) {
        return `${piece.type}[${piece.power}]`;
    },

    _coord(row, col) {
        return `(${row},${col})`;
    },

    recordUncover(player, row, col, piece) {
        this.turnNumber++;
        const cfg = player === 1 ? gameState.player1 : gameState.player2;
        const who = cfg && cfg.type === 'cpu' ? `CPU` : `P${player}`;
        this.entries.push(`T${this.turnNumber} ${who}: UNCOVER ${this._coord(row, col)} → ${this._pieceLabel(piece)}`);
    },

    recordMove(player, fromRow, fromCol, toRow, toCol, piece, capturedPiece) {
        this.turnNumber++;
        const cfg = player === 1 ? gameState.player1 : gameState.player2;
        const who = cfg && cfg.type === 'cpu' ? `CPU` : `P${player}`;
        if (capturedPiece) {
            this.entries.push(
                `T${this.turnNumber} ${who}: ${this._pieceLabel(piece)} ${this._coord(fromRow, fromCol)} → ${this._coord(toRow, toCol)}  CAPTURES ${this._pieceLabel(capturedPiece)}`
            );
        } else {
            this.entries.push(
                `T${this.turnNumber} ${who}: ${this._pieceLabel(piece)} ${this._coord(fromRow, fromCol)} → ${this._coord(toRow, toCol)}`
            );
        }
    },

    boardSnapshot() {
        const colHeader = '     ' + [0,1,2,3,4,5].join('    ');
        const rows = [colHeader];
        for (let r = 0; r < BOARD_SIZE; r++) {
            let row = `${r}  `;
            for (let c = 0; c < BOARD_SIZE; c++) {
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

    saveToStorage() {
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const logText = [
            `=== Game Log ${timestamp} ===`,
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
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
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
        });
    }
};
