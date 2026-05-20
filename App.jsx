import { useState, useEffect, useRef, useCallback } from 'react'
import { db, ensureAuth } from './firebase.js'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'

// ── constants ─────────────────────────────────────────────────────────────────
const FOLDERS = ['Личное', 'Работа']
const PALETTE = [
  '#FF79C6','#FF5555','#FFB86C','#F1FA8C',
  '#5BBFDE','#8BE9FD','#50FA7B','#BD93F9',
  '#7EB8A4','#6272A4','#FF6E6E','#A4FFFF',
  '#FFFFA5','#69FF94','#D6ACFF','#FF92DF',
]
const DATE_COLOR = '#6ab0d4'
const MONTHS_RU = {
  'январ':'01','феврал':'02','март':'03','апрел':'04',
  'май':'05','июн':'06','июл':'07','август':'08',
  'сентябр':'09','октябр':'10','ноябр':'11','декабр':'12',
}
const INIT_STATE = {
  tasks: { 'Личное': [], 'Работа': [] },
  tags: {
    'Личное': [
      { id:'l1', label:'ПА',     color:'#FF79C6' },
      { id:'l2', label:'ОПЛАТА', color:'#FFB86C' },
    ],
    'Работа': [
      { id:'w1', label:'СОГЛАСОВАТЬ', color:'#5BBFDE' },
      { id:'w2', label:'ПЕРЕЗВОНИТЬ', color:'#8BE9FD' },
      { id:'w3', label:'ЗАПРОСИТЬ',   color:'#BD93F9' },
    ],
  }
}

// ── text helpers ──────────────────────────────────────────────────────────────
const DM1 = '\x01', DM2 = '\x02'

function parseDate(s) {
  let m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})$/)
  if (m) return m[1].padStart(2,'0') + '.' + m[2].padStart(2,'0')
  m = s.match(/^(\d{1,2})\s*([а-яёa-z]+)/i)
  if (m) { const d=m[1].padStart(2,'0'),w=m[2].toLowerCase(); for(const[k,v]of Object.entries(MONTHS_RU))if(w.startsWith(k))return d+'.'+v }
  m = s.match(/^([а-яёa-z]+)\s*(\d{1,2})/i)
  if (m) { const w=m[1].toLowerCase(),d=m[2].padStart(2,'0'); for(const[k,v]of Object.entries(MONTHS_RU))if(w.startsWith(k))return d+'.'+v }
  return null
}

function cook(raw, tags) {
  let s = raw
  for (const t of tags)
    s = s.split(new RegExp(t.label,'gi')).join(t.label)
  const dates = []
  s = s.replace(/\d{1,2}[.\-\/]\d{1,2}|\d{1,2}\s*[а-яё]+|[а-яё]+\s*\d{1,2}/gi, tok => {
    const d = parseDate(tok.trim()); if (d) { dates.push(d); return '' } return tok
  })
  const found = []
  for (const t of tags) {
    if (s.includes(t.label)) { found.push(t.label); s = s.split(t.label).join('') }
  }
  s = s.replace(/\s+/g,' ').trim()
  const parts = []
  if (found.length) parts.push(found.join(' '))
  if (dates.length) parts.push(dates.map(d=>DM1+d+DM2).join(' '))
  if (s) parts.push(s)
  return parts.join(' ')
}

function toEditable(s) { return s.replace(new RegExp(DM1+'([\\d.]+)'+DM2,'g'),'$1') }

function Rendered({ text, tags }) {
  if (!text) return null
  const map = {}; for (const t of tags) map[t.label] = t.color
  const segs=[], re=new RegExp(DM1+'([\\d.]+)'+DM2,'g')
  let last=0, m
  while ((m=re.exec(text))!==null) {
    if (m.index>last) segs.push({k:'t',v:text.slice(last,m.index)})
    segs.push({k:'d',v:m[1]}); last=m.index+m[0].length
  }
  if (last<text.length) segs.push({k:'t',v:text.slice(last)})
  const els=[]; let ki=0
  for (const seg of segs) {
    if (seg.k==='d') { els.push(<span key={ki++} style={{color:DATE_COLOR,fontWeight:400}}>{seg.v}</span>); continue }
    if (!tags.length) { els.push(seg.v); continue }
    let parts=[seg.v]
    for (const t of tags) {
      const next=[]
      for (const p of parts) {
        if (typeof p!=='string') { next.push(p); continue }
        const chunks=p.split(t.label)
        chunks.forEach((c,i)=>{next.push(c);if(i<chunks.length-1)next.push(<span key={ki++} style={{color:t.color,fontWeight:600}}>{t.label}</span>)})
      }
      parts=next
    }
    for (const p of parts) els.push(typeof p==='string'?p:<span key={ki++}>{p}</span>)
  }
  return <>{els}</>
}

function primaryTag(text,tags){ for(const t of tags)if(text.includes(t.label))return t.label; return null }
function sortItems(items,tags){
  const order=tags.map(t=>t.label)
  return [...items].sort((a,b)=>{
    const ia=order.indexOf(primaryTag(a.text,tags)??''); const ib=order.indexOf(primaryTag(b.text,tags)??'')
    return (ia<0?999:ia)-(ib<0?999:ib)||a.id-b.id
  })
}

// ── TagEditor ─────────────────────────────────────────────────────────────────
function TagEditor({ tag, onChange, onRemove }) {
  const [palOpen,setPalOpen]=useState(false)
  return (
    <div style={S.tagBlock}>
      <div style={S.tagRow}>
        <span style={{...S.tagLabel,color:tag.color}}>{tag.label}</span>
        <button onClick={()=>setPalOpen(o=>!o)} style={{...S.swatch,background:tag.color}}/>
        <button onClick={onRemove} style={S.ghost}>−</button>
      </div>
      {palOpen&&<div style={S.pal}>{PALETTE.map(c=><button key={c}
        onClick={()=>{onChange({...tag,color:c});setPalOpen(false)}}
        style={{...S.dot,background:c,outline:tag.color===c?`2px solid ${c}`:'none',outlineOffset:2}}/>)}</div>}
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ folder, tags, onTagsChange, onClose }) {
  const [label,setLabel]=useState('')
  const [color,setColor]=useState(PALETTE[4])
  const [palOpen,setPalOpen]=useState(false)

  function add(){
    const l=label.trim().toUpperCase(); if(!l)return
    onTagsChange([...tags,{id:String(Date.now()),label:l,color}])
    setLabel(''); setPalOpen(false)
  }

  return(
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sidebar} onClick={e=>e.stopPropagation()}>
        <div style={S.sbHead}>
          <span style={S.sbTitle}>{folder}</span>
          <button onClick={onClose} style={S.ghost}>×</button>
        </div>
        <div style={S.tagList}>
          {tags.map(t=>(
            <TagEditor key={t.id} tag={t}
              onChange={u=>onTagsChange(tags.map(x=>x.id===t.id?u:x))}
              onRemove={()=>onTagsChange(tags.filter(x=>x.id!==t.id))}/>
          ))}
        </div>
        <div style={S.newWrap}>
          <div style={S.newRow}>
            <input value={label} placeholder="новый тег" style={S.ghostInput}
              onChange={e=>setLabel(e.target.value)} onKeyDown={e=>e.key==='Enter'&&add()}/>
            <button onClick={()=>setPalOpen(o=>!o)} style={{...S.swatch,background:color}}/>
            <button onClick={add} style={S.ghost}>+</button>
          </div>
          {palOpen&&<div style={S.pal}>{PALETTE.map(c=><button key={c}
            onClick={()=>{setColor(c);setPalOpen(false)}}
            style={{...S.dot,background:c,outline:color===c?`2px solid ${c}`:'none',outlineOffset:2}}/>)}</div>}
        </div>
      </div>
    </div>
  )
}

// ── SubtaskRow ────────────────────────────────────────────────────────────────
function SubtaskRow({ sub, tags, onToggle, onDelete }) {
  const [hovered,setHovered]=useState(false)
  return(
    <div style={{...S.subRow,background:hovered?'#0c1520':'transparent'}}
      onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}>
      <span style={S.subIndent}>└</span>
      <button onClick={()=>onToggle(sub.id)}
        style={{...S.box,borderColor:sub.done?'#2a4a3a':'#161e2a',width:11,height:11,minWidth:11}}>
        {sub.done&&<span style={{...S.check,fontSize:8}}>✓</span>}
      </button>
      <span style={{...S.text,fontSize:11,opacity:sub.done?0.3:0.65,textDecoration:sub.done?'line-through':'none',color:'#6a8399'}}>
        <Rendered text={sub.text} tags={tags}/>
      </span>
      <button onClick={()=>onDelete(sub.id)}
        style={{...S.ghost,opacity:hovered?0.35:0,fontSize:13}}>×</button>
    </div>
  )
}

function AddSubtask({ tags, onAdd, onCancel }) {
  const [val,setVal]=useState('')
  const ref=useRef(null)
  useEffect(()=>ref.current?.focus(),[])
  function commit(){ const v=val.trim(); if(v)onAdd(cook(v,tags)); onCancel() }
  return(
    <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 4px 4px 4px'}}>
      <span style={S.subIndent}>└</span>
      <input ref={ref} value={val} style={{...S.editInput,fontSize:11,color:'#6a8399'}}
        onChange={e=>setVal(e.target.value)}
        onKeyDown={e=>{if(e.key==='Enter')commit();if(e.key==='Escape')onCancel()}}
        onBlur={onCancel}/>
    </div>
  )
}

// ── TaskRow ───────────────────────────────────────────────────────────────────
function TaskRow({ task, tags, onToggle, onDelete, onPrio, onUpdateTask }) {
  const [hovered,setHovered]=useState(false)
  const [addingSub,setAddingSub]=useState(false)
  const pressTimer=useRef(null)

  const startPress=()=>{pressTimer.current=setTimeout(()=>onPrio(task.id),500)}
  const endPress=()=>clearTimeout(pressTimer.current)
  const onDblClick=e=>{e.stopPropagation();setAddingSub(true)}

  function addSub(text){ onUpdateTask(task.id,{subtasks:[...(task.subtasks||[]),{id:Date.now(),text,done:false}]}) }
  function toggleSub(sid){ onUpdateTask(task.id,{subtasks:(task.subtasks||[]).map(s=>s.id===sid?{...s,done:!s.done}:s)}) }
  function deleteSub(sid){ onUpdateTask(task.id,{subtasks:(task.subtasks||[]).filter(s=>s.id!==sid)}) }

  const subs=sortItems(task.subtasks||[],tags)

  return(
    <div style={S.taskBlock}>
      <div style={{...S.row,background:hovered?'#0f1924':'transparent'}}
        onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>{setHovered(false);endPress()}}
        onMouseDown={startPress} onMouseUp={endPress}
        onTouchStart={startPress} onTouchEnd={endPress}
        onDoubleClick={onDblClick}>
        <button onClick={e=>{endPress();onToggle(task.id)}}
          style={{...S.box,borderColor:task.done?'#2a4a3a':'#1a2535'}}>
          {task.done&&<span style={S.check}>✓</span>}
        </button>
        <span style={{...S.text,textDecoration:task.done?'line-through':'none',opacity:task.done?0.3:1}}>
          <Rendered text={task.text} tags={tags}/>
        </span>
        {task.priority&&!task.done&&<span style={S.prio}>!!!</span>}
        <button onClick={e=>{e.stopPropagation();onDelete(task.id)}}
          style={{...S.ghost,opacity:hovered?0.35:0,fontSize:14}}>×</button>
      </div>
      {subs.filter(s=>!s.done).map(s=><SubtaskRow key={s.id} sub={s} tags={tags} onToggle={toggleSub} onDelete={deleteSub}/>)}
      {addingSub&&<AddSubtask tags={tags} onAdd={addSub} onCancel={()=>setAddingSub(false)}/>}
      {subs.filter(s=>s.done).map(s=><SubtaskRow key={s.id} sub={s} tags={tags} onToggle={toggleSub} onDelete={deleteSub}/>)}
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [state,setState]=useState(INIT_STATE)
  const [input,setInput]=useState('')
  const [fi,setFi]=useState(0)
  const [sbOpen,setSbOpen]=useState(false)
  const [uid,setUid]=useState(null)
  const [synced,setSynced]=useState(false)
  const inputRef=useRef(null)
  const remoteWrite=useRef(false) // flag to skip write when update came from Firestore

  const folder=FOLDERS[fi]
  const tags=state.tags[folder]||[]
  const tasks=state.tasks[folder]||[]

  // ── auth + realtime sync ──
  useEffect(()=>{
    ensureAuth().then(user=>{
      if (!user) return
      setUid(user.uid)
      const ref=doc(db,'users',user.uid,'data','state')
      // listen for remote changes
      const unsub=onSnapshot(ref,snap=>{
        if (snap.exists()) {
          remoteWrite.current=true
          setState(snap.data())
        }
        setSynced(true)
      })
      return ()=>unsub()
    })
  },[])

  // ── write to Firestore on local state change ──
  useEffect(()=>{
    if (!uid || !synced) return
    if (remoteWrite.current) { remoteWrite.current=false; return }
    const ref=doc(db,'users',uid,'data','state')
    setDoc(ref,state).catch(console.error)
  },[state,uid,synced])

  const setFolderTags=useCallback(newTags=>{
    setState(prev=>({...prev,tags:{...prev.tags,[folder]:newTags}}))
  },[folder])

  const setTasks=fn=>
    setState(prev=>({...prev,tasks:{...prev.tasks,[folder]:typeof fn==='function'?fn(prev.tasks[folder]||[]):fn}}))

  const add=()=>{
    const raw=input.trim(); if(!raw)return
    setTasks(prev=>[{id:Date.now(),text:cook(raw,tags),done:false,priority:false,subtasks:[]},...prev])
    setInput(''); inputRef.current?.focus()
  }

  const toggle=id=>setTasks(p=>p.map(t=>t.id===id?{...t,done:!t.done}:t))
  const prio=id=>setTasks(p=>p.map(t=>t.id===id?{...t,priority:!t.priority}:t))
  const del=id=>setTasks(p=>p.filter(t=>t.id!==id))
  const clrDone=()=>setTasks(p=>p.filter(t=>!t.done))
  const updateTask=(id,patch)=>setTasks(p=>p.map(t=>t.id===id?{...t,...patch}:t))

  const pending=sortItems(tasks.filter(t=>!t.done),tags)
  const done=tasks.filter(t=>t.done)

  return(
    <div style={S.root}>
      {sbOpen&&<Sidebar folder={folder} tags={tags} onTagsChange={setFolderTags} onClose={()=>setSbOpen(false)}/>}
      <div style={S.wrap}>
        <div style={S.topBar}>
          <button onClick={()=>setSbOpen(true)} style={{...S.ghost,fontSize:17,padding:'0 6px'}}>≡</button>
          <input ref={inputRef} value={input} style={S.input} autoFocus
            onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&add()}/>
          {!synced&&<span style={{color:'#1e3045',fontSize:10}}>…</span>}
        </div>
        <div style={S.list}>
          {pending.map(t=><TaskRow key={t.id} task={t} tags={tags}
            onToggle={toggle} onDelete={del} onPrio={prio} onUpdateTask={updateTask}/>)}
        </div>
        {done.length>0&&<>
          <div style={S.divider}/>
          <div style={S.list}>
            {done.map(t=><TaskRow key={t.id} task={t} tags={tags}
              onToggle={toggle} onDelete={del} onPrio={prio} onUpdateTask={updateTask}/>)}
          </div>
          <button onClick={clrDone} style={S.clearBtn}>сгрузить выполненное</button>
        </>}
      </div>
      <div style={S.fbar}>
        <button onClick={()=>setFi(i=>(i+1)%FOLDERS.length)} style={S.fbtn}>{folder}</button>
      </div>
    </div>
  )
}

const S={
  root:{minHeight:'100vh',background:'#0d1117',fontFamily:"'JetBrains Mono','Fira Code',monospace",display:'flex',flexDirection:'column'},
  wrap:{flex:1,maxWidth:640,width:'100%',margin:'0 auto',padding:'16px 16px 90px',boxSizing:'border-box'},
  topBar:{display:'flex',gap:8,marginBottom:14,alignItems:'center'},
  input:{flex:1,background:'transparent',border:'none',borderBottom:'1px solid #151f2e',outline:'none',color:'#7a9bb5',fontSize:12,fontFamily:'inherit',fontWeight:300,padding:'7px 2px',caretColor:'#3a6a8a'},
  ghost:{background:'transparent',border:'none',color:'#2a4055',fontSize:16,cursor:'pointer',padding:'2px 4px',fontFamily:'inherit',lineHeight:1},
  list:{display:'flex',flexDirection:'column'},
  taskBlock:{display:'flex',flexDirection:'column'},
  row:{display:'flex',alignItems:'center',gap:9,padding:'7px 4px',transition:'background 0.1s',userSelect:'none',cursor:'default'},
  subRow:{display:'flex',alignItems:'center',gap:6,padding:'3px 4px',transition:'background 0.1s'},
  subIndent:{color:'#1a2535',fontSize:11,flexShrink:0,width:16,textAlign:'center'},
  box:{width:12,height:12,minWidth:12,border:'1px solid',borderRadius:2,background:'transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0,flexShrink:0},
  check:{color:'#2a5a3a',fontSize:9,fontWeight:'bold',lineHeight:1},
  text:{flex:1,fontSize:12,color:'#7a9bb5',lineHeight:1.5,wordBreak:'break-word',fontWeight:300},
  prio:{color:'#5a2525',fontSize:10,fontWeight:500,flexShrink:0,letterSpacing:'0.1em'},
  editInput:{flex:1,background:'transparent',border:'none',borderBottom:'1px solid #1f6feb',outline:'none',color:'#7a9bb5',fontSize:12,fontFamily:'inherit',fontWeight:300,padding:'0 0 2px',caretColor:'#3a6a8a'},
  divider:{height:1,background:'#0f1924',margin:'8px 0'},
  clearBtn:{marginTop:8,background:'transparent',border:'none',color:'#1e3045',fontSize:10,padding:'3px 0',cursor:'pointer',fontFamily:'inherit',fontWeight:300},
  fbar:{position:'fixed',bottom:0,left:0,right:0,background:'#0d1117',borderTop:'1px solid #0f1924'},
  fbtn:{width:'100%',background:'transparent',border:'none',padding:'12px 0',fontSize:10,fontFamily:'inherit',fontWeight:300,color:'#1e3045',cursor:'pointer',letterSpacing:'0.14em'},
  overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:100,display:'flex'},
  sidebar:{width:250,maxWidth:'88vw',background:'#080d13',borderRight:'1px solid #0f1924',height:'100%',display:'flex',flexDirection:'column',padding:'16px 12px',boxSizing:'border-box',overflowY:'auto'},
  sbHead:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16},
  sbTitle:{color:'#2a4055',fontSize:10,letterSpacing:'0.14em'},
  tagList:{display:'flex',flexDirection:'column',gap:0,marginBottom:16},
  tagBlock:{borderBottom:'1px solid #0a1018',paddingBottom:5,paddingTop:4},
  tagRow:{display:'flex',alignItems:'center',gap:8},
  tagLabel:{fontSize:11,fontWeight:500,letterSpacing:'0.08em',flex:1},
  swatch:{width:9,height:9,borderRadius:'50%',border:'none',cursor:'pointer',padding:0,flexShrink:0,opacity:0.8},
  pal:{display:'flex',flexWrap:'wrap',gap:5,marginTop:7,paddingBottom:3},
  dot:{width:13,height:13,border:'none',borderRadius:'50%',cursor:'pointer',padding:0,flexShrink:0},
  newWrap:{borderTop:'1px solid #0f1924',paddingTop:10},
  newRow:{display:'flex',gap:7,alignItems:'center'},
  ghostInput:{flex:1,background:'transparent',border:'none',borderBottom:'1px solid #151f2e',outline:'none',color:'#7a9bb5',fontSize:11,fontFamily:'inherit',fontWeight:300,padding:'3px 0',caretColor:'#3a6a8a'},
}
