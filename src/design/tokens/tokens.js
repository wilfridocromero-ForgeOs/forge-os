// src/design/tokens.js

export const colors = {
  background: "#09090B",
  surface: "#111113",
  surfaceAlt: "#18181B",

  border: "#27272A",
  borderHover: "#3F3F46",

  text: "#FFFFFF",
  textMuted: "#A1A1AA",
  textSoft: "#71717A",

  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",

  white: "#FFFFFF",
};

export const radius = {
  sm: "0.75rem",
  md: "1rem",
  lg: "1.5rem",
};

export const spacing = {
  xs: "0.5rem",
  sm: "1rem",
  md: "1.5rem",
  lg: "2rem",
  xl: "3rem",
};

export const typography = {
  pageTitle: "text-5xl font-semibold tracking-tight",

  sectionTitle: "text-3xl font-semibold",

  cardTitle: "text-xl font-semibold",

  metric: "text-4xl font-semibold",

  body: "text-base",

  small: "text-sm",

  eyebrow: "text-xs uppercase tracking-[0.35em]",
};

export const shadows = {
  card:
    "0 20px 60px rgba(0,0,0,.35)",

  cardHover:
    "0 30px 80px rgba(0,0,0,.45)",
};

export const animation = {
  fast: "150ms",
  normal: "300ms",
  slow: "500ms",
};

export const layout = {
  sidebarWidth: "18rem",
  pageMaxWidth: "1600px",

  headerHeight: "80px",

  contentPadding: "2rem",
};

export const zIndex = {
  sidebar: 30,
  overlay: 40,
  modal: 50,
  toast: 60,
};