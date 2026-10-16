import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BookOpen, CircleGauge, ClipboardCheck, Compass, FileCheck2, GraduationCap, Library, LockKeyhole, Menu, Medal, RotateCcw, Settings, Settings2, ShieldCheck, Sparkles, Tags, Timer, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const learnerLinks=[
  ['Tableau de bord','/app',CircleGauge,true],['Mes cours','/app/courses',GraduationCap],['Apprendre','/app/learn',BookOpen],['Révisions','/app/review',RotateCcw],['Parcours guidé','/app/journey',Compass,false,'journey'],['Examen civique','/app/civic-exam',ClipboardCheck],['Défi 60 secondes','/app/speed',Timer,false,'speed'],['Compendium','/app/compendium',Library,false,'compendium'],['Progression','/app/progress',Medal],['Offres','/app/pricing',Sparkles]
];
const trainerLinks=[
  ['Tableau de bord','/app/trainer/overview',CircleGauge],['Cours','/app/trainer/courses',GraduationCap],['Groupes','/app/trainer/groups',Users],['Apprenants','/app/trainer/learners',Users],['Banque de questions','/app/trainer/questions',BookOpen],['Validation','/app/trainer/validation',FileCheck2],['Compendium','/app/compendium',Library]
];
const adminLinks=[
  ['Tableau de bord','/app/admin/overview',CircleGauge],['MDM','/app/admin/mdm',Tags],['Questions','/app/admin/questions',BookOpen],['Utilisateurs','/app/admin/users',Users],['Configuration','/app/admin/settings',Settings2],['Compendium','/app/compendium',Library]
];

export default function AppLayout(){
  const[open,setOpen]=useState(false);const{user,access}=useAuth();const navigate=useNavigate();const role=user?.role||'learner';const links=role==='admin'?adminLinks:role==='trainer'?trainerLinks:learnerLinks;
  const roleLabel=role==='admin'?'ADMINISTRATION':role==='trainer'?'ESPACE FORMATEUR':'ESPACE APPRENANT';
  return <div className="app-shell"><button className="mobile-menu" onClick={()=>setOpen(v=>!v)} aria-label="Menu">{open?<X/>:<Menu/>}</button><aside className={`sidebar ${open?'open':''}`}><button className="brand-button" onClick={()=>navigate('/')}><img src="/assets/calamelle-logo.png" alt="Calamelle" className="sidebar-logo"/></button><div className="sidebar-role">{roleLabel}</div><div className="brand-divider"/><nav className="side-nav">{links.map(([label,to,Icon,end,feature])=>{const locked=role==='learner'&&feature&&access&&!access.features?.[feature];const destination=locked?'/app/pricing':to;return <NavLink key={to} to={destination} end={Boolean(end)} onClick={()=>setOpen(false)} className={({isActive})=>`side-link ${isActive&&!locked?'active':''} ${locked?'locked':''}`}><Icon size={18}/><span>{label}</span>{locked&&<LockKeyhole size={14} className="side-lock"/>}</NavLink>})}</nav><div className="sidebar-bottom"><NavLink to="/app/profile" className={({isActive})=>`side-link ${isActive?'active':''}`}><Settings size={18}/><span>Profil & données</span></NavLink><div className="sidebar-quote">« Petit roseau deviendra plume. »</div></div></aside><main className="app-main"><Outlet/></main>{open&&<div className="scrim" onClick={()=>setOpen(false)}/>}</div>
}
