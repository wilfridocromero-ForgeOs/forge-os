// src/design/tokens.js

/* ==========================================================
   ORVESEN DESIGN TOKENS
   v1.0
========================================================== */

export const colors = {
  // Backgrounds
  background: "#09090B",
  surface: "#111113",
  surfaceAlt: "#18181B",
  surfaceHover: "#202024",

  // Borders
  border: "#27272A",
  borderHover: "#3F3F46",
  divider: "#2A2A2E",

  // Text
  text: "#FFFFFF",
  textSecondary: "#D4D4D8",
  textMuted: "#A1A1AA",
  textSoft: "#71717A",

  // Brand
  white: "#FFFFFF",

  // Status
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",
  info: "#3B82F6",
};

export const radius = {
  xs: "0.5rem",
  sm: "0.75rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  full: "9999px",
};

export const spacing = {
  xs: "0.25rem",
  sm: "0.5rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  "2xl": "3rem",
  "3xl": "4rem",
  "4xl": "6rem",
};

export const typography = {
  display: "text-6xl font-semibold tracking-tight",

  pageTitle: "text-5xl font-semibold tracking-tight",

  sectionTitle: "text-3xl font-semibold",

  cardTitle: "text-xl font-semibold",

  metric: "text-4xl font-semibold",

  body: "text-base leading-7",

  small: "text-sm leading-6",

  caption: "text-xs",

  eyebrow:
    "text-xs uppercase tracking-[0.35em]",
};

export const shadows = {
  sm: "0 10px 30px rgba(0,0,0,.25)",

  card: "0 20px 60px rgba(0,0,0,.35)",

  cardHover:
    "0 30px 80px rgba(0,0,0,.45)",

  modal:
    "0 50px 120px rgba(0,0,0,.60)",
};

export const animation = {
  fast: "150ms",
  normal: "250ms",
  slow: "400ms",
};

export const layout = {
  sidebarWidth: "18rem",

  headerHeight: "80px",

  pageMaxWidth: "1700px",

  contentPadding: "2rem",

  sectionGap: "3rem",
};

export const zIndex = {
  sidebar: 30,
  overlay: 40,
  dropdown: 45,
  modal: 50,
  toast: 60,
};