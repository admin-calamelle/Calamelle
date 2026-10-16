import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileCheck2, Pencil, Plus, Send, Trash2, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

const blank = {
  prompt:'', explanation:'', category:'', sourceModule:'', sourceTheme:'', difficulty:'Apprenti',
  isCivic:false, civicTheme:'', questionType:'knowledge', answers:['','','',''], correctIndex:0
};

const statusLabels = { draft:'Brouillon', pending:'À valider', validated:'Validé', published:'Publié' };

export default function QuestionManagement({ role='trainer', courses=[], onCourseChanged=null }) {
  const [params, setParams] = useSearchParams();
  const [mdm,setMdm]=useState({modules:[],themes:[],levels:[],questionTypes:[]});
  const [questions,setQuestions]=useState([]); const [form,setForm]=useState(blank); const [editing,setEditing]=useState(null);
  const [filters,setFilters]=useState({search:'',status:'',module:'',civic:''}); const [msg,setMsg]=useState(''); const [busy,setBusy]=useState(false);
  const [courseId,setCourseId]=useState('');

  const normalModules = useMemo(()=>mdm.modules.filter(m=>m.code!=='civic-official'),[mdm]);
  const currentModule = normalModules.find(m=>m.name===form.category) || normalModules[0];
  const themes = mdm.themes.filter(t=>t.module_code===currentModule?.code);
  const civicThemes = mdm.themes.filter(t=>t.module_code==='civic-official');

  async function load(){
    const qs=new URLSearchParams(); if(filters.search)qs.set('search',filters.search); if(filters.status)qs.set('status',filters.status); if(filters.module)qs.set('module',filters.module); if(filters.civic)qs.set('civic',filters.civic); qs.set('limit','160');
    const [m,q]=await Promise.all([api('/mdm'),api(`/manage/questions?${qs}`)]); setMdm(m);setQuestions(q.questions);
    if(!form.category && m.modules?.length){ const first=m.modules.find(x=>x.code!=='civic-official'); if(first)setForm(f=>({...f,category:first.name,sourceModule:first.name})); }
  }
  useEffect(()=>{load().catch(e=>setMsg(e.message))},[filters.search,filters.status,filters.module,filters.civic]);
  useEffect(()=>{const edit=params.get('edit'); if(edit) api(`/manage/questions/${edit}`).then(d=>startEdit(d.question)).catch(e=>setMsg(e.message));},[]);

  function startEdit(q){
    const incomingAnswers = Array.isArray(q.answers) ? q.answers.map(a=>a.text ?? '') : [];
    while(incomingAnswers.length < 4) incomingAnswers.push('');
    const ci=Math.max(0,q.answers?.findIndex(a=>a.isCorrect) ?? 0);
    setEditing(q.id);
    setForm({prompt:q.prompt||'',explanation:q.explanation||'',category:q.category||'',sourceModule:q.sourceModule||q.category||'',sourceTheme:q.sourceTheme||'',difficulty:q.difficulty||'Apprenti',isCivic:Boolean(q.isCivic),civicTheme:q.civicTheme||'',questionType:q.questionType||'knowledge',answers:incomingAnswers.slice(0,4),correctIndex:ci});
    window.scrollTo({top:0,behavior:'smooth'}); {const next=new URLSearchParams(params);next.set('edit',q.id);setParams(next);}
  }
  function reset(){setEditing(null);const first=normalModules[0];setForm({...blank,category:first?.name||'',sourceModule:first?.name||''});{const next=new URLSearchParams(params);next.delete('edit');setParams(next);}}
  function setModule(name){const m=normalModules.find(x=>x.name===name);setForm(f=>({...f,category:name,sourceModule:name,sourceTheme:'',civicTheme:f.civicTheme}));}
  function updateAnswer(i,value){const a=[...form.answers];a[i]=value;setForm({...form,answers:a});}
  async function save(status='draft'){
    const isDraft = status === 'draft';
    const missing = [];
    if(!form.category) missing.push('le module');
    if(!form.prompt.trim()) missing.push('la question');
    if(!isDraft){
      if(!form.explanation.trim()) missing.push('l’explication');
      if(form.answers.some(a=>!a.trim())) missing.push('les 4 réponses');
      if(form.isCivic&&!form.civicTheme) missing.push('le thème officiel civique');
    }
    if(missing.length){
      setMsg(`${isDraft?'Pour enregistrer le brouillon':'Pour continuer'}, complétez ${missing.join(', ')}.`);
      return;
    }
    setBusy(true);setMsg('');
    try{
      const body={...form,status};
      if(editing){
        await api(`/manage/questions/${editing}`,{method:'PUT',body:JSON.stringify(body)});
        if(status!=='draft') await api(`/manage/questions/${editing}/status`,{method:'POST',body:JSON.stringify({status})});
        setMsg(status==='draft'?'Brouillon mis à jour.':status==='pending'?'Question soumise pour validation.':'Question publiée.');
      } else {
        await api('/manage/questions',{method:'POST',body:JSON.stringify(body)});
        setMsg(status==='pending'?'Question soumise pour validation.':status==='published'?'Question publiée.':'Brouillon enregistré.');
      }
      reset();await load();
    }catch(e){setMsg(e.message)}finally{setBusy(false)}
  }
  async function status(id,status){try{await api(`/manage/questions/${id}/status`,{method:'POST',body:JSON.stringify({status})});setMsg(`Statut : ${statusLabels[status]}.`);await load()}catch(e){setMsg(e.message)}}
  async function remove(id){if(!confirm('Archiver cette question ?'))return;try{await api(`/manage/questions/${id}`,{method:'DELETE'});await load()}catch(e){setMsg(e.message)}}
  async function addToCourse(questionId){if(!courseId){setMsg('Choisissez d’abord un cours.');return}try{const d=await api(`/trainer/courses/${courseId}/questions`,{method:'POST',body:JSON.stringify({questionId})});setMsg(d.alreadyPresent?'Cette question est déjà dans le cours.':'Question ajoutée au cours.');if(!d.alreadyPresent)await onCourseChanged?.()}catch(e){setMsg(e.message)}}

  return <div className="management-stack">
    {msg&&<div className="alert info">{msg}</div>}
    <section className="paper-card question-wizard">
      <div className="section-row"><div><div className="eyebrow">{editing?'MODIFICATION':'NOUVELLE QUESTION'}</div><h2>{editing?'Modifier la question':'Créer et classer une question'}</h2></div>{editing&&<button className="icon-button" onClick={reset}><X/></button>}</div>
      <div className="wizard-step"><span>1</span><div><strong>Classification obligatoire</strong><small>Choisissez le module, la thématique et le niveau avant de saisir la question.</small></div></div>
      <div className="form-grid three">
        <label>Module *<select value={form.category} onChange={e=>setModule(e.target.value)}>{normalModules.map(m=><option key={m.code} value={m.name}>{m.name}</option>)}</select></label>
        <label>Thématique<select value={form.sourceTheme} onChange={e=>setForm({...form,sourceTheme:e.target.value})}><option value="">Non précisée</option>{themes.map(t=><option key={t.id} value={t.name}>{t.name}</option>)}</select></label>
        <label>Niveau *<select value={form.difficulty} onChange={e=>setForm({...form,difficulty:e.target.value})}>{mdm.levels.map(l=><option key={l.code} value={l.name}>{l.name}</option>)}</select></label>
      </div>
      <label className="civic-switch"><input type="checkbox" checked={form.isCivic} onChange={e=>setForm({...form,isCivic:e.target.checked,civicTheme:e.target.checked?form.civicTheme:''})}/><span><strong>Cette question fait partie de l’examen civique</strong><small>Laissez cette case vide si la question ne doit pas apparaître dans l’examen civique.</small></span></label>
      {form.isCivic&&<div className="civic-config"><label>Thème officiel *<select value={form.civicTheme} onChange={e=>setForm({...form,civicTheme:e.target.value})}><option value="">Choisir…</option>{civicThemes.map(t=><option key={t.id} value={t.name}>{t.name}</option>)}</select></label><fieldset><legend>Type de question</legend>{mdm.questionTypes.map(t=><label key={t.code} className="radio-choice"><input type="radio" name="question-type" checked={form.questionType===t.code} onChange={()=>setForm({...form,questionType:t.code})}/>{t.name}</label>)}</fieldset></div>}
      <div className="wizard-step"><span>2</span><div><strong>Contenu</strong><small>Rédigez la question, les propositions et l’explication pédagogique.</small></div></div>
      <label>Question *<textarea rows="3" value={form.prompt} onChange={e=>setForm({...form,prompt:e.target.value})}/></label>
      <div className="answers-editor modern">{form.answers.map((a,i)=><label key={i}><input type="radio" name="correct-answer" checked={form.correctIndex===i} onChange={()=>setForm({...form,correctIndex:i})}/><span className="answer-index">{String.fromCharCode(65+i)}</span><input value={a} onChange={e=>updateAnswer(i,e.target.value)} placeholder={`Réponse ${String.fromCharCode(65+i)}`}/></label>)}</div>
      <label>Explication *<textarea rows="3" value={form.explanation} onChange={e=>setForm({...form,explanation:e.target.value})}/></label>
      <div className="workflow-actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>save('draft')}>{busy?'Enregistrement…':'Enregistrer le brouillon'}</button><button type="button" className="btn btn-primary" disabled={busy} onClick={()=>save('pending')}><Send size={16}/> Soumettre pour validation</button>{role==='admin'&&<button type="button" className="btn btn-gold" disabled={busy} onClick={()=>save('published')}><CheckCircle2 size={16}/> Publier directement</button>}</div>
      {msg&&<div className="workflow-feedback" role="status" aria-live="polite">{msg}</div>}
    </section>

    <section className="paper-card management-list-card">
      <div className="section-row"><div><div className="eyebrow">BANQUE DE QUESTIONS</div><h2>Rechercher, valider et organiser</h2></div></div>
      <div className="management-filters"><input placeholder="Rechercher…" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/><select value={filters.module} onChange={e=>setFilters({...filters,module:e.target.value})}><option value="">Tous les modules</option>{normalModules.map(m=><option key={m.code}>{m.name}</option>)}</select><select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">Tous les statuts</option>{Object.entries(statusLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><select value={filters.civic} onChange={e=>setFilters({...filters,civic:e.target.value})}><option value="">Civique : tous</option><option value="true">Examen civique</option><option value="false">Hors examen</option></select></div>
      {courses.length>0&&<div className="course-quick-add"><span>Ajout rapide au cours :</span><select value={courseId} onChange={e=>setCourseId(e.target.value)}><option value="">Choisir un cours…</option>{courses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></div>}
      <div className="managed-question-list">{questions.map(q=><article key={q.id}><div className="managed-question-main"><div className="question-kicker"><span>{q.category}</span><span>{q.difficulty}</span>{q.isCivic&&<span className="civic-pill">Civique</span>}<span className={`status-pill ${q.status}`}>{statusLabels[q.status]||q.status}</span></div><strong>{q.prompt}</strong><small>{q.sourceTheme||q.civicTheme||'Sans thématique'}{q.authorName?` · ${q.authorName}`:''}</small></div><div className="managed-actions"><button className="icon-button" title="Modifier" onClick={()=>startEdit(q)}><Pencil size={16}/></button>{courses.length>0&&q.status==='published'&&<button className="btn btn-mini" onClick={()=>addToCourse(q.id)}>+ Cours</button>}{courses.length>0&&q.status!=='published'&&<span className="course-publish-hint">Publier avant ajout au cours</span>}{q.status==='draft'&&<button className="btn btn-mini" onClick={()=>status(q.id,'pending')}>Soumettre</button>}{q.status==='pending'&&<button className="btn btn-mini btn-gold" onClick={()=>status(q.id,'validated')}><FileCheck2 size={14}/> Valider</button>}{q.status==='validated'&&role==='admin'&&<button className="btn btn-mini btn-primary" onClick={()=>status(q.id,'published')}>Publier</button>}{(q.status!=='published'||role==='admin')&&<button className="icon-button danger" onClick={()=>remove(q.id)}><Trash2 size={16}/></button>}</div></article>)}</div>
    </section>
  </div>
}
