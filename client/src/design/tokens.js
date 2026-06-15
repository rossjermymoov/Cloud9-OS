/**
 * Moov OS Design Tokens — Light Mode
 * Sourced from MoveNinja V2 Design Language & Product Brief
 */
export const colors = {
  bg: {
    primary: '#F8FAFC',
    secondary: '#FFFFFF',
    surface: '#F1F5F9',
    surfaceHover: '#E2E8F0',
  },
  accent: {
    green: '#00C853',
    purple: '#7B2FBE',
    magenta: '#E91E8C',
    amber: '#F59E0B',
    teal: '#00BCD4',
    greenDim: 'rgba(0,200,83,0.12)',
    magentaDim: 'rgba(233,30,140,0.12)',
    amberDim: 'rgba(245,158,11,0.12)',
  },
  text: {
    primary: '#0F172A',
    secondary: '#64748B',
    dark: '#0F172A',
  },
  border: {
    subtle: 'rgba(0,0,0,0.08)',
    green: 'rgba(0,200,83,0.4)',
  },
};

/**
 * Health score → colour mapping
 * Spec Section 1.6: Green = healthy, Amber = warning, Red = at-risk
 * Design: Red maps to magenta (#E91E8C) per MoveNinja V2 status convention
 */
export const healthScoreColor = {
  green:  { bg: colors.accent.greenDim,   text: colors.accent.green,   border: colors.accent.green,   label: 'Healthy' },
  amber:  { bg: colors.accent.amberDim,   text: colors.accent.amber,   border: colors.accent.amber,   label: 'Warning' },
  red:    { bg: colors.accent.magentaDim, text: colors.accent.magenta, border: colors.accent.magenta, label: 'At Risk' },
};

export const accountStatusColor = {
  active:     { text: '#166534',             bg: '#dcfce7',                label: 'Active' },
  on_stop:    { text: colors.accent.magenta, bg: colors.accent.magentaDim, label: 'On Stop' },
  suspended:  { text: '#92400e',             bg: '#fef3c7',                label: 'Suspended' },
  churned:    { text: colors.text.secondary, bg: 'rgba(0,0,0,0.06)',       label: 'Churned' },
};

export const tierColor = {
  bronze:     { text: '#92400e', bg: 'rgba(205,127,50,0.12)' },
  silver:     { text: '#475569', bg: 'rgba(100,116,139,0.12)' },
  gold:       { text: '#92400e', bg: '#fef3c7' },
  enterprise: { text: colors.accent.purple, bg: 'rgba(123,47,190,0.10)' },
};
