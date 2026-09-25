// Stylus / drawing screen — Direction A
// Adds: ink ribbon, hand-drawn canvas content, AI-ink actions (recognize text,
// shape, solve math), and a mobile stylus variant.

const _Ink_Icon = ({ d, size=14, sw=1.5, fill='none' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
       strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{flex:'0 0 auto'}}>
    <path d={d} />
  </svg>
);

// Tool icons (SVG path "d")
const InkIc = {
  pen:        'M3 21l3-1 12-12-2-2L4 18l-1 3zM15 6l3 3',
  highlight:  'M6 19l3 1 9-9-4-4-9 9 1 3zM4 21h7',
  pencil:     'M3 21l3-1 13-13-2-2L4 18l-1 3z',
  eraser:     'M3 17L13 7l6 6-7 7H6l-3-3zM10 10l6 6',
  lasso:      'M5 7c0-2 3-4 7-4s7 2 7 4-3 4-7 4-7-2-7-4zm0 0c0 6 7 8 7 14 0-2-3-3-3-5',
  ruler:      'M3 13L11 5l8 8-8 8-8-8zM6 10l1 1M9 7l1 1M12 10l1 1M9 13l1 1M12 16l1 1',
  text:       'M5 6h14M12 6v14M9 20h6',
  shape:      'M4 4h7v7H4zM13 13h7v7h-7zM13 4l7 4-7 4z',
  undo:       'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo:       'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  sparkle:    'M12 3l1.8 4.7L18 9l-4.2 1.3L12 15l-1.8-4.7L6 9l4.2-1.3z',
  check:      'M5 13l4 4L19 7',
  x:          'M6 6l12 12M6 18L18 6',
  layers:     'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  hand:       'M7 11V5a2 2 0 1 1 4 0v6M11 11V4a2 2 0 1 1 4 0v7M15 11V6a2 2 0 1 1 4 0v9c0 4-3 7-7 7s-7-3-7-7v-3a2 2 0 1 1 4 0',
  more:       'M6 12h.01M12 12h.01M18 12h.01',
  plus:       'M12 5v14M5 12h14',
  page:       'M6 3h9l4 4v14H6z M15 3v4h4',
  diff:       'M9 4v16M15 4v16M3 8l6-4M3 16l6 4M21 8l-6-4M21 16l-6 4',
};

/* ---------------- Ink ribbon (replaces format ribbon in draw mode) ---- */

const InkPalette = [
  '#1c1a17', '#1e3a8a', '#7c2d12', '#166534',
  '#a16207', '#9d174d', '#7e22ce', '#f59e0b',
];

const InkRibbon = ({ tool='pen', color='#1c1a17', thickness=2 }) => {
  const tools = [
    { id: 'pen',       label: 'Pen',         icon: InkIc.pen },
    { id: 'highlight', label: 'Highlight',   icon: InkIc.highlight },
    { id: 'pencil',    label: 'Pencil',      icon: InkIc.pencil },
    { id: 'eraser',    label: 'Eraser',      icon: InkIc.eraser },
    { id: 'lasso',     label: 'Lasso',       icon: InkIc.lasso, sel: true /* highlighted in this screenshot */ },
    { id: 'ruler',     label: 'Ruler',       icon: InkIc.ruler },
    { id: 'text',      label: 'Type',        icon: InkIc.text },
    { id: 'shape',     label: 'Shape',       icon: InkIc.shape },
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
      borderBottom: '1px solid var(--line)', background: 'var(--panel)',
      flex: '0 0 auto', minWidth: 0, overflow: 'hidden',
    }}>
      {/* Tools */}
      <div style={{ display: 'flex', gap: 2 }}>
        {tools.map(t => (
          <div key={t.id} className={'ink-tool' + (t.sel ? ' sel' : '')}>
            <_Ink_Icon d={t.icon} size={16} />
            <span>{t.label}</span>
          </div>
        ))}
      </div>

      <div style={{ width: 1, height: 28, background: 'var(--line)', margin: '0 8px' }} />

      {/* Colors */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        {InkPalette.map((c, i) => (
          <div key={c} className={'ink-swatch' + (i === 0 ? ' sel' : '')}
               style={{ background: c }} />
        ))}
        <div style={{
          width: 18, height: 18, borderRadius: 9, marginLeft: 2, flex: '0 0 auto',
          background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
          border: '1.5px solid rgba(0,0,0,0.08)',
        }} />
      </div>

      <div style={{ width: 1, height: 28, background: 'var(--line)', margin: '0 8px' }} />

      {/* Thickness */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {[1.2, 2, 3.5, 6].map((w, i) => (
          <div key={i} style={{
            width: 28, height: 28, borderRadius: 6, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: i === 1 ? 'var(--accent-bg)' : 'transparent',
            border: i === 1 ? '1px solid var(--line)' : '1px solid transparent',
          }}>
            <div style={{
              width: 14, height: w, background: 'currentColor',
              borderRadius: w, color: 'var(--ink)',
            }} />
          </div>
        ))}
      </div>

      <div style={{ width: 1, height: 28, background: 'var(--line)', margin: '0 8px' }} />

      {/* Recognition toggles */}
      <div style={{ display: 'flex', gap: 4 }}>
        <div className="chip" style={{
          background: 'var(--accent-bg)', borderColor: 'transparent', color: 'var(--ink)',
          fontSize: 11, padding: '4px 9px',
        }}>
          <_Ink_Icon d={InkIc.sparkle} size={11} />
          Recognize
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 4 }} />

      {/* Undo/redo & exit */}
      <div style={{ display: 'flex', gap: 2 }}>
        <button className="btn-soft" style={{ padding: 6, border: 0 }}>
          <_Ink_Icon d={InkIc.undo} size={14} />
        </button>
        <button className="btn-soft" style={{ padding: 6, border: 0 }}>
          <_Ink_Icon d={InkIc.redo} size={14} />
        </button>
      </div>
      <button className="btn-primary" style={{ marginLeft: 4 }}>
        <_Ink_Icon d={InkIc.check} size={12} /> Done
      </button>
    </div>
  );
};

/* ---------------- The drawn artifacts (handwriting + diagram) -------- */

const InkSketch = () => (
  // Handwritten note + sketch of a light-pipe layout. Slightly wobbly.
  <svg width="100%" height="380" viewBox="0 0 720 380"
       style={{ display: 'block', overflow: 'visible' }}>
    <defs>
      <filter id="rough" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence baseFrequency="0.9" numOctaves="2" seed="3" />
        <feDisplacementMap in="SourceGraphic" scale="0.7" />
      </filter>
    </defs>

    {/* Diagram: LED -> light pipe -> relay -> target */}
    <g stroke="var(--ink)" strokeWidth="1.8" fill="none" strokeLinecap="round"
       strokeLinejoin="round" filter="url(#rough)">
      {/* LED */}
      <path d="M40 200 q-2 -16 14 -18 q18 -2 16 16 q-2 18 -16 18 q-16 0 -14 -16 z" />
      <text x="38" y="248" className="hand" fill="var(--ink)" fontSize="20"
            stroke="none">LED</text>

      {/* Rays expanding */}
      <path d="M72 192 q70 -30 160 -50" />
      <path d="M72 200 q70 -2 160 0" />
      <path d="M72 208 q70 28 160 50" />

      {/* Light pipe (rectangle) */}
      <path d="M232 140 q140 -4 280 0 q4 60 0 120 q-140 4 -280 0 q-4 -60 0 -120 z" />
      {/* Internal bounces */}
      <path d="M240 168 L350 230 L455 168 L510 226" strokeDasharray="3 4" opacity="0.7" />
      <text x="305" y="280" className="hand" fill="var(--ink)" fontSize="18"
            stroke="none">light pipe · a × a × L</text>

      {/* Relay lens */}
      <path d="M540 140 q12 60 0 120" />
      <path d="M560 140 q-12 60 0 120" />
      <text x="538" y="285" className="hand" fill="var(--ink)" fontSize="18"
            stroke="none">relay</text>

      {/* Target plane */}
      <path d="M660 130 L660 270" strokeWidth="2.4" />
      <path d="M540 200 q50 -20 120 -20" />
      <path d="M540 200 q50 20 120 20" />
      <text x="640" y="295" className="hand" fill="var(--ink)" fontSize="18"
            stroke="none">target</text>

      {/* Dimension bracket under pipe */}
      <path d="M232 320 L512 320 M232 310 L232 330 M512 310 L512 330" strokeWidth="1.4" />
      <text x="354" y="345" className="hand" fill="var(--ink)" fontSize="20"
            stroke="none">L ≈ 56 mm</text>
    </g>

    {/* Handwritten margin equation (in pen color) */}
    <g filter="url(#rough)">
      <text x="40" y="60" className="hand" fill="var(--ink)" fontSize="28">
        N = (L / a) · tan θ
      </text>
      <text x="40" y="92" className="hand" fill="var(--ink)" fontSize="22" opacity="0.78">
        need N ≥ 3 for ≤ 2% non-unif.
      </text>
    </g>

    {/* Red margin annotation */}
    <g filter="url(#rough)" stroke="oklch(0.6 0.18 25)" fill="none" strokeWidth="1.8"
       strokeLinecap="round">
      <path d="M555 70 L625 60" />
      <path d="M555 70 L575 56 M555 70 L575 80" />
    </g>
    <text x="430" y="55" className="hand" fill="oklch(0.55 0.18 25)" fontSize="20">
      check étendue here ←
    </text>

    {/* Yellow highlight stripe over heading word */}
    <rect x="32" y="40" width="270" height="28" rx="3"
          fill="oklch(0.9 0.18 95)" opacity="0.45" />

    {/* Lasso selection (dashed marquee) around the handwritten equation */}
    <path d="M28 32 q150 -8 290 4 q14 50 4 80 q-160 12 -300 0 q-8 -42 6 -84 z"
          fill="none" stroke="var(--accent)" strokeWidth="1.4" strokeDasharray="6 4" />
  </svg>
);

const SelectionPopover = () => (
  <div style={{
    position: 'absolute', top: 220, left: 100,
    background: 'var(--panel)', borderRadius: 10,
    border: '1px solid var(--line)',
    boxShadow: '0 12px 30px -10px rgba(0,0,0,0.25)',
    padding: 6, display: 'flex', gap: 4, alignItems: 'center',
    zIndex: 4,
  }}>
    <button className="btn-primary" style={{ fontSize: 11, padding: '5px 9px' }}>
      <_Ink_Icon d={InkIc.sparkle} size={11} /> Recognize as math
    </button>
    <button className="btn-soft" style={{ fontSize: 11 }}>
      <_Ink_Icon d={InkIc.text} size={11} /> To text
    </button>
    <button className="btn-soft" style={{ fontSize: 11 }}>
      <_Ink_Icon d={InkIc.shape} size={11} /> Tidy shapes
    </button>
    <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 4px' }} />
    <button className="btn-soft" style={{ fontSize: 11 }}>Copy</button>
    <button className="btn-soft" style={{ fontSize: 11, color: 'oklch(0.55 0.16 25)' }}>
      <_Ink_Icon d={InkIc.x} size={11} />
    </button>
  </div>
);

/* ---------------- Ink-aware AI sidebar variant ----------------------- */

const InkAiSidebar = ({ dark }) => {
  const bubbleBg = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)';
  const userBg   = dark ? 'oklch(0.32 0.06 45)' : 'oklch(0.95 0.04 70)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--rail)' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)',
                    display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--accent)' }}><_Ink_Icon d={InkIc.sparkle} size={15} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Smart Notes AI</div>
          <div style={{ fontSize: 10.5, color: 'var(--ink3)' }}>
            Ink selected · 1 equation, 1 diagram
          </div>
        </div>
        <button className="btn-soft" style={{ padding: 4, border: 0 }}>
          <_Ink_Icon d={InkIc.more} size={14} />
        </button>
      </div>

      {/* Context */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)',
                    display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="chip" style={{ background: 'var(--accent-bg)', borderColor: 'transparent',
                                       color: 'var(--ink)', alignSelf: 'flex-start' }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--accent)' }} />
          Lasso selection · 14 strokes
        </div>
        <div style={{
          padding: '8px 10px', borderRadius: 8, background: 'var(--panel)',
          border: '1px solid var(--line)', fontSize: 12, color: 'var(--ink2)',
          lineHeight: 1.5,
        }}>
          <span style={{ fontSize: 10, color: 'var(--ink3)', letterSpacing: '0.06em',
                         textTransform: 'uppercase' }}>recognized</span>
          <div className="eq" style={{ fontSize: 16, marginTop: 4, color: 'var(--ink)' }}>
            N = (L / a) · tan θ
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
            confidence 96% · LaTeX ready
          </div>
        </div>
      </div>

      {/* Quick actions specific to ink */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6,
                    borderBottom: '1px solid var(--line)' }}>
        {[
          { i: InkIc.text,    t: 'Convert handwriting to text',  s: 'replace strokes inline' },
          { i: InkIc.sparkle, t: 'Insert as LaTeX equation',     s: '$$ N = (L/a)\\tan\\theta $$' },
          { i: InkIc.shape,   t: 'Tidy diagram',                 s: 'straighten + align shapes' },
          { i: InkIc.diff,    t: 'Solve for L given θ, a',       s: 'show numerical answer' },
          { i: InkIc.page,    t: 'Explain in margin',            s: 'add an annotation block' },
        ].map((a, i) => (
          <button key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
            background: 'var(--panel)', border: '1px solid var(--line)',
            borderRadius: 8, textAlign: 'left', cursor: 'pointer', color: 'var(--ink)',
            font: 'inherit',
          }}>
            <span style={{ color: 'var(--accent)' }}><_Ink_Icon d={a.i} size={13} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>{a.t}</div>
              <div style={{ fontSize: 10.5, color: 'var(--ink3)', marginTop: 1,
                            fontFamily: a.t.includes('LaTeX')
                              ? "'JetBrains Mono', monospace" : 'inherit' }}>
                {a.s}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Assistant message — proactive interpretation */}
      <div className="no-scroll" style={{ flex: 1, overflow: 'auto', padding: '12px 12px 4px' }}>
        <div style={{ fontSize: 10.5, color: 'var(--ink3)', marginBottom: 4,
                      letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          claude-haiku-4.5
        </div>
        <div style={{ background: bubbleBg, padding: '10px 12px', borderRadius: 10,
                      fontSize: 13, lineHeight: 1.55 }}>
          Your sketch shows a Köhler integrator with the relay placed one focal length from the pipe
          exit. The handwritten condition <span className="eq">N ≥ 3</span> is consistent with the
          equation above. With <span className="eq">a = 4 mm, θ = 12°</span> I get
          <span className="eq"> L ≈ 56.4 mm</span> — matches your annotation.
        </div>
      </div>

      <div style={{ padding: '6px 10px 12px' }}>
        <div style={{
          background: 'var(--panel)', border: '1px solid var(--line)',
          borderRadius: 10, padding: '10px 12px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 13, color: 'var(--ink3)', flex: 1 }}>
            Ask about this sketch…
          </span>
          <span className="chip" style={{ fontSize: 10 }}>
            <span className="mono" style={{ fontSize: 9 }}>codex-cli</span>
          </span>
          <button className="btn-primary" style={{ padding: 5, borderRadius: 8 }}>
            <_Ink_Icon d="M3 11l18-8-8 18-2.5-7.5z" size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- Main screen ---------------------------------------- */

const EditorDrawing = ({ dark = false }) => (
  <div className={'dirA' + (dark ? ' dark' : '')}
       style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
    <TopBar direction="A" />
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '252px 1fr 360px', minHeight: 0 }}>
      <div style={{ background: 'var(--rail)', borderRight: '1px solid var(--line)',
                    overflow: 'hidden' }} className="no-scroll">
        <Tree />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0,
                      background: 'var(--bg)' }}>
        <InkRibbon />

        {/* Canvas */}
        <div className="no-scroll" style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {/* Page title block — still rendered, ink sits on top */}
          <div style={{ padding: '20px 56px 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span className="chip">
                <span style={{ width: 6, height: 6, borderRadius: 3, background: 'oklch(0.65 0.15 145)' }} />
                living · drawing
              </span>
              <span className="chip">#optics</span>
              <span className="chip" style={{ color: 'var(--ink3)' }}>
                ink layer · 28 strokes
              </span>
            </div>
            <h1 style={{
              fontFamily: '"Newsreader", Georgia, serif', fontSize: 30, fontWeight: 600,
              letterSpacing: '-0.02em', margin: '0 0 4px',
            }}>
              Köhler integrator sizing
            </h1>
            <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
              Drawing on top of: §&nbsp;Mixing condition
            </div>
          </div>

          {/* Paper area with dot grid */}
          <div className="paper-dot" style={{
            margin: '14px 32px 40px', borderRadius: 10, padding: '8px 24px 24px',
            border: '1px solid var(--line)',
            background: 'var(--panel)',
            position: 'relative', minHeight: 480,
          }}>
            <InkSketch />
            <SelectionPopover />

            {/* Ghosted prose hint that ink covers original text */}
            <div style={{
              position: 'absolute', bottom: 18, left: 24, right: 24,
              fontSize: 12, color: 'var(--ink3)', display: 'flex', gap: 10,
              alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span>Pressure-sensitive · Apple Pencil 2 · 240 Hz</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <span className="chip" style={{ fontSize: 10 }}>layer · ink 1</span>
                <span className="chip" style={{ fontSize: 10 }}>opacity 100%</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ borderLeft: '1px solid var(--line)', minHeight: 0 }}>
        <InkAiSidebar dark={dark} />
      </div>
    </div>
  </div>
);

const EditorDrawingDark = () => <EditorDrawing dark />;

/* ---------------- Mobile stylus ------------------------------------- */

const MobileDrawing = () => (
  <div className="dirA" style={{ width: '100%', height: '100%' }}>
    <Phone>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 44px)' }}>
        <div style={{ padding: '6px 14px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn-soft" style={{ padding: 6, border: 0 }}>
            <_Ink_Icon d="M15 6l-6 6 6 6" size={16} />
          </button>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--ink3)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Köhler integrator sizing · drawing
          </div>
          <button className="btn-soft" style={{ padding: '4px 8px', fontSize: 11, border: 0,
                                                color: 'var(--accent)', fontWeight: 600 }}>
            Done
          </button>
        </div>

        {/* Canvas */}
        <div className="paper-dot" style={{
          flex: 1, margin: '0 12px 12px', borderRadius: 12,
          border: '1px solid var(--line)', background: 'var(--panel)',
          position: 'relative', overflow: 'hidden',
        }}>
          <svg width="100%" height="100%" viewBox="0 0 360 520"
               style={{ display: 'block' }}>
            <defs>
              <filter id="rough2" x="-5%" y="-5%" width="110%" height="110%">
                <feTurbulence baseFrequency="0.9" numOctaves="2" seed="5" />
                <feDisplacementMap in="SourceGraphic" scale="0.6" />
              </filter>
            </defs>
            <rect x="14" y="22" width="220" height="32" rx="3"
                  fill="oklch(0.9 0.18 95)" opacity="0.45" />
            <g filter="url(#rough2)">
              <text x="18" y="50" className="hand" fontSize="26" fill="var(--ink)">Mixing</text>
              <text x="18" y="92" className="hand" fontSize="22" fill="var(--ink)">N = (L/a)·tan θ</text>
              <text x="18" y="120" className="hand" fontSize="18" fill="var(--ink)" opacity="0.78">
                need N ≥ 3
              </text>
            </g>
            <g stroke="var(--ink)" strokeWidth="1.8" fill="none" filter="url(#rough2)"
               strokeLinecap="round">
              <path d="M30 220 q-2 -14 12 -16 q16 -2 14 14 q-2 16 -14 16 q-14 0 -12 -14 z" />
              <path d="M58 218 q60 -20 130 -32" />
              <path d="M58 226 q60 -2 130 0" />
              <path d="M58 234 q60 20 130 32" />
              <path d="M190 188 q90 -4 130 0 q4 36 0 76 q-90 4 -130 0 q-4 -36 0 -76 z" />
              <path d="M196 212 L260 250 L320 212" strokeDasharray="3 4" opacity="0.7" />
              <text x="208" y="288" className="hand" fontSize="16" fill="var(--ink)" stroke="none">
                light pipe
              </text>
              <path d="M30 360 L320 360 M30 350 L30 370 M320 350 L320 370" />
              <text x="130" y="388" className="hand" fontSize="18" fill="var(--ink)" stroke="none">
                L ≈ 56 mm
              </text>
            </g>
          </svg>

          {/* AI suggestion chip */}
          <div style={{
            position: 'absolute', bottom: 12, left: 12, right: 12,
            background: 'var(--panel)', borderRadius: 12,
            border: '1px solid var(--line)',
            padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '0 8px 20px -10px rgba(0,0,0,0.2)',
          }}>
            <span style={{ color: 'var(--accent)' }}><_Ink_Icon d={InkIc.sparkle} size={14} /></span>
            <div style={{ flex: 1, fontSize: 12, lineHeight: 1.4 }}>
              <div style={{ fontWeight: 600 }}>Recognized: math + diagram</div>
              <div style={{ color: 'var(--ink3)', fontSize: 11 }}>Tap to convert or ask AI</div>
            </div>
            <button className="btn-primary" style={{ fontSize: 11, padding: '4px 10px' }}>
              Convert
            </button>
          </div>
        </div>

        {/* Ink toolbar (mobile) */}
        <div style={{
          padding: '8px 10px 22px', background: 'var(--panel)',
          borderTop: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {[InkIc.pen, InkIc.highlight, InkIc.pencil, InkIc.eraser, InkIc.lasso].map((d, i) => (
            <div key={i} style={{
              width: 38, height: 38, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: i === 0 ? 'var(--accent-bg)' : 'transparent',
              border: i === 0 ? '1px solid var(--line)' : '1px solid transparent',
              color: i === 0 ? 'var(--ink)' : 'var(--ink2)',
            }}>
              <_Ink_Icon d={d} size={18} />
            </div>
          ))}
          <div style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 4px' }} />
          {['#1c1a17','#1e3a8a','#7c2d12','#166534','#a16207'].map((c, i) => (
            <div key={c} className={'ink-swatch' + (i === 0 ? ' sel' : '')}
                 style={{ background: c, width: 22, height: 22, borderRadius: 11 }} />
          ))}
          <div style={{ flex: 1 }} />
          <button className="btn-soft" style={{ padding: 6, border: 0 }}>
            <_Ink_Icon d={InkIc.sparkle} size={16} />
          </button>
        </div>
      </div>
    </Phone>
  </div>
);

Object.assign(window, { EditorDrawing, EditorDrawingDark, MobileDrawing });
