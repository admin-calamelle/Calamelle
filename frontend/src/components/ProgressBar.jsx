import React from 'react';
export default function ProgressBar({ value = 0, max = 100, label }) {
  const pct = Math.max(0, Math.min(100, max ? value / max * 100 : 0));
  return <div className="progress-wrap">{label && <div className="progress-label"><span>{label}</span><strong>{Math.round(pct)}%</strong></div>}<div className="progress-track"><div className="progress-fill" style={{width: `${pct}%`}} /></div></div>;
}
