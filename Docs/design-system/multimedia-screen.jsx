// Multimedia page — shows a richer note with the full block vocabulary:
// web clipping, stylus annotations over typed text, lists, checklists, equations,
// links, citations, image embed.

const _MM_Icon = ({ d, size=14, sw=1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{flex:'0 0 auto'}}>
    <path d={d} />
  </svg>
);
const MMIc = {
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.5 1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.5-1.5',
  check: 'M5 13l4 4L19 7',
  square: 'M5 5h14v14H5z',
  squareChecked: 'M5 5h14v14H5z M8 12l3 3 5-6',
  external: 'M14 4h6v6M10 14L21 3M20 13v7H4V4h7',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  pen: 'M3 21l3-1 12-12-2-2L4 18l-1 3zM15 6l3 3',
  sparkle: 'M12 3l1.8 4.7L18 9l-4.2 1.3L12 15l-1.8-4.7L6 9l4.2-1.3z',
  globe: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  quote: 'M7 7v6a4 4 0 0 0 4-4V7H7zM15 7v6a4 4 0 0 0 4-4V7h-4z',
  hash: 'M5 9h14M5 15h14M10 3L8 21M16 3l-2 18',
};

/* ---------------- Annotation overlay -------------------------------- */
// Stylus marks layered over the typed prose.
const ProseAnnotations = () => (
  <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
       width="100%" height="100%">
    <defs>
      <filter id="mm-rough" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence baseFrequency="0.9" numOctaves="2" seed="7" />
        <feDisplacementMap in="SourceGraphic" scale="0.6" />
      </filter>
    </defs>

    {/* Yellow highlighter behind "non-uniformity ≤ 2%" phrase */}
    <rect x="278" y="118" width="180" height="22" rx="2"
          fill="oklch(0.9 0.18 95)" opacity="0.45" />

    {/* Red circle around "trial 14" in title */}
    <g stroke="oklch(0.55 0.18 25)" strokeWidth="1.8" fill="none" filter="url(#mm-rough)"
       strokeLinecap="round">
      <path d="M380 48 q60 -10 92 4 q4 22 -10 32 q-50 8 -88 -2 q-8 -18 6 -34 z" />
    </g>

    {/* Margin arrow + handwritten "rerun!" */}
    <g filter="url(#mm-rough)">
      <path d="M540 100 q40 -10 90 -8" stroke="oklch(0.55 0.18 25)" strokeWidth="1.6"
            fill="none" strokeLinecap="round" />
      <path d="M540 100 l16 -8 M540 100 l14 10"
            stroke="oklch(0.55 0.18 25)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <text x="560" y="78" className="hand" fontSize="20" fill="oklch(0.55 0.18 25)">
        rerun!
      </text>
    </g>

    {/* Underline under the inline link */}
    <path d="M186 230 q60 4 110 0" stroke="oklch(0.5 0.13 240)" strokeWidth="1.4"
          fill="none" filter="url(#mm-rough)" />
  </svg>
);

/* ---------------- Web clipping card --------------------------------- */
const WebClipping = () => (
  <div style={{
    display: 'grid', gridTemplateColumns: '120px 1fr', gap: 14,
    padding: 14, borderRadius: 10,
    border: '1px solid var(--line)',
    background: 'var(--panel)',
    margin: '16px 0',
  }}>
    <div className="imgph" style={{ height: 96, fontSize: 9 }}>
      thumbnail
    </div>
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
                    color: 'var(--ink3)', marginBottom: 4 }}>
        <div style={{ width: 14, height: 14, borderRadius: 3, background: 'oklch(0.45 0.13 240)',
                      color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 9 }}>a</div>
        <span>arxiv.org</span>
        <span>·</span>
        <span>clipped May 21 · 16:08</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: 'var(--ink3)' }}>
          <_MM_Icon d={MMIc.external} size={11} />
        </span>
      </div>
      <div style={{ fontFamily: '"Newsreader", Georgia, serif', fontSize: 16, fontWeight: 600,
                    letterSpacing: '-0.005em', marginBottom: 4, color: 'var(--ink)' }}>
        Tapered light-pipe homogenizers — analytic uniformity bounds
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.5, marginBottom: 8 }}>
        We derive closed-form expressions for irradiance non-uniformity at the exit of square light-pipes
        under finite-étendue Lambertian sources. The dominant scaling matches the bounce-count rule of
        thumb to within 3% for N ≥ 3…
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
        <span className="chip">PDF · 1.8 MB</span>
        <span className="chip">8 min read</span>
        <span className="chip" style={{ background: 'var(--accent-bg)', borderColor: 'transparent',
                                        color: 'var(--ink)' }}>
          <_MM_Icon d={MMIc.sparkle} size={10} /> AI summary
        </span>
      </div>
    </div>
  </div>
);

/* ---------------- The multimedia note body -------------------------- */
const MultimediaBody = () => (
  <div style={{ position: 'relative', fontFamily: '"Newsreader", Georgia, serif',
                fontSize: 16, lineHeight: 1.72, color: 'var(--ink)' }}>
    <ProseAnnotations />

    <p style={{ margin: '12px 0 18px' }}>
      Rerunning the homogenizer characterization with the replacement diffuser. Spec target is
      <span style={{ position: 'relative', padding: '0 2px' }}> non-uniformity ≤ 2% </span>
      across the 6 mm × 6 mm field, but trial 13 showed a band-shaped artifact at the seam — likely a
      mounting-tilt issue. See the&nbsp;
      <a href="#" style={{ color: 'oklch(0.5 0.13 240)', textDecoration: 'none' }}>
        prior log entry
      </a>
      &nbsp;for the as-built measurements.
    </p>

    <WebClipping />

    {/* Checklist */}
    <h2 style={{ fontFamily: 'inherit', fontSize: 20, fontWeight: 600, margin: '24px 0 8px' }}>
      Plan for today
    </h2>
    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px',
                 display: 'flex', flexDirection: 'column', gap: 6,
                 fontFamily: 'Inter, system-ui, sans-serif', fontSize: 14 }}>
      {[
        { d: true,  t: 'Verify étendue budget against new diffuser ED data',  who: 'me' },
        { d: true,  t: 'Order replacement Thorlabs DG10-1500-MD diffuser',    who: 'me · PO #4521' },
        { d: false, t: 'Re-measure uniformity at 6 mm target, 5 angles',      who: 'me' },
        { d: false, t: 'Check thermals after 30 min continuous run',          who: 'jamie' },
        { d: false, t: 'Update the analytic model with measured ED',          who: 'AI · proposed' },
      ].map((c, i) => (
        <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '2px 0' }}>
          <span style={{
            width: 16, height: 16, borderRadius: 4, marginTop: 1,
            border: '1.5px solid ' + (c.d ? 'var(--accent)' : 'var(--ink3)'),
            background: c.d ? 'var(--accent)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
            color: 'white',
          }}>
            {c.d && <_MM_Icon d={MMIc.check} size={11} sw={2.5} />}
          </span>
          <span style={{
            flex: 1, color: c.d ? 'var(--ink3)' : 'var(--ink)',
            textDecoration: c.d ? 'line-through' : 'none',
          }}>{c.t}</span>
          <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{c.who}</span>
        </li>
      ))}
    </ul>

    {/* Ordered list */}
    <h2 style={{ fontFamily: 'inherit', fontSize: 20, fontWeight: 600, margin: '24px 0 8px' }}>
      Procedure
    </h2>
    <ol style={{ paddingLeft: 24, margin: '0 0 14px', fontFamily: 'Inter, system-ui, sans-serif',
                 fontSize: 14, lineHeight: 1.65 }}>
      <li style={{ marginBottom: 4 }}>Center the LED on the optical axis using the alignment pinhole.</li>
      <li style={{ marginBottom: 4 }}>Insert the diffuser at <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, background: 'rgba(0,0,0,0.05)', padding: '1px 5px', borderRadius: 3 }}>z = 12.0 mm</code>; torque to 0.4 Nm.</li>
      <li style={{ marginBottom: 4 }}>Mount the light pipe in its kinematic cell, finger-tight then back off ¼ turn.</li>
      <li style={{ marginBottom: 4 }}>Acquire 9 frames at the target plane, rotating the source 0–360° in 45° steps.</li>
      <li>Compute the irradiance map; check for the seam artifact at θ = 0°, 180°.</li>
    </ol>

    {/* Equation block */}
    <div style={{
      padding: '16px 20px', borderRadius: 10,
      background: 'var(--accent-bg)', border: '1px solid var(--line)',
      margin: '16px 0', display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10.5, color: 'var(--ink3)', letterSpacing: '0.06em',
                      textTransform: 'uppercase', marginBottom: 4 }}>
          Non-uniformity target
        </div>
        <Eq big>
          σ<sub>I</sub> / Ī &nbsp;=&nbsp;
          <span className="frac">
            <span className="top">1</span>
            <span className="bot">√(N · n<sub>facets</sub>)</span>
          </span>
          &nbsp;≤&nbsp; 0.02
        </Eq>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
        <span className="chip mono" style={{ fontSize: 10 }}>KaTeX</span>
        <span className="chip" style={{ fontSize: 10 }}>eq. 1</span>
      </div>
    </div>

    {/* Image + caption with handwritten annotation */}
    <div style={{ margin: '20px 0' }}>
      <div style={{ position: 'relative' }}>
        <div className="imgph" style={{ height: 200, fontSize: 10 }}>
          irradiance map · 6mm target · trial 13
        </div>
        {/* Stylus arrow + note pointing at seam */}
        <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
          <g stroke="oklch(0.55 0.18 25)" strokeWidth="1.6" fill="none" strokeLinecap="round">
            <path d="M70 100 q-30 -20 -50 -60" />
            <path d="M70 100 l-12 -6 M70 100 l-4 -12" />
          </g>
          <text x="10" y="28" className="hand" fontSize="20" fill="oklch(0.55 0.18 25)">
            seam artifact
          </text>
        </svg>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 6,
                    fontFamily: 'Inter, system-ui, sans-serif' }}>
        Figure 1. Irradiance map at the 6 mm target plane, trial 13. The diagonal seam corresponds
        to the diffuser/pipe interface. Replaced for trial 14.
      </div>
    </div>

    {/* Callout / quote */}
    <div style={{
      borderLeft: '3px solid var(--accent)',
      padding: '8px 16px', margin: '20px 0',
      background: 'rgba(0,0,0,0.02)',
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11,
                    color: 'var(--ink3)', marginBottom: 4,
                    letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        <_MM_Icon d={MMIc.quote} size={11} /> from · Boreman, &lsquo;Modulation Transfer Function&rsquo;, ch.&nbsp;7
      </div>
      <div style={{ fontStyle: 'italic', color: 'var(--ink)', fontSize: 15.5 }}>
        Uniformity at the integrator exit is governed by the product N · n<sub>facets</sub>, not by
        either count alone. Square pipes give one facet pair per bounce; hex pipes give three.
      </div>
    </div>

    {/* Refs */}
    <h2 style={{ fontFamily: 'inherit', fontSize: 20, fontWeight: 600, margin: '24px 0 8px' }}>
      References
    </h2>
    <ol style={{ paddingLeft: 22, margin: 0, fontFamily: 'Inter, system-ui, sans-serif',
                 fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink2)' }}>
      <li style={{ marginBottom: 4 }}>
        Cassarly W., &lsquo;Light-pipe integrators&rsquo;, SPIE Optical Eng. Vol. 47.&nbsp;
        <a href="#" style={{ color: 'oklch(0.5 0.13 240)' }}>doi:10.1117/12.736419</a>
      </li>
      <li style={{ marginBottom: 4 }}>
        Boreman G., <i>Modulation Transfer Function in Optical and Electro-Optical Systems</i>,
        SPIE Press, 2001.
      </li>
      <li>
        Thorlabs DG10-1500-MD datasheet ·&nbsp;
        <a href="#" style={{ color: 'oklch(0.5 0.13 240)' }}>thorlabs.com/dg10-1500-md</a>
      </li>
    </ol>
  </div>
);

/* ---------------- Top-of-page meta strip for this kind of note ------ */
const MultimediaTitle = () => (
  <div style={{ padding: '24px 56px 0', position: 'relative' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span className="chip">
        <span style={{ width: 6, height: 6, borderRadius: 3, background: 'oklch(0.65 0.15 145)' }} />
        living
      </span>
      <span className="chip"><_MM_Icon d={MMIc.hash} size={10} /> optics</span>
      <span className="chip"><_MM_Icon d={MMIc.hash} size={10} /> trial-log</span>
      <span className="chip" style={{ color: 'var(--ink3)' }}>
        <_MM_Icon d={MMIc.pen} size={10} /> 14 stylus marks
      </span>
      <span className="chip" style={{ color: 'var(--ink3)' }}>
        <_MM_Icon d={MMIc.bookmark} size={10} /> 1 clipping · 3 refs
      </span>
    </div>
    <h1 style={{ position: 'relative', zIndex: 2,
      fontFamily: '"Newsreader", Georgia, serif',
      fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em',
      margin: '0 0 6px', lineHeight: 1.15,
    }}>
      Field notes — diffractive beam shaper, <span>trial 14</span>
    </h1>
    <div style={{ fontSize: 12.5, color: 'var(--ink3)', display: 'flex', gap: 10 }}>
      <span>by you · today, 14:32</span>
      <span>·</span>
      <span>linked to: Köhler integrator sizing, Étendue first principles</span>
    </div>
  </div>
);

/* ---------------- Main multimedia screen ---------------------------- */
const MultimediaPage = ({ dark = false }) => (
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
        <FormatBar direction="A" />
        <div className="no-scroll" style={{ flex: 1, overflow: 'auto' }}>
          <MultimediaTitle />
          <div style={{ padding: '0 56px 60px' }}>
            <MultimediaBody />
          </div>
        </div>
      </div>
      <div style={{ borderLeft: '1px solid var(--line)', minHeight: 0 }}>
        <AiSidebar direction="A" dark={dark} />
      </div>
    </div>
  </div>
);

const MultimediaPageDark = () => <MultimediaPage dark />;

Object.assign(window, { MultimediaPage, MultimediaPageDark });
