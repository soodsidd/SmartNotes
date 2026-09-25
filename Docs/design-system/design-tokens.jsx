// Design tokens sheet — one big artboard documenting the system.

const _DT_Icon = ({ d, size=14, sw=1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{flex:'0 0 auto'}}>
    <path d={d} />
  </svg>
);

/* ----------------- token data --------------------------------------- */

const COLOR_TOKENS = {
  Surface: [
    { name: '--bg',     light: '#faf8f3', dark: '#16140f', role: 'app background' },
    { name: '--panel',  light: '#ffffff', dark: '#1c1a14', role: 'cards / editor surface' },
    { name: '--rail',   light: '#f3efe7', dark: '#110f0b', role: 'tree + AI rail' },
  ],
  Ink: [
    { name: '--ink',    light: '#1c1a17', dark: '#ece7dc', role: 'primary text' },
    { name: '--ink2',   light: '#5a544c', dark: '#a8a195', role: 'secondary text' },
    { name: '--ink3',   light: '#918a7e', dark: '#6f6a5f', role: 'muted / meta' },
  ],
  Line: [
    { name: '--line',   light: '#e6e0d4', dark: '#2a261f', role: 'borders, dividers' },
    { name: '--line2',  light: '#efeae0', dark: '#221f19', role: 'subtler dividers / fills' },
  ],
  Accent: [
    { name: '--accent',    light: 'oklch(0.55 0.13 35)',  dark: 'oklch(0.72 0.13 40)',
      role: 'brand accent — buttons, links, ink lasso' },
    { name: '--accent-bg', light: 'oklch(0.95 0.04 70)',  dark: 'oklch(0.32 0.06 45)',
      role: 'soft accent fills, callouts' },
  ],
  Semantic: [
    { name: 'living',   light: 'oklch(0.65 0.15 145)', dark: 'oklch(0.65 0.15 145)',
      role: 'living-note dot, "saved" pill' },
    { name: 'attention',light: 'oklch(0.55 0.18 25)',  dark: 'oklch(0.65 0.18 25)',
      role: 'stylus annotations, warnings' },
    { name: 'link',     light: 'oklch(0.5 0.13 240)',  dark: 'oklch(0.7 0.13 240)',
      role: 'inline links' },
    { name: 'diff-add', light: 'oklch(0.92 0.07 145)', dark: 'oklch(0.32 0.08 145)',
      role: 'AI-proposed additions' },
    { name: 'diff-rem', light: 'oklch(0.91 0.06 25)',  dark: 'oklch(0.32 0.08 25)',
      role: 'AI-proposed removals' },
    { name: 'highlight',light: 'oklch(0.9 0.18 95)',   dark: 'oklch(0.9 0.18 95)',
      role: 'stylus highlighter (always warm)' },
  ],
};

const TYPE_TOKENS = [
  { name: 'display.lg', family: 'Newsreader', weight: 600, size: 34, line: 1.15, ls: '-0.02em',
    sample: 'Köhler integrator sizing',
    note: 'Page title' },
  { name: 'display.md', family: 'Newsreader', weight: 600, size: 26, line: 1.2, ls: '-0.015em',
    sample: 'Field notes — trial 14',
    note: 'Mobile title, focused-mode title' },
  { name: 'heading',    family: 'Newsreader', weight: 600, size: 20, line: 1.3, ls: '-0.01em',
    sample: 'Mixing condition',
    note: 'Section heading inside a note' },
  { name: 'body',       family: 'Newsreader', weight: 400, size: 16, line: 1.72,
    sample: 'Uniformity scales with the bounce count N.',
    note: 'Default reading text — serif for long-form' },
  { name: 'ui',         family: 'Inter', weight: 500, size: 13, line: 1.45,
    sample: 'New page',
    note: 'Buttons, tree, chips' },
  { name: 'caption',    family: 'Inter', weight: 400, size: 11, line: 1.4,
    sample: 'updated 2h ago by AI',
    note: 'Meta strips, timestamps' },
  { name: 'eyebrow',    family: 'Inter', weight: 500, size: 10, line: 1.4, upper: true, ls: '0.08em',
    sample: 'Recently edited',
    note: 'Section labels, group dividers (uppercase)' },
  { name: 'mono',       family: 'JetBrains Mono', weight: 500, size: 12, line: 1.6,
    sample: 'optics/illumination/kohler.md',
    note: 'Paths, keyboard shortcuts, code' },
  { name: 'hand',       family: 'Caveat', weight: 500, size: 22, line: 1.2,
    sample: 'rerun!',
    note: 'Stylus / handwriting rendering' },
];

const SPACING = [
  { n: '1', v: 4 },  { n: '2', v: 8 },  { n: '3', v: 12 },
  { n: '4', v: 16 }, { n: '5', v: 20 }, { n: '6', v: 24 },
  { n: '8', v: 32 }, { n: '10', v: 40 }, { n: '14', v: 56 },
];

const RADIUS = [
  { n: 'xs', v: 3,  role: 'chips, highlights' },
  { n: 'sm', v: 6,  role: 'buttons, code inline' },
  { n: 'md', v: 8,  role: 'small cards, inputs' },
  { n: 'lg', v: 10, role: 'callouts, AI bubbles' },
  { n: 'xl', v: 12, role: 'paper card, sheets' },
  { n: '2xl',v: 16, role: 'modals' },
  { n: 'full', v: 999, role: 'avatar, pills' },
];

const SHADOWS = [
  { n: 'none',   css: 'none', role: 'flat surfaces' },
  { n: 'card',   css: '0 1px 0 rgba(0,0,0,0.04), 0 10px 30px -20px rgba(0,0,0,0.18)',
    role: 'paper card on bg' },
  { n: 'popover',css: '0 12px 30px -10px rgba(0,0,0,0.25)',
    role: 'selection toolbar, menus' },
  { n: 'modal',  css: '0 30px 80px -20px rgba(0,0,0,0.4), 0 0 0 1px var(--line)',
    role: 'capture, settings' },
  { n: 'fab',    css: '0 10px 24px -6px oklch(0.55 0.13 35 / 0.45)',
    role: 'mobile floating AI button' },
];

const ICONS = [
  { d: 'M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4zM8 4v16', n: 'notebook' },
  { d: 'M4 6h16M4 12h16M4 18h10', n: 'section' },
  { d: 'M6 3h9l4 4v14H6z M15 3v4h4', n: 'page' },
  { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z', n: 'folder' },
  { d: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2l-4.3-4.3', n: 'search' },
  { d: 'M12 5v14M5 12h14', n: 'plus' },
  { d: 'M3 13l3-8h12l3 8M3 13v6h18v-6', n: 'inbox' },
  { d: 'M12 3l1.8 4.7L18 9l-4.2 1.3L12 15l-1.8-4.7L6 9l4.2-1.3z', n: 'sparkle' },
  { d: 'M4 20l4-1 11-11-3-3L5 16l-1 4z', n: 'edit' },
  { d: 'M14 3l7 7-11 11H3v-7L14 3z', n: 'pen' },
  { d: 'M9 4v16M15 4v16M3 8l6-4M3 16l6 4', n: 'diff' },
  { d: 'M5 13l4 4L19 7', n: 'check' },
  { d: 'M6 6l12 12M6 18L18 6', n: 'close' },
  { d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.5 1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.5-1.5', n: 'link' },
  { d: 'M5 9h14M5 15h14M10 3L8 21M16 3l-2 18', n: 'hash' },
  { d: 'M6 3h12v18l-6-4-6 4z', n: 'bookmark' },
];

/* ----------------- presentation helpers ----------------------------- */

const ColorRow = ({ tok, dark }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '40px 40px 1fr 130px', gap: 12,
                alignItems: 'center', padding: '6px 0' }}>
    <div style={{
      width: 36, height: 36, borderRadius: 8, background: tok.light,
      border: '1px solid var(--line)',
    }} />
    <div style={{
      width: 36, height: 36, borderRadius: 8, background: tok.dark,
      border: '1px solid var(--line)',
    }} />
    <div style={{ minWidth: 0 }}>
      <div className="mono" style={{ fontSize: 12, fontWeight: 500,
        fontFamily: "'JetBrains Mono', monospace", color: 'var(--ink)' }}>
        {tok.name}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink3)' }}>{tok.role}</div>
    </div>
    <div className="mono" style={{
      fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5,
      color: 'var(--ink3)', textAlign: 'right',
    }}>
      <div>{tok.light}</div>
      <div>{tok.dark}</div>
    </div>
  </div>
);

const TypeRow = ({ tok }) => {
  const fam = tok.family === 'Newsreader' ? '"Newsreader", Georgia, serif'
            : tok.family === 'Inter' ? 'Inter, system-ui, sans-serif'
            : tok.family === 'JetBrains Mono' ? '"JetBrains Mono", ui-monospace, monospace'
            : tok.family === 'Caveat' ? '"Caveat", cursive'
            : 'inherit';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 220px',
                  gap: 16, alignItems: 'baseline', padding: '12px 0',
                  borderTop: '1px solid var(--line2)' }}>
      <div>
        <div className="mono" style={{ fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11.5, color: 'var(--ink)', fontWeight: 500 }}>
          {tok.name}
        </div>
        <div className="mono" style={{ fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10, color: 'var(--ink3)', marginTop: 2 }}>
          {tok.family} · {tok.weight} · {tok.size}/{tok.line}
        </div>
      </div>
      <div style={{
        fontFamily: fam, fontWeight: tok.weight, fontSize: tok.size,
        lineHeight: tok.line, letterSpacing: tok.ls,
        textTransform: tok.upper ? 'uppercase' : 'none',
        color: 'var(--ink)',
      }}>
        {tok.sample}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink3)', lineHeight: 1.45 }}>
        {tok.note}
      </div>
    </div>
  );
};

const SpaceTile = ({ s }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
    <div style={{ width: 56, height: 56, position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: s.v, height: s.v, background: 'var(--accent)', borderRadius: 2 }} />
    </div>
    <div className="mono" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5,
                                    color: 'var(--ink)' }}>
      space-{s.n}
    </div>
    <div className="mono" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                                    color: 'var(--ink3)' }}>
      {s.v}px
    </div>
  </div>
);

const RadiusTile = ({ r }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
    <div style={{
      width: 60, height: 60,
      borderRadius: r.v === 999 ? 30 : r.v,
      background: 'var(--accent-bg)', border: '1px solid var(--accent)',
    }} />
    <div className="mono" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5,
                                    color: 'var(--ink)' }}>
      radius-{r.n}
    </div>
    <div style={{ fontSize: 10, color: 'var(--ink3)' }}>{r.role}</div>
  </div>
);

const ShadowTile = ({ s }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
    <div style={{ padding: 14 }}>
      <div style={{
        width: 96, height: 60, borderRadius: 10, background: 'var(--panel)',
        boxShadow: s.css, border: s.css === 'none' ? '1px solid var(--line)' : 'none',
      }} />
    </div>
    <div className="mono" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5,
                                    color: 'var(--ink)' }}>
      shadow-{s.n}
    </div>
    <div style={{ fontSize: 10, color: 'var(--ink3)', textAlign: 'center', maxWidth: 120 }}>
      {s.role}
    </div>
  </div>
);

/* ----------------- the artboard ------------------------------------- */

const SectionH = ({ n, t, sub }) => (
  <div style={{ margin: '0 0 14px', display: 'flex', alignItems: 'baseline', gap: 12 }}>
    <span className="mono" style={{ fontFamily: "'JetBrains Mono', monospace",
                                    fontSize: 11, color: 'var(--ink3)' }}>
      {n}
    </span>
    <div>
      <div style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 22, fontWeight: 600,
                    letterSpacing: '-0.01em' }}>{t}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>{sub}</div>}
    </div>
  </div>
);

const Panel = ({ children, style }) => (
  <div style={{
    background: 'var(--panel)', border: '1px solid var(--line)',
    borderRadius: 12, padding: 22, ...style,
  }}>{children}</div>
);

const DesignTokens = ({ dark = false }) => (
  <div className={'dirA' + (dark ? ' dark' : '')}
       style={{ width: '100%', minHeight: '100%',
                background: 'var(--bg)', color: 'var(--ink)',
                fontFamily: 'Inter, system-ui, sans-serif' }}>
    {/* Header */}
    <div style={{ padding: '36px 48px 24px', borderBottom: '1px solid var(--line)',
                  display: 'flex', alignItems: 'flex-end', gap: 24 }}>
      <div style={{ flex: 1 }}>
        <div className="mono" style={{ fontFamily: "'JetBrains Mono', monospace",
                                       fontSize: 11, color: 'var(--ink3)',
                                       letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Smart Notes · design system · v0.1
        </div>
        <h1 style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 42, fontWeight: 600,
                     letterSpacing: '-0.02em', margin: '6px 0 6px' }}>
          Design tokens
        </h1>
        <div style={{ fontSize: 13.5, color: 'var(--ink2)', maxWidth: 620, lineHeight: 1.5 }}>
          Warm-neutral palette anchored on a rust accent, serif body for long-form reading,
          Inter for UI, JetBrains Mono for paths/code, Caveat for stylus rendering. All values
          listed as CSS custom properties; dark mode is a token swap, not a separate system.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end' }}>
        <div style={{ textAlign: 'right' }}>
          <div className="mono" style={{ fontFamily: "'JetBrains Mono', monospace",
                                         fontSize: 10, color: 'var(--ink3)' }}>last updated</div>
          <div style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 16 }}>
            May 23, 2026
          </div>
        </div>
      </div>
    </div>

    <div style={{ padding: 32, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      {/* COLOR */}
      <Panel style={{ gridColumn: '1 / -1' }}>
        <SectionH n="01" t="Color" sub="All tokens defined for light + dark. Dark is a swatch swap on the same surface/ink/line system." />
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 16,
                      borderTop: '1px solid var(--line2)', paddingTop: 8 }}>
          {Object.entries(COLOR_TOKENS).map(([group, toks]) => (
            <React.Fragment key={group}>
              <div style={{ paddingTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{group}</div>
                <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{toks.length} tokens</div>
              </div>
              <div style={{ paddingTop: 4 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '40px 40px 1fr 130px',
                              gap: 12, fontSize: 10, color: 'var(--ink3)',
                              letterSpacing: '0.08em', textTransform: 'uppercase',
                              padding: '0 0 4px' }}>
                  <div>light</div><div>dark</div><div>token</div>
                  <div style={{ textAlign: 'right' }}>value</div>
                </div>
                {toks.map(tok => <ColorRow key={tok.name} tok={tok} />)}
              </div>
            </React.Fragment>
          ))}
        </div>
      </Panel>

      {/* TYPE */}
      <Panel style={{ gridColumn: '1 / -1' }}>
        <SectionH n="02" t="Typography" sub="Serif (Newsreader) for long-form, Inter for UI, JetBrains Mono for paths/code, Caveat for stylus rendering." />
        <div>
          {TYPE_TOKENS.map(t => <TypeRow key={t.name} tok={t} />)}
        </div>
      </Panel>

      {/* SPACING */}
      <Panel>
        <SectionH n="03" t="Spacing" sub="4px base unit. Use space-2/3/4 for layout density; space-6+ for block-level rhythm." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 8,
                      paddingTop: 8 }}>
          {SPACING.map(s => <SpaceTile key={s.n} s={s} />)}
        </div>
      </Panel>

      {/* RADIUS */}
      <Panel>
        <SectionH n="04" t="Radius" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8,
                      paddingTop: 8 }}>
          {RADIUS.map(r => <RadiusTile key={r.n} r={r} />)}
        </div>
      </Panel>

      {/* SHADOWS */}
      <Panel style={{ gridColumn: '1 / -1' }}>
        <SectionH n="05" t="Elevation" sub="Five steps. Card uses a soft warm drop; popover and modal are darker and crisper." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8,
                      paddingTop: 8 }}>
          {SHADOWS.map(s => <ShadowTile key={s.n} s={s} />)}
        </div>
      </Panel>

      {/* ICONS */}
      <Panel style={{ gridColumn: '1 / -1' }}>
        <SectionH n="06" t="Iconography"
                  sub="Stroke-only, 1.5px, round caps/joins, 24×24 grid. Stroke inherits currentColor." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 12,
                      paddingTop: 8 }}>
          {ICONS.map(ic => (
            <div key={ic.n} style={{ display: 'flex', flexDirection: 'column',
                                      alignItems: 'center', gap: 6,
                                      padding: '14px 8px', border: '1px solid var(--line2)',
                                      borderRadius: 8 }}>
              <span style={{ color: 'var(--ink)' }}><_DT_Icon d={ic.d} size={20} /></span>
              <div className="mono" style={{ fontFamily: "'JetBrains Mono', monospace",
                                              fontSize: 10, color: 'var(--ink3)' }}>{ic.n}</div>
            </div>
          ))}
        </div>
      </Panel>

      {/* COMPONENTS */}
      <Panel style={{ gridColumn: '1 / -1' }}>
        <SectionH n="07" t="Components"
                  sub="Atomic primitives, in order of frequency on the page." />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20,
                      paddingTop: 8, borderTop: '1px solid var(--line2)' }}>

          {/* Buttons */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Buttons</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
              <button className="btn-primary">
                <_DT_Icon d="M5 13l4 4L19 7" size={11} /> Accept &amp; commit
              </button>
              <button className="btn-soft">Edit before accepting</button>
              <button className="btn-soft" style={{ borderColor: 'transparent' }}>Ghost</button>
              <button className="btn-soft" style={{ color: 'oklch(0.55 0.16 25)' }}>
                <_DT_Icon d="M6 6l12 12M6 18L18 6" size={11} /> Reject
              </button>
            </div>
            <div className="mono" style={{ fontFamily: "'JetBrains Mono', monospace",
                                            fontSize: 10, color: 'var(--ink3)', marginTop: 10 }}>
              .btn-primary · .btn-soft · ghost · destructive
            </div>
          </div>

          {/* Chips */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Chips</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span className="chip">default</span>
              <span className="chip" style={{ background: 'var(--accent-bg)',
                                              borderColor: 'transparent', color: 'var(--ink)' }}>
                <_DT_Icon d="M12 3l1.8 4.7L18 9l-4.2 1.3L12 15l-1.8-4.7L6 9l4.2-1.3z" size={10} />
                accent
              </span>
              <span className="chip">
                <span style={{ width: 6, height: 6, borderRadius: 3,
                               background: 'oklch(0.65 0.15 145)' }} />
                living
              </span>
              <span className="chip mono" style={{ fontFamily: "'JetBrains Mono', monospace",
                                                   fontSize: 10 }}>
                mono
              </span>
              <span className="chip" style={{ borderStyle: 'dashed', color: 'var(--ink3)' }}>
                + tag
              </span>
            </div>
            <div className="mono" style={{ fontFamily: "'JetBrains Mono', monospace",
                                            fontSize: 10, color: 'var(--ink3)', marginTop: 10 }}>
              .chip · variants via inline tokens
            </div>
          </div>

          {/* Inputs */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Inputs</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                            border: '1px solid var(--line)', borderRadius: 7, fontSize: 12,
                            color: 'var(--ink3)' }}>
                <_DT_Icon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2l-4.3-4.3" size={12} />
                <span>Search notes…</span>
                <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace",
                               fontSize: 10, padding: '1px 4px',
                               border: '1px solid var(--line)', borderRadius: 3 }}>⌘K</span>
              </div>
              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)',
                            borderRadius: 10, padding: '8px 12px', fontSize: 12,
                            color: 'var(--ink3)' }}>
                Ask anything about this note…
              </div>
            </div>
            <div className="mono" style={{ fontFamily: "'JetBrains Mono', monospace",
                                            fontSize: 10, color: 'var(--ink3)', marginTop: 10 }}>
              search · ai prompt
            </div>
          </div>

          {/* Tree item */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Tree item</div>
            <div style={{ background: 'var(--rail)', borderRadius: 8, padding: 6 }}>
              <div className="tree-item">
                <span className="caret">▾</span>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent)' }} />
                <span>Notebook</span>
              </div>
              <div className="tree-item" style={{ paddingLeft: 24 }}>
                <span className="caret">▾</span>
                <span>Section</span>
              </div>
              <div className="tree-item active" style={{ paddingLeft: 42, position: 'relative' }}>
                <span style={{ position: 'absolute', left: 14, top: 6, bottom: 6, width: 2,
                                background: 'var(--accent)', borderRadius: 2 }} />
                <span>Active page</span>
                <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: 3,
                                background: 'oklch(0.65 0.15 145)' }} />
              </div>
            </div>
          </div>

          {/* Callout */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Callout / equation</div>
            <div style={{ padding: '10px 12px', borderRadius: 8,
                          background: 'var(--accent-bg)', border: '1px solid var(--line)' }}>
              <div style={{ fontSize: 10, color: 'var(--ink3)', letterSpacing: '0.06em',
                            textTransform: 'uppercase', marginBottom: 4 }}>
                Non-uniformity
              </div>
              <div className="eq" style={{ fontSize: 16 }}>
                N ≈ (L / a) · tan θ<sub>in</sub>
              </div>
            </div>
          </div>

          {/* AI bubble */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>AI message</div>
            <div style={{ background: 'rgba(0,0,0,0.025)', borderRadius: 10, padding: '8px 12px',
                          fontSize: 12.5, lineHeight: 1.5, maxWidth: 240 }}>
              For decent uniformity, target N ≥ 3. With a = 4 mm and θ = 12° you get L ≈ 56 mm.
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button className="btn-primary" style={{ fontSize: 11, padding: '4px 9px' }}>
                <_DT_Icon d="M12 5v14M5 12h14" size={11} /> Append
              </button>
              <button className="btn-soft" style={{ fontSize: 11, padding: '4px 9px' }}>
                Rewrite
              </button>
            </div>
          </div>
        </div>
      </Panel>

      {/* MOTION / MISC */}
      <Panel style={{ gridColumn: '1 / -1' }}>
        <SectionH n="08" t="Motion & misc"
                  sub="Restrained motion — content shouldn't reflow while you read." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18,
                      paddingTop: 8 }}>
          {[
            { n: 'duration.fast', v: '120ms', role: 'hover, focus, ribbon swap' },
            { n: 'duration.base', v: '200ms', role: 'menu open, chip toggle' },
            { n: 'duration.slow', v: '320ms', role: 'sheet, modal, diff swap-in' },
            { n: 'easing',        v: 'cubic-bezier(0.2, 0.7, 0.2, 1)', role: 'standard ease' },
            { n: 'border.width',  v: '1px',   role: 'all dividers; 1.5px only for icons' },
            { n: 'focus.ring',    v: '2px var(--accent), offset 2px', role: 'keyboard focus' },
            { n: 'opacity.muted', v: '0.6',   role: 'disabled content' },
            { n: 'grid.dot',      v: '22px',  role: 'ink-paper dot grid pitch' },
          ].map(m => (
            <div key={m.n} style={{ padding: 12, border: '1px solid var(--line2)',
                                     borderRadius: 8 }}>
              <div className="mono" style={{ fontFamily: "'JetBrains Mono', monospace",
                                              fontSize: 11, color: 'var(--ink)', fontWeight: 500 }}>
                {m.n}
              </div>
              <div className="mono" style={{ fontFamily: "'JetBrains Mono', monospace",
                                              fontSize: 10.5, color: 'var(--accent)', margin: '4px 0' }}>
                {m.v}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{m.role}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  </div>
);

const DesignTokensDark = () => <DesignTokens dark />;

Object.assign(window, { DesignTokens, DesignTokensDark });
