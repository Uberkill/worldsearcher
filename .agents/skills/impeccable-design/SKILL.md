---
name: Impeccable Design
description: An ultra-strict Design System and UI anti-pattern detector. Triggers when generating frontend layouts, styling, or CSS. Forces professional typography, spacing, and contrast.
---

# Impeccable Design Agent Rules

When generating any UI, HTML, CSS, React, or frontend components, you MUST adhere to the following mechanical design rules to prevent "AI Slop". You act as a rigorous Design Lead.

## 1. Typography & Hierarchy
- **NO INTER:** Do not use 'Inter' or 'Roboto' unless explicitly forced. Default to more premium typography choices like 'Outfit', 'Plus Jakarta Sans', or modern system UI stacks.
- **Strict Scale:** Do not guess font sizes. Use a strict scale: `text-xs` (0.75rem), `text-sm` (0.875rem), `text-base` (1rem), `text-lg` (1.125rem), `text-xl` (1.25rem), `text-2xl` (1.5rem), `text-4xl` (2.25rem). 
- **Letter Spacing:** Tighter letter spacing on large headings (`tracking-tight`), looser letter spacing on small caps or `text-xs` (`tracking-wider`).
- **Font Weights:** Avoid generic bolding. Use `font-medium` (500) for UI elements, `font-semibold` (600) for sub-headers.

## 2. Spatial Design & Rhythm
- **Padding Hierarchies:** Inner padding must be equal to or smaller than outer margins. If a card has `p-6`, the elements inside must be spaced with `gap-4` or `gap-3` (never `gap-8`).
- **Symmetry:** Avoid making everything `flex justify-between items-center` with a massive empty gap in the middle. Group related items tightly using `gap-2` or `gap-3`.
- **Negative Space:** Let the UI breathe. Use significant vertical rhythm `mb-8` or `mb-12` between distinct sections.

## 3. Color & Contrast (Anti-Slop)
- **Banish the AI Gradient:** DO NOT use the default `from-purple-500 to-blue-500` gradient under any circumstances.
- **Subtle Backgrounds:** Use neutral, very subtle off-whites (`slate-50`, `zinc-50`) or incredibly dark off-blacks (`zinc-900`, `slate-950`).
- **Contrast Check:** Text on a colored background must meet high contrast ratios. Use `text-white` on dark backgrounds, never `text-gray-200`. Use `text-slate-900` on light, not `text-slate-700` for primary headings.
- **Borders:** Instead of heavy shadows, prefer subtle `border border-white/10` (dark mode) or `border-black/5` (light mode) to define edges crisply.

## 4. Mechanical Rules
- If you are asked to build a "card", do not just draw a white box with shadow. Consider if a minimalist separator or a transparent hover-state is better.
- Avoid building generic dashboard interfaces when the prompt asks for a "website" or "landing page".
- **Execution:** Always verify your component adheres to these rules before outputting code.
