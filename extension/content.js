// Pinpoint content script — element picker, comment popover, numbered pins.
// Everything UI lives inside a shadow root so page CSS can't touch it and vice versa.
(() => {
  if (window.__pinpointLoaded) return;
  window.__pinpointLoaded = true;

  // Safari and Firefox expose the promise-based extension API as `browser`; Chrome only has
  // `chrome`. Prefer `browser` where it exists so every `await chrome.…` below works on all three.
  const chrome = globalThis.browser ?? globalThis.chrome;

  // ---------- state ----------
  let picking = false;
  let hovered = null;
  let selected = null;
  let pins = []; // { id, number, selector, comment, el }
  let replies = []; // resolved annotations for this page, with what the agent said back
  let pickChain = [], pickIndex = 0; // the element stack under the last click, and where we sit in it
  let recording = false, recN = 0, flowSteps = null; // a flow being recorded; its steps once Done

  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const K_SEND = MAC ? "\u2318\u21a9" : "Ctrl+Enter";

  // ---------- shadow UI ----------
  const host = document.createElement("pinpoint-root");
  host.setAttribute("data-pinpoint", "");
  // Closed: with an open root any script on the page could reach our textarea and Send button and
  // file a note the developer never wrote — which the hook then hands the agent as their request.
  const shadow = host.attachShadow({ mode: "closed" });
  // For the test suite, which reads the UI from this isolated world over CDP. The page's own scripts
  // live in a different world and never see this global.
  globalThis.__pinpointShadow = shadow;
  shadow.innerHTML = `
    <style>
      /* Pinpoint is a layer over somebody else's app, so it keeps one look of its own in every theme:
         ink panels and a lime accent that stands out on any page, with sky blue for anything the
         agent did. Lime on a white page is faint, so the marks and pins carry a thin ink edge. The
         one flourish is the highlight — print crop marks, not a filled box — and the numbered drops. */
      :host {
        --graphite: #121212;        /* ink surfaces */
        --graphite-2: #1f1f1f;      /* wells, hovers */
        --graphite-3: #2d2d2d;      /* pressed, rules */
        --paper: #f5f5f5;           /* text on ink: 17.8:1 */
        --paper-dim: #a8a8a8;       /* secondary text: 8.5:1 */
        --paper-faint: #8c8c8c;     /* hints: 5.9:1 */
        --accent: #c6f432;          /* lime */
        --accent-hi: #c6f432;       /* lime as text on ink: 15.5:1 */
        --accent-ink: #121212;      /* text on lime */
        --edge: #121212;            /* the ink edge that keeps lime readable on a white page */
        --agent: #5cc8ff;           /* the agent */
        --ok: #5fd39a; --danger: #ff7a7f; --warn: #f2c14e;
        --line: rgba(255,255,255,.09);
        --shadow: 0 1px 0 rgba(255,255,255,.06) inset, 0 10px 30px -6px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.25);
        --mark-src: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAFmUlEQVR4nMxYfUxbVRQ//aQF2gJDPuTLsaEOmS5myr4kTglRJmh06JZsyxJNjJq4P8x0wamJxgXn9A/iP07+0S0iLBI0IQ6XRYbTJTND5nBbhsCGVspnWwptafv6POdBEdr3el/bR7Jfcntv7zv3nt89955777lquM2hBQWQkZFh5jguk+f5TPqvUqkmnE7nOBZdkCBUECfS09PXY7abEhK6S0wGCQ9i9g2mZrvd3gdxIGaCSKwGCdVjcdPS+lU5GsjM1QjliREOJm0chJE9j9kRJPoDrARBi8WyWq1WtyG5DfQ/K18DFbUpUF6ZDOs2GkTb/HnRCxfPuqH7+1kYt3Ihopcw7XQ4HDdBBmQRTEtLq0Bi7ZjSLRlqeOGABar3mEGrkze+gJ+HjhPT0NLohOmpIJGcxL5qpqamLrDaMjXglFZjZx1ULn04CQ4fzwJzhgbigXOSgw9eGoXrl3zCfyRazZryqJrQO0uRXCcW9ZXPp8I7TdmQZFRDvDAkq6Fqlwlsw34YuuYnb6/VaDTtPp9vQqqNpAVNJtMqnU7Xi8X8DdsM8P7JbFCr43b6ZQgGeXhv3yj83u0lKw5hehDXpENMVtIcWq32UyKXv1YHh5uyFCMnKMW+6j/PgoISHVmRnO+YlKyoVpzaAhzVTWysbjx9JxSX6mElMNA3BweqR8iKAdRVjE7zd7iMqAWxwWtEbtuO5BUjR1hTlgTlVUayohZ1viImIzXFdELAk3tNIAfYOfSc80B7k1NIVKY6Odixb14HknxG7HvEWYzTex9mhcZUFZSVG4AFtysIH78+Dr+d9Syrf+hxIxxsvAOSTdG9/oGtRiBdnhl+He63Regrt5Z+j2gdDAbLKd9UlQwaTXTHIG888vJYBDkC1TW8Og4skI7ySqNQRis+Ev5dbHh59LOmjL32zrTMQO95r+R3muozrewLDa3FpbqjEsRRCEIpZvaG3PuzhynT08WWWaIrgqDYfTCFfnR69r43eM2niIx2QRcaJ8IrxSwoLBz7OAcs0DpVQsY5sXjTmWASRKFRyh0yCFbuTMVTQXo70eEyrqxLBRZCxkDj2IBFEIUuUz7Qx56aghI9PLXfLPm99kUzFKxlO9tfV+Z1YdhwOYKPiLwer1iz6P6a1quFKrqBsHDh9CycOGaH4RsB4X/RPVrY80Y6bH4ihdmW9tFd64d5juN9ePWi0S6zjJiT+NCK3cEgPEZbRM1+C7BARCiNWecJZuXJj8V+bHHhfkoTp+oKJ0eQOou/oLz1s2nw++QdWSFisZDzeXnhlk3AA+K4mIwoQTQ1RWLX7WMcdDYnHDlKouOraXA5hBDgCh5xbSCXIAFHdIjyLxvsPN2AlYZ10A8nP3EI04PTe1BKTpIgjug7zNo8s7zq3b2jwmJWCtQX9Tnn4VVova/xHtgpJcs6Lox4u+nB/N6S+/XwYXMO83Yih9zbu23Q/4dPmFpcThtBxDlCYGnzBAKBGszHqMN67Hh2On5LUtv6BXLUJy6jp6ORI8gKNDCAuhtjlF9wrWSuxhv2R6dityRZ7q06GwxdFfiM+v3+CpfLdYPVTpYW6ggtuZU6JgWkaMbBPgpDINml5PDE2CyHHCGmUI2ePzCOpdeA7EKMyI5+mwOpaRomuTefs8Fwv3+RHL58DYFMxDRP1DEpIEWkkBRHs6Rzahk5a6zkYiYYRtIaIklERMk9O7JIDj12S6zkCIm8Dxai0/yKxby8Yi0cbcsFy8KbTYicdTBAWwkFQRW4nQxDHEjouSCcZMOpXKH+UN3/5Obm5ra43e5/IU4k/J5BoSKS/ImeMHKK5i8KtlsCuQGsexRPiX8gASjy4IKnTT4SOkfPFwtV/R6PZzsmKyQIxV6EjEZjnsFg6EKSnNfr3Y7TOgIKQLknq3lQVEYu7QaF8B8AAAD//19+9o4AAAAGSURBVAMAqiZ/YE1hrDwAAAAASUVORK5CYII=");
        --mark-armed: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAD7klEQVR4nMyY20sUURzHf7PuimuuumY95AWNKDMKk0jT1AyjEKSXIoL+geihFwPrD+jJgl4iiqCHqKCQhCIMhYQuFiRFgVGZmml5yduuu+6972/ZjXGc2TmzOxt94fDbOed3fucz58y5rYX+c1nJBBUUFOSGQqHCSCRSyM+SJM0uLi7O4KeLUpREScrpdO6EOckJQGVqPgD+BnMP6e78/PxHSkKGAQHWBqAL+FmrgFkdWFodGuXPYS4C9AmlAzAvL6/cYrF0oeEqJZASRga1xgd5b5GOLSwsjJJZgPn5+Y1o4CGSUwRMDxTPv2Hb5ubmXunV1W0BQ9qKYI/lDYmCaYHKerNVb8gTtoTZWQnzGimHgycLpgYai+Xy+/01brd7iIwCOhyO9Tab7R1+FlMaBdgRpGp8kwtq5Ratilar9TKlGY6FnuTJ16lZrpaJoS3BW42isuYLmCm0FURbmzFpxpVlFo0KZ/4hHPeiFfa0WrlqD2LmjqFSqfjEiFB1UzaVbLFFn8a/Bmiw30Miq5isjSH0YKUuIIZ3B4zwtpTtkKj9ygba25K9Kv9Nr4c6z86QxxURDUXhcLgMc2VMnmdRcaphq9y61CRJETp/bS0ci/M6rm4kEcnWxwZlmdp3VhRzJj0dOpFDuxuyNcurm+zUcnwdGVAR6QECLOok0oNVCeDiqj6g7yPrDH1ASPiVy7fbTPGRDbFDWabWgzMkqIGnHlN84gLorDLPouI0RYLqe7BMoZD2p+D3han3vptEhc75RXqAcHpPgvqB9e7RrSXN8u6bSzQxHCRR4dqwpm21qZqJhXoZNkMSPL7UHrbTqXYnlW3LjD6PfvLT7UvzNNDjFanOo8bD4MfRK5etHiAv1n0wB40esQo3ZUTt7GSIklAPdpIjykytvfgGW6PnPwZLEo43iOtq+ZoE6EU+RFaYeVBVKh4b9gOGd5eaj+aJBW/UEY9D6VM0NiDPaTloAmLT7obpktLVfRQFk9B7d/Dt9Wj66MSwY6gHYSsoDYoN7R5SzFy59A6l3mAw2AY7HQsotEcnAJLXn8ZndDQRHEto+HCB2oo7yguMSCGZo6lAINDocrk+6zkKHes5EHqyngNT6prCjrFPBI4lfO/ggByYUoOMwuGfrxHRCoYuRhw4BcgJo3Aswzc3GeSEgWoTmBx1RuFYSV0tuSFukAQg4TfGvlhOvlMSSmkRxqmnFDP7Jakc1eNwPp+vzuPxTFKSSulyzr2Ctaye/1+JAf1d52CHAb8/FTiWKdsYdptiAPXz3xexrC9er7cZych3qirT9lm73V6UlZX1DJChlZWVZvTcTzJBZh8E+FbGB0Lxm5KO/gAAAP//y1oh7wAAAAZJREFUAwAtleVWvuOV/gAAAABJRU5ErkJggg==");
        --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
        --sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        --ease: cubic-bezier(.16,1,.3,1);
        all: initial;
      }
      * { box-sizing: border-box; font-family: var(--sans); -webkit-font-smoothing: antialiased; }
      button { border: 0; background: none; padding: 0; margin: 0; cursor: pointer; color: inherit; font: inherit; outline: none; -webkit-tap-highlight-color: transparent; }
      button:focus { outline: none; }
      button:focus-visible { box-shadow: 0 0 0 2px var(--graphite), 0 0 0 4px var(--accent-hi); }
      @media (forced-colors: active) { button:focus-visible { outline: 2px solid ButtonText; outline-offset: 2px; } }
      kbd { font: 500 10.5px/1 var(--mono); color: var(--paper-dim); background: var(--graphite-2);
            border-radius: 5px; padding: 3px 5px; box-shadow: inset 0 -1px 0 rgba(0,0,0,.35); }

      /* ---------- the highlight: crop marks ---------- */
      .hl { position: fixed; pointer-events: none; display: none; transition: none;
            outline: 1px solid var(--edge); outline-offset: 2px; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 45%, transparent); }
      .hl .c { position: absolute; width: 14px; height: 14px; border: 0 solid var(--accent);
               filter: drop-shadow(0 0 .6px var(--edge)) drop-shadow(0 0 .6px var(--edge)); }
      .hl .c.tl { left: -6px; top: -6px; border-left-width: 3px; border-top-width: 3px; }
      .hl .c.tr { right: -6px; top: -6px; border-right-width: 3px; border-top-width: 3px; }
      .hl .c.bl { left: -6px; bottom: -6px; border-left-width: 3px; border-bottom-width: 3px; }
      .hl .c.br { right: -6px; bottom: -6px; border-right-width: 3px; border-bottom-width: 3px; }
      .hl .tag {
        position: absolute; left: -6px; top: -34px; display: inline-flex; gap: 6px; align-items: center;
        background: var(--graphite); color: var(--paper-dim); font: 500 11px/1 var(--mono);
        padding: 6px 8px; border-radius: 6px; white-space: nowrap; max-width: 70vw; overflow: hidden;
        text-overflow: ellipsis; box-shadow: var(--shadow);
      }
      .hl .tag.below { top: auto; bottom: -34px; }
      .hl .tag b { font-weight: 600; color: var(--accent-hi); }
      /* Held, not hovered: the marks go solid ink-violet and the box gets a faint wash. */
      .hl.selected { background: color-mix(in srgb, var(--accent) 10%, transparent); box-shadow: 0 0 0 4px var(--accent); }
      .hl.flash { animation: flash 1s var(--ease); }
      @keyframes flash { 30% { background: color-mix(in srgb, var(--accent) 22%, transparent) } }

      /* ---------- the bar ---------- */
      .dock {
        position: fixed; bottom: 16px; left: 16px; display: none; align-items: center; gap: 2px;
        pointer-events: auto; background: var(--graphite); color: var(--paper);
        border-radius: 999px; box-shadow: var(--shadow); padding: 4px; font-size: 12.5px; user-select: none;
        /* No transition on transform: keepDockOnScreen() measures right after resetting it. */
      }
      .dock.pos-br { left: auto; right: 16px; }
      .dock.pos-tl { bottom: auto; top: 16px; }
      .dock.pos-tr { bottom: auto; top: 16px; left: auto; right: 16px; }
      /* Dragged somewhere: left/top come from the drag, the corner classes stop applying. */
      .dock.free { right: auto !important; bottom: auto !important; }
      .dock .grip { width: 14px; height: 28px; display: inline-grid; place-items: center; color: var(--paper-faint); cursor: grab; flex: none; }
      .dock .grip::before { content: ""; width: 6px; height: 12px; background: radial-gradient(currentColor 1px, transparent 1.4px) 0 0 / 3px 4px; }
      .dock.dragging, .dock.dragging * { cursor: grabbing !important; }
      .dock.dragging { box-shadow: var(--shadow), 0 0 0 2px var(--accent); }
      .dock.mini .grip, .dock.armed .grip { display: none; }
      .dock button { display: inline-flex; align-items: center; gap: 7px; border-radius: 999px; height: 28px; padding: 0 11px; line-height: 1; }
      .dock button:hover { background: var(--graphite-2); }
      .dock .toggle { font-weight: 600; letter-spacing: -.005em; }
      .mark { width: 16px; height: 16px; flex: none; background: var(--mark-src) center / contain no-repeat; }
      .dock .hint { color: var(--paper-faint); font-weight: 400; }
      .dock .hint kbd { margin-left: 2px; }
      .dock .sep { width: 1px; height: 16px; background: var(--line); margin: 0 3px; flex: none; }
      .dock:not(.agent-live) .agent-say + .sep { display: none; }
      .dock .count { color: var(--paper-dim); font-variant-numeric: tabular-nums; position: relative; }
      .dock .count b { color: var(--paper); font-weight: 600; }
      .dock .count.only-done b { color: var(--paper-dim); }
      .dock .count.unread::after { content: ""; position: absolute; top: 4px; right: 6px; width: 7px; height: 7px;
                                   border-radius: 50%; background: var(--agent); box-shadow: 0 0 0 2px var(--graphite); }
      .dock .close, .dock .restart { color: var(--paper-faint); width: 28px; padding: 0; justify-content: center; font-size: 15px; }
      .dock .close:hover, .dock .restart:hover { color: var(--paper); }
      .dock .restart.busy { opacity: .5; pointer-events: none; }
      .dock.mini .label, .dock.mini .hint, .dock.mini .sep, .dock.mini .close, .dock.mini .restart { display: none; }
      .dock.mini .toggle { padding: 0 8px; }
      .dock.mini .count { padding: 0 9px 0 4px; }
      /* The agent, while it works: an orange light and what it is doing. */
      .who { display: none; align-items: center; padding-left: 6px; }
      .dock.agent-live .who { display: inline-flex; }
      .av { display: none; }
      .av.agent { display: block; width: 8px; height: 8px; border-radius: 50%; background: var(--agent);
                  box-shadow: 0 0 0 3px color-mix(in srgb, var(--agent) 30%, transparent); }
      .av.agent svg { display: none; }
      .dock.agent-live .av.agent { animation: breathe 1.8s ease-in-out infinite; }
      @keyframes breathe { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--agent) 10%, transparent); } }
      .agent-say { color: var(--paper-dim); font-size: 12px; max-width: 0; overflow: hidden; white-space: nowrap; opacity: 0;
                   transition: max-width 240ms var(--ease), opacity 180ms ease; }
      .dock.agent-live .agent-say { max-width: 200px; opacity: 1; padding: 0 8px 0 7px; }
      .dock.mini .agent-say { display: none; }
      /* Picking: the bar turns violet and goes inert, so it can never sit between you and a target;
         only Stop and the counter take clicks. */
      .dock.armed { pointer-events: none; background: var(--accent); color: var(--accent-ink); }
      .dock.armed .toggle:hover { background: transparent; }
      .dock.armed .mark { background-image: var(--mark-armed); animation: pulse 1.6s ease-in-out infinite; }
      @keyframes pulse { 50% { opacity: .5 } }
      .dock.armed .hint { color: color-mix(in srgb, var(--accent-ink) 80%, transparent); }
      .dock.armed .label, .dock.armed .sep, .dock.armed .close, .dock.armed .restart { display: none; }
      .dock .stop { display: none; }
      .dock.armed .stop { display: inline-flex; pointer-events: auto; background: var(--graphite); color: var(--paper); font-weight: 600; }
      .dock.armed .stop:hover { background: var(--graphite-2); }
      .dock.armed .stop kbd { background: var(--graphite-2); }
      .dock.armed .count { pointer-events: auto; color: color-mix(in srgb, var(--accent-ink) 75%, transparent); }
      .dock.armed .count b { color: var(--accent-ink); }
      .dock.armed .count:hover { background: rgba(0,0,0,.1); }
      /* Bridge down: a small pill whose only job is to bring it back. */
      .dock .start { display: none; color: var(--paper-dim); font-weight: 500; }
      .dock.offline .start { display: inline-flex; }
      .dock .start .led { width: 7px; height: 7px; border-radius: 50%; background: var(--paper-faint); flex: none; }
      .dock .start.busy { opacity: .55; pointer-events: none; }
      .dock.offline .count, .dock.offline .who, .dock.offline .agent-say, .dock.offline .restart,
      .dock.offline .sep, .dock.offline .label, .dock.offline .hint { display: none; }
      .dock.offline.armed .start { display: none; }
      /* Drafts wait for you to hand them over. */
      .dock .drafts { display: none; background: var(--accent); color: var(--accent-ink); font-weight: 700; }
      .dock .drafts:hover { background: color-mix(in srgb, var(--accent) 88%, #fff); }
      .dock.has-drafts .drafts { display: inline-flex; }
      .dock.mini .drafts, .dock.armed .drafts, .dock.offline .drafts { display: none; }
      /* While picking, a note about the whole page is one press away. */
      .dock .page-note { display: none; }
      .dock.armed .page-note { display: inline-flex; pointer-events: auto; color: var(--accent-ink); font-weight: 600; }
      .dock.armed .page-note:hover { background: rgba(0,0,0,.1); }
      /* Recording a flow: a red light and a running count of steps; Done is the way out. */
      .dock .rec-start, .dock .rec-done { display: none; }
      .dock.armed .rec-start { display: inline-flex; pointer-events: auto; color: var(--accent-ink); font-weight: 600; }
      .dock.armed .rec-start:hover { background: rgba(0,0,0,.1); }
      .dock.recording .rec-done { display: inline-flex; font-weight: 600; }
      .dock .rec-done .led { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); flex: none; animation: pulse 1.6s ease-in-out infinite; }
      .dock.recording .toggle, .dock.recording .drafts, .dock.recording.armed .rec-start { display: none; }
      .pop .steps { margin: 4px 0 0; padding-left: 18px; color: var(--paper-dim); font: 11px/1.5 var(--mono); max-height: 120px; overflow: auto; }
      .pop .steps li { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      /* ---------- region marquee ---------- */
      .marquee { position: fixed; display: none; pointer-events: none; z-index: 3;
                 border: 2px dashed var(--edge); outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
                 background: color-mix(in srgb, var(--accent) 12%, transparent); }
      .marquee .size { position: absolute; right: 0; bottom: -26px; font: 500 10.5px/1 var(--mono); background: var(--graphite);
                       color: var(--paper-dim); padding: 5px 7px; border-radius: 5px; white-space: nowrap; box-shadow: var(--shadow); }

      /* ---------- the comment box ---------- */
      .pop {
        position: fixed; z-index: 3; width: min(360px, calc(100vw - 16px)); pointer-events: auto; display: none;
        background: var(--graphite); color: var(--paper); border-radius: 14px; box-shadow: var(--shadow);
        padding: 14px 14px 12px; animation: rise 180ms var(--ease);
      }
      @keyframes rise { from { opacity: 0; transform: translateY(4px) } }
      .pop .meta { font: 11px/1.5 var(--mono); color: var(--paper-faint); margin-bottom: 10px; display: grid; gap: 3px; }
      .pop .meta .row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .pop .meta b { font: 600 13.5px/1.3 var(--sans); color: var(--accent-hi); margin-right: 4px; }
      .pop .meta .picked { color: var(--paper-dim); font: 12.5px/1.4 var(--sans); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .pop textarea {
        width: 100%; min-height: 60px; max-height: 220px; resize: none; color: var(--paper);
        background: var(--graphite-2); border: 1px solid transparent; border-radius: 10px;
        padding: 10px 11px; font: 13.5px/1.5 var(--sans); outline: none; caret-color: var(--accent-hi);
        transition: border-color 120ms ease, box-shadow 120ms ease;
      }
      .pop textarea::placeholder { color: var(--paper-faint); }
      .pop textarea:focus { border-color: color-mix(in srgb, var(--accent) 70%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
      /* Clicking is a guess; these walk the stack under the point you clicked. */
      .pop .scope { display: flex; gap: 4px; align-items: center; margin: -2px 0 10px; }
      .pop .scope button { font: 500 11.5px var(--sans); color: var(--paper-dim); background: var(--graphite-2);
                           border-radius: 7px; padding: 5px 9px; line-height: 1; }
      .pop .scope button:hover:not(:disabled) { color: var(--paper); background: var(--graphite-3); }
      .pop .scope button:disabled { opacity: .35; cursor: default; }
      .pop .scope-hint { font: 10.5px/1 var(--mono); color: var(--paper-faint); margin-left: auto; }
      .pop .row2 { display: flex; gap: 4px; margin-top: 10px; align-items: center; }
      .pop .status { order: -1; margin-right: auto; font-size: 11.5px; color: var(--paper-faint); }
      .pop .status.err { color: var(--danger); }
      .pop .status.ok { color: var(--ok); }
      .pop .ghost { color: var(--paper-dim); font: 500 12px var(--sans); border-radius: 8px; padding: 7px 10px; }
      .pop .ghost:hover { background: var(--graphite-2); color: var(--paper); }
      /* Dictation: only where the browser has a recognizer. Red while it listens. */
      .pop .mic { display: none; align-items: center; padding: 6px 8px; }
      .pop .mic.avail { display: inline-flex; }
      .pop .mic[aria-pressed="true"] { color: var(--danger); background: var(--graphite-2); }
      .pop .send { background: var(--accent); color: var(--accent-ink); display: inline-flex; gap: 8px; align-items: center;
                   border-radius: 8px; padding: 7px 8px 7px 13px; font: 600 12.5px var(--sans); }
      .pop .send:hover { background: color-mix(in srgb, var(--accent) 88%, #fff); }
      .pop .send kbd { background: rgba(0,0,0,.14); color: var(--accent-ink); box-shadow: none; }

      /* ---------- pins: numbered drops, pointing at the corner they mark ---------- */
      .pin {
        position: fixed; z-index: 2; min-width: 22px; height: 22px; padding: 0 6px; pointer-events: auto; cursor: pointer;
        border-radius: 11px 11px 11px 3px; background: var(--accent); color: var(--accent-ink);
        font: 700 11px/22px var(--sans); text-align: center; font-variant-numeric: tabular-nums;
        box-shadow: 0 0 0 2px var(--edge), 0 4px 12px rgba(0,0,0,.3);
        transform: translate(-50%, -50%); transition: transform 120ms var(--ease);
      }
      .pin:hover { transform: translate(-50%, -50%) scale(1.12); }
      .pin.watched { box-shadow: 0 0 0 2px var(--edge), 0 0 0 6px color-mix(in srgb, var(--agent) 60%, transparent), 0 4px 12px rgba(0,0,0,.3); }
      .pin.new { animation: drop 260ms var(--ease); }
      /* A draft is marked but not sent: an outline of a pin. */
      .pin.draft { background: var(--graphite); color: var(--accent); box-shadow: 0 0 0 2px var(--accent), 0 4px 12px rgba(0,0,0,.3); }
      /* The agent asked something: the pin carries a question mark in the agent's colour. */
      .pin.waiting::after { content: "?"; position: absolute; top: -8px; right: -8px; width: 15px; height: 15px; border-radius: 50%;
                            background: var(--agent); color: #08131a; font: 800 10px/15px var(--sans); box-shadow: 0 0 0 2px var(--edge); }
      @keyframes drop { from { transform: translate(-50%, -90%) scale(.6); opacity: 0 } }
      .tip {
        position: fixed; z-index: 4; max-width: min(300px, calc(100vw - 16px)); pointer-events: auto; display: none;
        background: var(--graphite); color: var(--paper); border-radius: 10px; box-shadow: var(--shadow);
        padding: 10px 12px; font-size: 12.5px; line-height: 1.5;
      }
      .tip .num { color: var(--accent-hi); font-weight: 700; margin-right: 5px; font-variant-numeric: tabular-nums; }
      .tip .del { display: inline-block; margin-top: 8px; color: var(--paper-faint); font-size: 11.5px; border-radius: 5px; padding: 2px 0; }
      .tip .del:hover { color: var(--danger); }

      /* ---------- notes panel ---------- */
      .panel {
        position: fixed; z-index: 5; top: 8px; right: 8px; bottom: 8px; width: 316px; display: none;
        pointer-events: auto; background: var(--graphite); color: var(--paper); border-radius: 14px;
        box-shadow: var(--shadow); animation: slide 220ms var(--ease); flex-direction: column; overflow: hidden;
      }
      @keyframes slide { from { transform: translateX(14px); opacity: 0 } }
      .panel h2 { margin: 0; padding: 16px 16px 8px; font-size: 14px; font-weight: 600; letter-spacing: -.005em; display: flex; align-items: center; }
      .panel h2 .close { margin-left: auto; color: var(--paper-faint); font-size: 17px; width: 26px; height: 26px; border-radius: 7px; }
      .panel h2 .close:hover { color: var(--paper); background: var(--graphite-2); }
      .panel .list { list-style: none; margin: 0; padding: 0 8px 14px; overflow: auto; flex: 1; }
      .panel .item { display: flex; gap: 10px; padding: 10px 8px; border-radius: 10px; cursor: pointer; align-items: flex-start; outline: none; }
      .panel .item:hover, .panel .item:focus-visible { background: var(--graphite-2); }
      .panel .item:focus-visible { box-shadow: 0 0 0 2px var(--accent-hi); }
      .panel .item .n { background: var(--accent); color: var(--accent-ink); border-radius: 10px 10px 10px 3px; min-width: 20px; height: 20px;
                        font: 700 10.5px/20px var(--sans); text-align: center; padding: 0 5px; flex: none; font-variant-numeric: tabular-nums; }
      .panel .item .body { min-width: 0; flex: 1; display: grid; gap: 3px; }
      .panel .item .c { font-size: 13px; line-height: 1.45; }
      .panel .item .s { font: 10.5px/1.5 var(--mono); color: var(--paper-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .panel .item .s .warn { color: var(--warn); }
      .panel .item.gone .c { opacity: .55; }
      .panel .item .x { color: var(--paper-faint); width: 24px; height: 24px; border-radius: 7px; font-size: 16px; line-height: 1;
                        display: inline-flex; align-items: center; justify-content: center; flex: none; opacity: 0; }
      .panel .item:hover .x, .panel .item:focus-within .x, .panel .item .x:focus-visible { opacity: 1; }
      .panel .item .x:hover { color: var(--danger); background: var(--graphite-3); }
      .panel .group { padding: 16px 8px 6px; font: 600 12px/1 var(--sans); color: var(--paper-dim); display: flex; align-items: center;
                      border-top: 1px solid var(--line); margin-top: 8px; }
      .panel .group .clear-done { margin-left: auto; font: 500 11.5px var(--sans); color: var(--paper-faint); padding: 4px 8px; border-radius: 7px; }
      .panel .group .clear-done:hover { color: var(--paper); background: var(--graphite-2); }
      .panel .item.done { cursor: default; }
      .panel .item.done:hover { background: none; }
      .panel .item.done .n { background: var(--graphite-3); color: var(--paper-dim); }
      .panel .item.done .c { color: var(--paper-dim); }
      /* The agent's answer, in the agent's colour. */
      .panel .reply { margin-top: 6px; padding: 8px 10px; background: color-mix(in srgb, var(--agent) 9%, var(--graphite-2));
                      border-radius: 4px 10px 10px 10px; font-size: 12.5px; line-height: 1.5; color: var(--paper); }
      .panel .reply .who { display: block; font: 600 11px/1 var(--sans); color: var(--agent); margin-bottom: 5px; padding: 0; }
      .panel .reply.none { color: var(--paper-faint); font-style: italic; }
      .panel .empty { padding: 20px 16px; color: var(--paper-dim); font-size: 13px; line-height: 1.55; }
      .panel .item.draft .n { background: var(--graphite); color: var(--accent); box-shadow: inset 0 0 0 1.5px var(--accent); }
      .panel .item.waiting .n { background: var(--agent); color: #08131a; }
      .panel .ask { margin-top: 6px; padding: 8px 10px; border-radius: 4px 10px 10px 10px; font-size: 12.5px; line-height: 1.5;
                    background: color-mix(in srgb, var(--agent) 12%, var(--graphite-2)); }
      .panel .ask b { display: block; font: 600 11px/1 var(--sans); color: var(--agent); margin-bottom: 5px; }
      .panel .mine { margin-top: 6px; padding: 7px 10px; border-radius: 10px 4px 10px 10px; font-size: 12.5px; line-height: 1.5;
                     background: color-mix(in srgb, var(--accent) 10%, var(--graphite-2)); }
      .panel .mine b { display: block; font: 600 11px/1 var(--sans); color: var(--accent); margin-bottom: 4px; }
      .panel form { margin-top: 8px; display: grid; gap: 6px; }
      .panel form textarea { width: 100%; min-height: 52px; resize: none; border-radius: 8px; border: 1px solid transparent; background: var(--graphite-2);
                             color: var(--paper); font: 12.5px/1.45 var(--sans); padding: 8px 9px; outline: none; }
      .panel form textarea:focus { border-color: color-mix(in srgb, var(--accent) 70%, transparent); }
      .panel form .fr { display: flex; gap: 6px; justify-content: flex-end; }
      .panel form button { font: 600 11.5px var(--sans); border-radius: 7px; padding: 6px 11px; }
      .panel form .go { background: var(--accent); color: var(--accent-ink); }
      .panel form .no { color: var(--paper-faint); }
      /* Before and after: the crop from when it was marked, and one from once the agent was done. */
      .panel .ba { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px; }
      .panel .ba figure { margin: 0; min-width: 0; }
      .panel .ba img { display: block; width: 100%; max-height: 90px; object-fit: contain; background: var(--graphite-2); border-radius: 6px; }
      .panel .ba figcaption { font: 600 10.5px/1 var(--sans); color: var(--paper-faint); margin-top: 4px; }
      .panel .follow { margin-top: 6px; font: 500 11.5px var(--sans); color: var(--paper-faint); padding: 3px 0; }
      .panel .follow:hover { color: var(--accent); }
      .panel .group .send-all { margin-left: auto; font: 700 11.5px var(--sans); color: var(--accent-ink); background: var(--accent); padding: 4px 9px; border-radius: 7px; }

      /* ---------- toast ---------- */
      .toast {
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); display: none; pointer-events: none;
        background: var(--graphite); color: var(--paper); border-radius: 999px; padding: 9px 16px 9px 14px;
        font-size: 12.5px; box-shadow: var(--shadow); max-width: min(560px, calc(100vw - 32px));
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; animation: rise 180ms var(--ease);
      }
      .toast::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-right: 9px; vertical-align: 1px; }
      .toast.action { pointer-events: auto; cursor: pointer; }
      .toast.action::before { background: var(--agent); }
      .toast.action::after { content: " ›"; color: var(--paper-faint); }
      /* A finished note: the agent's reply, and whether it is what you meant. */
      .toast.card { pointer-events: auto; align-items: center; gap: 10px; border-radius: 14px; padding: 7px 7px 7px 14px; }
      .toast.card::before { background: var(--agent); margin-right: 0; flex: none; }
      .toast.card .tm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
      .toast.card button { flex: none; font: 600 11.5px var(--sans); border-radius: 8px; padding: 6px 10px; }
      .toast.card .ok { background: var(--accent); color: var(--accent-ink); }
      .toast.card .nq { color: var(--paper-dim); }
      .toast.card .nq:hover { color: var(--paper); background: var(--graphite-2); }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation: none !important; transition-duration: 1ms !important; }
      }
    </style>

    <div class="hl"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i><div class="tag"></div></div>
    <div class="marquee"><span class="size"></span></div>

    <div class="dock">
      <span class="grip" title="Drag to move the bar anywhere" aria-hidden="true"></span>
      <button class="toggle" aria-label="Pinpoint: pick an element" aria-pressed="false"><span class="mark" aria-hidden="true"></span><span class="label">Pinpoint</span><span class="hint"></span></button>
      <button class="page-note" title="A note about the whole page, not one element">Whole page</button>
      <button class="rec-start" title="Click through what goes wrong; each click becomes a step">Record steps</button>
      <button class="rec-done" title="Stop recording and write the note (Esc throws it away)"><span class="led" aria-hidden="true"></span>Recording · <span class="rec-n">0</span>&nbsp;· Done</button>
      <button class="stop" title="Stop picking">Stop&nbsp;<kbd>Esc</kbd></button>
      <button class="start" title="Start the Pinpoint bridge"><span class="led" aria-hidden="true"></span><span class="st">Bridge off · Start</span></button>
      <span class="sep"></span>
      <span class="who" title="">
        <span class="av you" aria-label="you"><svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z"/></svg></span>
        <span class="av agent" aria-label="your coding agent"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 1.6l1.7 5.2 4.4-3.2-3.2 4.4 5.2 1.7-5.2 1.7 3.2 4.4-4.4-3.2L12 22.4l-1.7-5.2-4.4 3.2 3.2-4.4-5.2-1.7 5.2-1.7-3.2-4.4 4.4 3.2z"/></svg></span>
      </span>
      <span class="agent-say"></span>
      <span class="sep"></span>
      <button class="drafts" title="Hand your drafts to the agent">Send <span class="dn">0</span></button>
      <button class="count"><b>0</b>&nbsp;<span class="cw">notes</span></button>
      <button class="restart" title="Restart the bridge (picks up a new build)" aria-label="Restart the bridge">&#8635;</button>
      <button class="close" title="Hide on this site" aria-label="Hide Pinpoint on this site">&times;</button>
    </div>

    <div class="pop" role="dialog" aria-label="Comment for your coding agent" aria-describedby="pp-meta">
      <div class="meta" id="pp-meta"></div>
      <div class="scope">
        <button class="wider" title="Select the element around this one">↑ wider</button>
        <button class="narrower" title="Select the element inside this one">↓ narrower</button>
        <span class="scope-hint"></span>
      </div>
      <textarea rows="2" aria-label="What should change"></textarea>
      <div class="row2">
        <span class="status" role="status"></span>
        <button class="ghost mic" aria-pressed="false" aria-label="Dictate" title="Dictate — your browser sends the audio to its speech service"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 6-6.9h-2Z"/></svg></button>
        <button class="ghost copy" title="Copy as a prompt, for any chat">Copy</button>
        <button class="ghost cancel" title="Close this and pick another element">Re-pick</button>
        <button class="ghost draft" title="Keep it on the page without sending it yet (Shift+Cmd/Ctrl+Enter)">Draft</button>
        <button class="send">Send<kbd></kbd></button>
      </div>
    </div>

    <div class="tip"></div>

    <div class="panel">
      <h2>Notes on this page <button class="close" aria-label="Close notes">&times;</button></h2>
      <ul class="list"></ul>
    </div>

    <div class="toast" role="status"></div>
  `;
  const ui = {
    hl: shadow.querySelector(".hl"),
    tag: shadow.querySelector(".hl .tag"),
    dock: shadow.querySelector(".dock"),
    marquee: shadow.querySelector(".marquee"),
    marqueeSize: shadow.querySelector(".marquee .size"),
    dockToggle: shadow.querySelector(".dock .toggle"),
    dockStop: shadow.querySelector(".dock .stop"),
    dockPage: shadow.querySelector(".dock .page-note"),
    recStart: shadow.querySelector(".dock .rec-start"),
    recDone: shadow.querySelector(".dock .rec-done"),
    recN: shadow.querySelector(".dock .rec-n"),
    dockDrafts: shadow.querySelector(".dock .drafts"),
    dockDraftsN: shadow.querySelector(".dock .drafts .dn"),
    draft: shadow.querySelector(".pop .draft"),
    dockStart: shadow.querySelector(".dock .start"),
    dockStartLabel: shadow.querySelector(".dock .start .st"),
    dockHint: shadow.querySelector(".dock .hint"),
    dockCount: shadow.querySelector(".dock .count"),
    dockCountN: shadow.querySelector(".dock .count b"),
    dockCountWord: shadow.querySelector(".dock .count .cw"),
    dockClose: shadow.querySelector(".dock .close"),
    dockRestart: shadow.querySelector(".dock .restart"),
    pop: shadow.querySelector(".pop"),
    meta: shadow.querySelector(".pop .meta"),
    scope: shadow.querySelector(".pop .scope"),
    wider: shadow.querySelector(".pop .wider"),
    narrower: shadow.querySelector(".pop .narrower"),
    scopeHint: shadow.querySelector(".pop .scope-hint"),
    text: shadow.querySelector(".pop textarea"),
    send: shadow.querySelector(".pop .send"),
    sendKbd: shadow.querySelector(".pop .send kbd"),
    copy: shadow.querySelector(".pop .copy"),
    mic: shadow.querySelector(".pop .mic"),
    cancel: shadow.querySelector(".pop .cancel"),
    status: shadow.querySelector(".pop .status"),
    who: shadow.querySelector(".who"),
    agentSay: shadow.querySelector(".agent-say"),
    tip: shadow.querySelector(".tip"),
    panel: shadow.querySelector(".panel"),
    panelList: shadow.querySelector(".panel .list"),
    panelClose: shadow.querySelector(".panel h2 .close"),
    toast: shadow.querySelector(".toast"),
  };
  ui.sendKbd.textContent = K_SEND;
  ui.text.placeholder = "What should change here — how it looks or what it does?";

  // Inline !important styles on the host, because the shadow ":host { all: initial }" rule would
  // otherwise leave it a static, inline, z-index:auto element — and then any page with its own
  // fixed bar (z-index: 10 is enough) paints straight over our overlay.
  host.style.cssText =
    "position:fixed !important;top:0 !important;left:0 !important;width:0 !important;height:0 !important;" +
    "margin:0 !important;padding:0 !important;border:0 !important;overflow:visible !important;" +
    "pointer-events:none !important;z-index:2147483646 !important;display:block !important;" +
    "transform:none !important;filter:none !important;clip-path:none !important;contain:none !important;";
  (document.documentElement || document.body).appendChild(host);

  // ---------- helpers: selectors, paths, styles, source hints ----------
  // closest() does not cross shadow boundaries, so from inside our own shadow root the host is
  // unreachable and every control we own looked like page content. While picking, that made the
  // document's capture-phase click handler open a comment box on our own Stop button.
  const isOurs = (el) => {
    if (!el) return false;
    if (el === host) return true;
    if (el.getRootNode && el.getRootNode() === shadow) return true;
    return !!el.closest?.("pinpoint-root");
  };

  // ---------- iframe support ----------
  // captureVisibleTab crops in TOP-document viewport coordinates, but inside an iframe our rects
  // are frame-relative. Each frame asks its parent where its own <iframe> box sits; the answers
  // chain up so a frame nested several levels deep still gets a correct absolute offset.
  const isTop = window.top === window;
  let frameOffset = { x: 0, y: 0, at: 0 };

  window.addEventListener("message", async (e) => {
    const d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.__pinpoint === "whereAmI") {
      // A child frame is asking for its position. Find which iframe it came from.
      const frames = [...document.querySelectorAll("iframe, frame")];
      const el = frames.find((f) => f.contentWindow === e.source);
      if (!el) return;
      const r = el.getBoundingClientRect();
      // The frame's document starts inside its border and padding, not at its outer edge.
      const cs = getComputedStyle(el);
      const ix = el.clientLeft + (parseFloat(cs.paddingLeft) || 0), iy = el.clientTop + (parseFloat(cs.paddingTop) || 0);
      const mine = isTop ? { x: 0, y: 0 } : await askParent();
      e.source.postMessage({ __pinpoint: "youAreAt", token: d.token, x: mine.x + r.left + ix, y: mine.y + r.top + iy }, "*");
    }
  });

  function askParent(timeout = 400) {
    return new Promise((resolve) => {
      const token = Math.random().toString(36).slice(2);
      const done = (v) => { window.removeEventListener("message", on); clearTimeout(t); resolve(v); };
      const on = (e) => {
        if (e.data?.__pinpoint === "youAreAt" && e.data.token === token) done({ x: e.data.x, y: e.data.y });
      };
      const t = setTimeout(() => done({ x: 0, y: 0 }), timeout);
      window.addEventListener("message", on);
      try { window.parent.postMessage({ __pinpoint: "whereAmI", token }, "*"); } catch { done({ x: 0, y: 0 }); }
    });
  }

  async function getFrameOffset() {
    if (isTop) return { x: 0, y: 0 };
    if (Date.now() - frameOffset.at < 1000) return frameOffset;
    const o = await askParent();
    frameOffset = { ...o, at: Date.now() };
    return o;
  }

  const GENERATED = /^(css-|sc-|_|jsx-|svelte-)|(?=[a-f]*\d)[0-9a-f]{6,}|^[A-Za-z0-9_-]*__[A-Za-z0-9_-]+_[A-Za-z0-9]{5,}$/;
  const classCount = new Map();
  function rarity(cls) {
    if (!classCount.has(cls)) {
      let n = 0;
      try { n = document.getElementsByClassName(cls).length; } catch { n = 999; }
      classCount.set(cls, n);
    }
    return classCount.get(cls);
  }
  // "btn btn-sm btn-primary" should identify itself by btn-primary, not by btn: the rarest
  // classes are the ones that actually distinguish this element from its siblings.
  function stableClasses(el) {
    return [...el.classList]
      .filter((c) => c && !GENERATED.test(c))
      .sort((a, b) => rarity(a) - rarity(b))
      .slice(0, 2);
  }

  // Returns the root (document or ShadowRoot) that querySelector should run against for `el`.
  function rootOf(el) {
    const r = el.getRootNode();
    return r instanceof ShadowRoot ? r : document;
  }

  function uniqueSelector(el) {
    const root = rootOf(el);
    const local = uniqueSelectorIn(el, root);
    // Inside a shadow tree: prefix with the host's selector, joined by ">>>" (resolved by safeQuery).
    if (root !== document && root.host) return uniqueSelector(root.host) + " >>> " + local;
    return local;
  }

  // Attributes a framework or a template puts on an element on purpose. These survive a re-render
  // that shuffles sibling order, which positional selectors do not.
  const STABLE_ATTRS = ["data-testid", "data-test", "data-cy", "data-field", "data-action", "data-array",
                        "data-component", "data-id", "data-key", "data-value", "name", "for", "aria-label", "value", "placeholder", "type"];
  function attrCandidates(el) {
    const tag = el.tagName.toLowerCase();
    const out = [];
    for (const a of STABLE_ATTRS) {
      const v = el.getAttribute?.(a);
      if (v && v.length <= 60 && !/["\\]/.test(v)) out.push(`${tag}[${a}="${v}"]`);
    }
    return out;
  }
  function firstUnique(cands, root, el) {
    for (const c of cands) {
      try {
        const hits = root.querySelectorAll(c);
        if (hits.length === 1 && hits[0] === el) return c;
      } catch {}
    }
    return null;
  }

  function uniqueSelectorIn(el, root) {
    if (el.id && root.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
    // Try the element's own stable attributes before anything positional.
    const own = firstUnique(attrCandidates(el), root, el);
    if (own) return own;
    // Then the same attributes combined with a distinctive class.
    const cls = stableClasses(el);
    if (cls.length) {
      const withClass = attrCandidates(el).map((c) => c + "." + CSS.escape(cls[0]));
      const hit = firstUnique(withClass, root, el);
      if (hit) return hit;
    }
    // Then an attribute-anchored ancestor plus this element's class, which survives re-ordering.
    for (let p = el.parentElement, hops = 0; p && hops < 4; p = p.parentElement, hops++) {
      const anchor = p.id && root.querySelectorAll(`#${CSS.escape(p.id)}`).length === 1
        ? `#${CSS.escape(p.id)}`
        : firstUnique(attrCandidates(p), root, p);
      if (!anchor) continue;
      const tail = el.tagName.toLowerCase() + (cls.length ? "." + cls.map((c) => CSS.escape(c)).join(".") : "");
      const hit = firstUnique([`${anchor} ${tail}`], root, el);
      if (hit) return hit;
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && root.querySelectorAll(`#${CSS.escape(cur.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(cur.id)}`);
        break;
      }
      const cls = stableClasses(cur);
      if (cls.length) part += "." + cls.map((c) => CSS.escape(c)).join(".");
      const parent = cur.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter((s) => s.tagName === cur.tagName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      try {
        const candidate = parts.join(" > ");
        if (root.querySelectorAll(candidate).length === 1) return candidate;
      } catch {}
      cur = parent;
    }
    return parts.join(" > ");
  }

  function domPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let p = cur.tagName.toLowerCase();
      if (cur.id) p += `#${cur.id}`;
      else {
        const c = stableClasses(cur);
        if (c.length) p += "." + c[0];
      }
      parts.unshift(p);
      const parent = cur.parentElement;
      if (!parent) {
        const r = cur.getRootNode();
        if (r instanceof ShadowRoot && r.host) { parts.unshift("#shadow-root"); cur = r.host; continue; }
      }
      cur = parent;
    }
    return parts.join(" > ");
  }

  const STYLE_PROPS = [
    "display", "position", "width", "height", "padding", "margin", "gap",
    "color", "background-color", "background-image", "border", "border-radius", "box-shadow", "opacity",
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align", "text-transform",
    "flex-direction", "justify-content", "align-items", "grid-template-columns", "overflow", "z-index",
  ];
  function computedStyles(el) {
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && v !== "none" && v !== "normal" && v !== "auto" && v !== "0px" && v !== "static" && v !== "visible") out[p] = v;
    }
    return out;
  }

  function pickAttributes(el) {
    const keep = {};
    for (const a of el.attributes) {
      if (/^(id|class|style)$/.test(a.name)) continue;
      if (/^(role|aria-[\w-]+|href|src|alt|name|type|placeholder|title|for|value|data-[\w-]+)$/.test(a.name)) {
        keep[a.name] = a.value.length > 200 ? a.value.slice(0, 200) + "…" : a.value;
      }
    }
    return keep;
  }

  // Framework internals live in the page's MAIN world; inspector.js answers synchronously.
  function sourceHint(el) {
    let result = null;
    const onResult = (e) => { result = e.detail; };
    el.addEventListener("pinpoint:inspect-result", onResult, { once: true });
    el.dispatchEvent(new CustomEvent("pinpoint:inspect", { bubbles: true }));
    el.removeEventListener("pinpoint:inspect-result", onResult);
    try {
      const h = result ? JSON.parse(result) : null;
      if (h && !h.error) return h;
    } catch {}
    return { framework: null, components: [], file: null, line: null, column: null, attributes: {} };
  }

  // A production build has stripped the framework's debug info, so the hint has no file: ask the
  // worker to trace the component through the page's own source maps (sourcemap.js). Bounded, and
  // any failure just leaves the hint as it was.
  // Started when the popover opens (paintMeta) and reused at Send, so the lookup has usually
  // finished — or at least filled the worker's cache — by the time the comment is written.
  const mapLookups = new WeakMap();
  function mapLookup(el) {
    if (!mapLookups.has(el)) mapLookups.set(el, mapSource(el).catch(() => null));
    return mapLookups.get(el);
  }
  async function mapSource(el) {
    let raw = null;
    const on = (e) => { raw = e.detail; };
    el.addEventListener("pinpoint:probe-result", on, { once: true });
    el.dispatchEvent(new CustomEvent("pinpoint:probe", { bubbles: true }));
    el.removeEventListener("pinpoint:probe-result", on);
    let probe = null;
    try { probe = JSON.parse(raw); } catch {}
    if (typeof probe?.snippet !== "string") return null;
    const r = await chrome.runtime.sendMessage({ type: "sourcemap", snippet: probe.snippet, scripts: probe.scripts }).catch(() => null);
    if (typeof r?.file !== "string") return null;
    return { ...r, fnName: probe.name };
  }
  async function applyMapSource(el, hint) {
    const r = await Promise.race([mapLookup(el), new Promise((res) => setTimeout(res, 1800))]); // the worker stops at 1.5 s
    if (!r) return;
    Object.assign(hint, { file: r.file, line: r.line ?? null, column: r.column ?? null, method: "sourcemap" });
    if (r.name) {
      const i = hint.components.indexOf(r.fnName);
      if (i >= 0) hint.components[i] = r.name; else hint.components.unshift(r.name);
    }
  }

  // The page's recent uncaught errors, from inspector.js in the MAIN world. Raw and untrusted: the
  // worker validates and redacts them before they reach the bridge.
  function pageErrors() {
    let raw = null;
    const on = (e) => { raw = e.detail; };
    document.addEventListener("pinpoint:context-result", on, { once: true });
    document.dispatchEvent(new CustomEvent("pinpoint:context"));
    document.removeEventListener("pinpoint:context-result", on);
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v.slice(-20) : []; } catch { return []; }
  }

  // A small identity card for the element, so a pin can tell whether the node its selector now
  // matches is really the thing the developer clicked. On pages that rebuild themselves with
  // innerHTML, a positional selector can otherwise silently point at a different element.
  const FP_ATTRS = ["id", "name", "for", "value", "type", "placeholder", "aria-label",
                    "data-testid", "data-field", "data-action", "data-array", "data-component"];
  function fingerprint(el) {
    const attrs = {};
    for (const a of FP_ATTRS) {
      const v = el.getAttribute?.(a);
      if (v) attrs[a] = v.slice(0, 80);
    }
    return { tag: el.tagName.toLowerCase(), text: clip(el.textContent, 60), attrs, ctx: around(el) };
  }
  // The text next to the element, from the nearest of three ancestors that has any. An element the
  // agent renamed keeps its neighbours; a stranger re-rendered into the same spot (the next step's
  // chip, the next row) comes with new ones.
  // ponytail: first-occurrence removal of the element's own text; a sibling with the very same text
  // earlier on only makes this stricter.
  function around(el) {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const own = norm(el.textContent);
    for (let p = el.parentElement, i = 0; p && i < 3; p = p.parentElement, i++) {
      const t = norm(norm(p.textContent).replace(own, " "));
      if (t) return t.slice(0, 120);
    }
    return "";
  }
  // Same spot, same kind, same attributes, same neighbours: the element itself, only its text has
  // changed. Used only where the selector already points at it — never to go looking elsewhere.
  function renamed(el, fp) {
    if (!fp?.ctx || !el || el.tagName.toLowerCase() !== fp.tag) return false;
    if (!Object.keys(fp.attrs).every((k) => (el.getAttribute(k) || "") === fp.attrs[k])) return false;
    return around(el) === fp.ctx;
  }
  function fingerprintMatches(el, fp) {
    if (!fp || !el || el.tagName.toLowerCase() !== fp.tag) return false;
    const keys = Object.keys(fp.attrs);
    if (keys.length) return keys.every((k) => (el.getAttribute(k) || "") === fp.attrs[k]);
    return clip(el.textContent, 60) === fp.text;
  }
  // Selector first; if it lands on something else, look for the real element by identity.
  function findElement(selector, fp) {
    const bySelector = safeQuery(selector);
    if (!fp) return bySelector;
    if (bySelector && (fingerprintMatches(bySelector, fp) || renamed(bySelector, fp))) return bySelector;
    let found = null;
    try {
      for (const el of document.getElementsByTagName(fp.tag)) {
        if (isOurs(el) || !fingerprintMatches(el, fp)) continue;
        if (found) return null; // ambiguous: better no pin than a wrong one
        found = el;
      }
    } catch {}
    return found;
  }

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls = stableClasses(el).map((c) => `.${c}`).join("");
    const r = el.getBoundingClientRect();
    return `${tag}${id}${cls}  ${Math.round(r.width)}×${Math.round(r.height)}`;
  }

  function clip(s, n) {
    s = (s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  // ---------- highlight ----------
  function moveHighlight(el, cls) {
    if (!el) {
      ui.hl.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(ui.hl.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    ui.hl.className = "hl " + (cls || "");
    ui.tag.classList.toggle("below", r.top < 26);
    ui.tag.textContent = describe(el);
  }

  // ---------- the dock ----------
  // A quiet, always-there marker that Pinpoint is live in this tab, doubling as the on/off switch
  // so you don't have to reach for the keyboard for every note.
  let bridgeOk = false, bridgeCode = null, dockHidden = false, pendingResume = false, unread = false;
  // The bridge was up recently — so being down now is an interruption worth a pill, not a sign that
  // Pinpoint is installed and unused (which should leave your pages alone).
  let usedRecently = false;
  const RECENT_MS = 12 * 3600 * 1000;
  const HIDE_KEY = "hideDock:" + location.origin;

  // A page whose <html> or <body> carries a transform/filter/will-change becomes the containing
  // block for our fixed bar, so "bottom: 16px" stops meaning the bottom of the window. Measure
  // where it actually landed and nudge it back onto the viewport.
  function keepDockOnScreen() {
    if (!isTop || ui.dock.style.display !== "flex") return;
    ui.dock.style.transform = "none";
    const r = ui.dock.getBoundingClientRect();
    if (!r.width) return;
    const vw = window.innerWidth, vh = window.innerHeight, M = 16;
    const pos = ui.dock.className;
    let wantLeft = /pos-br|pos-tr/.test(pos) ? vw - M - r.width : M;
    let wantTop = /pos-tl|pos-tr/.test(pos) ? M : vh - M - r.height;
    // Dragged somewhere: the same fraction of the free space, so a resize keeps it in proportion and
    // never off-screen.
    if (freePos) {
      wantLeft = 8 + freePos.fx * Math.max(0, vw - r.width - 16);
      wantTop = 8 + freePos.fy * Math.max(0, vh - r.height - 16);
    }
    const dx = Math.round(wantLeft - r.left), dy = Math.round(wantTop - r.top);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) ui.dock.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // ---------- moving the bar ----------
  // Drag it anywhere on the page and it stays there on this site. Stored as a fraction of the free
  // space rather than pixels, so a narrower window keeps it on screen and in proportion. The popup's
  // corner setting puts it back in a corner.
  const POS_KEY = "dockXY:" + location.origin;
  let freePos = null;
  function applyFree() { ui.dock.classList.add("free"); ui.dock.style.left = "0px"; ui.dock.style.top = "0px"; }
  function clearFree() { freePos = null; ui.dock.classList.remove("free"); ui.dock.style.left = ""; ui.dock.style.top = ""; }
  let drag = null, dragJustEnded = false;
  // Move and up are watched on the window for the length of the press: a quick drag leaves the bar
  // within a few pixels, and the bar would never hear about it. Capture only starts once it really
  // is a drag — capturing on press would retarget the click and the toggle would never get it.
  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 5) return;   // a click that wobbled, not a drag
      drag.moved = true;
      try { ui.dock.setPointerCapture(drag.id); } catch {}
      ui.dock.classList.add("dragging");
      clearTimeout(miniTimer);
      ui.dock.classList.remove("mini");
    }
    e.preventDefault();
    const M = 8, vw = window.innerWidth, vh = window.innerHeight, w = drag.r.width, h = drag.r.height;
    const x = Math.min(Math.max(M, drag.r.left + dx), vw - w - M);
    const y = Math.min(Math.max(M, drag.r.top + dy), vh - h - M);
    freePos = { fx: (x - M) / Math.max(1, vw - w - 2 * M), fy: (y - M) / Math.max(1, vh - h - 2 * M) };
    applyFree();
    keepDockOnScreen();
  }
  async function onDragEnd(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    window.removeEventListener("pointermove", onDragMove, true);
    window.removeEventListener("pointerup", onDragEnd, true);
    window.removeEventListener("pointercancel", onDragEnd, true);
    if (!moved) return;
    ui.dock.classList.remove("dragging");
    dragJustEnded = true;
    setTimeout(() => (dragJustEnded = false), 0);
    try { await chrome.storage.local.set({ [POS_KEY]: freePos }); } catch {}
  }
  ui.dock.addEventListener("pointerdown", (e) => {
    if (!e.isTrusted || e.button !== 0 || picking) return;
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, r: ui.dock.getBoundingClientRect(), moved: false };
    window.addEventListener("pointermove", onDragMove, true);
    window.addEventListener("pointerup", onDragEnd, true);
    window.addEventListener("pointercancel", onDragEnd, true);
  });
  // Letting go fires a click on whatever is under the pointer; that is the end of a drag, not a press.
  ui.dock.addEventListener("click", (e) => { if (dragJustEnded) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);

  // ---------- agent presence ----------
  // The bridge reports what the coding agent last did; the bar shows it the way a shared document
  // shows the other person's cursor, so you can see your notes being worked on.
  let agentState = null, agentTimer = 0;
  function setAgent(a) {
    const known = agentState?.at;
    agentState = a;
    paintAgent();
    clearTimeout(agentTimer);
    if (a) agentTimer = setTimeout(paintAgent, 26000);
    // a resolve is worth calling out, and worth flashing the pin it belongs to
    // A finished note is announced from the replies themselves (loadReplies), with what the agent
    // said — not from this presence ping, which only knew that *something* was resolved.
    void known;
    if (a && a.id && a.action === "look") {
      const p = pins.find((x) => x.id === a.id);
      if (p) { p.node.classList.add("watched"); setTimeout(() => p.node.classList.remove("watched"), 2600); }
    }
  }
  // Agents identify themselves in the MCP handshake ("claude-code", "cursor-vscode", "codex"…).
  // Naming the one that is actually working is the whole point of connecting more than one.
  const agentName = (a) => a?.name || "Your coding agent";
  function paintAgent() {
    if (!isTop) return;
    const live = !!agentState && (agentState.secondsAgo ?? 999) < 25 && Date.now() - agentState.seenAt < 26000;
    ui.dock.classList.toggle("agent-live", live);
    ui.agentSay.textContent = live ? `${agentState.name ? agentState.name + " · " : ""}${agentState.label || "working"}` : "";
    ui.who.title = live ? `${agentName(agentState)} is ${agentState.label || "working"}` : "You";
    if (live) { clearTimeout(miniTimer); ui.dock.classList.remove("mini"); }
  }

  let miniTimer = 0;
  function expandDock(ms = 4000) {
    ui.dock.classList.remove("mini");
    clearTimeout(miniTimer);
    if (!picking && !recording) miniTimer = setTimeout(() => ui.dock.classList.add("mini"), ms);
  }

  function paintDock() {
    if (!isTop) return;
    ui.dock.classList.toggle("armed", picking);
    ui.dockToggle.setAttribute("aria-pressed", String(picking));
    ui.dock.classList.toggle("recording", recording);
    ui.recN.textContent = String(recN);
    if (picking || recording) { clearTimeout(miniTimer); ui.dock.classList.remove("mini"); }
    else if (!ui.dock.classList.contains("mini")) expandDock();
    // While armed the Stop button carries the Esc affordance, so the hint just names the action.
    ui.dockHint.replaceChildren(picking ? "Click any element" : elt("kbd", null, MAC ? "\u2325\u21e7A" : "Alt+Shift+A"));
    // The counter is the ONLY way into the notes panel. Hiding it at zero pending meant that the
    // moment an agent finished everything, its replies became unreachable — the note looked simply
    // deleted. Keep the door open while there is anything to read.
    const pend = pins.length, done = replies.length;
    ui.dockCountN.textContent = String(pend || done);
    ui.dockCountWord.textContent = pend ? (pend === 1 ? "note" : "notes") : "done";
    ui.dockCount.classList.toggle("only-done", !pend && done > 0);
    ui.dockCount.title = pend ? "Notes on this page" : "What your agent finished here";
    paintAgent();
    ui.dockCount.style.display = pend || done ? "inline-flex" : "none";
    ui.dockCount.classList.toggle("unread", unread);
    const drafts = pins.filter((p) => p.status === "draft").length;
    ui.dock.classList.toggle("has-drafts", drafts > 0);
    ui.dockDraftsN.textContent = String(drafts);
    // Bridge down used to mean no bar at all — the one moment you needed a way back. Now the bar
    // stays, as a small pill that starts it.
    ui.dock.classList.toggle("offline", !bridgeOk);
    ui.dockStartLabel.textContent = bridgeCode === "token" ? "Bridge needs its token" : "Bridge off · Start";
    ui.dock.style.display = !dockHidden && (bridgeOk || usedRecently) ? "flex" : "none";
    requestAnimationFrame(keepDockOnScreen);
  }

  async function refreshDock() {
    if (!isTop) return;
    try {
      const h = await chrome.runtime.sendMessage({ type: "health" });
      bridgeOk = !!h?.ok;
      bridgeCode = h?.code || null;
    } catch { bridgeOk = false; bridgeCode = null; }
    try {
      if (bridgeOk) { usedRecently = true; await chrome.storage.local.set({ lastBridgeAt: Date.now() }); }
      else usedRecently = bridgeCode === "token" || Date.now() - ((await chrome.storage.local.get({ lastBridgeAt: 0 })).lastBridgeAt || 0) < RECENT_MS;
    } catch {}
    try {
      const v = await chrome.storage.local.get([HIDE_KEY, POS_KEY]);
      dockHidden = !!v[HIDE_KEY];
      const fp = v[POS_KEY];
      if (fp && Number.isFinite(fp.fx) && Number.isFinite(fp.fy)) { freePos = fp; applyFree(); }
      else if (!drag) clearFree();
    } catch {}
    try {
      const { dockPos } = await chrome.storage.sync.get({ dockPos: "tr" });
      ui.dock.classList.remove("pos-br", "pos-tl", "pos-tr");
      if (dockPos !== "bl") ui.dock.classList.add("pos-" + dockPos);
    } catch {}
    paintDock();
  }

  ui.dock.addEventListener("mouseenter", () => { clearTimeout(miniTimer); ui.dock.classList.remove("mini"); });
  ui.dock.addEventListener("mouseleave", () => { if (!picking) expandDock(1200); });
  ui.dockToggle.addEventListener("click", (e) => { e.stopPropagation(); togglePicking(); });
  ui.dockStop.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); stopPicking(); });
  ui.dockCount.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });
  ui.dockDrafts.addEventListener("click", (e) => { e.stopPropagation(); sendDrafts(); });
  ui.dockPage.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); notePage(); });
  ui.recStart.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); if (e.isTrusted) startRecording(); });
  ui.recDone.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); if (e.isTrusted) finishRecording(); });
  async function sendDrafts() {
    const r = await chrome.runtime.sendMessage({ type: "sendDrafts", url: location.href.split("#")[0] }).catch(() => null);
    if (!r || r.error) return toast("Not sent — the bridge isn't answering");
    toast(`Sent ${r.sent} draft${r.sent === 1 ? "" : "s"} to your agent`);
    loadPins();
  }
  ui.dockStart.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (bridgeCode === "token") return toast("Open the Pinpoint toolbar popup and paste the bridge token — once", 5000);
    ui.dockStart.classList.add("busy");
    toast("Starting the bridge…", 6000);
    const r = await startBridge();
    ui.dockStart.classList.remove("busy");
    if (r?.ok) { toast("Bridge started"); await refreshDock(); loadPins(); return; }
    toast(await whyNoStart(r), 7000);
  });
  // The launcher may be missing (a first run, Safari): say exactly what to run instead.
  const startBridge = () => chrome.runtime.sendMessage({ type: "startBridge" }).catch(() => null);
  async function whyNoStart(r) {
    let cli = "<pinpoint>/bridge/cli.js";
    try { cli = (await chrome.storage.local.get({ cliPath: null })).cliPath || cli; } catch {}
    return r?.code === "no_host" || r?.code === "no_node"
      ? `Start it in a terminal: node ${cli} — or run install-native-host once to make this button work`
      : r?.code === "unsupported" ? `Start it in a terminal: node ${cli}` : (r?.error || "The bridge did not start — start it in a terminal");
  }
  ui.dockRestart.addEventListener("click", async (e) => {
    e.stopPropagation();
    ui.dockRestart.classList.add("busy");
    toast("Restarting the bridge…", 6000);
    const r = await chrome.runtime.sendMessage({ type: "restartBridge" }).catch(() => null);
    ui.dockRestart.classList.remove("busy");
    toast(r?.ok ? "Bridge restarted" : "The bridge did not come back — start it in a terminal");
    refreshDock();
    loadPins();
  });
  ui.dockClose.addEventListener("click", async (e) => {
    e.stopPropagation();
    dockHidden = true;
    paintDock();
    try { await chrome.storage.local.set({ [HIDE_KEY]: true }); } catch {}
    toast("Hidden on this site — the toolbar icon still works");
  });

  let toastTimer = 0, toastMs = 0;
  const armToast = () => { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, toastMs); };
  function hideToast() { clearTimeout(toastTimer); ui.toast.style.display = "none"; }
  function toast(msg, ms = 2200, onClick = null) {
    ui.toast.className = "toast";
    ui.toast.textContent = msg;
    ui.toast.style.display = "block";
    ui.toast.classList.toggle("action", !!onClick);
    ui.toast.onclick = onClick ? () => { hideToast(); onClick(); } : null;
    toastMs = ms;
    armToast();
  }
  // Something you might be reading or reaching for does not vanish under the pointer.
  ui.toast.addEventListener("mouseenter", () => clearTimeout(toastTimer));
  ui.toast.addEventListener("mouseleave", () => { if (ui.toast.style.display !== "none") armToast(); });

  // "#3 done": the agent's reply, and the two things you might say to it. Accept closes the loop;
  // Not quite opens the reopen box on that note. Clicking the text opens the panel, as before.
  function doneCard(a, more) {
    toast("", 10000, () => togglePanel(true));
    ui.toast.classList.replace("action", "card");
    ui.toast.innerHTML = `<span class="tm"></span><button class="ok">Accept</button><button class="nq">Not quite</button>`;
    ui.toast.querySelector(".tm").textContent = `#${a.number} done — ${clip(a.resolution || "marked done", 90)}${more}`;
    ui.toast.querySelector(".ok").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!e.isTrusted) return;
      hideToast();
      const r = await chrome.runtime.sendMessage({ type: "accept", id: a.id }).catch(() => null);
      if (!r || r.error || r.ok === false) toast("Not accepted — the bridge isn't answering");
    });
    ui.toast.querySelector(".nq").addEventListener("click", (e) => {
      e.stopPropagation();
      if (!e.isTrusted) return;
      hideToast();
      reopen(a.id);
    });
    ui.toast.style.display = "flex";
  }
  async function reopen(id) {
    await togglePanel(true);
    [...ui.panelList.querySelectorAll(".item.done")].find((li) => li.dataset.id === id)?.querySelector(".follow")?.click();
  }

  // ---------- notes panel ----------
  function togglePanel(force) {
    const open = force !== undefined ? force : ui.panel.style.display !== "flex";
    ui.panel.style.display = open ? "flex" : "none";
    if (!open) { askedAfter.clear(); replies.forEach(requestAfter); return; }
    unread = false;
    paintDock();
    renderPanel(true);
    // Opening the panel is a request for the current state: an agent may have finished something
    // since the page loaded, and its reply is the whole point of looking.
    return loadReplies().then(() => { paintDock(); if (ui.panel.style.display === "flex") renderPanel(); });
  }
  ui.panelClose.addEventListener("click", () => togglePanel(false));

  // Something changing at the bridge (an agent at work, an after crop landing) re-renders the panel;
  // that must never throw away an answer you are in the middle of writing. `force`: you asked for it.
  const panelTyping = () => [...ui.panelList.querySelectorAll("form textarea")].some((t) => t.value.trim() || t === shadow.activeElement);
  function renderPanel(force = false) {
    if (!force && panelTyping()) return;
    ui.panelList.innerHTML = "";
    if (!pins.length && !replies.length) {
      ui.panelList.innerHTML = `<li class="empty">Nothing marked on this page yet. Turn on Pinpoint and click anything you want changed.</li>`;
      return;
    }
    // What needs you first: questions from the agent, then drafts you have not sent.
    const order = { waiting: 0, draft: 1 };
    const sorted = pins.slice().sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2));
    const draftCount = pins.filter((p) => p.status === "draft").length;
    if (draftCount) {
      const g = document.createElement("li");
      g.className = "group";
      g.innerHTML = `<span class="gl"></span><button class="send-all">Send all</button>`;
      g.querySelector(".gl").textContent = `${draftCount} draft${draftCount === 1 ? "" : "s"}, not sent`;
      g.querySelector(".send-all").addEventListener("click", (e) => { e.stopPropagation(); sendDrafts(); });
      ui.panelList.appendChild(g);
    }
    for (const p of sorted) {
      const li = document.createElement("li");
      li.className = "item" + (p.node.dataset.orphan === "1" ? " gone" : "") + (p.status === "draft" ? " draft" : p.status === "waiting" ? " waiting" : "");
      li.innerHTML = `<span class="n"></span><div class="body"><div class="c"></div><div class="s"></div></div><button class="x">&times;</button>`;
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.setAttribute("aria-label", `Show note ${p.number}: ${p.comment}`);
      // The row itself, not its × — Enter on that button must still press it.
      li.addEventListener("keydown", (e) => { if (e.target === li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); revealPin(p); } });
      const x = li.querySelector(".x");
      x.setAttribute("aria-label", `Remove note ${p.number}`);
      x.addEventListener("click", (e) => { e.stopPropagation(); deleteNote(p.id); });
      li.querySelector(".n").textContent = p.number;
      li.querySelector(".c").textContent = p.comment;
      li.querySelector(".s").replaceChildren(p.kind === "page" ? "the whole page"
        : p.kind === "flow" ? `a recorded flow · ${Number(p.steps) || 0} steps`
        : p.node.dataset.orphan === "1" ? elt("span", { class: "warn" }, "not on this view")
        : p.selector);
      appendThread(li.querySelector(".body"), p.thread);
      // The agent asked: the answer box is right here.
      if (p.status === "waiting") li.querySelector(".body").appendChild(answerForm(p.id, "Your answer", "Answer"));
      li.addEventListener("click", (e) => { if (!e.target.closest("form")) revealPin(p); });
      ui.panelList.appendChild(li);
    }

    // A note used to simply vanish when the agent finished it, so you never saw what it did.
    // It stays here instead, with the agent's own answer underneath.
    if (!replies.length) return;
    const head = document.createElement("li");
    head.className = "group";
    // Name who actually did it when they all agree; otherwise the per-item labels below say it.
    const names = [...new Set(replies.map((a) => a.resolvedBy).filter(Boolean))];
    head.innerHTML = `<span class="gl"></span><button class="clear-done">Clear done</button>`;
    head.querySelector(".gl").textContent = names.length === 1 ? `Done by ${names[0]} (${replies.length})` : `Done by your agent (${replies.length})`;
    head.querySelector(".clear-done").addEventListener("click", async () => {
      const done = replies.slice();
      const results = await Promise.all(done.map((a) => chrome.runtime.sendMessage({ type: "delete", id: a.id }).catch(() => null)));
      if (results.some((r) => !r || r.error)) toast("Some notes were not removed — the bridge isn't answering");
      await loadReplies();
      paintDock();
      renderPanel(true);
    });
    ui.panelList.appendChild(head);

    for (const a of replies) {
      const li = document.createElement("li");
      li.className = "item done";
      li.dataset.id = a.id;
      li.innerHTML = `<span class="n"></span><div class="body"><div class="c"></div><div class="reply"><span class="who"></span><span class="what"></span></div></div><button class="x">&times;</button>`;
      const x = li.querySelector(".x");
      x.setAttribute("aria-label", `Remove done note ${a.number}`);
      x.addEventListener("click", async (e) => {
        e.stopPropagation();
        const r = await chrome.runtime.sendMessage({ type: "delete", id: a.id }).catch(() => null);
        if (!r || r.error) return toast("Not removed — the bridge isn't answering");
        await loadReplies();
        paintDock();
        renderPanel(true);
      });
      li.querySelector(".n").textContent = a.number;
      li.querySelector(".c").textContent = a.comment;
      li.querySelector(".who").textContent = (a.resolvedBy || "agent") + (a.acceptedAt ? " · accepted" : "");
      const what = li.querySelector(".what");
      if (a.resolution) what.textContent = a.resolution;
      else {
        what.textContent = "marked done without a note";
        li.querySelector(".reply").classList.add("none");
      }
      if (a.after?.screenshot) li.querySelector(".body").appendChild(beforeAfter(a));
      else requestAfter(a);
      // Not what you meant? Say so here: the note reopens with this conversation attached.
      const follow = document.createElement("button");
      follow.className = "follow";
      follow.textContent = "Reply…";
      follow.addEventListener("click", (e) => {
        e.stopPropagation();
        follow.replaceWith(answerForm(a.id, "Not quite? Say what is still wrong — the note reopens", "Reopen"));
        li.querySelector("form textarea")?.focus();
      });
      li.querySelector(".body").appendChild(follow);
      ui.panelList.appendChild(li);
    }
  }

  // The list carries no pixels; the pictures come per note, once, and are kept for this page.
  // ponytail: a page whose CSP forbids data: images shows empty frames here.
  const askedAfter = new Set(), shots = new Map();
  // Its tab was most likely not in front when the agent finished; it is now. Asked when the done
  // card shows, when the panel shows the note, and once more when the panel closes — the panel
  // itself may have been in front of the element (then the page answers "busy" and nothing blinks).
  function requestAfter(a) {
    if (a.after || askedAfter.has(a.id)) return;
    askedAfter.add(a.id);
    chrome.runtime.sendMessage({ type: "after", id: a.id }).catch(() => {});
  }
  const png = (x) => (typeof x?.base64 === "string" && /^[A-Za-z0-9+/=]+$/.test(x.base64) ? "data:image/png;base64," + x.base64 : null);
  function beforeAfter(a) {
    const box = document.createElement("div");
    box.className = "ba";
    box.innerHTML = `<figure><img alt="Before"><figcaption>Before</figcaption></figure><figure><img alt="After"><figcaption>After</figcaption></figure>`;
    const [bi, ai] = box.querySelectorAll("img");
    const key = a.id + ":" + a.after.at;
    const paint = (s) => { if (s.before) bi.src = s.before; else bi.parentNode.remove(); ai.src = s.after; };
    if (shots.has(key)) paint(shots.get(key));
    else chrome.runtime.sendMessage({ type: "get", id: a.id }).then((r) => {
      const after = png(r?.annotation?.after?.screenshot);
      if (!after) return;
      const s = { before: png(r.annotation.screenshot), after };
      shots.set(key, s);
      paint(s);
    }).catch(() => {});
    return box;
  }

  // The conversation on a note, oldest first: what the agent asked or said, and what you answered.
  function appendThread(body, thread = []) {
    for (const m of thread) {
      const d = document.createElement("div");
      d.className = m.by === "you" ? "mine" : "ask";
      const b = document.createElement("b");
      b.textContent = m.by === "you" ? "You" : (m.name || "Your agent") + (m.kind === "resolution" ? " (done)" : "");
      d.append(b, document.createTextNode(m.text));
      body.appendChild(d);
    }
  }
  function answerForm(id, placeholder, label) {
    const f = document.createElement("form");
    f.innerHTML = `<textarea rows="2"></textarea><div class="fr"><button type="submit" class="go"></button></div>`;
    const ta = f.querySelector("textarea"), go = f.querySelector(".go");
    ta.placeholder = placeholder;
    ta.setAttribute("aria-label", placeholder);
    go.textContent = label;
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); f.requestSubmit(); }
    });
    ["keyup", "keypress", "input"].forEach((t) => ta.addEventListener(t, (e) => e.stopPropagation()));
    f.addEventListener("click", (e) => e.stopPropagation());
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return ta.focus();
      go.disabled = true;
      const r = await chrome.runtime.sendMessage({ type: "answer", id, text }).catch(() => null);
      go.disabled = false;
      if (!r || r.error || r.ok === false) return toast("Not sent — the bridge isn't answering");
      toast("Sent to your agent");
      await loadPins();
      renderPanel(true);
    });
    return f;
  }

  function revealPin(p) {
    if (p.kind === "page" || p.kind === "flow") return;
    const el = p.el && p.el.isConnected ? p.el : findElement(p.selector, p.fp);
    if (!el) return toast("That element isn't on the page right now");
    // The CSS media query cannot reach this one — jumping to a note must respect the setting too.
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
    setTimeout(() => {
      moveHighlight(el, "flash");
      ui.hl.classList.add("flash");
      setTimeout(() => { ui.hl.classList.remove("flash"); if (!selected) moveHighlight(null); }, 1000);
    }, 260);
  }

  // ---------- picker ----------
  // Frames each run their own copy of this script, so picking has to be told to all of them — or an
  // element in an iframe could be clicked while the top frame thought it had stopped. `fromMirror`
  // is the message coming back; it must not be sent on again.
  // The worker sends this to every frame of the tab, which includes this one. Ours comes back after
  // whatever happened since: on a slow machine "picking on" arrived after the click that turned it
  // off, and picking came back over the comment box. A frame never takes its own echo.
  const frameKey = Math.random().toString(36).slice(2);
  const mirror = (on) => { try { chrome.runtime.sendMessage({ type: "mirrorPicking", picking: on, src: frameKey }); } catch {} };
  function startPicking(fromMirror = false) {
    if (picking) return;
    // The shortcut while a comment is half-written would otherwise wipe it without a word. Once the
    // offline fallback has put it on the clipboard it is safe, and moving on is fine.
    if (ui.pop.style.display === "block" && ui.text.value.trim() && !ui.pop.dataset.saved) {
      setStatus("Send or discard this note first (Esc twice)", "err");
      ui.text.focus();
      return;
    }
    picking = true;
    document.documentElement.classList.add("pinpoint-picking");
    paintDock();
    hidePopover();
    if (!fromMirror) mirror(true);
  }
  function stopPicking(fromMirror = false) {
    const was = picking;
    picking = false;
    hovered = null;
    if (dragFrom) swallowAfterUp = true;   // the button is still down; its release must not click the page
    dragFrom = null; dragging = false;
    ui.marquee.style.display = "none";
    pendingResume = false;
    document.documentElement.classList.remove("pinpoint-picking");
    paintDock();
    if (!selected) moveHighlight(null);
    if (was && !fromMirror) mirror(false);
  }
  function togglePicking() {
    picking ? stopPicking() : startPicking();
  }

  function targetFromEvent(e) {
    const path = e.composedPath ? e.composedPath() : [e.target];
    for (const n of path) {
      if (n && n.nodeType === 1 && !isOurs(n) && n !== document.documentElement && n !== document.body) return n;
    }
    return null;
  }

  let hoverTimer = 0;
  document.addEventListener("mousemove", (e) => {
    if (!picking || !e.isTrusted) return;
    const t = targetFromEvent(e);
    if (t && t !== hovered) {
      hovered = t;
      moveHighlight(t);
      // Walking framework internals is too costly for every mousemove, so the component name
      // is filled in once the pointer settles.
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        if (!picking || hovered !== t) return;
        const c = sourceHint(t).components[0];
        if (c && hovered === t) {
          const b = document.createElement("b");
          b.textContent = `<${c}>`;
          ui.tag.replaceChildren(b, document.createTextNode("  " + describe(t)));
        }
      }, 90);
    }
  }, true);

  document.addEventListener("click", (e) => {
    // A drag ends with pointerup, which already stopped picking — so the click the browser fires
    // straight after it would otherwise land on the page and follow whatever link sat under the box.
    if (!e.isTrusted) return;    // a page script "clicking" must never pick, or eat a real click
    if (performance.now() < swallowClickUntil) {
      swallowClickUntil = 0;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (!picking) return;
    const t = targetFromEvent(e);
    if (!t) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    pickElement(t, e.clientX, e.clientY);
  }, true);

  function pickElement(t, x, y) {
    setPickChain(x, y, t);
    selected = t;
    stopPicking();
    moveHighlight(t, "selected");
    openPopover(t);
  }

  // Keyboard picking: Tab moves the highlight with focus, the arrows walk the tree from wherever it
  // is, Enter takes it. Nothing about choosing an element should need a mouse.
  const pickable = (n) => n && n.nodeType === 1 && !isOurs(n) && n !== document.documentElement && n !== document.body;
  function hoverTo(n) {
    if (!pickable(n)) return;
    hovered = n;
    moveHighlight(n);
    n.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }
  document.addEventListener("focusin", (e) => {
    if (!picking || !e.isTrusted) return;
    if (pickable(e.target)) { hovered = e.target; moveHighlight(e.target); }
  }, true);

  // ---------- region selection ----------
  // Click takes one element; drag takes an area. A box has no element of its own, so it is
  // anchored to the deepest element that fully contains it — which is what lets the pin re-find
  // itself after a re-render, exactly as an element pin does, and gives the agent a real
  // container to edit rather than four loose coordinates.
  let selectedRegion = null;
  let dragFrom = null, dragging = false;
  // A timestamp, not a flag: a flag left set by a drag whose click never came would eat the next
  // real click on the page, however much later that is.
  let swallowClickUntil = 0, swallowAfterUp = false;

  const boxOf = (a, b) => ({
    left: Math.min(a.x, b.x), top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
  });

  // What did the box ENCLOSE? — not what encloses the box.
  //
  // Two earlier rules were wrong, both reproduced in test/site/region.html:
  //   1. "the deepest element that fully CONTAINS the box" — nobody drags pixel-perfect, so a box
  //      drawn generously around a card is contained by no card and the search reached <main>.
  //   2. "the outermost element that is ≥60% covered" — a short page container is itself mostly
  //      covered, and being outermost it swallowed the card inside it.
  //
  // The rule that holds: the SMALLEST element that accounts for at least half the box. Share is
  // measured against the box, so a candidate must already be about the size of what was drawn —
  // which rules out incidental slivers — and taking the smallest such element keeps the most
  // specific one. Span three cards and no single card reaches half, so their grid wins instead.
  function anchorFor(box) {
    const bx2 = box.left + box.width, by2 = box.top + box.height;
    const boxArea = box.width * box.height || 1;
    const shareOfBox = (r) => {
      const w = Math.min(r.right, bx2) - Math.max(r.left, box.left);
      const h = Math.min(r.bottom, by2) - Math.max(r.top, box.top);
      return w > 0 && h > 0 ? (w * h) / boxArea : 0;
    };

    let best = null, bestArea = Infinity;
    let fallback = null, fallbackShare = 0;
    for (const el of document.body.querySelectorAll("*")) {
      if (isOurs(el)) continue;
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (area < 100) continue;                       // hairlines and empty wrappers
      const share = shareOfBox(r);
      if (share > fallbackShare) { fallbackShare = share; fallback = el; }
      if (share >= 0.5 && area < bestArea) { best = el; bestArea = area; }
    }
    return best || fallback || document.body;
  }

  // The outermost elements wholly inside the box — what the region actually contains, without
  // listing every descendant of every card.
  function containedIn(anchor, box, limit = 12) {
    const out = [];
    for (const el of anchor.querySelectorAll("*")) {
      if (out.length >= limit) break;
      if (isOurs(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left >= box.left - 1 && r.top >= box.top - 1 &&
          r.right <= box.left + box.width + 1 && r.bottom <= box.top + box.height + 1 &&
          !out.some((o) => o.contains(el))) out.push(el);
    }
    return out;
  }

  // Pointer events, not mouse events: the suppression block below preventDefaults pointerdown,
  // and per spec that cancels the compatibility mousedown/mouseup/click that would otherwise
  // follow — so a mousedown listener here would never fire at all.
  document.addEventListener("pointerdown", (e) => {
    if (!picking || !e.isTrusted || isOurs(e.target)) return;
    dragFrom = { x: e.clientX, y: e.clientY };
    dragging = false;
  }, true);

  document.addEventListener("pointermove", (e) => {
    if (!picking || !dragFrom || !e.isTrusted) return;
    const to = { x: e.clientX, y: e.clientY };
    if (!dragging && Math.hypot(to.x - dragFrom.x, to.y - dragFrom.y) < 6) return;
    dragging = true;
    ui.hl.style.display = "none";           // one selection idiom at a time
    const b = boxOf(dragFrom, to);
    Object.assign(ui.marquee.style, {
      display: "block", left: b.left + "px", top: b.top + "px",
      width: b.width + "px", height: b.height + "px",
    });
    ui.marqueeSize.textContent = `${Math.round(b.width)} × ${Math.round(b.height)}`;
  }, true);

  document.addEventListener("pointerup", (e) => {
    if (!e.isTrusted) return;
    if (swallowAfterUp) { swallowAfterUp = false; swallowClickUntil = performance.now() + 400; }
    if (!picking || !dragFrom) return;
    const from = dragFrom;
    dragFrom = null;
    if (!dragging) return;                  // a plain click — the click handler owns it
    dragging = false;
    ui.marquee.style.display = "none";
    const box = boxOf(from, { x: e.clientX, y: e.clientY });
    if (box.width < 12 || box.height < 12) return;   // a twitch, not a drag
    swallowClickUntil = performance.now() + 400;
    const anchor = anchorFor(box);
    const inside = containedIn(anchor, box);
    const ar = anchor.getBoundingClientRect();
    selected = anchor;
    selectedRegion = {
      x: Math.round(box.left + window.scrollX), y: Math.round(box.top + window.scrollY),
      width: Math.round(box.width), height: Math.round(box.height),
      // offset within the anchor, so the pin can be replaced after the DOM is rebuilt
      dx: Math.round(box.left - ar.left), dy: Math.round(box.top - ar.top),
      contains: inside.map((el) => ({ tag: el.tagName.toLowerCase(), selector: uniqueSelector(el), text: clip(el.innerText || "", 60) })),
    };
    stopPicking();
    setPickChain(box.left + box.width / 2, box.top + box.height / 2, anchor);
    moveHighlight(anchor, "selected");
    openPopover(anchor, selectedRegion);
  }, true);

  ["mousedown", "mouseup", "pointerdown", "pointerup"].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      if (picking && e.isTrusted && targetFromEvent(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true)
  );

  let escArmed = false;
  document.addEventListener("keydown", (e) => {
    if (!e.isTrusted) return;
    const took = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (picking && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      const cur = hovered && hovered.isConnected ? hovered : null;
      if (e.key === "Enter") {
        const t = cur || (pickable(document.activeElement) ? document.activeElement : null);
        if (t) { took(); const r = t.getBoundingClientRect(); return pickElement(t, r.left + r.width / 2, r.top + r.height / 2); }
      }
      if (cur) {
        const next = { ArrowUp: cur.parentElement, ArrowDown: cur.firstElementChild, ArrowLeft: cur.previousElementSibling, ArrowRight: cur.nextElementSibling }[e.key];
        if (e.key.startsWith("Arrow")) { took(); return hoverTo(next); }
      }
    }
    if (e.key === "Escape") {
      // Just after Send, picking is off only until the crop is taken; Esc then means "stay off".
      pendingResume = false;
      if (recording && !picking && ui.pop.style.display !== "block") { took(); return stopRecording(); }
      if (tipPinned && !picking && ui.pop.style.display !== "block") { took(); return hideTip(); }
      if (ui.panel.style.display === "flex" && !picking && ui.pop.style.display !== "block") { took(); return togglePanel(false); }
      if (picking) { took(); return stopPicking(); }
      if (ui.pop.style.display === "block") {
        took();
        // Don't throw away typed text on a stray Esc.
        if (ui.text.value.trim() && !escArmed) {
          escArmed = true;
          setStatus("Press Esc again to discard", "err");
          return;
        }
        escArmed = false;
        return hidePopover();
      }
    }
    if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === "KeyA") {
      e.preventDefault();
      e.stopImmediatePropagation();
      togglePicking();
    }
  }, true);

  // ---------- popover ----------
  // A note about the page as a whole: anchored to <body>, cropped to what is on screen.
  let selectedPage = false;
  function notePage() {
    stopPicking();
    selected = document.body;
    selectedPage = true;
    pickChain = [document.body]; pickIndex = 0;
    openPopover(document.body);
  }

  // ---------- recording a flow ----------
  // "It breaks after I do this, then this": you click through the page as usual and each click is a
  // step. The worker keeps the steps per tab (storage.session), so a click that navigates keeps the
  // recording going on the next page. Clicks are never stopped — the page has to do what it does.
  // ponytail: top frame only; a click inside an iframe is not a step.
  async function startRecording() {
    stopPicking();
    const r = await chrome.runtime.sendMessage({ type: "recordStart" }).catch(() => null);
    if (!r?.ok) return toast("Can't record here — the extension isn't answering");
    recording = true; recN = 0;
    paintDock();
    toast("Recording — click through it, then Done. Esc throws it away", 3000);
  }
  function stopRecording() {
    recording = false;
    paintDock();
    chrome.runtime.sendMessage({ type: "recordStop" }).catch(() => {});
  }
  async function finishRecording() {
    recording = false;
    paintDock();
    const r = await chrome.runtime.sendMessage({ type: "recordStop", keep: true }).catch(() => null);
    const steps = Array.isArray(r?.steps) ? r.steps : [];
    if (!steps.length) return toast("No steps yet — click through the page, then Done");
    selected = document.body;
    selectedPage = true;
    flowSteps = steps;
    pickChain = [document.body]; pickIndex = 0;
    openPopover(document.body);
  }
  document.addEventListener("pointerdown", async (e) => {
    if (!recording || picking || !isTop || !e.isTrusted || e.button !== 0) return;
    const el = targetFromEvent(e);
    if (!el) return;   // our own bar, or the bare page
    // What you would say out loud: the thing, its label. Never an input's value — that is what you typed.
    const step = { selector: uniqueSelector(el), describe: describe(el), url: location.href, at: new Date().toISOString(),
                   text: clip(el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "", 80) };
    const capture = await captureRect(el);
    const r = await chrome.runtime.sendMessage({ type: "recordStep", step, capture }).catch(() => null);
    if (!recording) return;
    if (r?.n) { recN = r.n; paintDock(); }
    if (r?.full) toast("Ten steps is the most one note takes — press Done", 3000);
  }, true);
  // A navigation reloads this script; the recording is still the worker's.
  if (isTop) chrome.runtime.sendMessage({ type: "recordState" }).then((r) => {
    if (r?.recording) { recording = true; recN = r.n || 0; paintDock(); }
  }).catch(() => {});

  let returnFocus = null;
  function openPopover(el, region = null) {
    const prev = document.activeElement;
    returnFocus = prev && prev !== document.body && !isOurs(prev) ? prev : el;
    const r = region
      ? { left: region.x - window.scrollX, top: region.y - window.scrollY,
          right: region.x - window.scrollX + region.width, bottom: region.y - window.scrollY + region.height }
      : el.getBoundingClientRect();
    paintMeta(el, region);
    ui.text.value = "";
    ui.text.style.height = "";
    micAvailable();
    delete ui.pop.dataset.saved;
    ui.status.textContent = "";
    ui.status.className = "status";
    ui.pop.style.display = "block";
    const W = ui.pop.offsetWidth || 340, H = ui.pop.offsetHeight || 170, M = 8;
    let left = Math.max(M, Math.min(r.left, window.innerWidth - W - M));
    let top = r.bottom + M;
    if (top + H > window.innerHeight - M) top = Math.max(M, r.top - H - M);
    if (selectedPage) { left = Math.round((window.innerWidth - W) / 2); top = Math.max(M, Math.round(window.innerHeight * 0.18)); }
    Object.assign(ui.pop.style, { left: left + "px", top: top + "px" });
    ui.send.title = `Send to your coding agent (${K_SEND})`;
    ui.text.placeholder = region
      ? `What should change about this area? e.g. make these cards two-up on mobile — ${K_SEND} to send`
      : `What should change — how it looks or what it does? e.g. disable this until the form is valid — ${K_SEND} to send`;
    setTimeout(() => ui.text.focus(), 0);
  }
  // The elements under a point, innermost first — the same list devtools walks. Anything of ours is
  // excluded, and <html> is not a useful thing to annotate.
  function setPickChain(x, y, chosen) {
    const stack = (document.elementsFromPoint(x, y) || [])
      .filter((el) => el && el.nodeType === 1 && !isOurs(el) && el !== document.documentElement);
    pickChain = stack.length ? stack : chosen ? [chosen] : [];
    const i = pickChain.indexOf(chosen);
    if (i >= 0) pickIndex = i;
    else { pickChain = chosen ? [chosen, ...pickChain] : pickChain; pickIndex = 0; }
  }

  // What the popover says about the thing you picked. Split out of openPopover so retargeting can
  // repaint it without wiping whatever you have already typed.
  function paintMeta(el, region) {
    const hint = sourceHint(el);
    if (!hint.file && /^(react|vue)$/.test(hint.framework || "")) mapLookup(el);
    const comp = hint.components[0] ? [elt("b", null, `<${hint.components[0]}>`), " "] : [];
    const file = hint.file ? ` · ${hint.file}${hint.line ? ":" + hint.line : ""}` : "";
    if (flowSteps) {
      ui.meta.replaceChildren(elt("div", { class: "row" }, elt("b", null, "Recorded flow"), `${flowSteps.length} step${flowSteps.length === 1 ? "" : "s"}`), elt("ol", { class: "steps" }));
      const ol = ui.meta.querySelector(".steps");
      for (const st of flowSteps) { const li = document.createElement("li"); li.textContent = st.describe + (st.text ? ` “${st.text}”` : ""); ol.appendChild(li); }
      ui.scope.style.display = "none";
      return;
    }
    if (selectedPage) {
      ui.meta.replaceChildren(elt("div", { class: "row" }, elt("b", null, "This page"), clip(document.title || location.pathname, 60)),
        elt("div", { class: "picked" }, "A note about the whole page — the screenshot is what is on screen now"));
      ui.scope.style.display = "none";
      return;
    }
    const label = clip(el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "", 46);
    ui.meta.replaceChildren(...(region
      ? [elt("div", { class: "row" }, elt("b", null, "Region"), ` ${region.width}×${region.height} in ${describe(el)}${file}`),
         elt("div", { class: "picked" }, `${region.contains.length} element${region.contains.length === 1 ? "" : "s"} inside`)]
      : [elt("div", { class: "row" }, ...comp, describe(el) + file), label && elt("div", { class: "picked" }, `“${label}”`)]).filter(Boolean));
    const many = pickChain.length > 1;
    ui.scope.style.display = many ? "flex" : "none";
    ui.narrower.disabled = pickIndex <= 0;
    ui.wider.disabled = pickIndex >= pickChain.length - 1;
    ui.scopeHint.textContent = many ? `${pickIndex + 1}/${pickChain.length} · ⌥↑↓` : "";
  }

  // Clicking is a guess. On this page, a few pixels off the headline is the difference between a
  // 567×113 <h1> and the 1120×662 block holding the whole hero — with nothing in between. So keep
  // the stack under the click point and let it be corrected.
  function retarget(delta) {
    const next = pickIndex + delta;
    if (next < 0 || next >= pickChain.length) return;
    pickIndex = next;
    selected = pickChain[pickIndex];
    if (selectedRegion) {
      // The box stays where it was drawn; its offset is recorded inside whatever now anchors it.
      const ar = selected.getBoundingClientRect();
      selectedRegion.dx = Math.round(selectedRegion.x - window.scrollX - ar.left);
      selectedRegion.dy = Math.round(selectedRegion.y - window.scrollY - ar.top);
    }
    moveHighlight(selected, "selected");
    paintMeta(selected, selectedRegion);
  }

  function hidePopover() {
    stopDictation(true);
    selectedPage = false;
    flowSteps = null;
    const hadFocus = !!shadow.activeElement && ui.pop.contains(shadow.activeElement);
    if (hadFocus && returnFocus?.isConnected) { try { returnFocus.focus({ preventScroll: true }); } catch {} }
    returnFocus = null;
    selectedRegion = null;
    pickChain = []; pickIndex = 0;
    escArmed = false;
    ui.pop.style.display = "none";
    selected = null;
    moveHighlight(null);
  }
  ui.wider.addEventListener("click", (e) => { e.preventDefault(); retarget(1); ui.text.focus(); });
  ui.narrower.addEventListener("click", (e) => { e.preventDefault(); retarget(-1); ui.text.focus(); });
  ui.cancel.addEventListener("click", () => { hidePopover(); startPicking(); });
  ui.text.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit({ draft: e.shiftKey });
    }
    // Widen or narrow without leaving the keyboard. Alt is the modifier because the plain arrows
    // belong to the textarea.
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      retarget(e.key === "ArrowUp" ? 1 : -1);
    }
    e.stopPropagation();
  });
  ["keyup", "keypress", "input"].forEach((t) => ui.pop.addEventListener(t, (e) => e.stopPropagation()));
  ui.text.addEventListener("input", () => delete ui.pop.dataset.saved);   // edited since it was copied
  // Grows with what you write, from two lines to about ten, then scrolls.
  const fitText = () => { ui.text.style.height = "auto"; ui.text.style.height = Math.min(ui.text.scrollHeight + 2, 220) + "px"; };
  ui.text.addEventListener("input", fitText);
  // A dialog keeps Tab inside it; otherwise focus walks off into the page behind.
  ui.pop.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = [...ui.pop.querySelectorAll("textarea, button:not([disabled])")].filter((n) => n.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(shadow.activeElement);
    const next = e.shiftKey ? (i <= 0 ? f[f.length - 1] : f[i - 1]) : (i === f.length - 1 ? f[0] : f[i + 1]);
    e.preventDefault();
    next.focus();
  });
  ui.send.addEventListener("click", () => submit());
  ui.draft.addEventListener("click", () => submit({ draft: true }));
  ui.copy.addEventListener("click", async () => {
    if (!selected) return;
    const a = await buildAnnotation(selected, ui.text.value.trim());
    setStatus(...(await copyText(formatPrompt(a)) ? ["Copied prompt", "ok"] : ["This page does not allow copying", "err"]));
  });

  // ---------- dictation ----------
  // Looked up each time the popover opens, not at load. Chrome and Safari send the audio to their
  // own speech service (PRIVACY.md says so); Firefox's recognizer is not one we offer. Only a real
  // click starts it, so nothing scripted can open the microphone.
  let SR = null, rec = null;
  function micAvailable() {
    SR = !/Firefox\//.test(navigator.userAgent) && window.isSecureContext && typeof globalThis.webkitSpeechRecognition === "function"
      ? globalThis.webkitSpeechRecognition : null;
    ui.mic.classList.toggle("avail", !!SR);
  }
  // `now`: the popover is going away, so late results must not land in the next one.
  function stopDictation(now = false) {
    const r = rec;
    if (!r) return;
    if (now) { rec = null; ui.mic.setAttribute("aria-pressed", "false"); }
    try { r.stop(); } catch {}
  }
  const MIC_ERRORS = {
    "not-allowed": "Microphone blocked — allow it for this site from the address bar",
    "service-not-allowed": "Microphone blocked — allow it for this site from the address bar",
    "audio-capture": "No microphone found",
    "network": "Dictation needs the browser's speech service, which can't be reached",
    "no-speech": "Didn't hear anything",
  };
  ui.mic.addEventListener("click", (e) => {
    if (!e.isTrusted) return;
    if (rec) return stopDictation();
    if (!SR) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    const base = ui.text.value.replace(/\s+$/, "");
    let finals = "";
    r.onresult = (ev) => {
      if (rec !== r) return;
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0]?.transcript || "";
        if (ev.results[i].isFinal) finals += t; else interim += t;
      }
      ui.text.value = (base ? base + " " : "") + (finals + interim).trim();
      delete ui.pop.dataset.saved;
      fitText();
    };
    r.onerror = (ev) => { if (ev.error !== "aborted") setStatus(MIC_ERRORS[ev.error] || `Dictation stopped (${ev.error})`, "err"); };
    r.onend = () => {
      if (rec !== r) return;
      rec = null;
      ui.mic.setAttribute("aria-pressed", "false");
      if (ui.status.textContent === "Listening…") setStatus("");
    };
    rec = r;
    ui.mic.setAttribute("aria-pressed", "true");
    try { r.start(); setStatus("Listening…"); }
    catch { rec = null; ui.mic.setAttribute("aria-pressed", "false"); setStatus("Dictation could not start", "err"); }
    ui.text.focus();
  });

  function resumePicking() {
    if (!pendingResume) return;
    pendingResume = false;
    startPicking();
    toast(`${lastWasDraft ? "Saved as a draft" : "Sent ✓"} — still picking, Esc when you're done`, 1800);
  }

  function setStatus(msg, cls) {
    ui.status.textContent = msg;
    ui.status.className = "status " + (cls || "");
  }

  // ---------- annotation payload ----------
  // Where to crop, in top-document viewport coordinates. The worker takes the picture, so a page
  // that navigates the instant it sees "Sent ✓" still gets its screenshot.
  async function captureRect(el, override = null) {
    // A region crops to its own box; an element crops to the element.
    const r = override
      ? { left: override.x - window.scrollX, top: override.y - window.scrollY, width: override.width, height: override.height }
      : el.getBoundingClientRect();
    const off = await getFrameOffset();
    // The visible part only. Clamping just the origin kept the full height, so an element scrolled
    // half off the top was cropped with whatever sat below it.
    const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top);
    const rect = {
      x: x0 + off.x, y: y0 + off.y,
      width: Math.min(window.innerWidth, r.left + r.width) - x0,
      height: Math.min(window.innerHeight, r.top + r.height) - y0,
    };
    if (rect.width < 2 || rect.height < 2) return null;
    // Also send the rect in DOCUMENT space. The worker crops later, and if the page scrolled in
    // between, viewport coordinates point at whatever has moved into that spot — silently
    // producing a confident picture of the wrong thing. Document coordinates survive scrolling.
    const doc = isTop
      ? { x: r.left + window.scrollX + off.x, y: r.top + window.scrollY + off.y, width: r.width, height: r.height }
      : null;
    return { rect, dpr: window.devicePixelRatio || 1, doc };
  }

  // Which of our own things would be in a crop of `rect` (top-viewport px): "busy" for the panel or
  // the comment box, "passive" for the rest (pins, the bar, a toast), null for nothing. A frame
  // cannot see the top frame's overlay, so it always says "passive" and the worker hides everything.
  function uiInWay(rect) {
    if (!isTop) return "passive";
    let way = null;
    for (const n of shadow.querySelectorAll(".pin, .dock, .panel, .pop, .toast, .tip, .hl, .marquee")) {
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height || r.right < rect.x || r.left > rect.x + rect.width || r.bottom < rect.y || r.top > rect.y + rect.height) continue;
      if (n === ui.panel || n === ui.pop) return "busy";
      way = "passive";
    }
    return way;
  }

  // Our own overlay must not appear in the crop.
  let restoreTimer = 0;
  function hideOverlayForCapture() {
    // Synchronous: the message must go out in this same tick, so that a page which navigates
    // immediately afterwards has already handed the request to the worker.
    host.style.display = "none";
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(showOverlay, 8000); // safety net if the worker never answers
  }
  function showOverlay() {
    clearTimeout(restoreTimer);
    host.style.display = "";
  }

  async function buildAnnotation(el, comment, opts = {}) {
    const r = el.getBoundingClientRect();
    const a = {
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())).slice(0, 8),
      createdAt: new Date().toISOString(),
      comment,
      page: { url: location.href, title: document.title, viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 }, scroll: { x: window.scrollX, y: window.scrollY } },
      element: {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: [...el.classList],
        selector: uniqueSelector(el),
        domPath: domPath(el),
        text: clip(el.innerText || el.textContent, 200),
        outerHTML: clip(el.outerHTML, 600),
        attributes: pickAttributes(el),
        rect: { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) },
        styles: computedStyles(el),
        fingerprint: fingerprint(el),
      },
      source: sourceHint(el),
      screenshot: null,
    };
    // A region annotation is an element annotation on its anchor, plus the box. Everything
    // downstream — selector, fingerprint, pin re-finding, styles — keeps working unchanged.
    if (opts.region) a.region = opts.region;
    // Only React and Vue leave a component function to look up; anything else adds no await here.
    if (!a.source.file && /^(react|vue)$/.test(a.source.framework || "")) { try { await applyMapSource(el, a.source); } catch {} }
    const errors = pageErrors();
    if (errors.length) a.context = { errors };
    return a;
  }

  function formatPrompt(a) {
    const s = a.source || {};
    const lines = [
      `## Change request`,
      ``,
      `**Change:** ${a.comment || "(no comment)"}`,
      ``,
      `**Page:** ${a.page.url}`,
      `**Element:** \`${a.element.selector}\``,
      `**DOM path:** ${a.element.domPath}`,
    ];
    if (a.element.text) lines.push(`**Text:** "${a.element.text}"`);
    if (s.components?.length) lines.push(`**Component chain (${s.framework}):** ${s.components.join(" ← ")}`);
    if (s.file) lines.push(`**Source:** ${s.file}${s.line ? ":" + s.line : ""}${s.method === "sourcemap" ? " (via source map)" : ""}`);
    lines.push(`**Size:** ${a.element.rect.width}×${a.element.rect.height}px at viewport ${a.page.viewport.width}×${a.page.viewport.height}`);
    const st = Object.entries(a.element.styles).map(([k, v]) => `${k}: ${v}`).join("; ");
    if (st) lines.push(``, `**Computed styles:** ${st}`);
    lines.push(``, "```html", a.element.outerHTML, "```");
    return lines.join("\n");
  }

  let sending = false, lastWasDraft = false;
  async function submit({ draft = false } = {}) {
    if (!selected || sending) return;
    const comment = ui.text.value.trim();
    if (!comment) {
      setStatus("Write a comment first", "err");
      ui.text.focus();
      return;
    }
    const el = selected;
    stopDictation(true);
    sending = true;
    setStatus("Sending…");
    ui.send.disabled = true;
    try {
      const region = selectedRegion;
      const page = selectedPage, steps = flowSteps;
      // A page note is cropped to the window: the whole visible page, not the <body> box. Measured
      // before the note is built: a source-map lookup in there can take a moment, and the crop is of
      // what was on screen when Send was pressed (the worker skips it if the page scrolled since).
      const capture = await captureRect(el, page ? { x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight } : region);
      const a = await buildAnnotation(el, comment, region ? { region } : {});
      if (draft) a.status = "draft";
      if (page) a.kind = "page";
      if (steps) { a.kind = "flow"; a.steps = steps; }
      if (capture) hideOverlayForCapture();
      // The worker stores the comment first and answers immediately, then takes and attaches the
      // crop on its own. Nothing here is on the page's lifetime.
      const sendIt = () => chrome.runtime.sendMessage({ type: "submit", annotation: a, capture }).catch((e) => ({ error: String(e?.message || e) }));
      let res = await sendIt();
      if ((!res || res.error) && !/token/.test(res?.error || "")) {
        // Most often the bridge is simply not running. Where the launcher is installed, start it and
        // send once more — the note arrives instead of becoming a clipboard chore.
        setStatus("Starting the bridge…");
        if ((await startBridge())?.ok) { res = await sendIt(); refreshDock(); }
      }
      if (!res || res.error) { showOverlay(); throw new Error(res?.error || "no response"); }
      addPin({ id: a.id, number: res.number || pins.length + 1, selector: a.element.selector, comment, el, fp: a.element.fingerprint, region, fresh: true,
               status: draft ? "draft" : "pending", kind: a.kind || null, steps: steps?.length || 0 });
      pinsChangedHere();
      setStatus(draft ? "Saved as a draft" : "Sent ✓", "ok");
      lastWasDraft = draft;
      // The overlay stays hidden until the worker has taken its picture ("captureDone"), which
      // reads as the popover closing the moment you hit send.
      hidePopover();
      // Stay in picking mode so the next note is one click away — no shortcut, no toolbar trip.
      pendingResume = true;
      if (!capture) { showOverlay(); resumePicking(); }
    } catch (e) {
      showOverlay();
      // Bridge not running? Fall back to clipboard so nothing is lost.
      try {
        const a = await buildAnnotation(el, comment);
        if (!(await copyText(formatPrompt(a)))) throw new Error("the bridge is offline and this page does not allow copying");
        ui.pop.dataset.saved = "1";
        setStatus("Bridge offline — prompt copied to clipboard", "err");
      } catch {
        setStatus("Failed: " + (e.message || e), "err");
      }
    } finally {
      sending = false;
      ui.send.disabled = false;
    }
  }

  // ---------- pins ----------
  function addPin(p) {
    const node = document.createElement("div");
    node.className = "pin" + (p.status === "draft" ? " draft" : p.status === "waiting" ? " waiting" : "");
    node.textContent = p.number;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `Note ${p.number}: ${p.comment}`);
    node.tabIndex = -1;   // out of the page's own tab order; the panel is the keyboard route
    node.addEventListener("mouseenter", () => showTip(p, node));
    node.addEventListener("mouseleave", scheduleHideTip);
    node.addEventListener("click", (e) => {
      e.stopPropagation();
      if (tipPinned === p.id) return hideTip();
      tipPinned = p.id;
      showTip(p, node);
    });
    shadow.appendChild(node);
    if (p.fresh) {
      node.classList.add("new");
      setTimeout(() => node.classList.remove("new"), 400);
    }
    p.node = node;
    pins.push(p);
    positionAll();
    paintDock();
    if (ui.panel.style.display === "flex") renderPanel();
  }
  // What the pin can see, told to the bridge so the agent hears about it too. positionAll runs on
  // every scroll and mutation, so only transitions are reported — and only from the top frame, or
  // an iframe would report its own failure to find a top-document element.
  function reportState(p, state) {
    if (!isTop || p.reported === state) return;
    p.reported = state;
    try { chrome.runtime.sendMessage({ type: "elementState", id: p.id, state, url: location.href }); } catch {}
  }

  function positionPin(p, taken) {
    if (p.kind === "page" || p.kind === "flow") {
      // About the page, not an element: it lives at the window's top-left, below any others there.
      delete p.node.dataset.orphan;
      p.node.style.display = "block";
      let y = 24;
      if (taken) { while (taken.has("page:" + y)) y += 26; taken.add("page:" + y); }
      p.node.style.left = "24px";
      p.node.style.top = y + "px";
      return;
    }
    if (p.el && (!p.el.isConnected || (p.fp && !fingerprintMatches(p.el, p.fp) && !renamed(p.el, p.fp)))) p.el = null;
    const el = p.el || (p.el = findElement(p.selector, p.fp));
    if (!el) {
      p.node.style.display = "none";
      p.node.dataset.orphan = "1";
      reportState(p, "gone");
      return;
    }
    // Found, but its own selector now lands somewhere else: the pin is fine and the selector is
    // not, which is exactly the case that would edit the wrong node.
    reportState(p, safeQuery(p.selector) === el ? "ok" : "moved");
    delete p.node.dataset.orphan;
    const r = el.getBoundingClientRect();
    const visible = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    p.node.style.display = visible ? "block" : "none";
    // Several comments on one element would otherwise land on the same pixel, hiding all but the
    // last. Stack them downwards instead so each stays hoverable and removable.
    // A region pin belongs on the box's corner, not the anchor's — the anchor may be far larger
    // than the area that was marked. The offset was recorded inside the anchor, so it moves with it.
    const anchored = p.region
      ? { right: r.left + p.region.dx + p.region.width, top: r.top + p.region.dy }
      : { right: r.right, top: r.top };
    let x = Math.min(anchored.right, window.innerWidth - 14);
    let y = Math.max(12, anchored.top);
    if (taken) {
      const key = () => Math.round(x) + ":" + Math.round(y);
      let guard = 0;
      while (taken.has(key()) && guard++ < 20) y += 26;
      taken.add(key());
    }
    p.node.style.left = x + "px";
    p.node.style.top = y + "px";
  }
  function safeQuery(sel) {
    try {
      const hops = sel.split(" >>> ");
      let root = document, el = null;
      for (const hop of hops) {
        el = root.querySelector(hop);
        if (!el) return null;
        root = el.shadowRoot || el;
      }
      return el;
    } catch { return null; }
  }
  // A modal <dialog> or a fullscreen element sits in the top layer, above every z-index — including
  // ours — and makes the rest of the page inert. Living inside it is the only way to stay usable.
  function followTopLayer() {
    let top = document.fullscreenElement || null;
    if (!top) { try { top = document.querySelector("dialog:modal"); } catch {} }
    const parent = top || document.documentElement;
    if (parent && host.parentNode !== parent) parent.appendChild(host);
  }
  document.addEventListener("fullscreenchange", () => { followTopLayer(); repositionAll(); });
  function positionAll() {
    followTopLayer();
    keepDockOnScreen();
    const taken = new Set();
    pins.forEach((p) => positionPin(p, taken));
    if (selected) moveHighlight(selected, "selected");
  }
  let raf = 0;
  function repositionAll() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      positionAll();
    });
  }
  window.addEventListener("scroll", repositionAll, true);
  window.addEventListener("resize", repositionAll);
  new MutationObserver(repositionAll).observe(document.documentElement, { childList: true, subtree: true, attributes: true });

  let tipTimer = 0;
  function showTip(p, node) {
    clearTimeout(tipTimer);
    ui.tip.replaceChildren(elt("div", null, elt("span", { class: "num" }, `#${p.number}`), " " + p.comment), elt("button", { class: "del" }, "Remove this note"));
    ui.tip.querySelector(".del").onclick = () => deleteNote(p.id);
    ui.tip.style.display = "block";
    const r = node.getBoundingClientRect();
    ui.tip.style.left = Math.max(8, Math.min(r.left + 14, window.innerWidth - ui.tip.offsetWidth - 8)) + "px";
    ui.tip.style.top = r.bottom + 6 + "px";
    ui.tip.onmouseenter = () => clearTimeout(tipTimer);
    ui.tip.onmouseleave = scheduleHideTip;
  }
  function scheduleHideTip() {
    clearTimeout(tipTimer);
    if (tipPinned) return;
    tipTimer = setTimeout(() => (ui.tip.style.display = "none"), 250);
  }
  // A clicked pin keeps its tip open, so the comment can be read and removed without chasing a hover.
  let tipPinned = null;
  function hideTip() { tipPinned = null; ui.tip.style.display = "none"; }
  async function deleteNote(id) {
    const r = await chrome.runtime.sendMessage({ type: "delete", id }).catch((e) => ({ error: String(e?.message || e) }));
    if (!r || r.error) return toast("Not removed — the bridge isn't answering");
    removePin(id);
    hideTip();
  }
  function removePin(id) {
    const i = pins.findIndex((p) => p.id === id);
    if (i >= 0) {
      pins[i].node.remove();
      pins.splice(i, 1);
      pinsChangedHere();
      paintDock();
      if (ui.panel.style.display === "flex") renderPanel();
    }
  }
  // navigator.clipboard needs a secure context, and http://app.test is not one. The old route works
  // there: a selected textarea and execCommand. Ours lives in the shadow root, out of the page's way.
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    shadow.appendChild(ta);
    const prev = shadow.activeElement;
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    ta.remove();
    prev?.focus?.();
    return ok;
  }

  // DOM, not markup: whatever the page or the agent wrote stays text.
  function elt(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    e.append(...kids);
    return e;
  }

  // Re-render pending pins for this page on load (they live in the bridge, not the page).
  // Loads overlap (a focus, a visibility change and the worker's "reloadPins" can all land at once),
  // and a note can be sent or removed here while one is on its way. An answer that is older than
  // either must not repaint: it wiped the pin of a note sent a moment after the page opened.
  let pinLoads = 0, pinsLoading = false;
  const pinsChangedHere = () => { if (pinsLoading) loadPins(); };
  async function loadPins() {
    const seq = ++pinLoads;
    pinsLoading = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: "list", status: "open", url: location.href.split("#")[0] });
      if (seq !== pinLoads) return;
      pinsLoading = false;
      if (!res || !res.annotations) return;
      pins.forEach((p) => p.node.remove());
      pins = [];
      for (const a of res.annotations) addPin({ id: a.id, number: a.number, selector: a.element.selector, comment: a.comment, fp: a.element.fingerprint,
                                               region: a.region || null, status: a.status, kind: a.kind || null, thread: a.thread || [], steps: a.steps?.length || 0 });
      noticeQuestions();
      positionAll();
      paintDock();
      setAgent(res.agent ? { ...res.agent, seenAt: Date.now() } : null);
      await loadReplies();
      paintDock();
      if (ui.panel.style.display === "flex") renderPanel();
    } catch { if (seq === pinLoads) pinsLoading = false; }
  }

  // What the agent has already finished on this page, newest first.
  // Reply ids already known on this page. null until the first load: what was finished before the
  // page opened is history, not news.
  let seenReplies = null;
  // A question from the agent is news the first time it is seen, never again — and what was already
  // asked when the page opened is not news at all.
  let seenAsks = null;
  function noticeQuestions() {
    const asks = new Map(pins.filter((p) => p.status === "waiting").map((p) => [p.id + ":" + p.thread.length, p]));
    if (seenAsks && isTop) {
      const fresh = [...asks].filter(([k]) => !seenAsks.has(k)).map(([, p]) => p);
      if (fresh.length) {
        unread = true;
        const p = fresh[0], q = [...p.thread].reverse().find((m) => m.by === "agent");
        toast(`#${p.number}: ${q?.name || "Your agent"} asks — ${clip(q?.text || "", 90)}`, 8000, () => togglePanel(true));
      }
    }
    seenAsks = new Set(asks.keys());
  }
  async function loadReplies() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "list", status: "resolved", url: location.href.split("#")[0] });
      replies = (res?.annotations || []).slice().sort((a, b) => String(b.resolvedAt || "").localeCompare(String(a.resolvedAt || "")));
    } catch { replies = []; }
    const ids = new Set(replies.map((a) => a.id));
    if (seenReplies && isTop) {
      // Accepted somewhere else already (another tab): not news here either.
      const fresh = replies.filter((a) => !a.acceptedAt && !seenReplies.has(a.id));
      if (fresh.length) {
        unread = true;
        doneCard(fresh[0], fresh.length > 1 ? ` (+${fresh.length - 1} more)` : "");
        fresh.forEach(requestAfter);
      }
    }
    seenReplies = ids;
  }
  loadPins();
  refreshDock();
  // A client-side route change (pushState, a router) is a new page to the developer and to the
  // bridge, which keys notes by URL — but not to us: no reload, so the old route's pins stayed up.
  let lastUrl = location.href.split("#")[0];
  const routeCheck = () => {
    const now = location.href.split("#")[0];
    if (now === lastUrl) return;
    lastUrl = now;
    if (ui.pop.style.display === "block" && !ui.text.value.trim()) hidePopover();
    loadPins();
  };
  window.addEventListener("popstate", routeCheck);
  try { window.navigation?.addEventListener("navigatesuccess", routeCheck); } catch {}
  setInterval(routeCheck, 500);   // pushState fires no event at all outside the page's own world
  // Notice the bridge going away too, not only coming back: the dock should not offer a dead bridge.
  setInterval(() => { if (isTop && !dockHidden && !document.hidden) refreshDock(); }, 6000);
  // The background worker pushes "reloadPins" when the bridge changes; these are the belt-and-braces
  // paths for a tab that was backgrounded while the worker was asleep.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadPins(); refreshDock(); } });
  window.addEventListener("focus", () => { loadPins(); refreshDock(); });

  // Test hook: dispatch "pinpoint:debug-selector" on any element to get {selector, domPath} back.
  document.addEventListener("pinpoint:debug-selector", (e) => {
    const el = e.composedPath()[0];
    if (el?.nodeType !== 1) return;
    el.dispatchEvent(new CustomEvent("pinpoint:debug-selector-result", { detail: JSON.stringify({ selector: uniqueSelector(el), domPath: domPath(el) }) }));
  }, true);

  // ---------- messages from popup / background ----------
  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === "togglePicker") { togglePicking(); reply({ picking }); }
    else if (msg.type === "startPicker") { startPicking(); reply({ picking }); }
    else if (msg.type === "setPicking") {
      // An "off" from another frame also cancels a resume this frame is still waiting to make.
      if (msg.src !== frameKey && (msg.picking !== picking || (!msg.picking && pendingResume))) msg.picking ? startPicking(true) : stopPicking(true);
      reply({ picking });
    }
    else if (msg.type === "captureDone") { showOverlay(); resumePicking(); reply({ ok: true }); }
    else if (msg.type === "reloadPins") { loadPins().then(() => { refreshDock(); reply({ ok: true }); }); return true; }
    else if (msg.type === "showDock") { chrome.storage.local.remove(HIDE_KEY).finally(() => { dockHidden = false; refreshDock(); reply({ ok: true }); }); return true; }
    else if (msg.type === "clearPins") { pins.forEach((p) => p.node.remove()); pins = []; reply({ ok: true }); }
    else if (msg.type === "recheck") {
      // Re-identify the element the way a pin does, and describe what is there NOW. The bridge
      // does the comparing; this side only reports.
      (async () => {
        const el = findElement(msg.selector, msg.fingerprint);
        if (!el) return reply({ found: false, url: location.href });
        const r = el.getBoundingClientRect();
        // A region was anchored to this element with an offset, so its box moves with it.
        const override = msg.region
          ? { x: r.left + window.scrollX + msg.region.dx, y: r.top + window.scrollY + msg.region.dy, width: msg.region.width, height: msg.region.height }
          : null;
        const capture = await captureRect(el, override);
        const inWay = capture ? uiInWay(capture.rect) : null;
        reply({
          found: true,
          url: location.href,
          // Hide the overlay for the shot only when it is in the picture. When that is the panel or the
          // comment box, you are using it: no fresh crop this time rather than a blink under your cursor.
          hide: inWay === "passive",
          busy: inWay === "busy",
          selectorStillMatches: safeQuery(msg.selector) === el,
          element: {
            tag: el.tagName.toLowerCase(),
            selector: uniqueSelector(el),
            text: clip(el.innerText || el.textContent, 200),
            outerHTML: clip(el.outerHTML, 600),
            attributes: pickAttributes(el),
            rect: { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) },
            styles: computedStyles(el),
            fingerprint: fingerprint(el),
          },
          capture: inWay === "busy" ? null : capture,
        });
      })();
      return true;
    }
    else if (msg.type === "hideForCapture") { hideOverlayForCapture(); reply({ ok: true }); }
    else if (msg.type === "viewportNow") reply({ x: window.scrollX, y: window.scrollY, w: window.innerWidth, h: window.innerHeight, url: location.href });
    else if (msg.type === "ping") reply({ ok: true, picking, pins: pins.length });
    else if (msg.type === "reveal") {
      const p = pins.find((x) => x.id === msg.id);
      if (p) revealPin(p);
      reply({ ok: !!p });
    }
  });
})();
