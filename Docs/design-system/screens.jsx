// Screens for Smart Notes — initial directions
// Three desktop directions for the main editor + AI sidebar, plus secondary screens.

const { useState } = React;

/* ---------------------------------------------------------------- */
/*  Shared content fragments (so all three directions share text)   */
/* ---------------------------------------------------------------- */

const TREE_NOTEBOOKS = [
  {
    id: 'optics', name: 'Optics R&D', color: 'oklch(0.6 0.15 35)', active: true,
    sections: [
      { id: 'ill', name: 'Illumination', open: true, active: true, pages: [
        { id: 'p1', name: 'Köhler integrator sizing', active: true, status: 'living' },
        { id: 'p2', name: 'Light pipe geometry' },
        { id: 'p3', name: 'Étendue — first principles' },
      ]},
      { id: 'img', name: 'Imaging', pages: [] },
      { id: 'col', name: 'Color metrology', pages: [] },
    ],
  },
  {
    id: 'sw', name: 'Software', color: 'oklch(0.55 0.13 240)',
    sections: [
      { id: 'cli', name: 'CLI tools', pages: [] },
      { id: 'infra', name: 'Mini-PC infra', pages: [] },
    ],
  },
  {
    id: 'p', name: 'Personal', color: 'oklch(0.55 0.13 145)', sections: [
      { id: 'jrn', name: 'Journal', pages: [] }
    ],
  },
];

const RECENTS = [
  'Köhler integrator sizing',
  'Diffractive beam shaper — design notes',
  'May 21 — standup',
  'Tailscale exit-node setup',
];

const AI_HISTORY = [
  {
    role: 'user',
    text: 'Continue the derivation past the mixing condition. Show how the light-pipe length scales with required uniformity.',
  },
  {
    role: 'assistant',
    blocks: [
      { kind: 'p', text: 'For a square light-pipe of side a, the uniformity at the exit improves as the number of internal reflections N grows. The marginal ray angle θ entering the pipe sets:' },
      { kind: 'eq', html: 'N \u2248 (L / a) · tan(θ)' },
      { kind: 'p', text: 'Typical projection illuminators target N ≥ 3 for ≤ 2% non-uniformity. With θ = 12° and a = 4 mm, L ≈ 56 mm. Below is a tightened version of the section you have.' },
    ],
  },
];

/* ---------------------------------------------------------------- */
/*  Tiny SVG icons                                                  */
/* ---------------------------------------------------------------- */
const Icon = ({ d, size=14, sw=1.5, fill='none' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
       strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{flex:'0 0 auto'}}>
    <path d={d} />
  </svg>
);
const Ic = {
  notebook: 'M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4zM8 4v16',
  section:  'M4 6h16M4 12h16M4 18h10',
  page:     'M6 3h9l4 4v14H6z M15 3v4h4',
  caret:    'M9 6l6 6-6 6',
  search:   'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2l-4.3-4.3',
  plus:     'M12 5v14M5 12h14',
  sparkle:  'M12 3l1.8 4.7L18 9l-4.2 1.3L12 15l-1.8-4.7L6 9l4.2-1.3zM19 14l1 2.5L22 17l-2 .8L19 20l-.8-2.2L16 17l2-.5z',
  send:     'M3 11l18-8-8 18-2.5-7.5z',
  chat:     'M21 12a8 8 0 1 1-3.5-6.6L21 4l-1 4',
  edit:     'M4 20l4-1 11-11-3-3L5 16l-1 4z',
  diff:     'M9 4v16M15 4v16M3 8l6-4M3 16l6 4M21 8l-6-4M21 16l-6 4',
  attach:   'M21 11l-9 9a5 5 0 1 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 1 1-3-3l8-8',
  pen:      'M14 3l7 7-11 11H3v-7L14 3z',
  more:     'M6 12h.01M12 12h.01M18 12h.01',
  folder:   'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  inbox:    'M3 13l3-8h12l3 8M3 13v6h18v-6M3 13h5l1 2h6l1-2h5',
  hash:     'M5 9h14M5 15h14M10 3L8 21M16 3l-2 18',
  check:    'M5 13l4 4L19 7',
  x:        'M6 6l12 12M6 18L18 6',
  cmd:      'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6z',
  enter:    'M9 10L4 14l5 4M4 14h12a4 4 0 0 0 4-4V6',
};

/* ---------------------------------------------------------------- */
/*  Equation: a faked KaTeX-ish render                              */
/* ---------------------------------------------------------------- */
const Eq = ({ children, big }) => (
  <div className="eq" style={{
    fontSize: big ? 22 : 17, lineHeight: 1.6,
    textAlign: big ? 'center' : 'left',
    margin: big ? '14px 0' : '6px 0',
  }}>{children}</div>
);

/* ---------------------------------------------------------------- */
/*  Tree (left rail)                                                */
/* ---------------------------------------------------------------- */
const Tree = ({ dark }) => (
  <div style={{ padding: '8px 6px', fontSize: 13 }}>
    <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: 'var(--ink3)', padding: '8px 10px 4px' }}>Recent</div>
    {RECENTS.map((r, i) => (
      <div key={i} className="tree-item" style={{ paddingLeft: 12 }}>
        <span className="icon" style={{ color: 'var(--ink3)' }}><Icon d={Ic.page} size={12} /></span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</span>
      </div>
    ))}
    <div style={{ height: 10 }} />
    <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: 'var(--ink3)', padding: '8px 10px 4px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>Notebooks</span>
      <span style={{ color: 'var(--ink3)' }}><Icon d={Ic.plus} size={12} /></span>
    </div>
    {TREE_NOTEBOOKS.map(nb => (
      <div key={nb.id}>
        <div className={'tree-item' + (nb.active ? ' active' : '')}>
          <span className="caret">▾</span>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: nb.color, flex: '0 0 auto' }} />
          <span style={{ fontWeight: nb.active ? 500 : 400 }}>{nb.name}</span>
        </div>
        {nb.sections && nb.active && nb.sections.map(s => (
          <div key={s.id}>
            <div className={'tree-item' + (s.active ? ' active' : '')} style={{ paddingLeft: 24 }}>
              <span className="caret">{s.open ? '▾' : '▸'}</span>
              <span className="icon" style={{ color: 'var(--ink3)' }}><Icon d={Ic.section} size={12} /></span>
              <span>{s.name}</span>
            </div>
            {s.open && s.pages.map(p => (
              <div key={p.id} className={'tree-item' + (p.active ? ' active' : '')}
                   style={{ paddingLeft: 42, position: 'relative' }}>
                {p.active && <span style={{ position: 'absolute', left: 14, top: 6, bottom: 6, width: 2,
                                          background: 'var(--accent)', borderRadius: 2 }} />}
                <span className="icon" style={{ color: 'var(--ink3)' }}><Icon d={Ic.page} size={12} /></span>
                <span style={{ fontWeight: p.active ? 500 : 400 }}>{p.name}</span>
                {p.status === 'living' && (
                  <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: 3,
                                background: 'oklch(0.65 0.15 145)' }} />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    ))}
    <div style={{ height: 10 }} />
    <div className="tree-item" style={{ color: 'var(--ink2)' }}>
      <span className="icon"><Icon d={Ic.inbox} size={13} /></span>
      <span>Inbox</span>
      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ink3)' }}>7</span>
    </div>
  </div>
);

/* ---------------------------------------------------------------- */
/*  Note body (shared rendered Markdown)                            */
/* ---------------------------------------------------------------- */
const NoteBody = ({ direction = 'A' }) => {
  const serif = direction === 'C';
  const bodyFont = direction === 'B'
    ? { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 14.5, lineHeight: 1.65 }
    : serif
      ? { fontFamily: '"Source Serif 4", Georgia, serif', fontSize: 17, lineHeight: 1.72 }
      : { fontFamily: '"Newsreader", Georgia, serif', fontSize: 16, lineHeight: 1.7 };

  return (
    <div style={{ color: 'var(--ink)', ...bodyFont }}>
      <h2 style={{ fontFamily: bodyFont.fontFamily, fontSize: serif ? 22 : 20, fontWeight: 600,
                   margin: '24px 0 8px', letterSpacing: '-0.01em' }}>
        Goal
      </h2>
      <p style={{ margin: '0 0 14px' }}>
        Pick light-pipe length L and entry aperture a for a Köhler integrator that hits ≤ 2% irradiance
        non-uniformity over a 6 mm × 6 mm target, given the LED source étendue and the f/# of the relay.
      </p>

      <h2 style={{ fontFamily: bodyFont.fontFamily, fontSize: serif ? 22 : 20, fontWeight: 600,
                   margin: '24px 0 8px', letterSpacing: '-0.01em' }}>
        Étendue budget
      </h2>
      <p style={{ margin: '0 0 10px' }}>
        Conservation requires the source étendue G<sub>s</sub> to fit inside the relay's acceptance G<sub>r</sub>.
        For a Lambertian LED of emitter area A<sub>s</sub> radiating into a half-angle θ<sub>s</sub>:
      </p>
      <Eq big>
        G<sub>s</sub> = π A<sub>s</sub> sin²θ<sub>s</sub> &nbsp;≤&nbsp;
        <span className="frac"><span className="top">π d²</span><span className="bot">4 (f/#)²</span></span>
      </Eq>

      <h2 style={{ fontFamily: bodyFont.fontFamily, fontSize: serif ? 22 : 20, fontWeight: 600,
                   margin: '24px 0 8px', letterSpacing: '-0.01em' }}>
        Mixing condition
      </h2>
      <p style={{ margin: '0 0 12px' }}>
        Uniformity at the pipe exit scales with the number of internal bounces N. Rule of thumb for
        ≤ 2% non-uniformity: N ≥ 3 across the angular spread. From geometry,
      </p>
      <div style={{
        display: 'flex', gap: 12, alignItems: 'flex-start',
        padding: '14px 16px', borderRadius: 8,
        background: 'var(--accent-bg)',
        border: '1px solid var(--line)',
        margin: '0 0 16px',
      }}>
        <div style={{ flex: 1, fontFamily: bodyFont.fontFamily }}>
          <Eq>N ≈ (L / a) · tan θ<sub>in</sub></Eq>
          <Eq>L<sub>min</sub> = 3 a / tan θ<sub>in</sub></Eq>
        </div>
        <span className="chip" style={{ background: 'rgba(255,255,255,0.5)', flex: '0 0 auto' }}>
          KaTeX
        </span>
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------- */
/*  AI Sidebar (right rail)                                         */
/* ---------------------------------------------------------------- */
const AiSidebar = ({ direction = 'A', wide, dark: darkOverride }) => {
  const dark = darkOverride ?? (direction === 'B');
  const bubbleBg = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)';
  const userBg   = dark ? 'oklch(0.32 0.06 45)' : 'oklch(0.95 0.04 70)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--rail)' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)',
                    display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--accent)' }}><Icon d={Ic.sparkle} size={15} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Smart Notes AI</div>
          <div style={{ fontSize: 10.5, color: 'var(--ink3)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Discussing · Köhler integrator sizing
          </div>
        </div>
        <button className="btn-soft" style={{ padding: 4, border: 0 }}>
          <Icon d={Ic.more} size={14} />
        </button>
      </div>

      {/* Context strip */}
      <div style={{ padding: '8px 12px', display: 'flex', flexWrap: 'wrap', gap: 5,
                    borderBottom: '1px solid var(--line)' }}>
        <span className="chip" style={{ background: 'var(--accent-bg)', borderColor: 'transparent', color: 'var(--ink)' }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--accent)' }} />
          Whole note · 2.1k tokens
        </span>
        <span className="chip">2 related</span>
        <span className="chip">+ context</span>
      </div>

      {/* Conversation */}
      <div className="no-scroll" style={{ flex: 1, overflow: 'auto', padding: '12px 12px 4px',
                                          display: 'flex', flexDirection: 'column', gap: 12 }}>
        {AI_HISTORY.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'stretch',
                                maxWidth: m.role === 'user' ? '85%' : '100%' }}>
            <div style={{
              fontSize: 10.5, color: 'var(--ink3)', marginBottom: 4,
              textAlign: m.role === 'user' ? 'right' : 'left',
              letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>
              {m.role === 'user' ? 'You' : 'claude-haiku-4.5'}
            </div>
            <div style={{
              background: m.role === 'user' ? userBg : bubbleBg,
              padding: '10px 12px', borderRadius: 10,
              fontSize: 13, lineHeight: 1.55,
              border: m.role === 'user' ? '1px solid var(--line)' : '1px solid transparent',
            }}>
              {m.text ? (
                <span>{m.text}</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {m.blocks.map((b, j) => b.kind === 'eq'
                    ? <div key={j} style={{ textAlign: 'center', padding: '4px 0' }} className="eq">{b.html}</div>
                    : <div key={j}>{b.text}</div>
                  )}
                </div>
              )}
            </div>
            {m.role === 'assistant' && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                <button className="btn-primary" style={{ fontSize: 11, padding: '4px 9px' }}>
                  <Icon d={Ic.plus} size={11} /> Append
                </button>
                <button className="btn-soft" style={{ fontSize: 11, padding: '4px 9px' }}>
                  <Icon d={Ic.diff} size={11} /> Rewrite section
                </button>
                <button className="btn-soft" style={{ fontSize: 11, padding: '4px 9px' }}>
                  <Icon d={Ic.page} size={11} /> New linked note
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Mode row */}
      <div style={{ padding: '8px 12px 4px', display: 'flex', gap: 4, borderTop: '1px solid var(--line)' }}>
        {['Ask','Continue','Summarize','Critique'].map((m,i) => (
          <button key={m} className={i===0 ? 'btn-primary' : 'btn-soft'}
                  style={{ fontSize: 11, padding: '3px 8px', flex: i===0 ? '0 0 auto' : '0 0 auto' }}>
            {m}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{ padding: '6px 10px 12px' }}>
        <div style={{
          background: 'var(--panel)', border: '1px solid var(--line)',
          borderRadius: 10, padding: '10px 12px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontSize: 13, color: 'var(--ink3)' }}>
            Ask anything about this note…
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="btn-soft" style={{ padding: 4, border: 0 }}>
              <Icon d={Ic.attach} size={13} />
            </button>
            <span className="chip" style={{ fontSize: 10 }}>
              <span className="mono" style={{ fontSize: 9 }}>codex-cli</span>
              <span style={{ opacity: 0.5 }}>·</span>
              sonnet-4.5
            </span>
            <div style={{ flex: 1 }} />
            <button className="btn-primary" style={{ padding: 5, borderRadius: 8 }}>
              <Icon d={Ic.send} size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------- */
/*  Top bar                                                          */
/* ---------------------------------------------------------------- */
const TopBar = ({ direction = 'A' }) => {
  const mono = direction === 'B';
  return (
    <div style={{
      height: 44, borderBottom: '1px solid var(--line)',
      display: 'flex', alignItems: 'center', padding: '0 14px',
      gap: 12, background: 'var(--panel)', flex: '0 0 auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 6,
          background: 'var(--accent)', color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
        }}>S</div>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>Smart Notes</div>
      </div>
      <div style={{ height: 16, width: 1, background: 'var(--line)' }} />
      <div className={mono ? '' : 'mono'} style={{ fontSize: 12, color: 'var(--ink2)',
              fontFamily: mono ? 'inherit' : "'JetBrains Mono', monospace",
              display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: 'var(--ink3)' }}>vault</span>
        <span style={{ color: 'var(--ink3)' }}>/</span>
        Optics R&amp;D
        <span style={{ color: 'var(--ink3)' }}>/</span>
        Illumination
        <span style={{ color: 'var(--ink3)' }}>/</span>
        <span style={{ color: 'var(--ink)' }}>Köhler integrator sizing.md</span>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                      border: '1px solid var(--line)', borderRadius: 7, fontSize: 12,
                      color: 'var(--ink3)', minWidth: 220 }}>
          <Icon d={Ic.search} size={12} />
          <span>Search notes…</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                         padding: '1px 4px', border: '1px solid var(--line)', borderRadius: 3 }}>⌘K</span>
        </div>
        <div className="chip" style={{ fontSize: 10.5 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: 'oklch(0.65 0.15 145)' }} />
          Saved · 14:32
        </div>
        <div style={{ width: 26, height: 26, borderRadius: 13, background: 'var(--line2)',
                      border: '1px solid var(--line)' }} />
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------- */
/*  Editor pane formatting ribbon                                   */
/* ---------------------------------------------------------------- */
const FormatBar = ({ direction }) => {
  const items = ['H1','H2','H3','|','B','I','S','|','</>','—','Σ','|','• List','1. List','☐ Task','| Table','|','🔗','📎'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px',
                  borderBottom: '1px solid var(--line)', background: 'var(--panel)',
                  fontSize: 12, color: 'var(--ink2)', flex: '0 0 auto', overflow: 'hidden' }}>
      {items.map((t, i) => t === '|'
        ? <div key={i} style={{ width: 1, height: 14, background: 'var(--line)' }} />
        : <button key={i} className="btn-soft" style={{ border: 0, padding: '4px 8px', fontWeight: 500,
              fontFamily: ['B','I','S','Σ'].includes(t) ? 'serif' : 'inherit',
              fontStyle: t==='I' ? 'italic' : 'normal',
              textDecoration: t==='S' ? 'line-through' : 'none',
              fontWeight: t==='B' ? 700 : 500,
          }}>{t}</button>
      )}
      <div style={{ flex: 1 }} />
      <button className="btn-soft" style={{ fontSize: 11 }}>
        <Icon d={Ic.edit} size={11} /> Edit
      </button>
      <button className="btn-soft" style={{ fontSize: 11, color: 'var(--accent)',
                                            borderColor: 'var(--accent)' }}>
        <Icon d={Ic.pen} size={11} /> Draw
      </button>
    </div>
  );
};

/* ---------------------------------------------------------------- */
/*  Title block                                                     */
/* ---------------------------------------------------------------- */
const TitleBlock = ({ direction = 'A' }) => {
  const serif = direction !== 'B';
  return (
    <div style={{ padding: '28px 56px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span className="chip">
          <span style={{ width: 6, height: 6, borderRadius: 3, background: 'oklch(0.65 0.15 145)' }} />
          living
        </span>
        <span className="chip"><Icon d={Ic.hash} size={10} /> optics</span>
        <span className="chip"><Icon d={Ic.hash} size={10} /> illumination</span>
        <span className="chip" style={{ color: 'var(--ink3)' }}>updated · 2h ago by AI</span>
      </div>
      <h1 style={{
        fontFamily: serif
          ? (direction === 'C' ? '"Source Serif 4", Georgia, serif' : '"Newsreader", Georgia, serif')
          : 'inherit',
        fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em',
        margin: '0 0 6px', lineHeight: 1.15,
      }}>
        Köhler integrator sizing
      </h1>
      <div style={{ fontSize: 12.5, color: 'var(--ink3)', display: 'flex', gap: 10 }}>
        <span>4 min read</span>
        <span>·</span>
        <span>1 image · 1 code block · 3 equations</span>
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------- */
/*  Direction A — Notebook Classic                                  */
/* ---------------------------------------------------------------- */
const EditorClassic = ({ dark = false }) => (
  <div className={'dirA' + (dark ? ' dark' : '')} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
    <TopBar direction="A" />
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '252px 1fr 360px', minHeight: 0 }}>
      <div style={{ background: 'var(--rail)', borderRight: '1px solid var(--line)',
                    overflow: 'hidden' }} className="no-scroll">
        <Tree />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg)' }}>
        <FormatBar direction="A" />
        <div className="no-scroll" style={{ flex: 1, overflow: 'auto' }}>
          <TitleBlock direction="A" />
          <div style={{ padding: '0 56px 40px' }}>
            <NoteBody direction="A" />
          </div>
        </div>
      </div>
      <div style={{ borderLeft: '1px solid var(--line)', minHeight: 0 }}>
        <AiSidebar direction="A" dark={dark} />
      </div>
    </div>
  </div>
);

const EditorClassicDark = () => <EditorClassic dark />;
/* ---------------------------------------------------------------- */
/*  Secondary screen — AI Diff Review                                */
/* ---------------------------------------------------------------- */
const DiffReview = () => (
  <div className="dirA" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
    <TopBar direction="A" />
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '252px 1fr 360px', minHeight: 0 }}>
      <div style={{ background: 'var(--rail)', borderRight: '1px solid var(--line)' }} className="no-scroll">
        <Tree />
      </div>

      {/* Center: diff */}
      <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--line)',
                      display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto' }}>
          <span style={{ color: 'var(--accent)' }}><Icon d={Ic.sparkle} size={15} /></span>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Review AI rewrite</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink3)' }}>
              §&nbsp;Mixing condition · 3 lines changed · proposed 14:31
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn-soft">Edit before accepting</button>
          <button className="btn-soft" style={{ color: 'oklch(0.55 0.16 25)' }}>
            <Icon d={Ic.x} size={12} /> Reject
          </button>
          <button className="btn-primary">
            <Icon d={Ic.check} size={12} /> Accept &amp; commit
          </button>
        </div>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 0 }}>
          {/* Before */}
          <div className="no-scroll" style={{ overflow: 'auto', padding: '20px 28px',
                                              borderRight: '1px solid var(--line)' }}>
            <div style={{ fontSize: 10.5, color: 'var(--ink3)', letterSpacing: '0.08em',
                          textTransform: 'uppercase', marginBottom: 14 }}>
              before · current note
            </div>
            <div style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 16, lineHeight: 1.7 }}>
              <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 10px' }}>Mixing condition</h2>
              <p>Uniformity at the pipe exit scales with the number of internal bounces N.</p>
              <p className="diff-rem">
                For decent uniformity, pick N around 3 or so. So roughly L should be a few times a divided
                by tan of the input half-angle.
              </p>
              <p className="diff-rem mono" style={{ fontStyle: 'italic', fontSize: 13 }}>
                $$ N \approx L/a \cdot \theta $$
              </p>
              <p>The resulting length governs the relay back-focal-distance.</p>
            </div>
          </div>

          {/* After */}
          <div className="no-scroll" style={{ overflow: 'auto', padding: '20px 28px' }}>
            <div style={{ fontSize: 10.5, color: 'var(--ink3)', letterSpacing: '0.08em',
                          textTransform: 'uppercase', marginBottom: 14,
                          display: 'flex', justifyContent: 'space-between' }}>
              <span>proposed · claude-haiku-4.5</span>
              <span className="chip" style={{ fontSize: 10 }}>git: AI: rewrite §mixing</span>
            </div>
            <div style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 16, lineHeight: 1.7 }}>
              <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 10px' }}>Mixing condition</h2>
              <p>Uniformity at the pipe exit scales with the number of internal bounces N.</p>
              <p className="diff-add">
                Typical projection illuminators target N ≥ 3 for ≤ 2% non-uniformity. From small-angle
                geometry, the minimum length follows directly from the entrance half-angle θ<sub>in</sub>.
              </p>
              <div className="diff-add" style={{ padding: '8px 12px', borderRadius: 6 }}>
                <Eq>N ≈ (L / a) · tan θ<sub>in</sub></Eq>
                <Eq>L<sub>min</sub> = 3 a / tan θ<sub>in</sub></Eq>
              </div>
              <p>The resulting length governs the relay back-focal-distance.</p>
            </div>
          </div>
        </div>

        {/* Footer rationale */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--line)',
                      background: 'var(--panel)', flex: '0 0 auto',
                      display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span className="chip" style={{ background: 'var(--accent-bg)', borderColor: 'transparent' }}>
            <Icon d={Ic.sparkle} size={10} /> rationale
          </span>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.55, flex: 1 }}>
            Tightened the prose, added the explicit ≤ 2% threshold, and fixed the math block — the previous
            equation was missing the tangent and the bounce-count constant.
          </div>
          <span className="chip mono" style={{ fontSize: 10 }}>1 commit pending</span>
        </div>
      </div>

      <div style={{ borderLeft: '1px solid var(--line)' }}>
        <AiSidebar direction="A" />
      </div>
    </div>
  </div>
);

/* ---------------------------------------------------------------- */
/*  Secondary screen — Capture (desktop modal)                       */
/* ---------------------------------------------------------------- */
const Capture = () => (
  <div className="dirA" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
                                  position: 'relative' }}>
    <TopBar direction="A" />
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '252px 1fr 360px', minHeight: 0,
                  filter: 'blur(2px) saturate(0.7)', opacity: 0.55 }}>
      <div style={{ background: 'var(--rail)', borderRight: '1px solid var(--line)' }} />
      <div style={{ background: 'var(--bg)' }} />
      <div style={{ borderLeft: '1px solid var(--line)', background: 'var(--rail)' }} />
    </div>
    {/* Scrim */}
    <div style={{ position: 'absolute', inset: '44px 0 0 0', background: 'rgba(20,15,10,0.18)' }} />
    {/* Modal */}
    <div style={{
      position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      width: 680, background: 'var(--panel)', borderRadius: 14,
      boxShadow: '0 30px 80px -20px rgba(0,0,0,0.4), 0 0 0 1px var(--line)',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)',
                    display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon d={Ic.inbox} size={15} />
        <div style={{ fontWeight: 600, fontSize: 14 }}>Quick capture</div>
        <span className="chip mono" style={{ fontSize: 10 }}>⌘⇧V</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>auto-detected: <b style={{ color: 'var(--ink)' }}>URL</b></span>
      </div>

      <div style={{ padding: 18 }}>
        <div style={{ padding: 14, border: '1px dashed var(--line)', borderRadius: 10,
                      background: 'var(--bg)' }}>
          <div className="mono" style={{ fontSize: 12, color: 'var(--ink)' }}>
            https://arxiv.org/abs/2306.04567
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 12 }}>
            <div className="imgph" style={{ width: 84, height: 84, fontSize: 8 }}>preview</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                Tapered light-pipe homogenizers — analytic uniformity bounds
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.5, marginBottom: 6 }}>
                We derive closed-form expressions for irradiance non-uniformity at the exit of square
                light-pipes under finite-étendue Lambertian sources…
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <span className="chip">arxiv.org</span>
                <span className="chip">PDF · 1.8 MB</span>
                <span className="chip">8 min read</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--ink3)',
                      letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
          where to save
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { label: 'Inbox', sub: 'Optics R&D / Inbox · default', primary: true, icon: Ic.inbox },
            { label: 'New note', sub: 'Create page from this capture', icon: Ic.plus },
            { label: 'Append to…', sub: 'Pick an existing page', icon: Ic.page },
            { label: 'Ask AI first', sub: 'Summarize before saving', icon: Ic.sparkle },
          ].map((o, i) => (
            <button key={i} style={{
              display: 'flex', gap: 10, alignItems: 'center', padding: 12,
              borderRadius: 10, textAlign: 'left',
              border: o.primary ? '1.5px solid var(--accent)' : '1px solid var(--line)',
              background: o.primary ? 'var(--accent-bg)' : 'var(--panel)',
              cursor: 'pointer', font: 'inherit', color: 'var(--ink)',
            }}>
              <span style={{
                width: 32, height: 32, borderRadius: 8, flex: '0 0 auto',
                background: o.primary ? 'var(--accent)' : 'var(--bg)',
                color: o.primary ? 'white' : 'var(--ink2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon d={o.icon} size={14} />
              </span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{o.label}</div>
                <div style={{ fontSize: 11, color: 'var(--ink2)', marginTop: 2 }}>{o.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)',
                    background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="chip"><Icon d={Ic.hash} size={10} /> optics</span>
        <span className="chip"><Icon d={Ic.hash} size={10} /> reading</span>
        <span className="chip" style={{ color: 'var(--ink3)', borderStyle: 'dashed' }}>+ tag</span>
        <div style={{ flex: 1 }} />
        <button className="btn-soft">Cancel</button>
        <button className="btn-primary">
          Save to Inbox
          <span className="mono" style={{ marginLeft: 4, fontSize: 10, opacity: 0.8 }}>↵</span>
        </button>
      </div>
    </div>
  </div>
);

/* ---------------------------------------------------------------- */
/*  Mobile screens — iPhone 14 viewport (390 × 844)                  */
/* ---------------------------------------------------------------- */
const Phone = ({ children, label }) => (
  <div style={{
    width: '100%', height: '100%',
    background: '#000',
    borderRadius: 38, padding: 8,
    boxShadow: '0 8px 30px -10px rgba(0,0,0,0.25)',
  }}>
    <div style={{
      width: '100%', height: '100%', borderRadius: 30, overflow: 'hidden',
      position: 'relative', background: 'var(--bg)',
    }}>
      {/* Notch */}
      <div style={{
        position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
        width: 110, height: 28, background: '#000', borderRadius: 18, zIndex: 5,
      }} />
      {/* Status bar */}
      <div style={{
        height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 26px', fontSize: 13.5, fontWeight: 600, position: 'relative', zIndex: 6,
        color: 'var(--ink)',
      }}>
        <span>9:41</span>
        <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
          <span style={{ fontSize: 10 }}>●●●</span>
          <span style={{ fontSize: 10 }}>◔</span>
          <span style={{
            width: 22, height: 11, borderRadius: 3, border: '1.2px solid currentColor',
            position: 'relative',
          }}>
            <span style={{ position: 'absolute', inset: 1.2, background: 'currentColor', borderRadius: 1 }} />
          </span>
        </span>
      </div>
      {children}
    </div>
  </div>
);

const MobileNotePage = () => (
  <div className="dirA" style={{ width: '100%', height: '100%' }}>
    <Phone>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 44px)' }}>
        {/* Page header */}
        <div style={{ padding: '6px 14px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn-soft" style={{ padding: 6, border: 0 }}>
            <Icon d="M15 6l-6 6 6 6" size={16} />
          </button>
          <div style={{ fontSize: 11.5, color: 'var(--ink3)', flex: 1, minWidth: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Optics R&D / Illumination
          </div>
          <button className="btn-soft" style={{ padding: 6, border: 0 }}>
            <Icon d={Ic.more} size={16} />
          </button>
        </div>

        <div className="no-scroll" style={{ flex: 1, overflow: 'auto', padding: '0 20px 100px' }}>
          <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
            <span className="chip" style={{ fontSize: 10 }}>
              <span style={{ width: 5, height: 5, borderRadius: 3, background: 'oklch(0.65 0.15 145)' }} />
              living
            </span>
            <span className="chip" style={{ fontSize: 10 }}>#optics</span>
          </div>
          <h1 style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 26, fontWeight: 600,
                       letterSpacing: '-0.02em', margin: '0 0 6px', lineHeight: 1.2 }}>
            Köhler integrator sizing
          </h1>
          <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginBottom: 16 }}>
            updated 2h ago by AI · 4 min read
          </div>

          <h2 style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 18, fontWeight: 600,
                       margin: '14px 0 6px' }}>Mixing condition</h2>
          <p style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 15.5, lineHeight: 1.6,
                      margin: '0 0 12px' }}>
            Uniformity at the pipe exit scales with the number of internal bounces N. Rule of thumb for
            ≤ 2% non-uniformity: N ≥ 3.
          </p>

          <div style={{
            padding: '10px 14px', borderRadius: 10,
            background: 'var(--accent-bg)', border: '1px solid var(--line)',
            margin: '12px 0',
          }}>
            <Eq>N ≈ (L / a) · tan θ<sub>in</sub></Eq>
            <Eq>L<sub>min</sub> = 3 a / tan θ<sub>in</sub></Eq>
          </div>

          <p style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 15.5, lineHeight: 1.6,
                      margin: '0 0 12px' }}>
            With θ<sub>in</sub> = 12° and a = 4 mm, L ≈ 56 mm. The resulting length governs the relay
            back-focal-distance.
          </p>

          <div className="imgph" style={{ height: 90, fontSize: 9, margin: '12px 0' }}>
            optical layout
          </div>
        </div>

        {/* Floating AI button */}
        <div style={{
          position: 'absolute', bottom: 96, right: 16,
          display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end',
        }}>
          <button style={{
            width: 56, height: 56, borderRadius: 28, border: 0, cursor: 'pointer',
            background: 'var(--accent)', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 10px 24px -6px oklch(0.55 0.13 35 / 0.45)',
          }}>
            <Icon d={Ic.sparkle} size={22} sw={1.8} />
          </button>
        </div>

        {/* Bottom tab bar */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'var(--panel)', borderTop: '1px solid var(--line)',
          padding: '8px 0 28px',
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4,
        }}>
          {[
            { i: Ic.notebook, l: 'Notes', a: true },
            { i: Ic.plus, l: 'Capture' },
            { i: Ic.search, l: 'Search' },
            { i: Ic.sparkle, l: 'AI' },
          ].map((t, i) => (
            <div key={i} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              color: t.a ? 'var(--accent)' : 'var(--ink3)', fontSize: 10.5,
            }}>
              <Icon d={t.i} size={20} sw={1.7} />
              <span style={{ fontWeight: t.a ? 600 : 400 }}>{t.l}</span>
            </div>
          ))}
        </div>
      </div>
    </Phone>
  </div>
);

const MobileAiSheet = () => (
  <div className="dirA" style={{ width: '100%', height: '100%' }}>
    <Phone>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 44px)',
                    position: 'relative' }}>
        {/* Dimmed page underneath */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.35, padding: '0 20px',
                      pointerEvents: 'none' }}>
          <h1 style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 24, fontWeight: 600,
                       margin: '14px 0 6px' }}>Köhler integrator sizing</h1>
          <div style={{ fontSize: 11.5, color: 'var(--ink3)' }}>updated 2h ago</div>
          <p style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 15, marginTop: 16,
                      lineHeight: 1.55, color: 'var(--ink2)' }}>
            Uniformity at the pipe exit scales with N, the number of internal bounces. Rule of thumb…
          </p>
        </div>

        {/* Sheet */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: '78%', background: 'var(--panel)',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -8px 24px -10px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
            <div style={{ width: 42, height: 4, background: 'var(--line)', borderRadius: 2 }} />
          </div>
          <div style={{ padding: '4px 16px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--accent)' }}><Icon d={Ic.sparkle} size={16} /></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Ask about this note</div>
              <div style={{ fontSize: 10.5, color: 'var(--ink3)' }}>Köhler integrator sizing · 2.1k tokens</div>
            </div>
            <button className="btn-soft" style={{ padding: 4, border: 0 }}><Icon d={Ic.x} size={14} /></button>
          </div>

          {/* Suggested prompts */}
          <div style={{ padding: '0 16px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['Continue derivation','Numerical example','Critique','Summarize'].map((s,i) => (
              <span key={i} className="chip" style={{ fontSize: 11, padding: '4px 9px',
                background: i===0 ? 'var(--accent-bg)' : 'transparent',
                borderColor: i===0 ? 'transparent' : 'var(--line)',
              }}>{s}</span>
            ))}
          </div>

          {/* Convo */}
          <div className="no-scroll" style={{ flex: 1, overflow: 'auto', padding: '0 16px 8px',
                                              display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ alignSelf: 'flex-end', maxWidth: '82%',
                          background: 'var(--accent-bg)', borderRadius: 14, padding: '8px 12px',
                          fontSize: 13, lineHeight: 1.5 }}>
              Continue past the mixing condition — show how L scales with required uniformity.
            </div>
            <div style={{ alignSelf: 'flex-start', maxWidth: '92%',
                          fontSize: 13, lineHeight: 1.55 }}>
              <div style={{ fontSize: 10, color: 'var(--ink3)', marginBottom: 4,
                            letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                claude-haiku-4.5
              </div>
              <div>
                For a square light-pipe of side a, uniformity improves as the bounce count N grows:
              </div>
              <div style={{ padding: '8px 10px', marginTop: 6, background: 'var(--bg)',
                            borderRadius: 8, border: '1px solid var(--line)' }}>
                <Eq>N ≈ (L / a) · tan θ<sub>in</sub></Eq>
              </div>
              <div style={{ marginTop: 8 }}>
                With θ = 12° and a = 4 mm, L ≈ 56 mm.
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn-primary" style={{ fontSize: 11, padding: '4px 9px' }}>
                  <Icon d={Ic.plus} size={11} /> Append
                </button>
                <button className="btn-soft" style={{ fontSize: 11, padding: '4px 9px' }}>
                  <Icon d={Ic.diff} size={11} /> Rewrite
                </button>
              </div>
            </div>
          </div>

          {/* Input */}
          <div style={{ padding: '8px 12px 18px', borderTop: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                          padding: '8px 10px', background: 'var(--bg)',
                          borderRadius: 22, border: '1px solid var(--line)' }}>
              <Icon d={Ic.attach} size={15} />
              <span style={{ fontSize: 14, color: 'var(--ink3)', flex: 1 }}>Ask anything…</span>
              <button className="btn-primary" style={{ width: 32, height: 32, padding: 0, borderRadius: 16 }}>
                <Icon d={Ic.send} size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Phone>
  </div>
);

/* ---------------------------------------------------------------- */
/*  Export to window                                                 */
/* ---------------------------------------------------------------- */
Object.assign(window, {
  EditorClassic, EditorClassicDark,
  DiffReview, Capture, MobileNotePage, MobileAiSheet,
});
