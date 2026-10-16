import React, { useEffect, useState } from 'react';
import { Check, LockKeyhole, Play, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { localStats } from '../lib/localDb';
import { useAuth } from '../context/AuthContext';

const stages = Array.from({length:19},(_,i)=>({number:i+1,title:i===18?'Épreuve finale':`Étape ${i+1}`,subtitle:i===18?'Mobiliser toutes les notions':'Une courte session pour faire progresser votre maîtrise'}));
export default function JourneyPage(){
  const[answered,setAnswered]=useState(0);
  const navigate=useNavigate();
  const{access}=useAuth();
  const civicOnly=Boolean(access?.naturalisationAccess&&!access?.fullAccess);
  useEffect(()=>{localStats().then(s=>setAnswered(s.totalAnswers))},[]);
  const unlocked=Math.min(19,Math.floor(answered/8)+1);
  const target=civicOnly?'/app/quiz?civic=true':'/app/quiz?category=Langue%20fran%C3%A7aise';
  return <div className="page"><PageHeader eyebrow={civicOnly?'PARCOURS CIVIQUE':'PARCOURS GUIDÉ'} title="Avancez, une étape après l’autre." subtitle={civicOnly?'Votre Pass Naturalisation transforme le parcours en entraînement civique progressif.':'Le parcours se déverrouille au fil de votre pratique et vous conduit jusqu’à l’épreuve finale.'}/>
    <div className="journey-map">{stages.map((s)=>{const done=s.number<unlocked;const active=s.number===unlocked;const locked=s.number>unlocked;return <div key={s.number} className={`journey-node ${done?'done':''} ${active?'active':''} ${locked?'locked':''}`}><div className="journey-line"/><button type="button" disabled={locked} onClick={()=>navigate(target)} className="journey-circle">{done?<Check/>:locked?<LockKeyhole/>:s.number===19?<Sparkles/>:<Play/>}</button><div className="journey-copy"><span>{String(s.number).padStart(2,'0')}</span><h3>{s.title}</h3><p>{civicOnly?(s.number===19?'Simulation civique finale':'Révision civique ciblée'):s.subtitle}</p>{active&&<em>Étape actuelle</em>}</div></div>})}</div>
  </div>
}
