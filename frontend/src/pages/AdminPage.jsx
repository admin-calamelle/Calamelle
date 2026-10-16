import React, { useEffect, useRef, useState } from 'react';
import { BadgeCheck, Clock3, Database, FileUp, Pencil, Plus, RotateCcw, Settings2, ShieldAlert, ShieldCheck, Trash2, UserX, Users } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import QuestionManagement from '../components/QuestionManagement';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const tabs=[['overview','Vue d’ensemble'],['mdm','MDM'],['questions','Questions'],['users','Utilisateurs'],['settings','Configuration']];
const roleLabels={learner:'Apprenant',trainer:'Formateur',admin:'Admin'};
const planLabels={monthly:'Mensuel',annual:'Annuel',naturalisation:'Pass Naturalisation',lifetime:'À vie'};

export default function AdminPage(){
  const {tab='overview'}=useParams();
  const navigate=useNavigate();
  const {user:currentUser}=useAuth();
  const fileRef=useRef(null);
  const [stats,setStats]=useState(null);
  const [mdm,setMdm]=useState({modules:[],themes:[],levels:[],questionTypes:[]});
  const [users,setUsers]=useState([]);
  const [settings,setSettings]=useState({});
  const [msg,setMsg]=useState('');
  const [moduleForm,setModuleForm]=useState({code:'',name:'',description:''});
  const [themeForm,setThemeForm]=useState({moduleCode:'',name:''});
  const [levelForm,setLevelForm]=useState({code:'',name:''});
  const [typeForm,setTypeForm]=useState({code:'',name:''});

  async function load(){
    try{
      const calls=[api('/admin/stats'),api('/mdm')];
      if(tab==='users')calls.push(api('/admin/users'));
      if(tab==='settings')calls.push(api('/admin/settings'));
      const data=await Promise.all(calls);
      setStats(data[0].stats);setMdm(data[1]);
      let i=2;
      if(tab==='users')setUsers(data[i++].users);
      if(tab==='settings')setSettings(data[i]?.settings||{});
    }catch(e){setMsg(e.message)}
  }
  useEffect(()=>{load()},[tab]);

  async function addMdm(type,body,reset){try{await api(`/admin/mdm/${type}`,{method:'POST',body:JSON.stringify(body)});reset();await load();setMsg('Référentiel ajouté.')}catch(e){setMsg(e.message)}}
  async function editMdm(type,item){const name=prompt('Nouveau libellé',item.name);if(!name)return;try{const body={...item,name,moduleCode:item.module_code,sortOrder:item.sort_order,active:true};await api(`/admin/mdm/${type}/${item.id||item.code}`,{method:'PUT',body:JSON.stringify(body)});await load()}catch(e){setMsg(e.message)}}
  async function deleteMdm(type,key){if(!confirm('Désactiver cet élément MDM ?'))return;try{await api(`/admin/mdm/${type}/${key}`,{method:'DELETE'});await load()}catch(e){setMsg(e.message)}}
  async function updateRole(id,role){try{await api(`/admin/users/${id}/role`,{method:'PUT',body:JSON.stringify({role})});await load();setMsg('Rôle mis à jour. La modification est effective immédiatement.')}catch(e){setMsg(e.message)}}
  async function suspendUser(u){
    if(!confirm(`Suspendre ${u.name} ? Le compte sera bloqué immédiatement puis supprimé automatiquement après 24 heures.`))return;
    try{const d=await api(`/admin/users/${u.id}/suspend`,{method:'PUT',body:'{}'});setMsg(d.message||'Compte suspendu.');await load()}catch(e){setMsg(e.message)}
  }
  async function restoreUser(u){try{const d=await api(`/admin/users/${u.id}/restore`,{method:'PUT',body:'{}'});setMsg(d.message||'Compte réactivé.');await load()}catch(e){setMsg(e.message)}}
  async function saveSettings(){try{const d=await api('/admin/settings',{method:'PUT',body:JSON.stringify({settings})});setSettings(d.settings||settings);setMsg('Configuration enregistrée et validée.')}catch(e){setMsg(e.message)}}
  async function importJson(e){const file=e.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());const arr=Array.isArray(data)?data:data.questions;const d=await api('/admin/questions/import',{method:'POST',body:JSON.stringify({questions:arr})});setMsg(`${d.imported} questions importées${d.errors?.length?` · ${d.errors.length} erreurs`:''}.`)}catch(e){setMsg(e.message)}finally{e.target.value=''}}
  const fmtDate=value=>value?new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'—';

  return <div className="page"><PageHeader eyebrow="ADMINISTRATION" title="Configurez et pilotez Calamelle." subtitle="MDM, contenus, utilisateurs, règles d’examen et publication : l’administrateur dispose du contrôle global de la plateforme."/>
    <div className="role-tabs">{tabs.map(([key,label])=><button key={key} className={tab===key?'active':''} onClick={()=>navigate(`/app/admin/${key}`)}>{label}</button>)}</div>
    {msg&&<div className="alert info">{msg}</div>}

    {tab==='overview'&&<><section className="admin-stats">{stats&&Object.entries(stats).map(([k,v])=><div className="stat-card" key={k}><Database/><span>{k}</span><strong>{v}</strong></div>)}</section><div className="admin-control-grid"><button className="paper-card control-tile" onClick={()=>navigate('/app/admin/mdm')}><Settings2/><strong>MDM</strong><span>Modules, thèmes, niveaux et types de questions.</span></button><button className="paper-card control-tile" onClick={()=>navigate('/app/admin/questions')}><ShieldCheck/><strong>Contenus</strong><span>Créer, valider, publier et archiver les questions.</span></button><button className="paper-card control-tile" onClick={()=>navigate('/app/admin/users')}><Users/><strong>Utilisateurs</strong><span>Rôles, suspension et accès : admin, formateur, apprenant.</span></button><button className="paper-card control-tile" onClick={()=>navigate('/app/admin/settings')}><Settings2/><strong>Configuration</strong><span>Règles de l’examen civique et paramètres globaux.</span></button></div></>}

    {tab==='mdm'&&<div className="mdm-grid">
      <section className="paper-card mdm-panel"><div className="eyebrow">MDM</div><h2>Modules</h2><form className="mdm-add" onSubmit={e=>{e.preventDefault();addMdm('modules',moduleForm,()=>setModuleForm({code:'',name:'',description:''}))}}><input required placeholder="Code (ex. grammaire)" value={moduleForm.code} onChange={e=>setModuleForm({...moduleForm,code:e.target.value})}/><input required placeholder="Nom du module" value={moduleForm.name} onChange={e=>setModuleForm({...moduleForm,name:e.target.value})}/><button className="icon-button"><Plus/></button></form><div className="mdm-list">{mdm.modules.map(m=><div key={m.id}><span><strong>{m.name}</strong><small>{m.code}</small></span><div><button className="icon-button" onClick={()=>editMdm('modules',m)}><Pencil size={14}/></button><button className="icon-button danger" onClick={()=>deleteMdm('modules',m.id)}><Trash2 size={14}/></button></div></div>)}</div></section>
      <section className="paper-card mdm-panel"><div className="eyebrow">MDM</div><h2>Thématiques</h2><form className="mdm-add" onSubmit={e=>{e.preventDefault();addMdm('themes',themeForm,()=>setThemeForm({moduleCode:'',name:''}))}}><select required value={themeForm.moduleCode} onChange={e=>setThemeForm({...themeForm,moduleCode:e.target.value})}><option value="">Module…</option>{mdm.modules.map(m=><option key={m.code} value={m.code}>{m.name}</option>)}</select><input required placeholder="Nom de la thématique" value={themeForm.name} onChange={e=>setThemeForm({...themeForm,name:e.target.value})}/><button className="icon-button"><Plus/></button></form><div className="mdm-list theme-list">{mdm.themes.map(t=><div key={t.id}><span><strong>{t.name}</strong><small>{mdm.modules.find(m=>m.code===t.module_code)?.name||t.module_code}</small></span><div><button className="icon-button" onClick={()=>editMdm('themes',t)}><Pencil size={14}/></button><button className="icon-button danger" onClick={()=>deleteMdm('themes',t.id)}><Trash2 size={14}/></button></div></div>)}</div></section>
      <section className="paper-card mdm-panel"><div className="eyebrow">MDM</div><h2>Niveaux</h2><form className="mdm-add" onSubmit={e=>{e.preventDefault();addMdm('levels',levelForm,()=>setLevelForm({code:'',name:''}))}}><input required placeholder="Code" value={levelForm.code} onChange={e=>setLevelForm({...levelForm,code:e.target.value})}/><input required placeholder="Nom" value={levelForm.name} onChange={e=>setLevelForm({...levelForm,name:e.target.value})}/><button className="icon-button"><Plus/></button></form><div className="mdm-list">{mdm.levels.map(l=><div key={l.code}><span><strong>{l.name}</strong><small>{l.code}</small></span><div><button className="icon-button" onClick={()=>editMdm('levels',l)}><Pencil size={14}/></button><button className="icon-button danger" onClick={()=>deleteMdm('levels',l.code)}><Trash2 size={14}/></button></div></div>)}</div></section>
      <section className="paper-card mdm-panel"><div className="eyebrow">MDM</div><h2>Types de questions</h2><form className="mdm-add" onSubmit={e=>{e.preventDefault();addMdm('question-types',typeForm,()=>setTypeForm({code:'',name:''}))}}><input required placeholder="Code" value={typeForm.code} onChange={e=>setTypeForm({...typeForm,code:e.target.value})}/><input required placeholder="Nom" value={typeForm.name} onChange={e=>setTypeForm({...typeForm,name:e.target.value})}/><button className="icon-button"><Plus/></button></form><div className="mdm-list">{mdm.questionTypes.map(t=><div key={t.code}><span><strong>{t.name}</strong><small>{t.code}</small></span><div><button className="icon-button" onClick={()=>editMdm('question-types',t)}><Pencil size={14}/></button><button className="icon-button danger" onClick={()=>deleteMdm('question-types',t.code)}><Trash2 size={14}/></button></div></div>)}</div></section>
    </div>}

    {tab==='questions'&&<><QuestionManagement role="admin"/><section className="paper-card import-card compact"><FileUp/><div><h3>Importer une banque JSON</h3><p>Import complémentaire pour l’administrateur. Les 2 741 QCM sont déjà intégrés.</p></div><button className="btn btn-ghost" onClick={()=>fileRef.current?.click()}>Choisir un JSON</button><input ref={fileRef} type="file" accept="application/json" hidden onChange={importJson}/></section></>}

    {tab==='users'&&<section className="paper-card admin-users-panel"><div className="section-row"><div><div className="eyebrow">UTILISATEURS</div><h2>Rôles, accès et suspension</h2><p className="muted">Une suspension bloque immédiatement la connexion. Sans réactivation, le compte est supprimé automatiquement 24 heures plus tard.</p></div><span className="count-badge">{users.length}</span></div><div className="admin-user-cards">{users.map(u=>{const suspended=u.status==='suspended';return <article className={`admin-user-card ${suspended?'suspended':''}`} key={u.id}><div className="admin-user-identity"><div className="admin-user-avatar">{u.name?.slice(0,1)?.toUpperCase()||'U'}</div><div><strong>{u.name}</strong><span>{u.email}</span></div></div><div className="admin-user-badges"><span className={`user-state ${suspended?'suspended':'active'}`}>{suspended?<><ShieldAlert size={13}/> Suspendu</>:<><BadgeCheck size={13}/> Actif</>}</span><span>{u.email_verified_at?'E-mail vérifié':'E-mail non vérifié'}</span>{u.premium_plan&&<span>{planLabels[u.premium_plan]||u.premium_plan}</span>}</div><div className="admin-user-controls"><label>Rôle<select value={u.role} disabled={suspended} onChange={e=>updateRole(u.id,e.target.value)}><option value="learner">Apprenant</option><option value="trainer">Formateur</option><option value="admin">Admin</option></select></label><div className="admin-user-action">{suspended?<button className="btn btn-ghost" onClick={()=>restoreUser(u)}><RotateCcw size={15}/> Réactiver</button>:<button className="btn btn-danger-soft" disabled={u.id===currentUser?.id} onClick={()=>suspendUser(u)}><UserX size={15}/> Suspendre</button>}</div></div>{suspended&&<div className="suspension-note"><Clock3 size={15}/><span>Suppression automatique prévue le <strong>{fmtDate(u.scheduled_delete_at)}</strong>. La réactivation annule la suppression.</span></div>}</article>})}</div></section>}

    {tab==='settings'&&<section className="paper-card settings-panel"><div className="eyebrow">CONFIGURATION</div><h2>Examen civique</h2><p className="muted">Ces valeurs pilotent réellement le générateur d’examen. Les limites sont vérifiées côté serveur.</p><div className="settings-grid"><label>Questions de connaissance<input type="number" min="1" max="200" step="1" value={settings.exam_knowledge_count||28} onChange={e=>setSettings({...settings,exam_knowledge_count:e.target.value})}/></label><label>Mises en situation<input type="number" min="0" max="200" step="1" value={settings.exam_scenario_count||12} onChange={e=>setSettings({...settings,exam_scenario_count:e.target.value})}/></label><label>Durée (minutes)<input type="number" min="1" max="240" step="1" value={settings.exam_duration_minutes||45} onChange={e=>setSettings({...settings,exam_duration_minutes:e.target.value})}/></label><label>Seuil de réussite (%)<input type="number" min="1" max="100" step="0.1" value={settings.exam_pass_percentage||80} onChange={e=>setSettings({...settings,exam_pass_percentage:e.target.value})}/></label></div><button className="btn btn-primary" onClick={saveSettings}>Enregistrer la configuration</button></section>}
  </div>
}
