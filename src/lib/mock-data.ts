// Mock data for Smart Notes prototype — no real file system or API calls

export interface Page {
  id: string
  title: string
  slug: string
  updatedAt: string
  createdAt: string
  preview: string
  content: string
}

export interface Section {
  id: string
  name: string
  pages: Page[]
}

export interface Notebook {
  id: string
  name: string
  color: string
  sections: Section[]
}

export const NOTEBOOK_COLORS = [
  '#C84B31', // rust (accent)
  '#4A90D9', // blue
  '#5BAD6F', // green
  '#9B59B6', // purple
  '#E67E22', // orange
  '#1ABC9C', // teal
]

export const mockNotebooks: Notebook[] = [
  {
    id: 'nb-work',
    name: 'Work',
    color: '#C84B31',
    sections: [
      {
        id: 'sec-projects',
        name: 'Projects',
        pages: [
          {
            id: 'pg-smart-notes-design',
            title: 'Smart Notes Design System',
            slug: 'smart-notes-design',
            updatedAt: '2026-05-23T10:30:00Z',
            createdAt: '2026-05-01T09:00:00Z',
            preview: 'Migrating from custom CSS to Tailwind v4 + shadcn/ui. Direction A tokens locked.',
            content: `# Smart Notes Design System

## Overview

We are migrating from a custom CSS system to **Tailwind CSS v4** and **shadcn/ui** primitives. The selected visual direction is Direction A — Notebook Classic.

## Token System

The token system defines colors, typography, spacing, and motion. All values live in \`src/styles/tokens.css\` as CSS custom properties, then aliased in the Tailwind \`@theme\` block.

### Color Tokens

| Token | Light | Dark |
|---|---|---|
| \`--background\` | \`#faf9f7\` | \`#1a1917\` |
| \`--surface\` | \`#ffffff\` | \`#252422\` |
| \`--accent\` | \`#c84b31\` | \`#c84b31\` |

## Typography

The app uses four typefaces:

- **Newsreader** (serif) — body reading text and page titles
- **Inter** (sans-serif) — UI chrome, buttons, labels
- **JetBrains Mono** — code and keyboard shortcuts
- **Caveat** — handwriting and annotation rendering

## Next Steps

1. Implement the three-pane desktop layout
2. Build mobile bottom tab bar
3. Integrate Tiptap editor with full ribbon toolbar
4. Wire up AI panel mock responses
`,
          },
          {
            id: 'pg-api-design',
            title: 'API Gateway Design',
            slug: 'api-gateway',
            updatedAt: '2026-05-22T15:45:00Z',
            createdAt: '2026-05-10T11:00:00Z',
            preview: 'REST endpoints for vault operations. GET /api/vault returns the full tree.',
            content: `# API Gateway Design

## Endpoints

The gateway exposes a REST API over HTTP on port 3000. All endpoints are local-only — never exposed to the public internet.

### Vault Operations

\`\`\`
GET  /api/vault          — Full notebook/section/page tree
GET  /api/page?path=     — Load page content + metadata
PUT  /api/page?path=     — Save page content + title
DELETE /api/page?path=   — Delete page + assets
POST /api/create         — Create notebook / section / page
\`\`\`

### AI Endpoints (Planned — Phase 2)

\`\`\`
POST /api/ai/ask         — Ask AI about current note
POST /api/ai/append      — AI suggests content to append
POST /api/ai/rewrite     — AI rewrites a section (returns diff)
\`\`\`

## Authentication

No authentication in Phase 1. Access is restricted by Tailscale network membership. Phase 3 may add simple token-based auth for API calls from agent scripts.

## Error Handling

All endpoints return standard HTTP status codes. Errors include a JSON body:

\`\`\`json
{
  "error": "Page not found",
  "code": "PAGE_NOT_FOUND",
  "path": "/Notebooks/Work/Projects/missing.md"
}
\`\`\`
`,
          },
          {
            id: 'pg-release-checklist',
            title: 'Phase 1 Release Checklist',
            slug: 'phase-1-checklist',
            updatedAt: '2026-05-23T08:00:00Z',
            createdAt: '2026-05-20T09:00:00Z',
            preview: 'Acceptance criteria for the Phase 1 interactive prototype.',
            content: `# Phase 1 Release Checklist

## Acceptance Criteria

- [ ] 3-column desktop grid (sidebar | editor | AI rail)
- [ ] Sidebar collapses to icon strip
- [ ] Mobile bottom tab bar (4 tabs)
- [ ] Correct breakpoint behavior (375px / 768px / 1280px)
- [ ] Light and dark mode correct at all breakpoints
- [ ] Tree expand/collapse with chevrons
- [ ] Active page accent left-bar
- [ ] Mobile drill-down with back chevron
- [ ] Create / rename / delete UI
- [ ] Notebook color dots
- [ ] Tiptap editor renders mock content
- [ ] Page title (serif, 4xl) + date
- [ ] Desktop formatting ribbon with active states
- [ ] Mobile BubbleMenu
- [ ] No iOS font-size issues (≥ 16px)
- [ ] Mock AI thread on desktop rail
- [ ] Mobile AI bottom Sheet
- [ ] Diff review UI (mock)
- [ ] Ink-aware chip visible
- [ ] Quick capture modal (Cmd+Shift+V)
- [ ] Search dialog (Cmd+K)
- [ ] Settings stub
- [ ] \`tsc --noEmit\` exits 0
- [ ] \`npm run build\` exits 0

## Status

All items above are targeted for completion in this sprint. Post-sprint QA on physical devices (iPhone, Android tablet) required before marking Phase 1 complete.
`,
          },
        ],
      },
      {
        id: 'sec-meetings',
        name: 'Meetings',
        pages: [
          {
            id: 'pg-standup-notes',
            title: 'Daily Standup Notes',
            slug: 'standup-notes',
            updatedAt: '2026-05-23T09:15:00Z',
            createdAt: '2026-04-15T09:00:00Z',
            preview: 'Running log of daily standup updates and blockers.',
            content: `# Daily Standup Notes

## 2026-05-23

**Done yesterday:**
- Completed SN-1 design system foundation
- Reviewed Direction A token specification
- Confirmed Tailwind v4 and shadcn/ui integration

**Today:**
- Begin SN-2 interactive prototype
- Implement three-pane desktop layout
- Install Tiptap

**Blockers:**
- None

---

## 2026-05-22

**Done yesterday:**
- Set up Next.js 14 with App Router
- Configured fonts (Newsreader, Inter, JetBrains Mono, Caveat)

**Today:**
- Install and configure Tailwind v4
- Add shadcn/ui primitives
- Validate token system renders correctly

**Blockers:**
- Tailwind v4 PostCSS config syntax differs from v3 — resolved by checking official docs
`,
          },
          {
            id: 'pg-product-review',
            title: 'Product Review — May 2026',
            slug: 'product-review-may',
            updatedAt: '2026-05-20T16:30:00Z',
            createdAt: '2026-05-20T14:00:00Z',
            preview: 'Monthly product review. Reviewed Phase 0 outcomes and Phase 1 scope.',
            content: `# Product Review — May 2026

## Attendees

- Owner (Product)
- Leo (UI Engineer)
- AI (note-taker)

## Phase 0 Outcomes

Phase 0 is complete. The core vault is working:
- Tiptap editor with Markdown round-trip
- KaTeX math rendering
- Autosave (1.2s debounce)
- Image paste
- Tree navigation
- Chat widget docked right rail

## Phase 1 Scope Confirmed

The Phase 1 goal is a responsive interactive prototype that works on desktop and mobile. The team agreed to:

1. Use the Direction A visual design (Notebook Classic)
2. Build mobile-first with Tailwind breakpoints
3. No real AI calls in the prototype — mock data only
4. Deliver working navigation, editor, and AI panel UI

## Action Items

- [ ] Leo: Implement Phase 1 prototype (SN-2)
- [ ] Owner: Review prototype on iPhone and desktop
- [ ] Owner: Confirm notebook color palette (6 presets or custom picker?)
`,
          },
          {
            id: 'pg-design-review',
            title: 'Design Review Notes',
            slug: 'design-review',
            updatedAt: '2026-05-18T11:00:00Z',
            createdAt: '2026-05-18T10:00:00Z',
            preview: 'Reviewed three design directions. Direction A selected unanimously.',
            content: `# Design Review Notes

## Direction A — Notebook Classic

**Selected unanimously.** Warm, legible, and closest to a physical notebook without mimicking OneNote.

Key observations:
- Parchment background (#faf8f3) reads as "notebook paper" without being too literal
- Newsreader serif for body text is excellent — high legibility at long-form reading sizes
- Rust accent (#c84b31) is distinctive and passes WCAG AA contrast on both light and dark backgrounds
- Dark mode is warm (near-black with amber undertones), not cold blue-grey

## Direction B — Minimal Pro (Not Selected)

Too cold. The grey-on-white palette lacks character and doesn't differentiate from existing tools like Notion.

## Direction C — Dark-First (Not Selected)

Dark mode was excellent, but light mode felt unfinished. The decision to go dark-first conflicted with the "notebook paper" feel that makes Direction A special.

## Token Decisions Made

- Accent color: **locked** to \`oklch(0.55 0.13 35)\` (rust)
- Body font size: **16px minimum** (iOS zoom prevention)
- Border radius: **conservative** — 6px buttons, 8px cards, 12px sheets
`,
          },
        ],
      },
    ],
  },
  {
    id: 'nb-personal',
    name: 'Personal',
    color: '#4A90D9',
    sections: [
      {
        id: 'sec-reading',
        name: 'Reading',
        pages: [
          {
            id: 'pg-books-2026',
            title: 'Books 2026',
            slug: 'books-2026',
            updatedAt: '2026-05-21T20:00:00Z',
            createdAt: '2026-01-01T00:00:00Z',
            preview: 'Reading list and notes for 2026. Currently reading: The Pragmatic Programmer.',
            content: `# Books 2026

## Currently Reading

### The Pragmatic Programmer (20th Anniversary Edition)

Authors: David Thomas, Andrew Hunt

**My notes:**

The book opens with the "broken windows" theory applied to code — one piece of bad code signals that no one cares, which invites more. The lesson: fix problems as soon as they appear, even small ones.

The concept of **tracer bullets** is compelling: instead of building the entire system in layers, fire a tracer from the start requirements through to the final output — a thin but complete implementation that proves the architecture works. Then iterate.

> "It's not about being perfect — it's about being good enough to ship and iterate."

---

## Finished

### Thinking in Systems — Donella Meadows

A dense but rewarding primer on systems thinking. Key insight: most problems aren't caused by evil actors or bad luck, but by the structure of the system itself. Change the structure, change the behavior.

**Highlight:** The concept of "leverage points" — places in a system where a small change has a large effect. The highest leverage points are often the most counterintuitive.

### A Pattern Language — Christopher Alexander

Timeless. The idea of patterns as a shared vocabulary for design is foundational to everything from software design patterns to modern UX. Still the best argument for why good design is not arbitrary.
`,
          },
          {
            id: 'pg-paper-notes',
            title: 'Research Paper Notes',
            slug: 'paper-notes',
            updatedAt: '2026-05-19T14:00:00Z',
            createdAt: '2026-04-01T10:00:00Z',
            preview: 'Notes on papers about diffusion models and attention mechanisms.',
            content: `# Research Paper Notes

## Attention Is All You Need (Vaswani et al., 2017)

The foundational transformer paper. Self-attention replaces recurrence and convolution entirely.

**Key equation — Scaled Dot-Product Attention:**

$$\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$$

The scaling by $\\sqrt{d_k}$ prevents the dot products from growing too large in high dimensions, which would push the softmax into regions with very small gradients.

**Multi-head attention:**

$$\\text{MultiHead}(Q, K, V) = \\text{Concat}(\\text{head}_1, \\ldots, \\text{head}_h)W^O$$

where $\\text{head}_i = \\text{Attention}(QW_i^Q, KW_i^K, VW_i^V)$

## Denoising Diffusion Probabilistic Models (Ho et al., 2020)

The paper that kicked off the modern diffusion era. The forward process adds Gaussian noise over $T$ timesteps:

$$q(x_t | x_{t-1}) = \\mathcal{N}(x_t; \\sqrt{1 - \\beta_t} x_{t-1}, \\beta_t I)$$

The reverse process learns to denoise:

$$p_\\theta(x_{t-1} | x_t) = \\mathcal{N}(x_{t-1}; \\mu_\\theta(x_t, t), \\Sigma_\\theta(x_t, t))$$

**Training objective** (simplified):

$$L_{\\text{simple}} = \\mathbb{E}_{t, x_0, \\epsilon} \\left[ \\| \\epsilon - \\epsilon_\\theta(\\sqrt{\\bar{\\alpha}_t} x_0 + \\sqrt{1 - \\bar{\\alpha}_t} \\epsilon, t) \\|^2 \\right]$$
`,
          },
          {
            id: 'pg-reading-log',
            title: 'Reading Log',
            slug: 'reading-log',
            updatedAt: '2026-05-15T21:00:00Z',
            createdAt: '2026-01-01T00:00:00Z',
            preview: 'Daily reading habit tracker and session notes.',
            content: `# Reading Log

## Goal

Read for at least 30 minutes per day. Track sessions here.

## May 2026

| Date | Book | Pages | Notes |
|------|------|-------|-------|
| May 23 | The Pragmatic Programmer | 42–67 | Chapter 3: The Basic Tools |
| May 22 | The Pragmatic Programmer | 15–41 | Chapter 2: A Pragmatic Approach |
| May 21 | The Pragmatic Programmer | 1–14 | Chapter 1: A Pragmatic Philosophy |
| May 20 | A Pattern Language | 890–920 | Patterns 231–245 |
| May 19 | A Pattern Language | 860–889 | Patterns 220–230 |

## April 2026

Finished *Thinking in Systems*. Great book — will re-read the leverage points chapter.

Also read the diffusion model papers I had been putting off. Took notes in the Research Paper Notes page.

## Habit Stats

- **Streak:** 12 days
- **This month:** 18/23 days (78%)
- **Total pages this year:** 847
`,
          },
        ],
      },
      {
        id: 'sec-ideas',
        name: 'Ideas',
        pages: [
          {
            id: 'pg-project-ideas',
            title: 'Project Ideas',
            slug: 'project-ideas',
            updatedAt: '2026-05-22T22:00:00Z',
            createdAt: '2026-01-15T10:00:00Z',
            preview: 'Backlog of personal project ideas. Sorted by excitement level.',
            content: `# Project Ideas

## High Excitement

### Local LLM Router
A small service that runs locally and routes AI requests to the right model based on task type. Simple tasks go to a fast/cheap model, complex reasoning goes to a larger model. The router itself could be a tiny classifier.

**Why:** I constantly switch between models manually. This would be automatic.

**Tech:** Node.js service, llama.cpp for local models, simple HTTP proxy.

### Smart Notes (In Progress)
Building this now. The goal is a local-first research notebook that lets AI agents read and write notes alongside me. See the Work notebook for details.

---

## Medium Excitement

### Recipe Manager
Tired of bookmarking recipes and losing them. Want a local app that stores recipes as structured data (ingredients, steps, tags), can scale ingredient quantities, and generates shopping lists.

**Tech:** Simple Next.js app, SQLite, markdown recipe format.

### RSS to Markdown
A script that fetches RSS feeds I follow, formats them as Markdown summaries, and appends them to a daily digest note in Smart Notes. Let the AI highlight what's worth reading.

---

## Low Excitement / Shelved

### Custom Mechanical Keyboard Firmware
Interesting but the time investment is too high for the payoff. Revisit if I get a Charybdis.

### 3D Printer Calibration Tracker
Logging calibration history per filament brand/material. Would be useful but not urgent.
`,
          },
          {
            id: 'pg-weekly-review',
            title: 'Weekly Review Template',
            slug: 'weekly-review',
            updatedAt: '2026-05-17T19:00:00Z',
            createdAt: '2026-02-01T09:00:00Z',
            preview: 'Template for weekly review sessions. What went well, what to improve.',
            content: `# Weekly Review Template

## Review Date: ____________

## Last Week Recap

### What went well?

-
-
-

### What didn't go well?

-
-
-

### What would I do differently?

-
-

---

## Energy & Focus

**Energy level this week:** ⬜⬜⬜⬜⬜ (1–5)

**Focus quality:** ⬜⬜⬜⬜⬜ (1–5)

**Sleep average:** _____ hours

---

## Key Outcomes

1.
2.
3.

---

## Next Week Intentions

### Top 3 priorities

1. **[Most important thing]** — Why it matters:
2. **[Second priority]** — Why it matters:
3. **[Third priority]** — Why it matters:

### Schedule

- Monday:
- Tuesday:
- Wednesday:
- Thursday:
- Friday:

---

## Carry-over items

Tasks that didn't get done last week and should roll forward:

- [ ]
- [ ]
- [ ]
`,
          },
          {
            id: 'pg-gratitude',
            title: 'Gratitude Journal',
            slug: 'gratitude',
            updatedAt: '2026-05-23T07:30:00Z',
            createdAt: '2026-01-01T00:00:00Z',
            preview: 'Daily gratitude notes. Three things per day.',
            content: `# Gratitude Journal

## May 23, 2026

1. The morning was quiet and I had two uninterrupted hours to work before any meetings.
2. The Smart Notes prototype is coming together — it's satisfying to see the design tokens translate to real UI.
3. Good coffee.

## May 22, 2026

1. Figured out the Tailwind v4 configuration after struggling with it for an hour. The aha moment felt good.
2. A friend sent a voice message just to catch up — no agenda, just connection.
3. The sun came out in the afternoon.

## May 21, 2026

1. Finally started reading The Pragmatic Programmer. Should have read it years ago.
2. The meal prep I did on Sunday made lunch effortless all week.
3. The keyboard I've been using for three years still feels great to type on.

---

*Keep this simple. Don't overthink it. Three things, most days.*
`,
          },
        ],
      },
    ],
  },
  {
    id: 'nb-research',
    name: 'Research',
    color: '#5BAD6F',
    sections: [
      {
        id: 'sec-optics',
        name: 'Optics',
        pages: [
          {
            id: 'pg-led-optics',
            title: 'LED Optics — Collimation Study',
            slug: 'led-optics',
            updatedAt: '2026-05-20T16:00:00Z',
            createdAt: '2026-04-10T11:00:00Z',
            preview: 'Collimation efficiency of LED dies using TIR vs. refractive lenses. Key equations and measurements.',
            content: `# LED Optics — Collimation Study

## Goal

Evaluate the collimation efficiency of small-die LEDs (< 1mm²) using total internal reflection (TIR) optics versus simple refractive lenses.

## Background

The angular distribution of an LED die follows Lambert's cosine law:

$$I(\\theta) = I_0 \\cos(\\theta)$$

where $I_0$ is the on-axis intensity and $\\theta$ is the angle from the optical axis.

For a Lambertian source, 50% of flux is emitted within ±30°, and 90% within ±64°.

## TIR Lens Analysis

A TIR (Total Internal Reflection) lens works by:
1. Refracting the central ray bundle through the front face
2. Capturing the peripheral rays via TIR on the outer cone surfaces
3. Redirecting both bundles toward the optical axis

The critical angle for PMMA (n = 1.49) is:

$$\\theta_c = \\arcsin\\left(\\frac{1}{n}\\right) = \\arcsin\\left(\\frac{1}{1.49}\\right) \\approx 42.2°$$

## Measurements

| Lens Type | Die Size | Half-Angle | Efficiency |
|-----------|----------|------------|------------|
| TIR 10° | 0.5mm² | 5.2° | 87% |
| TIR 20° | 0.5mm² | 10.8° | 91% |
| Refractive | 0.5mm² | 18.4° | 78% |
| TIR 10° | 1.0mm² | 7.1° | 83% |

## Key Finding

TIR optics outperform refractive lenses for narrow-angle collimation, particularly when die size is small relative to lens diameter. The efficiency advantage decreases as the target half-angle increases above 15°.
`,
          },
          {
            id: 'pg-laser-notes',
            title: 'Laser Diode Notes',
            slug: 'laser-diode-notes',
            updatedAt: '2026-05-15T14:00:00Z',
            createdAt: '2026-03-20T10:00:00Z',
            preview: 'Operating principles, beam characteristics, and thermal management for laser diodes.',
            content: `# Laser Diode Notes

## Operating Principles

A laser diode operates via stimulated emission in a semiconductor junction. Unlike LEDs, which emit spontaneously, a laser diode achieves population inversion and emits coherent light above a threshold current.

**Threshold current** depends on temperature:

$$I_{th}(T) = I_{th,0} \\exp\\left(\\frac{T - T_0}{T_1}\\right)$$

where $T_1$ is the characteristic temperature (typically 50–150K for GaAs, higher for InP).

## Beam Characteristics

Laser diodes emit an elliptical beam due to the geometry of the waveguide:
- **Fast axis** (perpendicular to junction): divergence 30–40°
- **Slow axis** (parallel to junction): divergence 8–15°

The beam quality parameter $M^2$ measures how close the beam is to a perfect Gaussian:
- $M^2 = 1$: ideal diffraction-limited Gaussian
- Typical diode: $M^2 \\approx 1.1–2.0$ (fast axis), $\\approx 1.05–1.3$ (slow axis)

## Thermal Management

Junction temperature directly affects:
- Threshold current (increases with T)
- Efficiency (decreases with T)
- Wavelength (redshifts ~0.3 nm/°C for GaAs)
- Lifetime (roughly halves per 10°C increase)

**Target:** Keep junction temperature < 60°C under continuous operation.

\`\`\`
P_dissipated = P_electrical - P_optical
             = V_f × I_f - P_out / η_wall
\`\`\`

For a 1W diode with 30% wall-plug efficiency at 3V:
- $P_{in} = 3V \\times 1A = 3W$
- $P_{optical} = 1W$
- $P_{heat} = 2W$

Requires a heatsink with thermal resistance $R_{th} < (60°C - 25°C) / 2W = 17.5°C/W$
`,
          },
          {
            id: 'pg-optical-bench',
            title: 'Optical Bench Setup',
            slug: 'optical-bench-setup',
            updatedAt: '2026-05-10T09:00:00Z',
            createdAt: '2026-03-01T10:00:00Z',
            preview: 'Setup notes for the optical measurement bench. Equipment list and calibration procedure.',
            content: `# Optical Bench Setup

## Equipment

| Item | Model | Serial | Location |
|------|-------|--------|----------|
| Integrating sphere | Labsphere 4" | LS-004-789 | Shelf B3 |
| Spectroradiometer | Ocean Insight FLAME-T | OI-20220315 | Cabinet 2 |
| Precision current source | Keithley 2400 | K2400-89341 | Rack |
| Thermocouple DAQ | NI USB-9211 | NI-009211-AA | Desk |
| Optical rail | Thorlabs RLA300/M | — | Bench |
| Power meter | Thorlabs PM100D | PM-093241 | Shelf B3 |

## Calibration Procedure

### Spectroradiometer

1. Allow 15 min warm-up time
2. Dark-correct: cap the input fiber, acquire dark spectrum in OceanView
3. Wavelength calibration: insert Hg-Ar lamp, check peak positions (253.7 nm, 404.7 nm, 546.1 nm, 579.1 nm)
4. Acceptable wavelength error: < ±0.3 nm

### Integrating Sphere

1. Clean the sphere interior with lint-free cloth if any contamination visible
2. Mount DUT at the input port
3. Set sphere capture angle to 2π sr (hemisphere collection)
4. Correction factor for self-absorption: apply pre-measured $k_{abs} = 0.97$

## Standard Measurement Sequence

\`\`\`
1. Set I_f to 10% of rated current
2. Wait 60s for thermal stabilization
3. Acquire 5 spectra, average
4. Increment I_f by 10% steps up to rated current
5. At each step: wait 30s, acquire 5 spectra
6. Record T_junction via thermocouple at each step
\`\`\`
`,
          },
        ],
      },
      {
        id: 'sec-ml',
        name: 'Machine Learning',
        pages: [
          {
            id: 'pg-transformer-notes',
            title: 'Transformer Architecture Notes',
            slug: 'transformer-notes',
            updatedAt: '2026-05-18T17:00:00Z',
            createdAt: '2026-04-05T09:00:00Z',
            preview: 'Deep dive into the transformer architecture. Attention, positional encoding, and training.',
            content: `# Transformer Architecture Notes

## Architecture Overview

The transformer consists of an encoder and decoder, each with $N$ identical layers. The original paper used $N = 6$.

**Encoder layer:**
1. Multi-head self-attention
2. Position-wise feed-forward network
3. Layer normalization + residual connections at each step

**Decoder layer:**
1. Masked multi-head self-attention (causal masking)
2. Multi-head cross-attention (queries from decoder, keys/values from encoder)
3. Position-wise feed-forward network
4. Layer normalization + residual connections

## Positional Encoding

Since the transformer has no inherent sense of sequence order, position is injected via sinusoidal encodings:

$$PE_{(pos, 2i)} = \\sin\\left(\\frac{pos}{10000^{2i/d_{model}}}\\right)$$

$$PE_{(pos, 2i+1)} = \\cos\\left(\\frac{pos}{10000^{2i/d_{model}}}\\right)$$

This allows the model to attend to relative positions via linear combinations of the encoding vectors.

## Training

**Optimizer:** Adam with warmup schedule:

$$lr = d_{model}^{-0.5} \\cdot \\min(step^{-0.5}, step \\cdot warmup\\_steps^{-1.5})$$

**Regularization:**
- Dropout $p = 0.1$ on attention weights and feed-forward sub-layers
- Label smoothing $\\epsilon = 0.1$ (reduces overconfidence)

## Key Hyperparameters (Base Model)

| Parameter | Value |
|-----------|-------|
| $d_{model}$ | 512 |
| $d_{ff}$ | 2048 |
| $h$ (heads) | 8 |
| $d_k = d_v$ | 64 |
| $N$ (layers) | 6 |
| Dropout | 0.1 |
| Parameters | ~65M |
`,
          },
          {
            id: 'pg-experiment-log',
            title: 'Experiment Log',
            slug: 'experiment-log',
            updatedAt: '2026-05-23T11:30:00Z',
            createdAt: '2026-04-01T09:00:00Z',
            preview: 'Log of ML experiments. Model configs, results, and observations.',
            content: `# Experiment Log

## EXP-042 — LoRA Fine-tuning Study

**Date:** 2026-05-23
**Model:** Llama 3.1 8B
**Task:** Summarization on research notes domain

### Config

\`\`\`yaml
model: meta-llama/Llama-3.1-8B-Instruct
lora_r: 16
lora_alpha: 32
lora_dropout: 0.05
target_modules: [q_proj, k_proj, v_proj, o_proj]
learning_rate: 2e-4
batch_size: 4
gradient_accumulation: 4
epochs: 3
warmup_ratio: 0.1
\`\`\`

### Results

| Metric | Baseline | Fine-tuned | Delta |
|--------|----------|------------|-------|
| ROUGE-1 | 0.31 | 0.47 | +51.6% |
| ROUGE-2 | 0.12 | 0.21 | +75.0% |
| ROUGE-L | 0.28 | 0.43 | +53.6% |
| BERTScore | 0.82 | 0.91 | +11.0% |

### Observations

The fine-tuned model correctly preserves equations in summaries (baseline often dropped LaTeX blocks). Technical terminology retention improved significantly. Domain-specific abbreviations are now handled correctly.

**Next:** Try rank-16 vs rank-64 LoRA to see if higher rank helps for technical content.

---

## EXP-041 — Embedding Space Analysis

**Date:** 2026-05-15

Projected note embeddings to 2D using UMAP. The Research notebook notes cluster tightly, with optics and ML forming two sub-clusters. Personal notes scatter more broadly. Work notes cluster near Research, suggesting semantic overlap.

**Use case:** Could drive a "related notes" feature in Phase 5.
`,
          },
          {
            id: 'pg-gpu-notes',
            title: 'GPU Setup Notes',
            slug: 'gpu-notes',
            updatedAt: '2026-05-12T13:00:00Z',
            createdAt: '2026-03-15T10:00:00Z',
            preview: 'CUDA setup, driver versions, and configuration for the local inference server.',
            content: `# GPU Setup Notes

## Hardware

- **GPU:** NVIDIA RTX 4090 (24GB VRAM)
- **Driver:** 551.23
- **CUDA:** 12.4
- **cuDNN:** 9.0.0

## Software Stack

\`\`\`
Python 3.11
PyTorch 2.2.0 (CUDA 12.1)
transformers 4.40.0
accelerate 0.29.0
bitsandbytes 0.43.0
flash-attn 2.5.7
\`\`\`

## Model Sizes vs VRAM

| Model | Precision | VRAM Required |
|-------|-----------|---------------|
| Llama 3.1 8B | FP16 | ~16 GB |
| Llama 3.1 8B | INT4 | ~5 GB |
| Llama 3.1 70B | INT4 | ~40 GB (OOM) |
| Llama 3.1 70B | INT4 + offload | ~24 GB (slow) |
| Phi-3 Mini | FP16 | ~8 GB |

## Inference Server

Running Ollama as the local inference server. Serves models via OpenAI-compatible API on port 11434.

\`\`\`bash
# Start server
ollama serve

# Pull model
ollama pull llama3.1:8b

# Test
curl http://localhost:11434/api/generate \\
  -d '{"model": "llama3.1:8b", "prompt": "Hello", "stream": false}'
\`\`\`

## Performance Benchmarks

| Model | Tokens/sec | Latency (first token) |
|-------|-----------|----------------------|
| Llama 3.1 8B FP16 | 87 | 0.8s |
| Llama 3.1 8B INT4 | 145 | 0.4s |
| Phi-3 Mini FP16 | 203 | 0.3s |
`,
          },
        ],
      },
    ],
  },
]

// Mock AI conversation threads per page
export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export const mockAiThreads: Record<string, AiMessage[]> = {
  'pg-smart-notes-design': [
    {
      id: 'msg-1',
      role: 'user',
      content: 'Can you summarize the key decisions made in the design token system?',
      timestamp: '2026-05-23T10:00:00Z',
    },
    {
      id: 'msg-2',
      role: 'assistant',
      content: 'The design token system for Smart Notes (Direction A — Notebook Classic) establishes four core elements:\n\n**Colors:** A warm parchment background (#faf9f7) with a rust accent (#c84b31). Dark mode flips to near-black (#1a1917) with the same accent. All semantic roles (text, borders, muted) derive from these via color-mix.\n\n**Typography:** Four typefaces — Newsreader (reading), Inter (UI chrome), JetBrains Mono (code/paths), and Caveat (handwriting). Body text is 16px minimum to prevent iOS auto-zoom.\n\n**Spacing:** 4px base unit with a linear scale up to 56px.\n\n**Motion:** Three speeds — 120ms (hover), 200ms (menus), 320ms (sheets). All use a single easing curve.\n\nThe tokens live in CSS custom properties and are aliased in the Tailwind `@theme` block, so they work with both vanilla CSS and utility classes.',
      timestamp: '2026-05-23T10:00:15Z',
    },
    {
      id: 'msg-3',
      role: 'user',
      content: 'What is the rationale for using color-mix() instead of hardcoded values?',
      timestamp: '2026-05-23T10:02:00Z',
    },
    {
      id: 'msg-4',
      role: 'assistant',
      content: 'Using `color-mix()` for derived values (like borders, muted backgrounds, and input surfaces) means the token system stays self-consistent across both light and dark modes without duplicating values.\n\nFor example:\n```css\n--border: color-mix(in srgb, var(--foreground) 12%, var(--background));\n```\n\nThis border color automatically adapts — in light mode it\'s a light warm grey, in dark mode it\'s a dark warm grey, both derived from the same formula. If the background or foreground token changes, all derived values update too.\n\nThe alternative (hardcoding separate border values for light and dark) is brittle: every token change requires updating multiple dependent values by hand. Color-mix makes the dependency graph explicit and automatic.',
      timestamp: '2026-05-23T10:02:20Z',
    },
  ],
  'pg-led-optics': [
    {
      id: 'msg-1',
      role: 'user',
      content: 'Can you explain why TIR lenses are more efficient than refractive lenses for narrow angles?',
      timestamp: '2026-05-20T16:30:00Z',
    },
    {
      id: 'msg-2',
      role: 'assistant',
      content: 'TIR (Total Internal Reflection) lenses outperform refractive lenses at narrow angles for two geometric reasons:\n\n**1. Capturing large-angle rays:**\nA Lambertian LED emits significant flux at angles > 60° from the axis. A simple refractive lens (like a plano-convex) can only capture rays that enter its front aperture — rays emitted nearly parallel to the substrate are missed entirely.\n\nThe TIR cone wraps around the LED die and captures these high-angle rays via total internal reflection, redirecting them toward the optical axis. This is why TIR lenses show 83–91% efficiency in your data versus 78% for the refractive lens.\n\n**2. Aberration at narrow angles:**\nAchieving a 5–10° half-angle with a refractive lens requires a very short focal length relative to die size, which introduces significant spherical aberration at the margins. The TIR surface can be shaped to correct this aberration because it handles the peripheral rays separately from the central bundle.\n\n**The crossover point:**\nAbove ~15° half-angle, refractive lenses become competitive because: (a) aberration is less critical at wider angles, (b) the TIR cone must be taller to redirect high-angle rays to a wider output angle, reducing compactness advantages. Your data supports this — for 20° TIR vs refractive, the efficiency gap narrows.',
      timestamp: '2026-05-20T16:31:00Z',
    },
  ],
  'pg-transformer-notes': [
    {
      id: 'msg-1',
      role: 'user',
      content: 'Why does the learning rate schedule include a warmup phase?',
      timestamp: '2026-05-18T17:30:00Z',
    },
    {
      id: 'msg-2',
      role: 'assistant',
      content: 'The warmup phase addresses a specific instability problem that occurs at the start of training with Adam:\n\n**The problem:** Adam uses an exponentially moving average of squared gradients to normalize the step size. At the beginning of training, this second moment estimate is near zero (it hasn\'t seen enough gradient history). Adam divides by this near-zero value, producing enormous effective learning rates in the first few steps — often causing the model to diverge immediately.\n\n**The fix:** By starting with a very small learning rate and linearly increasing it over `warmup_steps`, you give Adam time to accumulate reliable second-moment estimates before taking large steps. Once the estimates stabilize, the schedule switches to the inverse square root decay.\n\nThe schedule in the paper:\n$$lr = d_{model}^{-0.5} \\cdot \\min(step^{-0.5}, step \\cdot warmup\\_steps^{-1.5})$$\n\nThe first term dominates after warmup (decaying), the second during warmup (increasing). Typical warmup is 4000 steps for the base model.\n\n**Practical note:** Modern fine-tuning recipes sometimes skip warmup with smaller learning rates, but for training from scratch it remains important.',
      timestamp: '2026-05-18T17:31:30Z',
    },
    {
      id: 'msg-3',
      role: 'user',
      content: 'Continue this note with a section on positional encoding alternatives.',
      timestamp: '2026-05-18T18:00:00Z',
    },
    {
      id: 'msg-4',
      role: 'assistant',
      content: 'Here\'s a draft section on positional encoding alternatives you can append:\n\n---\n\n## Positional Encoding Alternatives\n\nThe original sinusoidal encoding has been largely superseded in modern architectures:\n\n**Learned Absolute Positions (BERT, GPT-2):** Simple embedding table indexed by position. Works well but can\'t generalize to sequences longer than seen during training.\n\n**Rotary Position Embedding (RoPE, Llama):** Encodes position as a rotation applied to query/key vectors in each attention head. Key advantage: the dot product `q·k` naturally captures *relative* position. Generalizes to longer sequences with no modification.\n\n**ALiBi (Train Short, Test Long):** Instead of adding positional information to embeddings, ALiBi adds a fixed linear bias to attention logits based on distance. Very simple, strong length generalization, used in MPT and BLOOM.\n\n**NoPE (No Positional Encoding):** Recent work shows that with causal masking alone, transformers can learn some positional structure implicitly. Combined with RoPE for local and NoPE for global, hybrids show promise.\n\nThe consensus for 2026 large models: RoPE with an extended context rope base (`rope_theta = 500000` for 128K context) is the current standard.\n\n---\n\nShall I append this to the note?',
      timestamp: '2026-05-18T18:01:00Z',
    },
  ],
}

// Mock diff for the AI diff review UI
export const mockDiff = {
  pageId: 'pg-smart-notes-design',
  sectionTitle: 'Token System — Color Tokens',
  rationale: 'Added missing dark-mode token values',
  before: `### Color Tokens

| Token | Light | Dark |
|---|---|---|
| \`--background\` | \`#faf9f7\` | \`#1a1917\` |
| \`--surface\` | \`#ffffff\` | \`#252422\` |
| \`--accent\` | \`#c84b31\` | \`#c84b31\` |`,
  after: `### Color Tokens

| Token | Light | Dark | Role |
|---|---|---|---|
| \`--background\` | \`#faf9f7\` | \`#1a1917\` | App canvas |
| \`--surface\` | \`#ffffff\` | \`#252422\` | Cards, editor |
| \`--accent\` | \`#c84b31\` | \`oklch(0.72 0.13 40)\` | Interactive elements |
| \`--ink\` | \`#1c1a17\` | \`#ece7dc\` | Primary text |
| \`--ink2\` | \`#5a544c\` | \`#a8a195\` | Secondary text |`,
}

// Flatten pages for search
export function getAllPages(): Array<Page & { notebookId: string; notebookName: string; sectionId: string; sectionName: string }> {
  return mockNotebooks.flatMap((nb) =>
    nb.sections.flatMap((sec) =>
      sec.pages.map((pg) => ({
        ...pg,
        notebookId: nb.id,
        notebookName: nb.name,
        sectionId: sec.id,
        sectionName: sec.name,
      }))
    )
  )
}

// Get page by id
export function getPageById(pageId: string): Page | undefined {
  for (const nb of mockNotebooks) {
    for (const sec of nb.sections) {
      const pg = sec.pages.find((p) => p.id === pageId)
      if (pg) return pg
    }
  }
  return undefined
}
