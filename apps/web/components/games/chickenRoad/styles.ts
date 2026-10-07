export const STYLE_ID = 'fg-chicken-road-styles';

export const CSS = `
.chr { display: flex; flex-direction: column; align-items: center; gap: 24px;
  width: 100%; max-width: 1100px; margin-inline: auto; padding: 10px;
  box-sizing: border-box; color: var(--fg-text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (min-width: 1024px) {
  .chr { flex-direction: row; align-items: flex-start; justify-content: center; }
}

.chr__stage { position: relative; width: 100%; max-width: 700px; min-width: 0;
  aspect-ratio: 3 / 2; background: #7c8b9e; border: 4px solid #e5a059;
  border-radius: var(--fg-r-lg); overflow: hidden;
  --chr-chick-x: 0px; --chr-chick-y: 0px; }
.chr__canvas { display: block; width: 100%; height: 100%; }

.chr__chick { position: absolute; left: var(--chr-chick-x); top: var(--chr-chick-y);
  width: 76px; height: 76px; margin: -38px 0 0 -38px; padding: 0;
  background: transparent; border: 0; border-radius: var(--fg-r-pill); cursor: pointer;
  z-index: 2; }
.chr__chick::after { content: ''; position: absolute; inset: 6px; border-radius: var(--fg-r-pill);
  border: 2px dashed rgba(255,255,255,.35); opacity: 0;
  transition: opacity var(--fg-t); }
.chr__chick:hover::after { opacity: .9; }
.chr__chick:focus-visible { outline: none; }
.chr__chick:focus-visible::after { opacity: 1; border-color: var(--fg-accent); border-style: solid; }
.chr__chick:disabled { cursor: default; pointer-events: none; }
.chr__chick:disabled::after { opacity: 0; }

.chr__hud { position: absolute; left: 12px; right: 12px; top: 12px; display: flex;
  justify-content: space-between; gap: 8px; pointer-events: none; }
.chr__chip { display: flex; flex-direction: column; gap: 1px; min-width: 84px;
  padding: 6px 8px; background: rgba(11, 20, 27, .72); border: 1px solid rgba(148, 163, 184, .18);
  border-radius: var(--fg-r-lg); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.chr__chip--profit { text-align: right; }
.chr__chip i { font-size: 9.5px; font-weight: 700; font-style: normal;
  letter-spacing: .1em; text-transform: uppercase; color: var(--fg-muted); }
.chr__chip b { font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums;
  letter-spacing: -.01em; color: #fff; }
.chr__chip--profit b { color: var(--fg-gold); }

.chr__panel { display: flex; flex-direction: column; gap: 16px; width: 100%;
  max-width: 700px; min-width: 0; flex: 0 0 auto; padding: 16px; box-sizing: border-box;
  background: var(--fg-panel); border: 1px solid var(--fg-line); border-radius: 16px; }
@media (min-width: 1024px) { .chr__panel { width: 340px; } }

.chr__label { display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 8px; font-size: 11px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--fg-dim); }
.chr__label b { font-size: 12px; font-weight: 800; letter-spacing: .02em; color: var(--fg-gold); }

.chr__modes { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; padding: 4px;
  background: var(--fg-sunken); border: 1px solid var(--fg-line); border-radius: 12px; }
.chr__mode { display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px; min-width: 0; padding: 8px 2px; font-family: inherit; font-size: 11px; font-weight: 800;
  letter-spacing: -.02em;
  color: var(--fg-muted); background: transparent; border: 0; border-radius: 8px; cursor: pointer;
  transition: background var(--fg-t), color var(--fg-t); }
.chr__mode-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chr__mode-max { font-family: var(--fg-num); font-size: 10.5px; font-weight: 700;
  font-variant-numeric: tabular-nums; color: var(--fg-gold); }
.chr__mode:hover:not(:disabled) { color: var(--fg-text); background: var(--fg-hover); }
.chr__mode:focus-visible { outline: none; box-shadow: var(--fg-ring); }
.chr__mode:disabled { opacity: .5; cursor: not-allowed; }
.chr__mode--on, .chr__mode--on:hover:not(:disabled) { color: var(--fg-on-accent);
  background: var(--fg-accent-deep); }
.chr__mode--on .chr__mode-max { color: var(--fg-on-accent); opacity: .85; }

.chr__bet { display: flex; gap: 6px; }
.chr__field { position: relative; flex: 1 1 auto; min-width: 0; }
.chr__cur { position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  font-size: 15px; font-weight: 800; color: var(--fg-dim); pointer-events: none; }
.chr__input { width: 100%; box-sizing: border-box; height: 44px; padding: 0 12px 0 26px;
  font-family: var(--fg-num); font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums;
  color: var(--fg-text); background: var(--fg-sunken); border: 1px solid var(--fg-line);
  border-radius: 12px; outline: none; transition: border-color var(--fg-t), box-shadow var(--fg-t); }
.chr__input:focus-visible { border-color: var(--fg-accent); box-shadow: var(--fg-ring); }
.chr__input:disabled { opacity: .55; cursor: not-allowed; }
.chr__mod { flex: 0 0 auto; min-width: 48px; height: 44px; padding: 0 8px; font-family: inherit;
  font-size: 13px; font-weight: 800; color: var(--fg-muted); background: var(--fg-sunken);
  border: 1px solid var(--fg-line); border-radius: 12px; cursor: pointer;
  transition: background var(--fg-t), color var(--fg-t), transform var(--fg-t); }
.chr__mod:hover:not(:disabled) { color: var(--fg-text); background: var(--fg-hover); }
.chr__mod:active:not(:disabled) { transform: translateY(1px); }
.chr__mod:focus-visible { outline: none; box-shadow: var(--fg-ring); }
.chr__mod:disabled { opacity: .45; cursor: not-allowed; }
.chr__quick { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-top: 8px; }
.chr__quick button { height: 32px; font-family: var(--fg-num); font-size: 12px; font-weight: 700;
  color: var(--fg-muted); background: transparent; border: 1px solid var(--fg-line);
  border-radius: 8px; cursor: pointer; transition: background var(--fg-t), color var(--fg-t), border-color var(--fg-t); }
.chr__quick button:hover:not(:disabled) { color: var(--fg-text); border-color: var(--fg-line-2); }
.chr__quick button[aria-pressed='true'] { color: var(--fg-text); border-color: var(--fg-accent); }
.chr__quick button:disabled { opacity: .45; cursor: not-allowed; }
.chr__quick button:focus-visible { outline: none; box-shadow: var(--fg-ring); }

.chr__stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.chr__stat { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px;
  background: var(--fg-sunken); border: 1px solid var(--fg-line); border-radius: 12px; }
.chr__stat i { font-size: 10px; font-weight: 700; font-style: normal; letter-spacing: .1em;
  text-transform: uppercase; color: var(--fg-dim); }
.chr__stat b { font-family: var(--fg-num); font-size: 18px; font-weight: 800;
  font-variant-numeric: tabular-nums; color: var(--fg-text); }
.chr__stat small { font-size: 11px; font-weight: 600; color: var(--fg-muted); }
.chr__stat--gold b { color: var(--fg-gold); }

@media (pointer: coarse) {
  .chr__mode { min-height: 44px; }
  .chr__quick button { height: 40px; }
}

.chr__banner { padding: 8px; text-align: center; font-size: 13px; font-weight: 700;
  border-radius: 12px; }
.chr__banner--lost { color: #d69199; background: rgba(239,68,68,.14);
  border: 1px solid rgba(239,68,68,.4); }
.chr__banner--won { color: var(--fg-pos-soft); background: color-mix(in srgb, var(--fg-pos) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--fg-pos) 40%, transparent); }
.chr__error { margin: 0; font-size: 12px; font-weight: 600; color: #d69199; text-align: center; }

.chr__actions { display: flex; gap: 8px; }
.chr__action { flex: 1 1 0; min-width: 0; height: 52px; padding: 0 10px; font-family: inherit;
  font-size: 17px; font-weight: 900; color: var(--fg-on-accent); background: var(--fg-accent-deep);
  border: none; border-radius: 12px; cursor: pointer;
  transition: background var(--fg-t), transform var(--fg-t), opacity var(--fg-t); }
.chr__action:hover:not(:disabled) { background: var(--fg-accent-mid); }
.chr__action:active:not(:disabled) { transform: translateY(1px) scale(.99); }
.chr__action:focus-visible { outline: none; box-shadow: var(--fg-ring); }
.chr__action:disabled { opacity: .45; cursor: not-allowed; }
.chr__action small { display: block; font-size: 11px; font-weight: 700; opacity: .85; }
.chr__action--go { background: #2f9e62; }
.chr__action--go:hover:not(:disabled) { background: #38b571; }
.chr__action--cash { color: #2a1a03; background: var(--fg-gold); }
.chr__action--cash:hover:not(:disabled) { background: var(--fg-gold-soft); }
.chr__hint { margin: 0; font-size: 11.5px; line-height: 1.5; text-align: center; color: var(--fg-dim); }
`;

