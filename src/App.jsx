import { useState, useEffect, useRef } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://fbldconclzuckyotxvsk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibGRjb25jbHp1Y2t5b3R4dnNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MDUwMDcsImV4cCI6MjA5NjQ4MTAwN30.dFPSoQLShrnrhGdAt4K3TPZWLigtUAe4ZaI7XygCMO0";
const USE_CLOUD = SUPABASE_URL !== "PASTE_YOUR_SUPABASE_URL_HERE";

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
const sb = {
  h: { "Content-Type":"application/json", "apikey":SUPABASE_KEY, "Authorization":`Bearer ${SUPABASE_KEY}` },
  async getAll(table) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?order=created_at.desc`, { headers:this.h });
    if(!r.ok) throw new Error(); return r.json();
  },
  async upsert(table, obj) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method:"POST", headers:{...this.h,"Prefer":"resolution=merge-duplicates"}, body:JSON.stringify(obj)
    }); if(!r.ok) throw new Error();
  },
  async delete(table, id) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method:"DELETE", headers:this.h });
    if(!r.ok) throw new Error();
  },
};
const local = {
  load: (k) => { try { return JSON.parse(localStorage.getItem(k)||"[]"); } catch { return []; } },
  save: (k,v) => localStorage.setItem(k, JSON.stringify(v)),
};

// ─── QUEST COLORS — each quest gets one assigned randomly on creation ──────────
const QUEST_PALETTES = [
  { color:"#C084FC", glow:"rgba(192,132,252,0.3)", grad:"linear-gradient(135deg,#C084FC,#818CF8)" }, // violet-blue
  { color:"#F472B6", glow:"rgba(244,114,182,0.3)", grad:"linear-gradient(135deg,#F472B6,#FB7185)" }, // pink-rose
  { color:"#34D399", glow:"rgba(52,211,153,0.3)",  grad:"linear-gradient(135deg,#34D399,#06B6D4)" }, // emerald-cyan
  { color:"#FBBF24", glow:"rgba(251,191,36,0.3)",  grad:"linear-gradient(135deg,#FBBF24,#F97316)" }, // amber-orange
  { color:"#60A5FA", glow:"rgba(96,165,250,0.3)",  grad:"linear-gradient(135deg,#60A5FA,#818CF8)" }, // blue-indigo
  { color:"#F87171", glow:"rgba(248,113,113,0.3)", grad:"linear-gradient(135deg,#F87171,#FB923C)" }, // red-orange
  { color:"#A3E635", glow:"rgba(163,230,53,0.3)",  grad:"linear-gradient(135deg,#A3E635,#34D399)" }, // lime-emerald
  { color:"#E879F9", glow:"rgba(232,121,249,0.3)", grad:"linear-gradient(135deg,#E879F9,#C084FC)" }, // fuchsia-violet
  { color:"#2DD4BF", glow:"rgba(45,212,191,0.3)",  grad:"linear-gradient(135deg,#2DD4BF,#60A5FA)" }, // teal-blue
  { color:"#FB923C", glow:"rgba(251,146,60,0.3)",  grad:"linear-gradient(135deg,#FB923C,#FBBF24)" }, // orange-amber
];
const getPalette = (id) => {
  if (!id) return QUEST_PALETTES[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return QUEST_PALETTES[Math.abs(hash) % QUEST_PALETTES.length];
};

// ─── PARTY CHARACTERS ─────────────────────────────────────────────────────────
const AVATARS = ["🧙","🧝","🧛","🧜","🦸","🧚","🪄","⚔️","🛡️","🏹","🔮","💀","🐉","🦅","🌙","⭐","🔥","❄️","⚡","🌊"];
const AVATAR_COLORS = [
  "#C084FC","#F472B6","#34D399","#FBBF24","#60A5FA",
  "#F87171","#A3E635","#E879F9","#2DD4BF","#FB923C",
];
const getCharacter = (name) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const avatar = AVATARS[Math.abs(hash) % AVATARS.length];
  const color  = AVATAR_COLORS[Math.abs(hash >> 4) % AVATAR_COLORS.length];
  return { avatar, color };
};

const TITLES = ["Wizard","Ranger","Rogue","Paladin","Bard","Druid","Warlock","Monk","Fighter","Sorcerer","Cleric","Barbarian"];
const getTitle = (name) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash<<5)-hash);
  return TITLES[Math.abs(hash>>2) % TITLES.length];
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STATUSES = ["Active","Completed","On Hold","Abandoned"];
const STATUS_META = {
  Active:    { color:"#A8FF78", glow:"rgba(168,255,120,0.25)", emoji:"⚔️" },
  Completed: { color:"#78C1FF", glow:"rgba(120,193,255,0.25)", emoji:"✦"  },
  "On Hold": { color:"#FFD478", glow:"rgba(255,212,120,0.25)", emoji:"⏸"  },
  Abandoned: { color:"#FF7878", glow:"rgba(255,120,120,0.25)", emoji:"✗"  },
};
const EMPTY_QUEST = { id:null, title:"", description:"", status:"Active", invitees:"", created_at:null, location:null, emoji:"" };

// ─── EMOJI PICKER DATA ────────────────────────────────────────────────────────
const EMOJI_GROUPS = {
  "Adventure": ["⚔️","🏔️","🗺️","🧭","🏕️","🚀","🛸","🌋","🏴‍☠️","🗝️","🔮","⚡","🌊","🦅","🐉","🌙","☄️","🔥","💎","🏆"],
  "Life":      ["❤️","🎯","💡","📚","🎨","🎵","🍀","🌱","✨","🦋","🌸","🌈","🎭","🎪","🎲","🧩","🪄","🎁","🏠","👑"],
  "People":    ["🤝","👥","💪","🧠","👁️","🙌","✊","🫀","🧬","🤺","🧗","🏄","🧘","🥊","🎤","🎬","🎯","🏇","🤿","🪂"],
  "Places":    ["🌍","🗼","🏯","🏛️","🕌","⛩️","🌁","🏖️","🏜️","🌃","🎡","🚂","✈️","⛵","🌉","🏟️","🗽","🎠","🌄","🏙️"],
  "Objects":   ["💰","📱","🔬","🧪","⚙️","🔑","📜","🧲","💊","🎸","🎺","🥁","🎻","🔭","🪐","🧸","🪆","🎀","🧧","🪩"],
};
const EMPTY_MEMBER = { id:null, name:"", role:"", note:"", created_at:null };

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Icon = ({ d, size=18, stroke="currentColor", fill="none" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
    stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const Icons = {
  plus:    "M12 5v14M5 12h14",
  x:       "M18 6 6 18M6 6l12 12",
  edit:    "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  trash:   "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  user:    "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  users:   "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  chevron: "M6 9l6 6 6-6",
  pin:     "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 10a1 1 0 1 1-2 0 1 1 0 0 1 2 0z",
  search:  "M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z",
  map:     "M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7zM9 4v13M15 7v13",
  cloud:   "M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z",
  shield:  "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  star:    "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function ActionBtn({ onClick, children, danger, title }) {
  const [h,setH] = useState(false);
  return (
    <button onClick={onClick} title={title} style={{
      background:h?(danger?"rgba(255,100,100,0.15)":"rgba(255,255,255,0.09)"):"transparent",
      border:`1px solid ${h?(danger?"rgba(255,100,100,0.4)":"rgba(255,255,255,0.18)"):"rgba(255,255,255,0.08)"}`,
      borderRadius:9, padding:"6px 8px",
      color:h?(danger?"#FF7878":"#fff"):"rgba(255,255,255,0.4)",
      cursor:"pointer", display:"flex", alignItems:"center",
      transition:"all 0.15s", transform:h?"scale(1.08)":"scale(1)",
    }} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}>{children}</button>
  );
}

function StatusBadge({ status }) {
  const { color } = STATUS_META[status]||STATUS_META["Active"];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:7,
      fontSize:10, fontWeight:700, letterSpacing:"0.1em", color, textTransform:"uppercase" }}>
      <span style={{ width:7, height:7, borderRadius:"50%", background:color, flexShrink:0,
        animation:status==="Active"?"pulseDot 2s ease-in-out infinite":"none" }} />
      {status}
    </span>
  );
}

// ─── PARTY AVATAR (mini) ─────────────────────────────────────────────────────
function MiniAvatar({ name, size=32, overlap=false }) {
  const { avatar, color } = getCharacter(name);
  return (
    <div title={name} style={{
      width:size, height:size, borderRadius:"50%", flexShrink:0,
      background:`radial-gradient(circle at 35% 35%, ${color}40, ${color}15)`,
      border:`2px solid ${color}60`,
      display:"flex", alignItems:"center", justifyContent:"center",
      fontSize:size*0.42, boxShadow:`0 0 10px ${color}30`,
      marginLeft: overlap ? -size*0.3 : 0,
      position:"relative", zIndex: 1,
      transition:"transform 0.2s, z-index 0s",
      cursor:"default",
    }}
      onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.15)";e.currentTarget.style.zIndex="10";}}
      onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.zIndex="1";}}
    >
      {avatar}
    </div>
  );
}

// ─── PARTY MEMBER CARD ────────────────────────────────────────────────────────
function MemberCard({ member, onEdit, onDelete }) {
  const { avatar, color } = getCharacter(member.name);
  const title = getTitle(member.name);
  const [h,setH] = useState(false);
  return (
    <div onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{
      background:h?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.03)",
      border:`1px solid ${h?color+"40":"rgba(255,255,255,0.07)"}`,
      borderRadius:16, padding:"16px",
      display:"flex", alignItems:"flex-start", gap:14,
      transition:"all 0.25s cubic-bezier(0.34,1.2,0.64,1)",
      transform:h?"translateY(-2px)":"none",
      boxShadow:h?`0 8px 24px rgba(0,0,0,0.3), 0 0 0 1px ${color}20`:"none",
      position:"relative", overflow:"hidden",
    }}>
      {/* Glow top accent */}
      <div style={{ position:"absolute", top:0, left:0, right:0, height:1,
        background:`linear-gradient(90deg,transparent,${color}60,transparent)`,
        opacity:h?1:0, transition:"opacity 0.3s" }} />

      {/* Avatar */}
      <div style={{
        width:52, height:52, borderRadius:14, flexShrink:0,
        background:`radial-gradient(circle at 35% 35%, ${color}35, ${color}10)`,
        border:`2px solid ${color}50`,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:26, boxShadow:`0 0 20px ${color}25, inset 0 0 12px ${color}10`,
      }}>{avatar}</div>

      {/* Info */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
          <h4 style={{ margin:0, fontSize:15, fontWeight:700, color:"#F2F2F2",
            fontFamily:"'Cormorant Garamond',serif", letterSpacing:"-0.01em" }}>{member.name}</h4>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.1em",
            textTransform:"uppercase", color:color, opacity:0.8,
            background:`${color}15`, border:`1px solid ${color}30`,
            padding:"1px 6px", borderRadius:4, flexShrink:0 }}>
            {member.role || title}
          </span>
        </div>
        {member.note && (
          <p style={{ margin:0, fontSize:12.5, color:"rgba(255,255,255,0.38)",
            fontFamily:"'DM Sans',sans-serif", lineHeight:1.55,
            whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            "{member.note}"
          </p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display:"flex", gap:5, opacity:h?1:0, transition:"opacity 0.2s", flexShrink:0 }}>
        <ActionBtn onClick={()=>onEdit(member)} title="Edit"><Icon d={Icons.edit} size={13}/></ActionBtn>
        <ActionBtn onClick={()=>onDelete(member.id)} title="Remove" danger><Icon d={Icons.trash} size={13}/></ActionBtn>
      </div>
    </div>
  );
}

// ─── PARTY SECTION (in quest card expanded) ───────────────────────────────────
function PartySection({ names, members, questColor }) {
  const nameList = names ? names.split(",").map(s=>s.trim()).filter(Boolean) : [];
  const allNames = [...new Set([...nameList, ...members.map(m=>m.name)])];
  if (allNames.length === 0) return null;

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:10 }}>
        <Icon d={Icons.users} size={13} stroke="rgba(255,255,255,0.3)" />
        <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em",
          textTransform:"uppercase", color:"rgba(255,255,255,0.25)", fontFamily:"'DM Sans',sans-serif" }}>
          Party
        </span>
        <span style={{ fontSize:10, color:"rgba(255,255,255,0.2)", fontFamily:"'DM Sans',sans-serif" }}>
          ({allNames.length})
        </span>
      </div>

      {/* Member cards for detailed members */}
      {members.length > 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom: nameList.length > members.length ? 10 : 0 }}>
          {members.map(m=>(
            <div key={m.id} style={{
              background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)",
              borderRadius:14, padding:"12px 14px",
              display:"flex", alignItems:"center", gap:12,
              borderLeft:`3px solid ${getCharacter(m.name).color}40`,
            }}>
              <div style={{
                width:40, height:40, borderRadius:11, flexShrink:0,
                background:`radial-gradient(circle at 35% 35%, ${getCharacter(m.name).color}30, ${getCharacter(m.name).color}08)`,
                border:`1.5px solid ${getCharacter(m.name).color}40`,
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:20,
              }}>{getCharacter(m.name).avatar}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <span style={{fontSize:14,fontWeight:700,color:"#F0F0F0",fontFamily:"'Cormorant Garamond',serif"}}>{m.name}</span>
                  <span style={{fontSize:9,color:getCharacter(m.name).color,fontWeight:700,letterSpacing:"0.08em",
                    textTransform:"uppercase",background:`${getCharacter(m.name).color}15`,
                    padding:"1px 6px",borderRadius:4,border:`1px solid ${getCharacter(m.name).color}25`}}>
                    {m.role||getTitle(m.name)}
                  </span>
                </div>
                {m.note&&<p style={{margin:"2px 0 0",fontSize:12,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Sans',sans-serif",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>"{m.note}"</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Simple name pills for invitees not in detailed members */}
      {(() => {
        const detailedNames = members.map(m=>m.name.toLowerCase());
        const simple = nameList.filter(n=>!detailedNames.includes(n.toLowerCase()));
        if(simple.length===0) return null;
        return (
          <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
            {simple.map((name,i)=>{
              const {color,avatar}=getCharacter(name);
              return (
                <div key={i} style={{display:"flex",alignItems:"center",gap:6,
                  padding:"5px 10px 5px 6px", borderRadius:20,
                  background:`${color}10`, border:`1px solid ${color}25`,}}>
                  <span style={{fontSize:14}}>{avatar}</span>
                  <span style={{fontSize:12,color:"rgba(255,255,255,0.6)",fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>{name}</span>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}

// ─── MAP VIEW ─────────────────────────────────────────────────────────────────
function MapView({ location, height=200 }) {
  if (!location?.name) return null;
  const q = encodeURIComponent(location.name+" Azerbaijan");
  const src = `https://maps.google.com/maps?q=${q}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
  return (
    <div style={{position:"relative",borderRadius:14,overflow:"hidden",border:"1px solid rgba(255,255,255,0.1)",background:"#0d1117"}}>
      <iframe title="map" src={src} width="100%" height={height}
        style={{display:"block",border:"none",filter:"invert(1) hue-rotate(190deg) saturate(0.55) brightness(0.82) contrast(1.05)"}}
        loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
      <div style={{position:"absolute",bottom:0,left:0,right:0,zIndex:2,
        background:"linear-gradient(to top,rgba(8,8,12,0.97) 0%,transparent 100%)",
        padding:"24px 14px 11px",display:"flex",alignItems:"center",gap:7}}>
        <Icon d={Icons.pin} size={14} stroke="#A8FF78" fill="rgba(168,255,120,0.25)" />
        <span style={{fontSize:12.5,color:"rgba(255,255,255,0.75)",fontFamily:"'DM Sans',sans-serif",fontWeight:500,flex:1,
          whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{location.name}</span>
        <a href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noopener noreferrer"
          style={{fontSize:11,color:"rgba(255,255,255,0.35)",textDecoration:"none",fontFamily:"'DM Sans',sans-serif",
            padding:"3px 8px",borderRadius:6,border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.05)"}}>
          Open ↗
        </a>
      </div>
    </div>
  );
}

// ─── LOCATION SEARCH ─────────────────────────────────────────────────────────
function LocationSearch({ value, onChange }) {
  const [query, setQuery] = useState(value?.name||"");
  const handleSet = () => { if(!query.trim()) return; onChange({name:query.trim()}); };
  const clear = () => { onChange(null); setQuery(""); };
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <div style={{display:"flex",gap:8}}>
        <div style={{position:"relative",flex:1}}>
          <div style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}>
            <Icon d={Icons.search} size={15} stroke="rgba(255,255,255,0.3)" />
          </div>
          <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSet()}
            placeholder="e.g. Baku, Nizami Street, Ganja…"
            style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)",
              borderRadius:12,padding:"12px 12px 12px 38px",color:"#F0F0F0",fontSize:13.5,outline:"none",
              fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",transition:"border-color 0.2s"}}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.25)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.12)"} />
        </div>
        <button onClick={handleSet} style={{padding:"0 18px",borderRadius:12,border:"none",cursor:"pointer",
          background:"rgba(168,255,120,0.15)",color:"#A8FF78",fontSize:13,fontWeight:700,
          fontFamily:"'DM Sans',sans-serif",flexShrink:0}}>Set</button>
      </div>
      <p style={{fontSize:11,color:"rgba(255,255,255,0.22)",margin:0,fontFamily:"'DM Sans',sans-serif"}}>
        Type any place and press Set or Enter — map appears instantly.
      </p>
      {value?.name&&(
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderRadius:10,
          background:"rgba(168,255,120,0.06)",border:"1px solid rgba(168,255,120,0.18)"}}>
          <Icon d={Icons.pin} size={13} stroke="#A8FF78" fill="rgba(168,255,120,0.2)" />
          <span style={{fontSize:12.5,color:"rgba(255,255,255,0.65)",fontFamily:"'DM Sans',sans-serif",flex:1}}>{value.name}</span>
          <button onClick={clear} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,0.25)",display:"flex",padding:2}}>
            <Icon d={Icons.x} size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── MEMBER MODAL ─────────────────────────────────────────────────────────────
function MemberModal({ member, onSave, onClose }) {
  const [form, setForm] = useState({...EMPTY_MEMBER,...member});
  const [visible, setVisible] = useState(false);
  useEffect(()=>{requestAnimationFrame(()=>setVisible(true));},[]);
  const close=()=>{setVisible(false);setTimeout(onClose,250);};
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const { avatar, color } = form.name ? getCharacter(form.name) : { avatar:"🧙", color:"#A8FF78" };

  const inp={width:"100%",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",
    borderRadius:12,padding:"12px 14px",color:"#F0F0F0",fontSize:14,outline:"none",
    fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",transition:"border-color 0.2s"};
  const lbl={fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
    color:"rgba(255,255,255,0.3)",marginBottom:7,display:"block",fontFamily:"'DM Sans',sans-serif"};

  return (
    <div style={{position:"fixed",inset:0,background:`rgba(0,0,0,${visible?0.75:0})`,
      backdropFilter:`blur(${visible?20:0}px)`,display:"flex",alignItems:"flex-end",
      justifyContent:"center",zIndex:2000,transition:"all 0.25s"}}
      onClick={e=>e.target===e.currentTarget&&close()}>
      <div style={{background:"linear-gradient(160deg,#111114,#0C0C0F)",
        borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,0.09)",borderBottom:"none",
        width:"100%",maxWidth:560,padding:"12px 24px 52px",
        display:"flex",flexDirection:"column",gap:20,
        transform:visible?"translateY(0)":"translateY(100%)",
        transition:"transform 0.3s cubic-bezier(0.34,1.1,0.64,1)",maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.1)",margin:"8px auto 0"}} />

        {/* Preview */}
        {form.name && (
          <div style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",
            borderRadius:16,background:`${color}08`,border:`1px solid ${color}25`,
            animation:"cardIn 0.3s ease both"}}>
            <div style={{width:52,height:52,borderRadius:14,flexShrink:0,
              background:`radial-gradient(circle at 35% 35%,${color}35,${color}10)`,
              border:`2px solid ${color}50`,display:"flex",alignItems:"center",
              justifyContent:"center",fontSize:26,boxShadow:`0 0 20px ${color}20`}}>{avatar}</div>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:"#F2F2F2",fontFamily:"'Cormorant Garamond',serif"}}>{form.name}</div>
              <div style={{fontSize:11,color:color,fontWeight:600,letterSpacing:"0.06em",marginTop:2,
                textTransform:"uppercase"}}>{form.role||getTitle(form.name)}</div>
            </div>
          </div>
        )}

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h2 style={{margin:0,fontSize:20,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",color:"#F2F2F2"}}>
            {member?.id?"Edit Member":"Add Party Member"}
          </h2>
          <button onClick={close} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",
            borderRadius:10,padding:"7px 8px",cursor:"pointer",color:"rgba(255,255,255,0.4)"}}>
            <Icon d={Icons.x} size={16} />
          </button>
        </div>

        <div><label style={lbl}>Name *</label>
          <input value={form.name} onChange={e=>set("name",e.target.value)} placeholder="Their name…" style={inp}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"} /></div>

        <div><label style={lbl}>Role / Class</label>
          <input value={form.role} onChange={e=>set("role",e.target.value)}
            placeholder={form.name?getTitle(form.name):"e.g. Navigator, Strategist, Hype Man…"} style={inp}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"} /></div>

        <div><label style={lbl}>Note</label>
          <input value={form.note} onChange={e=>set("note",e.target.value)}
            placeholder="What's their vibe or contribution?" style={inp}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"} /></div>

        <button onClick={()=>{if(!form.name.trim())return;onSave({...form,id:form.id||crypto.randomUUID(),created_at:form.created_at||new Date().toISOString()});}}
          disabled={!form.name.trim()} style={{
          background:form.name.trim()?"linear-gradient(135deg,#e8e8e8,#fff)":"rgba(255,255,255,0.08)",
          color:form.name.trim()?"#0A0A0C":"rgba(255,255,255,0.2)",
          border:"none",borderRadius:14,padding:"15px",fontSize:15,fontWeight:700,
          cursor:form.name.trim()?"pointer":"not-allowed",fontFamily:"'DM Sans',sans-serif"}}>
          {member?.id?"Save Changes":"Add to Party"}
        </button>
      </div>
    </div>
  );
}


// ─── EMOJI PICKER ─────────────────────────────────────────────────────────────
function EmojiPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState("Adventure");
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position:"relative" }}>
      {/* Trigger button */}
      <button onClick={() => setOpen(o => !o)} style={{
        display:"flex", alignItems:"center", gap:10,
        padding:"10px 16px", borderRadius:12, cursor:"pointer",
        background: open ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
        border:`1px solid ${open?"rgba(255,255,255,0.18)":"rgba(255,255,255,0.09)"}`,
        transition:"all 0.2s", width:"100%",
      }}>
        <span style={{ fontSize:22, lineHeight:1 }}>{value || "✨"}</span>
        <span style={{ fontSize:13, color: value ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.3)",
          fontFamily:"'DM Sans',sans-serif", fontWeight:500 }}>
          {value ? "Change emoji" : "Pick an emoji for this quest"}
        </span>
        {value && (
          <button onClick={(e) => { e.stopPropagation(); onChange(""); }} style={{
            marginLeft:"auto", background:"none", border:"none", cursor:"pointer",
            color:"rgba(255,255,255,0.3)", fontSize:13, padding:"2px 4px",
          }}>✕</button>
        )}
      </button>

      {/* Picker panel */}
      {open && (
        <div style={{
          position:"absolute", top:"calc(100% + 8px)", left:0, right:0, zIndex:9999,
          background:"#0E0E12", border:"1px solid rgba(255,255,255,0.12)",
          borderRadius:16, overflow:"hidden",
          boxShadow:"0 24px 64px rgba(0,0,0,0.7)",
          animation:"cardIn 0.2s ease both",
        }}>
          {/* Group tabs */}
          <div style={{ display:"flex", overflowX:"auto", borderBottom:"1px solid rgba(255,255,255,0.07)",
            padding:"8px 8px 0", gap:4 }}>
            {Object.keys(EMOJI_GROUPS).map(g => (
              <button key={g} onClick={() => setActiveGroup(g)} style={{
                flexShrink:0, padding:"6px 12px", borderRadius:"8px 8px 0 0",
                background: activeGroup===g ? "rgba(255,255,255,0.08)" : "transparent",
                border:"none", borderBottom: activeGroup===g ? "2px solid rgba(255,255,255,0.5)" : "2px solid transparent",
                color: activeGroup===g ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)",
                cursor:"pointer", fontSize:11, fontWeight:600, letterSpacing:"0.05em",
                fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap",
                transition:"all 0.15s",
              }}>{g}</button>
            ))}
          </div>

          {/* Emoji grid */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(10,1fr)", gap:2, padding:10 }}>
            {EMOJI_GROUPS[activeGroup].map((em, i) => (
              <button key={i} onClick={() => { onChange(em); setOpen(false); }} style={{
                fontSize:20, padding:"7px", borderRadius:8, border:"none",
                background: value===em ? "rgba(255,255,255,0.12)" : "transparent",
                cursor:"pointer", transition:"all 0.1s", lineHeight:1,
                boxShadow: value===em ? "inset 0 0 0 1px rgba(255,255,255,0.2)" : "none",
              }}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.08)"}
                onMouseLeave={e=>e.currentTarget.style.background=value===em?"rgba(255,255,255,0.12)":"transparent"}
              >{em}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── QUEST CARD ───────────────────────────────────────────────────────────────
function QuestCard({ quest, members, onEdit, onDelete, index }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered]   = useState(false);
  const palette = getPalette(quest.id);
  const { emoji } = STATUS_META[quest.status]||STATUS_META["Active"];
  const { color:statusColor } = STATUS_META[quest.status]||STATUS_META["Active"];

  const inviteeList = quest.invitees ? quest.invitees.split(",").map(s=>s.trim()).filter(Boolean) : [];
  const questMembers = members.filter(m=>inviteeList.map(n=>n.toLowerCase()).includes(m.name.toLowerCase()));
  const hasDetails = quest.description||inviteeList.length>0||quest.location?.name;

  return (
    <div onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
      style={{
        position:"relative", overflow:"hidden",
        background:expanded?"rgba(255,255,255,0.055)":hovered?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.025)",
        borderRadius:20,
        border:`1px solid ${expanded?palette.color+"35":hovered?palette.color+"25":"rgba(255,255,255,0.07)"}`,
        transition:"all 0.3s cubic-bezier(0.34,1.2,0.64,1)",
        transform:hovered&&!expanded?"translateY(-2px)":"translateY(0)",
        boxShadow:expanded
          ?`0 16px 48px rgba(0,0,0,0.45), 0 0 0 1px ${palette.color}15, inset 0 0 60px ${palette.color}04`
          :hovered?`0 8px 24px rgba(0,0,0,0.3), 0 0 0 1px ${palette.color}10`:"none",
        animation:`cardIn 0.5s cubic-bezier(0.34,1.2,0.64,1) ${index*0.07}s both`,
      }}>

      {/* Colored top edge glow */}
      <div style={{position:"absolute",top:0,left:0,right:0,height:2,
        background:palette.grad,
        opacity:expanded?0.9:hovered?0.6:0.3,
        transition:"opacity 0.3s"}} />

      {/* Subtle corner glow */}
      <div style={{position:"absolute",top:-20,right:-20,width:120,height:120,borderRadius:"50%",
        background:`radial-gradient(circle,${palette.color}12 0%,transparent 70%)`,
        pointerEvents:"none"}} />

      {/* Quest emoji — shown prominently, falls back to status emoji as watermark */}
      {quest.emoji ? (
        <div style={{position:"absolute",right:16,top:"50%",transform:"translateY(-50%)",
          fontSize:28,opacity:expanded?0.55:hovered?0.45:0.3,userSelect:"none",
          transition:"opacity 0.3s, transform 0.3s",
          filter:expanded?"none":"blur(0px)",
          transform: expanded?"translateY(-50%) scale(1.1)":"translateY(-50%) scale(1)",
        }}>{quest.emoji}</div>
      ) : (
        <div style={{position:"absolute",right:16,bottom:12,fontSize:36,
          opacity:expanded?0.07:0.035,userSelect:"none",filter:"blur(1px)"}}>{emoji}</div>
      )}

      {/* ── Collapsed row ── */}
      <div onClick={()=>hasDetails&&setExpanded(e=>!e)}
        style={{padding:"16px 18px",display:"flex",alignItems:"center",gap:12,
          cursor:hasDetails?"pointer":"default",userSelect:"none"}}>

        {/* Color dot */}
        <div style={{width:9,height:9,borderRadius:"50%",flexShrink:0,
          background:palette.color,
          boxShadow:`0 0 10px ${palette.color}`,
          animation:quest.status==="Active"?"pulseDot 2s ease-in-out infinite":"none"}} />

        <div style={{flex:1,minWidth:0}}>
          <h3 style={{margin:0,fontSize:16,fontWeight:700,letterSpacing:"-0.02em",
            color:"#F2F2F2",lineHeight:1.3,whiteSpace:"nowrap",
            overflow:"hidden",textOverflow:"ellipsis",
            fontFamily:"'Cormorant Garamond',serif"}}>{quest.title}</h3>
          {!expanded&&(quest.description||quest.location?.name||quest.emoji)&&(
            <p style={{margin:"3px 0 0",fontSize:12,color:"rgba(255,255,255,0.3)",
              whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
              fontFamily:"'DM Sans',sans-serif"}}>
              {quest.location?.name?`📍 ${quest.location.name}`:quest.description?.slice(0,60)+(quest.description?.length>60?"…":"")}
            </p>
          )}
        </div>

        {/* Mini avatars row */}
        {!expanded && inviteeList.length>0 && (
          <div style={{display:"flex",alignItems:"center",flexShrink:0}}>
            {inviteeList.slice(0,4).map((name,i)=>(
              <MiniAvatar key={i} name={name} size={26} overlap={i>0} />
            ))}
            {inviteeList.length>4&&(
              <div style={{width:26,height:26,borderRadius:"50%",background:"rgba(255,255,255,0.08)",
                border:"2px solid rgba(255,255,255,0.15)",display:"flex",alignItems:"center",
                justifyContent:"center",fontSize:10,color:"rgba(255,255,255,0.5)",
                fontWeight:700,marginLeft:-8,fontFamily:"'DM Sans',sans-serif"}}>
                +{inviteeList.length-4}
              </div>
            )}
          </div>
        )}

        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <StatusBadge status={quest.status} />
          {hasDetails&&(
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",
              width:24,height:24,borderRadius:6,background:"rgba(255,255,255,0.05)",
              transition:"transform 0.3s cubic-bezier(0.34,1.2,0.64,1)",
              transform:expanded?"rotate(180deg)":"rotate(0deg)"}}>
              <Icon d={Icons.chevron} size={14} stroke="rgba(255,255,255,0.4)" />
            </div>
          )}
          <div style={{display:"flex",gap:5,opacity:hovered||expanded?1:0.3,transition:"opacity 0.2s"}}
            onClick={e=>e.stopPropagation()}>
            <ActionBtn onClick={()=>onEdit(quest)} title="Edit"><Icon d={Icons.edit} size={13}/></ActionBtn>
            <ActionBtn onClick={()=>onDelete(quest.id)} title="Delete" danger><Icon d={Icons.trash} size={13}/></ActionBtn>
          </div>
        </div>
      </div>

      {/* ── Expanded ── */}
      <div style={{maxHeight:expanded?800:0,overflow:"hidden",transition:"max-height 0.45s cubic-bezier(0.4,0,0.2,1)"}}>
        <div style={{padding:"0 18px 20px",display:"flex",flexDirection:"column",gap:16,
          borderTop:`1px solid ${palette.color}20`}}>
          {quest.emoji && (
            <div style={{marginTop:14,display:"flex",alignItems:"center",gap:12,
              padding:"12px 14px",borderRadius:12,
              background:`${palette.color}08`,border:`1px solid ${palette.color}18`}}>
              <span style={{fontSize:32}}>{quest.emoji}</span>
              <span style={{fontSize:12,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif",fontStyle:"italic"}}>
                Quest emblem
              </span>
            </div>
          )}
          {quest.description&&(
            <p style={{margin:"14px 0 0",fontSize:13.5,color:"rgba(255,255,255,0.5)",
              lineHeight:1.75,fontFamily:"'DM Sans',sans-serif"}}>{quest.description}</p>
          )}
          {quest.location?.name&&expanded&&(
            <div style={{animation:"cardIn 0.4s ease 0.08s both"}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
                <Icon d={Icons.map} size={13} stroke="rgba(255,255,255,0.3)" />
                <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",
                  textTransform:"uppercase",color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif"}}>Location</span>
              </div>
              <MapView location={quest.location} height={200} />
            </div>
          )}
          {(inviteeList.length>0||questMembers.length>0)&&(
            <PartySection names={quest.invitees} members={questMembers} questColor={palette.color} />
          )}
          {quest.created_at&&(
            <p style={{margin:0,fontSize:10.5,color:"rgba(255,255,255,0.18)",
              fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.04em"}}>
              Created {new Date(quest.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── QUEST MODAL ──────────────────────────────────────────────────────────────
function QuestModal({ quest, onSave, onClose }) {
  const [form, setForm] = useState({...EMPTY_QUEST,...quest});
  const [visible, setVisible] = useState(false);
  const [saving, setSaving]   = useState(false);
  const titleRef = useRef(null);
  useEffect(()=>{requestAnimationFrame(()=>setVisible(true));setTimeout(()=>titleRef.current?.focus(),100);},[]);
  const close=()=>{setVisible(false);setTimeout(onClose,250);};
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const handleSave=async()=>{
    if(!form.title.trim()) return;
    setSaving(true);
    await onSave({...form,id:form.id||crypto.randomUUID(),created_at:form.created_at||new Date().toISOString()});
    setSaving(false);
  };
  const inp={width:"100%",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",
    borderRadius:12,padding:"12px 14px",color:"#F0F0F0",fontSize:14,outline:"none",
    fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",transition:"border-color 0.2s"};
  const lbl={fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
    color:"rgba(255,255,255,0.3)",marginBottom:7,display:"block",fontFamily:"'DM Sans',sans-serif"};
  return (
    <div style={{position:"fixed",inset:0,background:`rgba(0,0,0,${visible?0.72:0})`,
      backdropFilter:`blur(${visible?18:0}px)`,display:"flex",alignItems:"flex-end",
      justifyContent:"center",zIndex:1000,transition:"background 0.25s,backdrop-filter 0.25s"}}
      onClick={e=>e.target===e.currentTarget&&close()}>
      <div style={{background:"linear-gradient(160deg,#111114 0%,#0C0C0F 100%)",
        borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,0.09)",borderBottom:"none",
        width:"100%",maxWidth:560,padding:"12px 24px 52px",
        display:"flex",flexDirection:"column",gap:20,
        transform:visible?"translateY(0)":"translateY(100%)",
        transition:"transform 0.3s cubic-bezier(0.34,1.1,0.64,1)",maxHeight:"92vh",overflowY:"auto"}}>
        <div style={{width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.1)",margin:"8px auto 0"}} />
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h2 style={{margin:0,fontSize:20,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",color:"#F2F2F2"}}>
            {quest?.id?"Edit Quest":"New Quest"}
          </h2>
          <button onClick={close} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",
            borderRadius:10,padding:"7px 8px",cursor:"pointer",color:"rgba(255,255,255,0.4)"}}>
            <Icon d={Icons.x} size={16} />
          </button>
        </div>
        <div><label style={lbl}>Title *</label>
          <input ref={titleRef} value={form.title} onChange={e=>set("title",e.target.value)}
            placeholder="Name your quest…" style={inp}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"} /></div>
        <div><label style={lbl}>Description</label>
          <textarea value={form.description} onChange={e=>set("description",e.target.value)}
            placeholder="What does this quest involve?" rows={3}
            style={{...inp,resize:"vertical",lineHeight:1.65}}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"} /></div>
        <div><label style={lbl}>Status</label>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {STATUSES.map(s=>{
              const active=form.status===s; const {color,glow}=STATUS_META[s];
              return <button key={s} onClick={()=>set("status",s)} style={{
                padding:"8px 16px",borderRadius:20,fontSize:12,fontWeight:600,
                letterSpacing:"0.04em",fontFamily:"'DM Sans',sans-serif",cursor:"pointer",
                border:`1px solid ${active?color:"rgba(255,255,255,0.09)"}`,
                background:active?`${color}18`:"transparent",
                color:active?color:"rgba(255,255,255,0.35)",
                boxShadow:active?`0 0 16px ${glow}`:"none",
                transform:active?"scale(1.04)":"scale(1)",
                transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)"}}>{s}</button>;
            })}
          </div>
        </div>
        <div><label style={lbl}>Quest Emoji</label>
          <EmojiPicker value={form.emoji} onChange={v=>set("emoji",v)} />
        </div>
        <div><label style={lbl}>Location</label>
          <LocationSearch value={form.location} onChange={loc=>set("location",loc)} />
          {form.location?.name&&<div style={{marginTop:12}}><MapView location={form.location} height={180} /></div>}
        </div>
        <div><label style={lbl}>Invite People</label>
          <input value={form.invitees} onChange={e=>set("invitees",e.target.value)}
            placeholder="Alice, Bob, Charlie (comma separated)" style={inp}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"} /></div>
        <button onClick={handleSave} disabled={!form.title.trim()||saving} style={{
          background:form.title.trim()?"linear-gradient(135deg,#e8e8e8,#ffffff)":"rgba(255,255,255,0.08)",
          color:form.title.trim()?"#0A0A0C":"rgba(255,255,255,0.2)",border:"none",borderRadius:14,
          padding:"15px",fontSize:15,fontWeight:700,cursor:form.title.trim()?"pointer":"not-allowed",
          fontFamily:"'DM Sans',sans-serif",transition:"all 0.25s cubic-bezier(0.34,1.2,0.64,1)"}}>
          {saving?"Saving…":quest?.id?"Save Changes":"Add Quest"}
        </button>
      </div>
    </div>
  );
}

// ─── STATS BAR ────────────────────────────────────────────────────────────────
function StatsBar({ quests }) {
  const active=quests.filter(q=>q.status==="Active").length;
  const done=quests.filter(q=>q.status==="Completed").length;
  const total=quests.length; const pct=total>0?Math.round((done/total)*100):0;
  if(total===0) return null;
  return (
    <div style={{marginBottom:16,padding:"14px 18px",borderRadius:16,
      background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.06)",
      display:"flex",gap:20,alignItems:"center",
      animation:"cardIn 0.5s cubic-bezier(0.34,1.2,0.64,1) 0.1s both"}}>
      <div style={{flex:1}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
          <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.06em"}}>PROGRESS</span>
          <span style={{fontSize:10,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>{pct}%</span>
        </div>
        <div style={{height:3,background:"rgba(255,255,255,0.06)",borderRadius:2}}>
          <div style={{height:"100%",borderRadius:2,width:`${pct}%`,
            background:"linear-gradient(90deg,#78C1FF,#A8FF78)",
            transition:"width 0.8s cubic-bezier(0.34,1.2,0.64,1)",
            boxShadow:"0 0 8px rgba(168,255,120,0.4)"}} />
        </div>
      </div>
      {[{l:"Active",v:active,c:"#A8FF78"},{l:"Done",v:done,c:"#78C1FF"}].map(({l,v,c})=>(
        <div key={l} style={{textAlign:"center"}}>
          <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:"'Cormorant Garamond',serif",lineHeight:1}}>{v}</div>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:"0.08em",marginTop:3,fontFamily:"'DM Sans',sans-serif"}}>{l.toUpperCase()}</div>
        </div>
      ))}
    </div>
  );
}

// ─── DELETE CONFIRM ───────────────────────────────────────────────────────────
function DeleteConfirm({ onConfirm, onCancel, label="quest" }) {
  const [visible,setVisible]=useState(false);
  useEffect(()=>{requestAnimationFrame(()=>setVisible(true));},[]);
  const close=(cb)=>{setVisible(false);setTimeout(cb,200);};
  return (
    <div style={{position:"fixed",inset:0,background:`rgba(0,0,0,${visible?0.7:0})`,
      backdropFilter:`blur(${visible?12:0}px)`,display:"flex",alignItems:"center",
      justifyContent:"center",zIndex:3000,padding:24,transition:"all 0.2s"}}
      onClick={e=>e.target===e.currentTarget&&close(onCancel)}>
      <div style={{background:"linear-gradient(160deg,#111114,#0C0C0F)",
        border:"1px solid rgba(255,255,255,0.09)",borderRadius:22,padding:"28px 24px",
        maxWidth:320,width:"100%",
        transform:visible?"scale(1) translateY(0)":"scale(0.94) translateY(8px)",
        transition:"transform 0.25s cubic-bezier(0.34,1.2,0.64,1)"}}>
        <div style={{fontSize:36,marginBottom:12,textAlign:"center"}}>⚠️</div>
        <h3 style={{margin:"0 0 8px",fontSize:18,textAlign:"center",fontFamily:"'Cormorant Garamond',serif",color:"#F2F2F2"}}>Remove this {label}?</h3>
        <p style={{margin:"0 0 24px",fontSize:13.5,textAlign:"center",color:"rgba(255,255,255,0.3)",lineHeight:1.6,fontFamily:"'DM Sans',sans-serif"}}>This can't be undone.</p>
        <div style={{display:"flex",gap:10}}>
          <button onClick={()=>close(onCancel)} style={{flex:1,padding:"13px",borderRadius:12,
            background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",
            color:"rgba(255,255,255,0.5)",cursor:"pointer",fontSize:14,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>Keep It</button>
          <button onClick={()=>close(onConfirm)} style={{flex:1,padding:"13px",borderRadius:12,
            background:"rgba(255,80,80,0.1)",border:"1px solid rgba(255,80,80,0.25)",
            color:"#FF7878",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// ─── PARTY PAGE ───────────────────────────────────────────────────────────────
function PartyPage({ members, onAdd, onEdit, onDelete }) {
  return (
    <div style={{maxWidth:560,margin:"0 auto",padding:"24px 24px 0"}}>
      <div style={{marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",
            color:"rgba(255,255,255,0.2)",marginBottom:4}}>Your Crew</p>
          <h2 style={{fontSize:24,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",
            background:"linear-gradient(135deg,#F2F2F2,rgba(242,242,242,0.5))",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Party Members</h2>
        </div>
        <button onClick={onAdd} style={{display:"flex",alignItems:"center",gap:7,
          padding:"10px 16px",borderRadius:14,border:"1px solid rgba(255,255,255,0.1)",
          background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.7)",
          cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif",
          transition:"all 0.15s"}}
          onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.09)";e.currentTarget.style.borderColor="rgba(255,255,255,0.18)";}}
          onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.05)";e.currentTarget.style.borderColor="rgba(255,255,255,0.1)";}}>
          <Icon d={Icons.plus} size={14} /> Add Member
        </button>
      </div>

      {members.length===0 ? (
        <div style={{textAlign:"center",padding:"60px 0",animation:"cardIn 0.5s ease both"}}>
          <div style={{fontSize:48,marginBottom:16,opacity:0.15}}>🧙</div>
          <p style={{fontSize:15,color:"rgba(255,255,255,0.18)",lineHeight:1.7}}>
            No party members yet.<br/>Add your companions.
          </p>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {members.map((m,i)=>(
            <div key={m.id} style={{animation:`cardIn 0.4s ease ${i*0.06}s both`}}>
              <MemberCard member={m} onEdit={onEdit} onDelete={onDelete} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [quests,setQuests]     = useState([]);
  const [members,setMembers]   = useState([]);
  const [filter,setFilter]     = useState("All");
  const [tab,setTab]           = useState("quests"); // "quests" | "party"
  const [questModal,setQuestModal] = useState(null);
  const [memberModal,setMemberModal] = useState(null);
  const [deleteTarget,setDeleteTarget] = useState(null); // {id, type}
  const [mounted,setMounted]   = useState(false);
  const [syncing,setSyncing]   = useState(false);

  useEffect(()=>{
    setTimeout(()=>setMounted(true),50);
    if(USE_CLOUD){
      setSyncing(true);
      Promise.all([sb.getAll("quests"),sb.getAll("members")]).then(([q,m])=>{
        setQuests(q||[]); setMembers(m||[]); setSyncing(false);
      }).catch(()=>{
        setQuests(local.load("sidequests")); setMembers(local.load("members")); setSyncing(false);
      });
    } else {
      setQuests(local.load("sidequests")); setMembers(local.load("members"));
    }
  },[]);

  const saveQuest = async(q) => {
    const next=quests.find(x=>x.id===q.id)?quests.map(x=>x.id===q.id?q:x):[q,...quests];
    setQuests(next); setQuestModal(null);
    if(USE_CLOUD){try{await sb.upsert("quests",q);}catch{}} else local.save("sidequests",next);
  };
  const deleteQuest = async() => {
    const next=quests.filter(q=>q.id!==deleteTarget.id);
    setQuests(next); setDeleteTarget(null);
    if(USE_CLOUD){try{await sb.delete("quests",deleteTarget.id);}catch{}} else local.save("sidequests",next);
  };
  const saveMember = async(m) => {
    const next=members.find(x=>x.id===m.id)?members.map(x=>x.id===m.id?m:x):[m,...members];
    setMembers(next); setMemberModal(null);
    if(USE_CLOUD){try{await sb.upsert("members",m);}catch{}} else local.save("members",next);
  };
  const deleteMember = async() => {
    const next=members.filter(m=>m.id!==deleteTarget.id);
    setMembers(next); setDeleteTarget(null);
    if(USE_CLOUD){try{await sb.delete("members",deleteTarget.id);}catch{}} else local.save("members",next);
  };

  const filtered=filter==="All"?quests:quests.filter(q=>q.status===filter);
  const counts=STATUSES.reduce((acc,s)=>({...acc,[s]:quests.filter(q=>q.status===s).length}),{});

  return (
    <div style={{minHeight:"100vh",background:"#08080A",color:"#F0F0F0",
      fontFamily:"'DM Sans',sans-serif",paddingBottom:100,
      opacity:mounted?1:0,transition:"opacity 0.4s ease",position:"relative"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::placeholder{color:rgba(255,255,255,0.18)!important;}
        ::-webkit-scrollbar{width:0;}
        body{background:#08080A;}
        @keyframes pulseDot{0%,100%{opacity:1;transform:scale(1);}50%{opacity:0.5;transform:scale(1.3);}}
        @keyframes cardIn{from{opacity:0;transform:translateY(18px) scale(0.97);}to{opacity:1;transform:translateY(0) scale(1);}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes orb1{0%,100%{transform:translate(0,0);}50%{transform:translate(40px,-30px);}}
        @keyframes orb2{0%,100%{transform:translate(0,0);}50%{transform:translate(-30px,40px);}}
        @keyframes fabPulse{0%,100%{box-shadow:0 8px 32px rgba(0,0,0,0.5),0 0 0 0 rgba(240,240,240,0.08);}50%{box-shadow:0 8px 32px rgba(0,0,0,0.5),0 0 0 10px rgba(240,240,240,0);}}
      `}</style>

      {/* Orbs */}
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,overflow:"hidden"}}>
        <div style={{position:"absolute",width:500,height:500,borderRadius:"50%",
          background:"radial-gradient(circle,rgba(168,255,120,0.05) 0%,transparent 70%)",
          top:-100,left:-100,animation:"orb1 12s ease-in-out infinite"}} />
        <div style={{position:"absolute",width:600,height:600,borderRadius:"50%",
          background:"radial-gradient(circle,rgba(192,132,252,0.04) 0%,transparent 70%)",
          bottom:-200,right:-100,animation:"orb2 16s ease-in-out infinite"}} />
      </div>

      {/* Header */}
      <header style={{position:"sticky",top:0,zIndex:10,background:"rgba(8,8,10,0.85)",
        backdropFilter:"blur(24px)",borderBottom:"1px solid rgba(255,255,255,0.05)",
        padding:"44px 24px 0"}}>
        <div style={{maxWidth:560,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
            <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.16em",textTransform:"uppercase",color:"rgba(255,255,255,0.2)"}}>Your Life</p>
            {USE_CLOUD?(
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,
                color:syncing?"rgba(255,212,120,0.7)":"rgba(168,255,120,0.6)",fontFamily:"'DM Sans',sans-serif"}}>
                <Icon d={Icons.cloud} size={11} stroke="currentColor" />
                {syncing?"Syncing…":"Synced"}
              </div>
            ):(
              <div style={{fontSize:10,color:"rgba(255,120,120,0.5)",fontFamily:"'DM Sans',sans-serif"}}>⚠ Local only</div>
            )}
          </div>
          <h1 style={{fontSize:30,fontWeight:700,letterSpacing:"-0.03em",marginBottom:18,
            fontFamily:"'Cormorant Garamond',serif",
            background:"linear-gradient(135deg,#F2F2F2 0%,rgba(242,242,242,0.5) 100%)",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Side Quests</h1>

          {/* Tab bar */}
          <div style={{display:"flex",gap:0,borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
            {[
              {id:"quests",label:"Quests",icon:Icons.shield,count:quests.length},
              {id:"party", label:"Party", icon:Icons.users, count:members.length},
            ].map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                display:"flex",alignItems:"center",gap:7,
                padding:"10px 16px 12px",borderBottom:`2px solid ${tab===t.id?"rgba(255,255,255,0.7)":"transparent"}`,
                background:"none",border:"none",borderBottom:`2px solid ${tab===t.id?"rgba(255,255,255,0.6)":"transparent"}`,
                color:tab===t.id?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.3)",
                cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif",
                transition:"all 0.2s",marginBottom:-1,
              }}>
                <Icon d={t.icon} size={14} stroke="currentColor" />
                {t.label}
                {t.count>0&&<span style={{fontSize:10,opacity:0.5,marginLeft:2}}>{t.count}</span>}
              </button>
            ))}
          </div>

          {/* Filter pills — quests tab only */}
          {tab==="quests"&&(
            <div style={{display:"flex",gap:7,overflowX:"auto",paddingBottom:2,paddingTop:14}}>
              {["All",...STATUSES].map((s)=>{
                const active=filter===s;
                const count=s==="All"?quests.length:counts[s];
                const color=s==="All"?"#F0F0F0":STATUS_META[s]?.color;
                const glow=s!=="All"?STATUS_META[s]?.glow:null;
                return <button key={s} onClick={()=>setFilter(s)} style={{
                  flexShrink:0,padding:"5px 13px",borderRadius:20,fontSize:11.5,fontWeight:600,
                  cursor:"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",
                  border:`1px solid ${active?color:"rgba(255,255,255,0.09)"}`,
                  background:active?`${color}15`:"transparent",
                  color:active?color:"rgba(255,255,255,0.3)",
                  boxShadow:active&&glow?`0 0 14px ${glow}`:"none",
                  transform:active?"scale(1.04)":"scale(1)",
                  transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)",marginBottom:14,
                }}>{s}{count>0&&<span style={{opacity:0.5,marginLeft:5,fontSize:10}}>{count}</span>}</button>;
              })}
            </div>
          )}
          {tab==="party"&&<div style={{height:14}}/>}
        </div>
      </header>

      {/* Content */}
      <main style={{position:"relative",zIndex:1}}>
        {tab==="quests"&&(
          <div style={{maxWidth:560,margin:"20px auto 0",padding:"0 24px"}}>
            <StatsBar quests={quests} />
            {syncing?(
              <div style={{textAlign:"center",padding:"60px 0"}}>
                <div style={{width:24,height:24,border:"2px solid rgba(255,255,255,0.1)",
                  borderTopColor:"rgba(255,255,255,0.5)",borderRadius:"50%",
                  animation:"spin 0.8s linear infinite",margin:"0 auto 12px"}} />
                <p style={{fontSize:14,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>Loading…</p>
              </div>
            ):filtered.length===0?(
              <div style={{textAlign:"center",padding:"80px 0",animation:"cardIn 0.5s ease both"}}>
                <div style={{fontSize:48,marginBottom:16,opacity:0.12}}>⚔️</div>
                <p style={{fontSize:15,color:"rgba(255,255,255,0.18)",lineHeight:1.7}}>
                  {filter==="All"?"No quests yet.\nBegin your journey.":`No ${filter} quests.`}
                </p>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {filtered.map((q,i)=>(
                  <QuestCard key={q.id} quest={q} members={members} index={i}
                    onEdit={q=>setQuestModal(q)} onDelete={id=>setDeleteTarget({id,type:"quest"})} />
                ))}
              </div>
            )}
            {!USE_CLOUD&&(
              <div style={{marginTop:24,padding:"14px 16px",borderRadius:14,
                background:"rgba(255,120,120,0.06)",border:"1px solid rgba(255,120,120,0.15)",
                fontSize:12,color:"rgba(255,180,180,0.7)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.6}}>
                ⚠️ <strong>Local only.</strong> Add Supabase credentials to sync across devices.
              </div>
            )}
          </div>
        )}

        {tab==="party"&&(
          <PartyPage members={members}
            onAdd={()=>setMemberModal({...EMPTY_MEMBER})}
            onEdit={m=>setMemberModal(m)}
            onDelete={id=>setDeleteTarget({id,type:"member"})} />
        )}
      </main>

      {/* FAB */}
      <button onClick={()=>tab==="quests"?setQuestModal({...EMPTY_QUEST}):setMemberModal({...EMPTY_MEMBER})}
        style={{position:"fixed",bottom:36,left:"50%",transform:"translateX(-50%)",
          background:"linear-gradient(135deg,#e8e8e8,#ffffff)",
          color:"#0A0A0C",border:"none",borderRadius:28,
          padding:"14px 28px",display:"flex",alignItems:"center",gap:9,
          fontSize:14,fontWeight:700,cursor:"pointer",
          fontFamily:"'DM Sans',sans-serif",letterSpacing:"-0.01em",
          animation:"fabPulse 3s ease-in-out infinite",
          transition:"transform 0.2s cubic-bezier(0.34,1.56,0.64,1)",zIndex:100}}
        onMouseEnter={e=>{e.currentTarget.style.transform="translateX(-50%) scale(1.06)";e.currentTarget.style.animation="none";}}
        onMouseLeave={e=>{e.currentTarget.style.transform="translateX(-50%) scale(1)";e.currentTarget.style.animation="fabPulse 3s ease-in-out infinite";}}>
        <Icon d={Icons.plus} size={16} stroke="#0A0A0C" />
        {tab==="quests"?"New Quest":"Add Member"}
      </button>

      {questModal&&<QuestModal quest={questModal} onSave={saveQuest} onClose={()=>setQuestModal(null)} />}
      {memberModal&&<MemberModal member={memberModal} onSave={saveMember} onClose={()=>setMemberModal(null)} />}
      {deleteTarget&&(
        <DeleteConfirm
          label={deleteTarget.type}
          onConfirm={deleteTarget.type==="quest"?deleteQuest:deleteMember}
          onCancel={()=>setDeleteTarget(null)} />
      )}
    </div>
  );
}