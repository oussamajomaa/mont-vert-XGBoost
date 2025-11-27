import { Chart as ChartJS } from 'chart.js';

// Typo & couleurs globales
ChartJS.defaults.color = '#334155';          // slate-700
ChartJS.defaults.font.family = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell';
ChartJS.defaults.borderColor = 'rgba(148,163,184,0.25)'; // slate-400/25

// Palette utilitaire
export const palette = {
  in:   { border: 'rgb(16,185,129)',  bg: 'rgba(16,185,129,0.20)'  }, // emerald-500
  out:  { border: 'rgb(239,68,68)',   bg: 'rgba(239,68,68,0.20)'   }, // red-500
  adj:  { border: 'rgb(245,158,11)',  bg: 'rgba(245,158,11,0.20)'  }, // amber-500
  loss: { border: 'rgb(238,130,238)', bg: 'rgba(238,130,238,0.20)'   }, // violet-500
  exp:  { border: 'rgb(99,102,241)',  bg: 'rgba(99,102,241,0.20)'  }, // indigo (EXPIRED)
};

// Catégories (bar/doughnut)
export const categorical = [
  '#0ea5e9', // sky-500
  '#22c55e', // green-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#14b8a6', // teal-500
  '#a855f7', // purple-500
  '#06b6d4', // cyan-500
];

// Options communes
export const commonOptions = {
  plugins: {
    legend: {
      labels: { color: '#334155' } // slate-700
    },
    tooltip: {
      backgroundColor: 'rgba(15,23,42,0.92)', // slate-900/92
      titleColor: '#e2e8f0', // slate-200
      bodyColor: '#e2e8f0',
      borderColor: 'rgba(148,163,184,0.3)',
      borderWidth: 1,
    }
  },
  scales: {
    x: {
      grid: { color: 'rgba(148,163,184,0.20)' }, // slate-400/20
      ticks: { color: '#475569' } // slate-600
    },
    y: {
      grid: { color: 'rgba(148,163,184,0.20)' },
      ticks: { color: '#475569' }
    }
  }
};
