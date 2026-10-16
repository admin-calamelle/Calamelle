import React, { useEffect, useState } from 'react';
import PageHeader from '../components/PageHeader';
import ProgressBar from '../components/ProgressBar';
import { localStats } from '../lib/localDb';

export default function ProgressPage(){const[stats,setStats]=useState(null);useEffect(()=>{localStats().then(setStats)},[]);const categories=stats?Object.entries(stats.byCategory):[];return <div className="page"><PageHeader eyebrow="VOTRE PROGRESSION" title="Mesurer sans se laisser distraire par les chiffres." subtitle="Quelques indicateurs simples pour voir ce qui s’installe et ce qui mérite encore une révision."/>
<div className="stat-grid three"><div className="stat-card"><span>Réponses</span><strong>{stats?.totalAnswers||0}</strong><small>toutes sessions locales</small></div><div className="stat-card"><span>Précision</span><strong>{stats?.accuracy||0}%</strong><small>réponses justes</small></div><div className="stat-card"><span>À réviser</span><strong>{stats?.due||0}</strong><small>notions arrivées à échéance</small></div></div>
<div className="paper-card mastery-card"><h2>Maîtrise par domaine</h2>{categories.length?categories.map(([cat,v])=>{const total=v.correct+v.wrong;const pct=total?Math.round(v.correct/total*100):0;return <div className="mastery-row" key={cat}><div><span>{cat}</span><small>{v.questions} notion{v.questions>1?'s':''} rencontrée{v.questions>1?'s':''}</small></div><div className="mastery-bar"><ProgressBar value={pct}/></div><strong>{pct}%</strong></div>}):<div className="empty-state">Répondez à quelques questions pour faire apparaître votre progression.</div>}</div>
</div>}
