export const STYLE_ID = 'fg-avia-masters-styles';

export const CSS = `
.avia { display: flex; flex-direction: column; align-items: center; gap: 20px;
  width: 100%; max-width: 1180px; margin-inline: auto; padding: 10px;
  box-sizing: border-box; color: var(--fg-text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (min-width: 1024px) {
  .avia { flex-direction: row; align-items: flex-start; justify-content: center; }
}

.avia__stage { position: relative; width: 100%; max-width: 820px; min-width: 0;
  aspect-ratio: 16 / 9; background: var(--fg-panel-2); border: var(--fg-edge);
  border-radius: var(--fg-r-lg); overflow: hidden; }
.avia__canvas { display: block; width: 100%; height: 100%; touch-action: none;
  cursor: pointer; }

.avia__hud { position: absolute; left: 12px; right: 12px; top: 12px; display: flex;
  flex-wrap: wrap; gap: 8px; pointer-events: none; }
.avia__tile { flex: 1 1 auto; min-width: 84px; padding: 6px 6px;
  background: rgba(8,17,27,.72); border: 1px solid rgba(148,163,184,.22);
  border-radius: var(--fg-r-lg); backdrop-filter: blur(6px); }
.avia__tile-label { display: block; font-size: 9.5px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase; color: var(--fg-dim); }
.avia__tile-value { display: block; margin-top: 2px; font-size: 15px; font-weight: 800;
  font-variant-numeric: tabular-nums; color: var(--fg-text); }
.avia__tile--mult .avia__tile-value { color: var(--fg-pos); }
.avia__tile--payout .avia__tile-value { color: var(--fg-gold); }

.avia__banner { position: absolute; left: 50%; top: 46%; transform: translate(-50%,-50%);
  padding: 8px 16px; text-align: center; font-size: 17px; font-weight: 800;
  border-radius: var(--fg-r-lg); pointer-events: none; }
.avia__banner--won { color: var(--fg-bg); background: rgba(74,222,128,.94); }
.avia__banner--lost { color: #450a0a; background: rgba(248,113,113,.94); }
.avia__banner small { display: block; margin-top: 2px; font-size: 12px; font-weight: 700;
  opacity: .8; }

.avia__hint { position: absolute; left: 12px; bottom: 12px; margin: 0; font-size: 11px;
  color: rgba(226,232,240,.6); pointer-events: none; }

.avia__panel { display: flex; flex-direction: column; gap: 14px; width: 100%;
  max-width: 820px; min-width: 0; flex: 0 0 auto; padding: 12px; box-sizing: border-box;
  background: var(--fg-panel); border: 1px solid var(--fg-line); border-radius: var(--fg-r-lg); }
@media (min-width: 1024px) { .avia__panel { width: 320px; } }

.avia__label { display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 6px; font-size: 10.5px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--fg-dim); }
.avia__label b { font-size: 12.5px; color: var(--fg-muted); letter-spacing: 0; }

.avia__inputs { display: flex; gap: 6px; }
.avia__input { flex: 1 1 auto; min-width: 0; width: 100%; box-sizing: border-box;
  padding: 6px 8px; font-family: inherit; font-size: 15px; font-weight: 700;
  font-variant-numeric: tabular-nums; color: var(--fg-text); background: var(--fg-sunken);
  border: 1px solid var(--fg-line); border-radius: var(--fg-r-lg); outline: none; }
.avia__input:focus-visible { border-color: var(--fg-accent); box-shadow: var(--fg-ring); }
.avia__input:disabled { opacity: .5; cursor: not-allowed; }
.avia__mod { flex: 0 0 auto; min-width: 42px; padding: 0 8px; font-family: inherit;
  font-size: 12px; font-weight: 800; color: var(--fg-muted); background: var(--fg-sunken);
  border: 1px solid var(--fg-line); border-radius: var(--fg-r-lg); cursor: pointer;
  transition: background var(--fg-t), color var(--fg-t); }
.avia__mod:hover:not(:disabled) { color: #fff; background: var(--fg-line); }
.avia__mod:disabled { opacity: .45; cursor: not-allowed; }
.avia__mod:focus-visible { outline: none; box-shadow: var(--fg-ring); }

.avia__action { width: 100%; padding: 10px; font-family: inherit; font-size: 16px;
  font-weight: 900; color: var(--fg-on-accent);
  background: var(--fg-accent-deep); border: none;
  border-radius: var(--fg-r-lg); cursor: pointer; box-shadow: 0 10px 20px -6px rgba(31,87,214,.45);
  transition: background var(--fg-t), transform var(--fg-t); }
.avia__action:hover:not(:disabled) { background: var(--fg-accent-mid); }
.avia__action:active:not(:disabled) { transform: translateY(1px); }
.avia__action:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
.avia__action:focus-visible { outline: none; box-shadow: var(--fg-ring); }
.avia__standing { display: flex; flex-direction: column; gap: 2px; width: 100%;
  padding: 8px 10px; text-align: center; border-radius: var(--fg-r-lg);
  background: rgba(250,204,21,.1); border: 1px solid rgba(250,204,21,.35); }
.avia__standing span { font-size: 10.5px; font-weight: 800; letter-spacing: .1em;
  text-transform: uppercase; color: var(--fg-gold); }
.avia__standing b { font-size: 19px; font-weight: 900; font-variant-numeric: tabular-nums;
  color: var(--fg-gold-soft); }
.avia__standing small { font-size: 11px; color: rgba(253,224,71,.75); }

.avia__error { display: flex; align-items: center; justify-content: center; gap: 6px;
  margin: 0; padding: 8px 10px; font-size: 12px; font-weight: 700; line-height: 1.4;
  text-align: center; color: var(--fg-red);
  background: color-mix(in srgb, var(--fg-red) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--fg-red) 38%, transparent);
  border-radius: var(--fg-r); }
.avia__note { margin: 0; font-size: 10.5px; line-height: 1.5; color: var(--fg-dim);
  text-align: center; }

.avia__speeds { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.avia__speed { display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 8px 4px; font-family: inherit; font-size: 13px; font-weight: 800;
  color: var(--fg-muted); background: var(--fg-sunken); border: 1px solid var(--fg-line);
  border-radius: var(--fg-r-lg); cursor: pointer;
  transition: background var(--fg-t), color var(--fg-t); }
.avia__speed small { font-size: 10.5px; font-weight: 700; color: var(--fg-dim);
  font-variant-numeric: tabular-nums; }
.avia__speed:hover:not(:disabled) { color: #fff; background: var(--fg-line); }
.avia__speed:disabled { opacity: .45; cursor: not-allowed; }
.avia__speed:focus-visible { outline: none; box-shadow: var(--fg-ring); }
.avia__speed--on { color: var(--fg-on-accent); background: var(--fg-accent-deep);
  border-color: var(--fg-accent-deep); }
.avia__speed--on small { color: inherit; opacity: .85; }

.avia__safe { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px;
  border-radius: var(--fg-r-lg); border: 1px solid var(--fg-line); background: var(--fg-sunken);
  cursor: pointer; transition: border-color var(--fg-t), background var(--fg-t); }
.avia__safe input { margin: 2px 0 0; width: 16px; height: 16px; accent-color: var(--fg-gold);
  flex: 0 0 auto; cursor: pointer; }
.avia__safe-text { display: flex; flex-direction: column; gap: 2px; }
.avia__safe-text b { font-size: 13px; font-weight: 800; color: var(--fg-text); }
.avia__safe-text small { font-size: 11px; line-height: 1.45; color: var(--fg-muted); }
.avia__safe--on { border-color: color-mix(in srgb, var(--fg-gold) 55%, transparent);
  background: color-mix(in srgb, var(--fg-gold) 10%, transparent); }
.avia__safe--on .avia__safe-text b { color: var(--fg-gold); }

.avia__spots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.avia__spot { padding: 6px 4px; text-align: center; font-size: 11px; font-weight: 700;
  color: var(--fg-muted); border-radius: var(--fg-r); border: 1px solid var(--fg-line); }
.avia__spot b { color: var(--fg-gold); font-variant-numeric: tabular-nums; }

.avia__action-sub { display: block; margin-top: 2px; font-size: 11px; font-weight: 700;
  opacity: .85; }

.avia__legend { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.avia__chip { padding: 6px 4px; text-align: center; font-size: 11px; font-weight: 800;
  border-radius: var(--fg-r); background: color-mix(in srgb, var(--fg-pos) 12%, transparent); color: var(--fg-pos-soft);
  border: 1px solid color-mix(in srgb, var(--fg-pos) 30%, transparent); }
.avia__chip--bad { background: rgba(239,68,68,.12); color: #d69199;
  border-color: rgba(239,68,68,.3); }
`;

