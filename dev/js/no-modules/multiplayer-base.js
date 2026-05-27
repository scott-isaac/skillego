// multiplayer-base.js — shared helpers for hosted multiplayer pages
// (tournament lobby, network game lobby, future: spectator views).
// Keeps the truly common bits in one place so the per-page clients
// (tournament-client.js, lobby-client.js) only own their page-specific
// rendering and event flow.
//
// Wrapped in an IIFE that exposes a single `MP` namespace on `window`.
// Stays no-modules-friendly so it just drops into a <script> tag.

(function (global) {
'use strict';

// ── Default display name ────────────────────────────────────────────────
// Both clients used to roll their own "Player1234"-style generator. One
// canonical version: 4-digit suffix, low collision for small lobbies.
function defaultDisplayName() {
    return 'Player' + Math.floor(1000 + Math.random() * 9000);
}

// ── Copy-link button wiring ─────────────────────────────────────────────
// Both clients had a near-identical implementation: build invite URL,
// copy via navigator.clipboard with execCommand fallback, briefly flash
// "Copied!" feedback. Caller supplies the trigger button + a callback
// that returns the current invite URL (so the URL can change as state
// updates without re-wiring the button).
//
// Returns a teardown function in case the caller wants to unbind.
function setupCopyLinkButton(button, getUrl, opts) {
    if (!button) return () => {};
    opts = opts || {};
    const okLabel    = opts.successLabel || '✓ Copied';
    const idleLabel  = opts.idleLabel    || button.textContent;
    const flashMs    = opts.flashMs      || 1500;

    const onClick = () => {
        const url = getUrl && getUrl();
        if (!url) return;
        const finish = () => {
            button.textContent = okLabel;
            setTimeout(() => { button.textContent = idleLabel; }, flashMs);
        };
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(url).then(finish).catch(finish);
        } else {
            const ta = document.createElement('textarea');
            ta.value = url;
            ta.style.cssText = 'position:fixed;left:-9999px';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (_) {}
            ta.remove();
            finish();
        }
    };
    button.addEventListener('click', onClick);
    return () => button.removeEventListener('click', onClick);
}

// ── Invite URL builder ──────────────────────────────────────────────────
// Centralized so we don't get drift between page types. `param` is the
// query-string key ('lobby', 'tournament', 'join'); `code` is the value.
function inviteUrl(param, code) {
    return `${window.location.origin}${window.location.pathname}?${param}=${encodeURIComponent(code)}`;
}

// ── HTML escape ─────────────────────────────────────────────────────────
// Tournament-client has its own _escape; lobby-client never needed one
// because it builds DOM nodes directly. This is here so future shared
// rendering helpers don't reach into the per-page client for it.
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

global.MP = {
    defaultDisplayName,
    setupCopyLinkButton,
    inviteUrl,
    escapeHtml,
};

})(window);
