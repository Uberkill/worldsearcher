# Game Aesthetics & UI Design System

This document outlines the visual language, UI aesthetics, and overall design philosophy for the game. All future UI components (menus, HUD, inventory, overlays) must strictly adhere to these standards to maintain a premium, immersive experience.

## 1. Overall Vibe & Aesthetic

The game targets a **Premium Sci-Fi / Modern Voxel** aesthetic. It should not look like a basic flat clone; it must feel alive, polished, and state-of-the-art.

- **Glassmorphism & Depth:** UI panels should heavily utilize semi-transparent, blurred backgrounds (backdrop-blur) over solid opaque colors to give a sense of depth and keep the player connected to the 3D world behind the UI.
- **Sleek Dark Mode:** The default theme is dark and cinematic. Avoid blinding white backgrounds. Use deep indigos, slate grays, and rich blacks as foundational background colors.
- **Vibrant Accents:** Use highly vibrant, luminous colors (cyan, neon green, bright amber) for interactive elements, highlights, and health/stamina bars to create striking contrast against the dark backgrounds.

## 2. Typography

- **Primary Font:** **Inter** or **Outfit** (Modern, clean, highly readable sans-serif).
- **Styling:** Use uppercase with slight letter-spacing for headers, titles, and button labels to evoke a sleek, technical feel. Keep body text regular case for readability.
- **Hierarchy:** Clearly distinguish primary information (e.g., item counts, health) using varying font weights (Bold vs. Light) rather than just relying on font size.

## 3. UI Components (TailwindCSS + Framer Motion)

### Main Menus & Overlays

- **Backgrounds:** Use `bg-slate-900/60 backdrop-blur-md` for main panels. Add a subtle 1px border (`border-white/10`) to define edges.
- **Transitions:** Every menu should fade and slide in smoothly using `framer-motion`. **No sudden pop-ins.**
  - _Example:_ `initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}`
- **Shadows:** Use glowing drop-shadows for active or critical elements rather than harsh black box-shadows.

### Buttons & Interactive Elements

- **Hover States:** Elements must feel reactive. Buttons should subtly scale up (`hover:scale-105`) and brighten on hover.
- **Micro-animations:** Incorporate tap animations (`whileTap={{ scale: 0.95 }}`) on all clickable items.
- **Borders:** Primary action buttons (like "Start Game" or "Join World") should feature subtle, crisp borders and hover states without gradients (e.g., `bg-white/5 hover:bg-white/10 border border-white/10`).

### The HUD (Heads-Up Display)

- **Minimalist:** The HUD must never obscure the player's view of the world.
- **Hotbar:** The hotbar should float at the bottom of the screen with a glassmorphic background. The currently selected slot must be highlighted with a crisp, minimal border (e.g., `border-white/50 bg-white/10`) rather than glowing rings.
- **Status Bars:** Health and resource bars should feature smooth width transitions when values change. Avoid rigid, instantly snapping bars.

## 4. Color Palette Tokens (Reference)

- **Background Base:** `slate-900` (#0f172a) to `slate-950` (#020617)
- **Panel Backgrounds:** `rgba(15, 23, 42, 0.6)` + `blur(12px)`
- **Primary Accent (Cyan/Blue):** `cyan-400` (#22d3ee) / `blue-500` (#3b82f6)
- **Success/Health:** `emerald-400` (#34d399)
- **Danger/Damage:** `rose-500` (#f43f5e)
- **Borders & Dividers:** `white/10` to `white/20`
- **Text:** `slate-100` (#f1f5f9) for primary, `slate-400` (#94a3b8) for secondary/muted text.
