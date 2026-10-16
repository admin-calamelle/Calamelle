import React, { useEffect, useState } from 'react';
import { BookPlus, Pencil, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export default function CompendiumPage(){
  const {user,access}=useAuth();
  const navigate=useNavigate();
  const [q,setQ]=useState('');
  const [items,setItems]=useState([]);
  const [active,setActive]=useState(null);
  const [courses,setCourses]=useState([]);
  const [courseId,setCourseId]=useState('');
  const [msg,setMsg]=useState('');
  const [error,setError]=useState('');
  const civicOnly=Boolean(user?.role==='learner'&&access?.naturalisationAccess&&!access?.fullAccess);

  useEffect(()=>{
    const t=setTimeout(()=>{
      const scope=civicOnly?'&civic=true':'';
      api(`/questions?limit=100&search=${encodeURIComponent(q)}${scope}`).then(d=>{
        setItems(d.questions);
        setActive(current=>current&&d.questions.find(x=>x.id===current.id)?current:(d.questions[0]||null));
        setError('');
      }).catch(e=>{setItems([]);setActive(null);setError(e.message)});
    },180);
    return()=>clearTimeout(t);
  },[q,civicOnly]);

  useEffect(()=>{
    if(user&&(user.role==='trainer'||user.role==='admin')){
      api('/trainer/courses').then(d=>setCourses(d.courses)).catch(()=>{});
    }
  },[user]);

  const canManage=user?.role==='trainer'||user?.role==='admin';
  async function addCourse(){
    if(!active||!courseId)return;
    try{
      await api(`/trainer/courses/${courseId}/questions`,{method:'POST',body:JSON.stringify({questionId:active.id})});
      setMsg('Question ajoutée au cours.');
    }catch(e){setMsg(e.message)}
  }
  function edit(){
    if(!active)return;
    navigate(user?.role==='admin'?`/app/admin/questions?edit=${active.id}`:`/app/trainer/questions?edit=${active.id}`);
  }

  return <div className="page">
    <PageHeader eyebrow="LE COMPENDIUM" title={civicOnly?'Votre bibliothèque civique.':'Retrouvez une notion, une explication, un thème.'} subtitle={canManage?'Consultez la banque publiée et réutilisez les notions dans vos cours.':civicOnly?'Votre Pass Naturalisation ouvre ici uniquement les questions et explications civiques.':'Une bibliothèque de référence alimentée par la même banque que les exercices.'}/>
    {msg&&<div className="alert info">{msg}</div>}
    {error&&<div className="alert error">{error}</div>}
    <div className="search-box"><Search size={19}/><input placeholder={civicOnly?'Rechercher dans le Compendium civique…':'Rechercher dans les questions et explications…'} value={q} onChange={e=>setQ(e.target.value)}/></div>
    <div className="compendium-layout">
      <div className="compendium-list">{items.map(item=><button className={active?.id===item.id?'active':''} key={item.id} onClick={()=>setActive(item)}><span>{item.category}</span><strong>{item.prompt}</strong></button>)}</div>
      <div className="paper-card compendium-detail">{active?<>
        <div className="eyebrow">{active.category}</div><h2>{active.prompt}</h2><p>{active.explanation}</p>
        <div className="detail-tags"><span>{active.difficulty}</span>{active.civicTheme&&<span>{active.civicTheme}</span>}{active.isCivic&&<span>Examen civique</span>}</div>
        {canManage&&<div className="compendium-actions"><button className="btn btn-ghost" onClick={edit}><Pencil size={16}/> Modifier</button>{courses.length>0&&<><select value={courseId} onChange={e=>setCourseId(e.target.value)}><option value="">Ajouter à un cours…</option>{courses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select><button className="btn btn-primary" disabled={!courseId} onClick={addCourse}><BookPlus size={16}/> Ajouter</button></>}</div>}
      </>:<div className="empty-state">Sélectionnez une notion.</div>}</div>
    </div>
  </div>
}
