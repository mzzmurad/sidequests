import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://fbldconclzuckyotxvsk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibGRjb25jbHp1Y2t5b3R4dnNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MDUwMDcsImV4cCI6MjA5NjQ4MTAwN30.dFPSoQLShrnrhGdAt4K3TPZWLigtUAe4ZaI7XygCMO0";

// ─── SUPABASE AUTH + API ───────────────────────────────────────────────────────
const sb = {
  // Auth headers — updated dynamically after login
  _token: null,
  get h() {
    return {
      "Content-Type":"application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${this._token || SUPABASE_KEY}`,
    };
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  async signUp(email, password, displayName="") {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method:"POST",
      headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY},
      body:JSON.stringify({
        email, password,
        data: { display_name: displayName }
      }),
    });
    const d = await r.json();
    if(d.error) {
      const msg = d.error.message||d.msg||"";
      if(msg.toLowerCase().includes("already registered") || msg.toLowerCase().includes("already exists"))
        throw new Error("This email already has an account. Click Sign In instead.");
      if(msg.toLowerCase().includes("password"))
        throw new Error("Password must be at least 6 characters.");
      throw new Error(msg||"Sign up failed. Please try again.");
    }
    if(d.access_token) this._token = d.access_token;
    return d;
  },

  async signIn(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method:"POST",
      headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY},
      body:JSON.stringify({email,password}),
    });
    const d = await r.json();
    if(d.error) {
      // Give friendly error messages
      const msg = d.error.message||d.msg||"";
      if(msg.toLowerCase().includes("invalid login") || msg.toLowerCase().includes("invalid credentials"))
        throw new Error("Wrong email or password. If you don't have an account, click Sign Up.");
      if(msg.toLowerCase().includes("email not confirmed"))
        throw new Error("Please confirm your email first — check your inbox.");
      throw new Error(msg||"Sign in failed. Please try again.");
    }
    if(!d.access_token) throw new Error("Sign in failed. Please try again.");
    this._token = d.access_token;
    localStorage.setItem("sq_token", d.access_token);
    localStorage.setItem("sq_refresh", d.refresh_token);
    if(d.user?.user_metadata?.display_name) {
      localStorage.setItem("sq_name", d.user.user_metadata.display_name);
    }
    return d;
  },

  async signOut() {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method:"POST", headers:this.h,
    }).catch(()=>{});
    this._token = null;
    localStorage.removeItem("sq_token");
    localStorage.removeItem("sq_refresh");
  },

  async refreshSession() {
    const refresh_token = localStorage.getItem("sq_refresh");
    if(!refresh_token) return null;
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method:"POST",
      headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY},
      body:JSON.stringify({refresh_token}),
    });
    const d = await r.json();
    if(d.access_token) {
      this._token = d.access_token;
      localStorage.setItem("sq_token", d.access_token);
      localStorage.setItem("sq_refresh", d.refresh_token);
      return d;
    }
    return null;
  },

  getUser() {
    const token = this._token || localStorage.getItem("sq_token");
    if(!token) return null;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if(payload.exp * 1000 < Date.now()) return null;
      this._token = token;
      const name = payload.user_metadata?.display_name
        || payload.raw_user_meta_data?.display_name
        || null;
      return { id: payload.sub, email: payload.email, name };
    } catch { return null; }
  },

  // ── Friends ───────────────────────────────────────────────────────────────
  async sendFriendRequest(fromId, toEmail) {
    // Use RPC function to find user by email (searches auth.users safely)
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/find_user_by_email`, {
      method:"POST",
      headers:{...this.h,"Content-Type":"application/json"},
      body:JSON.stringify({search_email: toEmail.toLowerCase().trim()})
    });
    const result = await r.json();
    const target = Array.isArray(result) ? result[0] : result;
    if(!target?.user_id) throw new Error("No account found with that email. Make sure they have signed up first.");
    if(target.user_id === fromId) throw new Error("You can't add yourself!");
    // Check existing friendship
    const check = await fetch(`${SUPABASE_URL}/rest/v1/friendships?or=(and(from_id.eq.${fromId},to_id.eq.${target.user_id}),and(from_id.eq.${target.user_id},to_id.eq.${fromId}))`, {headers:this.h});
    const existing = await check.json();
    if(Array.isArray(existing) && existing.length > 0) throw new Error("Already friends or request already sent!");
    // Send the request
    await fetch(`${SUPABASE_URL}/rest/v1/friendships`, {
      method:"POST", headers:{...this.h,"Prefer":"return=minimal"},
      body:JSON.stringify({id:crypto.randomUUID(),from_id:fromId,to_id:target.user_id,status:"pending",created_at:new Date().toISOString()})
    });
    return target;
  },
  async removeFriend(userId, friendUserId) {
    // Delete the friendship row regardless of who sent it
    await fetch(`${SUPABASE_URL}/rest/v1/friendships?or=(and(from_id.eq.${userId},to_id.eq.${friendUserId}),and(from_id.eq.${friendUserId},to_id.eq.${userId}))`, {
      method:"DELETE", headers:this.h
    });
  },
  async getFriendships(userId) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/friendships?or=(from_id.eq.${userId},to_id.eq.${userId})`, {headers:this.h});
    const d = await r.json(); return Array.isArray(d)?d:[];
  },
  async respondFriendRequest(id, accept) {
    const status = accept ? "accepted" : "declined";
    const r = await fetch(`${SUPABASE_URL}/rest/v1/friendships?id=eq.${id}`, {
      method:"PATCH",
      headers:{...this.h,"Prefer":"return=minimal","Content-Type":"application/json"},
      body:JSON.stringify({status})
    });
    if(!r.ok) {
      const err = await r.text();
      console.error("respond error:", r.status, err);
      throw new Error("Could not update request: " + r.status);
    }
  },
  async getFriendProfiles(userId) {
    // Get ALL friendships first (don't bail early!)
    const ships = await this.getFriendships(userId);

    // Split by status
    const accepted = ships.filter(s=>s.status==="accepted");
    const pending  = ships.filter(s=>s.status==="pending" && s.from_id===userId);
    const incoming = ships.filter(s=>s.status==="pending" && s.to_id===userId);

    // Load accepted friend profiles via RPC (reliable even if no member record yet)
    let friends = [];
    if(accepted.length>0) {
      const friendIds = accepted.map(s=>s.from_id===userId?s.to_id:s.from_id);
      friends = (await Promise.all(friendIds.map(async fid=>{
        try {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/find_user_by_id`,{
            method:"POST",headers:{...this.h,"Content-Type":"application/json"},
            body:JSON.stringify({search_id:fid})
          });
          const d = await r.json();
          const p = Array.isArray(d)?d[0]:d;
          return p||null;
        } catch { return null; }
      }))).filter(Boolean);
    }

    // Load incoming requester profiles via RPC (to get their name+email from auth)
    let incomingProfiles = [];
    if(incoming.length>0) {
      incomingProfiles = await Promise.all(incoming.map(async s=>{
        try {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/find_user_by_id`, {
            method:"POST",
            headers:{...this.h,"Content-Type":"application/json"},
            body:JSON.stringify({search_id: s.from_id})
          });
          const profile = await r.json();
          const p = Array.isArray(profile)?profile[0]:profile;
          return {...s, profile: p||{name:"Unknown",email:""}};
        } catch {
          return {...s, profile:{name:"Unknown",email:""}};
        }
      }));
    }

    return {friends, pending, incoming:incomingProfiles};
  },

  // ── Memories ─────────────────────────────────────────────────────────────
  async getMemories(userId) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/memories?user_id=eq.${userId}&order=date.desc,created_at.desc`, {headers:this.h});
    const d = await r.json(); return Array.isArray(d)?d:[];
  },
  async upsertMemory(memory) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/memories`, {
      method:"POST", headers:{...this.h,"Prefer":"resolution=merge-duplicates"},
      body:JSON.stringify(memory)
    }); if(!r.ok) throw new Error();
  },
  async deleteMemory(id) {
    await fetch(`${SUPABASE_URL}/rest/v1/memories?id=eq.${id}`, {method:"DELETE", headers:this.h});
  },

  // ── Boards ────────────────────────────────────────────────────────────────
  async getMyBoards(userId) {
    // Get boards where user is creator or member
    const [created, memberships] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/boards?created_by=eq.${userId}&order=created_at.desc`, {headers:this.h}).then(r=>r.json()),
      fetch(`${SUPABASE_URL}/rest/v1/board_members?user_id=eq.${userId}&select=board_id`, {headers:this.h}).then(r=>r.json()),
    ]);
    const memberBoardIds = (Array.isArray(memberships)?memberships:[]).map(m=>m.board_id).filter(Boolean);
    if(memberBoardIds.length === 0) return Array.isArray(created)?created:[];
    const memberBoards = await fetch(
      `${SUPABASE_URL}/rest/v1/boards?id=in.(${memberBoardIds.join(",")})&order=created_at.desc`,
      {headers:this.h}
    ).then(r=>r.json());
    const all = [...(Array.isArray(created)?created:[]), ...(Array.isArray(memberBoards)?memberBoards:[])];
    return [...new Map(all.map(b=>[b.id,b])).values()];
  },
  async getBoardByInvite(code) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/boards?invite_code=eq.${code}`, {headers:this.h});
    const d = await r.json(); return Array.isArray(d)?d[0]:null;
  },
  async createBoard(board) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/boards`, {
      method:"POST", headers:{...this.h,"Prefer":"return=representation"}, body:JSON.stringify(board)
    }); const d=await r.json(); return Array.isArray(d)?d[0]:d;
  },
  async joinBoard(boardId, userId) {
    await fetch(`${SUPABASE_URL}/rest/v1/board_members`, {
      method:"POST", headers:{...this.h,"Prefer":"resolution=ignore-duplicates"},
      body:JSON.stringify({id:crypto.randomUUID(),board_id:boardId,user_id:userId})
    });
  },
  async getBoardQuests(boardId) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/quests?board_id=eq.${boardId}&order=created_at.desc`, {headers:this.h});
    const d = await r.json(); return Array.isArray(d)?d:[];
  },
  async getBoardMembers(boardId) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/board_members?board_id=eq.${boardId}&select=user_id,joined_at`, {headers:this.h});
    const d = await r.json(); return Array.isArray(d)?d:[];
  },
  async getBoardMemberProfiles(boardId) {
    const members = await this.getBoardMembers(boardId);
    if(!members.length) return [];
    const profiles = await Promise.all(members.map(async m=>{
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/find_user_by_id`,{
          method:"POST",headers:{...this.h,"Content-Type":"application/json"},
          body:JSON.stringify({search_id:m.user_id})
        });
        const d = await r.json();
        const p = Array.isArray(d)?d[0]:d;
        return p ? {...p, joined_at:m.joined_at} : null;
      } catch { return null; }
    }));
    return profiles.filter(Boolean);
  },

  // ── Data ──────────────────────────────────────────────────────────────────
  async getAll(table, userId="") {
    const filter = userId ? `&user_id=eq.${userId}` : "";
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?order=created_at.desc${filter}`,{headers:this.h});
    if(!r.ok) { console.error("getAll failed", table, r.status); return []; }
    return r.json();
  },
  async upsert(table,obj) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`,{
      method:"POST",headers:{...this.h,"Prefer":"resolution=merge-duplicates"},body:JSON.stringify(obj)
    }); if(!r.ok) throw new Error();
  },
  async delete(table,id) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,{method:"DELETE",headers:this.h});
    if(!r.ok) throw new Error();
  },
};

// ─── PALETTE ──────────────────────────────────────────────────────────────────
const QUEST_PALETTES = [
  {color:"#C084FC",glow:"rgba(192,132,252,0.3)",grad:"linear-gradient(135deg,#C084FC,#818CF8)"},
  {color:"#F472B6",glow:"rgba(244,114,182,0.3)",grad:"linear-gradient(135deg,#F472B6,#FB7185)"},
  {color:"#34D399",glow:"rgba(52,211,153,0.3)", grad:"linear-gradient(135deg,#34D399,#06B6D4)"},
  {color:"#FBBF24",glow:"rgba(251,191,36,0.3)", grad:"linear-gradient(135deg,#FBBF24,#F97316)"},
  {color:"#60A5FA",glow:"rgba(96,165,250,0.3)", grad:"linear-gradient(135deg,#60A5FA,#818CF8)"},
  {color:"#F87171",glow:"rgba(248,113,113,0.3)",grad:"linear-gradient(135deg,#F87171,#FB923C)"},
  {color:"#A3E635",glow:"rgba(163,230,53,0.3)", grad:"linear-gradient(135deg,#A3E635,#34D399)"},
  {color:"#E879F9",glow:"rgba(232,121,249,0.3)",grad:"linear-gradient(135deg,#E879F9,#C084FC)"},
  {color:"#2DD4BF",glow:"rgba(45,212,191,0.3)", grad:"linear-gradient(135deg,#2DD4BF,#60A5FA)"},
  {color:"#FB923C",glow:"rgba(251,146,60,0.3)", grad:"linear-gradient(135deg,#FB923C,#FBBF24)"},
];
const getPalette=(id)=>{
  if(!id) return QUEST_PALETTES[0];
  let h=0; for(let i=0;i<id.length;i++) h=id.charCodeAt(i)+((h<<5)-h);
  return QUEST_PALETTES[Math.abs(h)%QUEST_PALETTES.length];
};

// ─── CHARACTER ENGINE ─────────────────────────────────────────────────────────
const AVATARS=["🧙","🧝","🧛","🧜","🦸","🧚","🔮","💀","🐉","🦅","🌙","⭐","🔥","⚡","🌊","👑","🎯","🎭","🗝","🏆"];
const AVATAR_COLORS=["#C084FC","#F472B6","#34D399","#FBBF24","#60A5FA","#F87171","#A3E635","#E879F9","#2DD4BF","#FB923C"];
const TITLES=["Wizard","Ranger","Rogue","Paladin","Bard","Druid","Warlock","Monk","Fighter","Sorcerer","Cleric","Barbarian"];
const getCharacter=(name)=>{
  let h=0; for(let i=0;i<name.length;i++) h=name.charCodeAt(i)+((h<<5)-h);
  return {avatar:AVATARS[Math.abs(h)%AVATARS.length],color:AVATAR_COLORS[Math.abs(h>>4)%AVATAR_COLORS.length]};
};
const getTitle=(name)=>{
  let h=0; for(let i=0;i<name.length;i++) h=name.charCodeAt(i)+((h<<5)-h);
  return TITLES[Math.abs(h>>2)%TITLES.length];
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STATUSES=["Active","Completed","On Hold","Abandoned"];
const STATUS_META={
  Active:   {color:"#A8FF78",glow:"rgba(168,255,120,0.25)",emoji:"⚔"},
  Completed:{color:"#78C1FF",glow:"rgba(120,193,255,0.25)",emoji:"✦"},
  "On Hold":{color:"#FFD478",glow:"rgba(255,212,120,0.25)",emoji:"⏸"},
  Abandoned:{color:"#FF7878",glow:"rgba(255,120,120,0.25)",emoji:"✗"},
};
const EMPTY_QUEST={id:null,title:"",description:"",status:"Active",invitees:"",created_at:null,location:null,emoji:"",completed_at:null,photo:null,due_date:null,started_at:null};
const EMPTY_MEMBER={id:null,name:"",role:"",note:"",email:"",created_at:null};

// ─── XP + RANK SYSTEM ────────────────────────────────────────────────────────
const RANKS = [
  { name:"Wanderer",   min:0,    max:99,   icon:"🌱", color:"#A0A0A0" },
  { name:"Apprentice", min:100,  max:299,  icon:"⚔",  color:"#78C1FF" },
  { name:"Squire",     min:300,  max:599,  icon:"🛡",  color:"#A8FF78" },
  { name:"Knight",     min:600,  max:999,  icon:"🗡",  color:"#FBBF24" },
  { name:"Champion",   min:1000, max:1999, icon:"👑",  color:"#F472B6" },
  { name:"Legend",     min:2000, max:9999, icon:"🔥",  color:"#E879F9" },
];

const XP_VALUES = {
  Active:    10,  // just creating an active quest
  Completed: 50,  // completing a quest
  Hard:      25,  // bonus for hard quests (future)
};

const getRank = (xp) => RANKS.slice().reverse().find(r => xp >= r.min) || RANKS[0];

const calcXP = (quests) => {
  let xp = 0;
  quests.forEach(q => {
    xp += XP_VALUES.Active; // 10 XP per quest created
    if(q.status === "Completed") xp += XP_VALUES.Completed; // +50 on complete
  });
  return xp;
};

// ─── EMOJI PICKER DATA ────────────────────────────────────────────────────────
const EMOJI_GROUPS={
  "Adventure":["⚔","🏔","🗺","🧭","🏕","🚀","🛸","🌋","🏴‍☠","🗝","🔮","⚡","🌊","🦅","🐉","🌙","☄","🔥","💎","🏆"],
  "Life":     ["❤","🎯","💡","📚","🎨","🎵","🍀","🌱","✨","🦋","🌸","🌈","🎭","🎪","🎲","🧩","🪄","🎁","🏠","👑"],
  "People":   ["🤝","👥","💪","🧠","👁","🙌","✊","🫀","🧬","🤺","🧗","🏄","🧘","🥊","🎤","🎬","🎯","🏇","🤿","🪂"],
  "Places":   ["🌍","🗼","🏯","🏛","🕌","⛩","🌁","🏖","🏜","🌃","🎡","🚂","✈","⛵","🌉","🏟","🗽","🎠","🌄","🏙"],
  "Objects":  ["💰","📱","🔬","🧪","⚙","🔑","📜","🧲","💊","🎸","🎺","🥁","🎻","🔭","🪐","🧸","🪆","🎀","🧧","🪩"],
};

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Icon=({d,size=18,stroke="currentColor",fill="none"})=>(
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
    stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d}/>
  </svg>
);
const Icons={
  plus:    "M12 5v14M5 12h14",
  x:       "M18 6 6 18M6 6l12 12",
  edit:    "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  trash:   "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  user:    "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  users:   "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  chevron: "M6 9l6 6 6-6",
  back:    "M19 12H5M12 19l-7-7 7-7",
  pin:     "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 10a1 1 0 1 1-2 0 1 1 0 0 1 2 0z",
  search:  "M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z",
  map:     "M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7zM9 4v13M15 7v13",
  cloud:   "M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z",
  shield:  "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  check:   "M20 6 9 17l-5-5",
  camera:  "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  cal:     "M3 9h18M8 2v4M16 2v4M3 4h18a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",
  board:   "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  link:    "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  copy:    "M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
};

// ─── SMALL HELPERS ────────────────────────────────────────────────────────────
function ActionBtn({onClick,children,danger,title}){
  const [h,setH]=useState(false);
  return(
    <button onClick={onClick} title={title} style={{
      background:h?(danger?"rgba(255,100,100,0.15)":"rgba(255,255,255,0.09)"):"transparent",
      border:`1px solid ${h?(danger?"rgba(255,100,100,0.4)":"rgba(255,255,255,0.18)"):"rgba(255,255,255,0.08)"}`,
      borderRadius:9,padding:"6px 8px",
      color:h?(danger?"#FF7878":"#fff"):"rgba(255,255,255,0.4)",
      cursor:"pointer",display:"flex",alignItems:"center",
      transition:"all 0.15s",transform:h?"scale(1.08)":"scale(1)",
    }} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}>{children}</button>
  );
}

function StatusBadge({status}){
  const {color}=STATUS_META[status]||STATUS_META["Active"];
  return(
    <span style={{display:"inline-flex",alignItems:"center",gap:7,fontSize:10,fontWeight:700,letterSpacing:"0.1em",color,textTransform:"uppercase"}}>
      <span style={{width:7,height:7,borderRadius:"50%",background:color,flexShrink:0,
        animation:status==="Active"?"pulseDot 2s ease-in-out infinite":"none"}}/>
      {status}
    </span>
  );
}

// ─── MINI AVATAR ─────────────────────────────────────────────────────────────
function MiniAvatar({name,size=32,overlap=false}){
  const {avatar,color}=getCharacter(name);
  return(
    <div title={name} style={{
      width:size,height:size,borderRadius:"50%",flexShrink:0,
      background:`radial-gradient(circle at 35% 35%,${color}40,${color}15)`,
      border:`2px solid ${color}60`,display:"flex",alignItems:"center",justifyContent:"center",
      fontSize:size*0.42,boxShadow:`0 0 10px ${color}30`,
      marginLeft:overlap?-size*0.3:0,position:"relative",zIndex:1,
      transition:"transform 0.2s",cursor:"default",
    }}
      onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.15)";e.currentTarget.style.zIndex="10";}}
      onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.zIndex="1";}}
    >{avatar}</div>
  );
}

// ─── EMOJI PICKER ─────────────────────────────────────────────────────────────
function EmojiPicker({value,onChange}){
  const [open,setOpen]=useState(false);
  const [activeGroup,setActiveGroup]=useState("Adventure");
  const ref=useRef(null);
  useEffect(()=>{
    const h=(e)=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[]);
  return(
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderRadius:12,
        cursor:"pointer",background:open?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.04)",
        border:`1px solid ${open?"rgba(255,255,255,0.18)":"rgba(255,255,255,0.09)"}`,
        transition:"all 0.2s",width:"100%",
      }}>
        <span style={{fontSize:22,lineHeight:1}}>{value||"✨"}</span>
        <span style={{fontSize:13,color:value?"rgba(255,255,255,0.7)":"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>
          {value?"Change emoji":"Pick an emoji"}
        </span>
        {value&&<button onClick={e=>{e.stopPropagation();onChange("");}} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,0.3)",fontSize:13}}>✕</button>}
      </button>
      {open&&(
        <div style={{position:"absolute",top:"calc(100% + 8px)",left:0,right:0,zIndex:9999,
          background:"#0E0E12",border:"1px solid rgba(255,255,255,0.12)",borderRadius:16,overflow:"hidden",
          boxShadow:"0 24px 64px rgba(0,0,0,0.7)",animation:"cardIn 0.2s ease both"}}>
          <div style={{display:"flex",overflowX:"auto",borderBottom:"1px solid rgba(255,255,255,0.07)",padding:"8px 8px 0",gap:4}}>
            {Object.keys(EMOJI_GROUPS).map(g=>(
              <button key={g} onClick={()=>setActiveGroup(g)} style={{
                flexShrink:0,padding:"6px 12px",borderRadius:"8px 8px 0 0",
                background:activeGroup===g?"rgba(255,255,255,0.08)":"transparent",
                border:"none",borderBottom:activeGroup===g?"2px solid rgba(255,255,255,0.5)":"2px solid transparent",
                color:activeGroup===g?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.35)",
                cursor:"pointer",fontSize:11,fontWeight:600,letterSpacing:"0.05em",
                fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",transition:"all 0.15s",
              }}>{g}</button>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(10,1fr)",gap:2,padding:10}}>
            {EMOJI_GROUPS[activeGroup].map((em,i)=>(
              <button key={i} onClick={()=>{onChange(em);setOpen(false);}} style={{
                fontSize:20,padding:"7px",borderRadius:8,border:"none",
                background:value===em?"rgba(255,255,255,0.12)":"transparent",
                cursor:"pointer",transition:"all 0.1s",lineHeight:1,
                boxShadow:value===em?"inset 0 0 0 1px rgba(255,255,255,0.2)":"none",
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

// ─── MAP VIEW ─────────────────────────────────────────────────────────────────
function MapView({location,height=200}){
  if(!location?.name) return null;
  const q=encodeURIComponent(location.name+" Azerbaijan");
  const src=`https://maps.google.com/maps?q=${q}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
  return(
    <div style={{position:"relative",borderRadius:14,overflow:"hidden",border:"1px solid rgba(255,255,255,0.1)",background:"#0d1117"}}>
      <iframe title="map" src={src} width="100%" height={height}
        style={{display:"block",border:"none",filter:"invert(1) hue-rotate(190deg) saturate(0.55) brightness(0.82) contrast(1.05)"}}
        loading="lazy" referrerPolicy="no-referrer-when-downgrade"/>
      <div style={{position:"absolute",bottom:0,left:0,right:0,zIndex:2,
        background:"linear-gradient(to top,rgba(8,8,12,0.97) 0%,transparent 100%)",
        padding:"24px 14px 11px",display:"flex",alignItems:"center",gap:7}}>
        <Icon d={Icons.pin} size={14} stroke="#A8FF78" fill="rgba(168,255,120,0.25)"/>
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
function LocationSearch({value,onChange}){
  const [query,setQuery]=useState(value?.name||"");
  const handleSet=()=>{if(!query.trim())return;onChange({name:query.trim()});};
  const clear=()=>{onChange(null);setQuery("");};
  return(
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <div style={{display:"flex",gap:8}}>
        <div style={{position:"relative",flex:1}}>
          <div style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}>
            <Icon d={Icons.search} size={15} stroke="rgba(255,255,255,0.3)"/>
          </div>
          <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSet()}
            placeholder="e.g. Baku, Nizami Street, Ganja…"
            style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)",
              borderRadius:12,padding:"12px 12px 12px 38px",color:"#F0F0F0",fontSize:13.5,outline:"none",
              fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",transition:"border-color 0.2s"}}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.25)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.12)"}/>
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
          <Icon d={Icons.pin} size={13} stroke="#A8FF78" fill="rgba(168,255,120,0.2)"/>
          <span style={{fontSize:12.5,color:"rgba(255,255,255,0.65)",fontFamily:"'DM Sans',sans-serif",flex:1}}>{value.name}</span>
          <button onClick={clear} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(255,255,255,0.25)",display:"flex",padding:2}}>
            <Icon d={Icons.x} size={12}/>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── PARTY SECTION (inside quest card) ───────────────────────────────────────
function PartySection({names,members}){
  const nameList=names?names.split(",").map(s=>s.trim()).filter(Boolean):[];
  if(nameList.length===0&&members.length===0) return null;
  const detailedNames=members.map(m=>m.name.toLowerCase());
  const simple=nameList.filter(n=>!detailedNames.includes(n.toLowerCase()));
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
        <Icon d={Icons.users} size={13} stroke="rgba(255,255,255,0.3)"/>
        <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
          color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif"}}>Party ({nameList.length||members.length})</span>
      </div>
      {members.length>0&&(
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:simple.length>0?10:0}}>
          {members.map(m=>{
            const {avatar,color}=getCharacter(m.name);
            return(
              <div key={m.id} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",
                borderLeft:`3px solid ${color}40`,borderRadius:14,padding:"12px 14px",
                display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:40,height:40,borderRadius:11,flexShrink:0,
                  background:`radial-gradient(circle at 35% 35%,${color}30,${color}08)`,
                  border:`1.5px solid ${color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{avatar}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:7}}>
                    <span style={{fontSize:14,fontWeight:700,color:"#F0F0F0",fontFamily:"'Cormorant Garamond',serif"}}>{m.name}</span>
                    <span style={{fontSize:9,color:color,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",
                      background:`${color}15`,padding:"1px 6px",borderRadius:4,border:`1px solid ${color}25`}}>
                      {m.role||getTitle(m.name)}
                    </span>
                  </div>
                  {m.note&&<p style={{margin:"2px 0 0",fontSize:12,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Sans',sans-serif",
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>"{m.note}"</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {simple.length>0&&(
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          {simple.map((name,i)=>{
            const {color,avatar}=getCharacter(name);
            return(
              <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 10px 5px 6px",
                borderRadius:20,background:`${color}10`,border:`1px solid ${color}25`}}>
                <span style={{fontSize:14}}>{avatar}</span>
                <span style={{fontSize:12,color:"rgba(255,255,255,0.6)",fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>{name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── STREAK CALENDAR ──────────────────────────────────────────────────────────
function StreakCalendar({quests}){
  const [viewDate,setViewDate]=useState(new Date());
  const year=viewDate.getFullYear();
  const month=viewDate.getMonth();
  const monthName=viewDate.toLocaleDateString("en-US",{month:"long",year:"numeric"});
  const firstDay=new Date(year,month,1).getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const today=new Date();

  // Build sets of dates from quests
  const fireDates=new Set();
  const startDates=new Set();
  quests.forEach(q=>{
    if(q.status==="Completed"&&q.completed_at){
      const d=new Date(q.completed_at);
      fireDates.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    if(q.started_at){
      const d=new Date(q.started_at);
      startDates.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
  });

  const prevMonth=()=>setViewDate(new Date(year,month-1,1));
  const nextMonth=()=>setViewDate(new Date(year,month+1,1));
  const isToday=(d)=>today.getFullYear()===year&&today.getMonth()===month&&today.getDate()===d;
  const hasFire=(d)=>fireDates.has(`${year}-${month}-${d}`);
  const hasStart=(d)=>startDates.has(`${year}-${month}-${d}`);

  const completedThisMonth=quests.filter(q=>{
    if(q.status!=="Completed"||!q.completed_at) return false;
    const d=new Date(q.completed_at);
    return d.getFullYear()===year&&d.getMonth()===month;
  });

  return(
    <div style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.07)",
      borderRadius:20,padding:"20px",marginBottom:16,animation:"cardIn 0.5s ease both"}}>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <Icon d={Icons.cal} size={16} stroke="rgba(255,255,255,0.4)"/>
          <span style={{fontSize:14,fontWeight:700,color:"rgba(255,255,255,0.8)",fontFamily:"'Cormorant Garamond',serif"}}>{monthName}</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {completedThisMonth.length>0&&(
            <span style={{fontSize:11,color:"#FBBF24",fontFamily:"'DM Sans',sans-serif",fontWeight:600,
              background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.2)",
              padding:"3px 10px",borderRadius:20}}>
              🔥 {completedThisMonth.length} this month
            </span>
          )}
          <button onClick={prevMonth} style={{background:"none",border:"none",cursor:"pointer",
            color:"rgba(255,255,255,0.4)",fontSize:18,padding:"0 4px",lineHeight:1}}>‹</button>
          <button onClick={nextMonth} style={{background:"none",border:"none",cursor:"pointer",
            color:"rgba(255,255,255,0.4)",fontSize:18,padding:"0 4px",lineHeight:1}}>›</button>
        </div>
      </div>

      {/* Day labels */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=>(
          <div key={d} style={{textAlign:"center",fontSize:10,color:"rgba(255,255,255,0.2)",
            fontFamily:"'DM Sans',sans-serif",fontWeight:600,letterSpacing:"0.05em"}}>{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
        {Array.from({length:firstDay}).map((_,i)=><div key={`e${i}`}/>)}
        {Array.from({length:daysInMonth}).map((_,i)=>{
          const d=i+1;
          const fire=hasFire(d);
          const start=hasStart(d);
          const tod=isToday(d);
          return(
            <div key={d} style={{
              aspectRatio:"1",display:"flex",alignItems:"center",justifyContent:"center",
              borderRadius:8,position:"relative",
              background:fire?"rgba(251,191,36,0.12)":start?"rgba(168,255,120,0.08)":tod?"rgba(255,255,255,0.06)":"transparent",
              border:fire?"1px solid rgba(251,191,36,0.25)":start?"1px solid rgba(168,255,120,0.2)":tod?"1px solid rgba(255,255,255,0.2)":"1px solid transparent",
              transition:"all 0.15s",
            }}>
              {fire?(
                <span style={{fontSize:16,lineHeight:1,filter:"drop-shadow(0 0 6px rgba(251,191,36,0.8))"}}>🔥</span>
              ):(
                <span style={{fontSize:12,color:tod?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.3)",
                  fontFamily:"'DM Sans',sans-serif",fontWeight:tod?700:400}}>{d}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:4,
        fontSize:10,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif"}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}><span>🔥</span> quest completed</div>
        <div style={{display:"flex",alignItems:"center",gap:6}}><span>⚔</span> quest started</div>
      </div>
    </div>
  );
}

// ─── COMPLETED TAB ────────────────────────────────────────────────────────────
function CompletedTab({quests,onEdit}){
  const done=quests.filter(q=>q.status==="Completed").sort((a,b)=>{
    if(!a.completed_at) return 1;
    if(!b.completed_at) return -1;
    return new Date(b.completed_at)-new Date(a.completed_at);
  });

  if(done.length===0) return(
    <div style={{textAlign:"center",padding:"60px 0",animation:"cardIn 0.5s ease both"}}>
      <div style={{fontSize:48,marginBottom:16,opacity:0.12}}>🏆</div>
      <p style={{fontSize:15,color:"rgba(255,255,255,0.18)",lineHeight:1.7}}>No completed quests yet.<br/>Mark one as Completed to see it here.</p>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {done.map((q,i)=>{
        const palette=getPalette(q.id);
        return(
          <div key={q.id} style={{
            background:"rgba(255,255,255,0.03)",
            border:`1px solid ${palette.color}25`,
            borderLeft:`3px solid ${palette.color}`,
            borderRadius:16,overflow:"hidden",
            animation:`cardIn 0.4s ease ${i*0.06}s both`,
          }}>
            {/* Photo */}
            {q.photo&&(
              <div style={{position:"relative",height:160,overflow:"hidden"}}>
                <img src={q.photo} alt="completion" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(8,8,12,0.8) 0%,transparent 50%)"}}/>
                <div style={{position:"absolute",bottom:10,left:14,fontSize:20}}>{q.emoji||"🏆"}</div>
              </div>
            )}

            <div style={{padding:"14px 16px"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    {!q.photo&&q.emoji&&<span style={{fontSize:18}}>{q.emoji}</span>}
                    <h3 style={{margin:0,fontSize:16,fontWeight:700,color:"#F2F2F2",
                      fontFamily:"'Cormorant Garamond',serif",letterSpacing:"-0.01em"}}>{q.title}</h3>
                  </div>
                  {q.completed_at&&(
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:14}}>🔥</span>
                      <span style={{fontSize:12,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif"}}>
                        Completed {new Date(q.completed_at).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}
                      </span>
                    </div>
                  )}
                  {q.description&&(
                    <p style={{margin:"8px 0 0",fontSize:13,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.6,
                      display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{q.description}</p>
                  )}
                </div>
                <button onClick={()=>onEdit(q)} style={{background:"none",border:"1px solid rgba(255,255,255,0.1)",
                  borderRadius:8,padding:"6px 8px",cursor:"pointer",color:"rgba(255,255,255,0.35)",flexShrink:0}}>
                  <Icon d={Icons.edit} size={13}/>
                </button>
              </div>

              {/* Party avatars */}
              {q.invitees&&(
                <div style={{display:"flex",alignItems:"center",gap:6,marginTop:10}}>
                  {q.invitees.split(",").map(s=>s.trim()).filter(Boolean).slice(0,5).map((name,i)=>(
                    <MiniAvatar key={i} name={name} size={24} overlap={i>0}/>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── MEMBER DETAIL PAGE ───────────────────────────────────────────────────────
function MemberDetailPage({member,quests,onBack,onEdit}){
  const {avatar,color}=getCharacter(member.name);
  const myQuests=quests.filter(q=>
    q.invitees&&q.invitees.split(",").map(s=>s.trim().toLowerCase()).includes(member.name.toLowerCase())
  );
  const completedTogether=myQuests.filter(q=>q.status==="Completed");
  const activeTogether=myQuests.filter(q=>q.status==="Active");

  return(
    <div style={{maxWidth:560,margin:"0 auto",padding:"0 24px 120px",animation:"cardIn 0.4s ease both"}}>
      {/* Back */}
      <button onClick={onBack} style={{display:"flex",alignItems:"center",gap:8,background:"none",border:"none",
        cursor:"pointer",color:"rgba(255,255,255,0.4)",fontSize:13,fontFamily:"'DM Sans',sans-serif",
        padding:"0 0 20px",fontWeight:600}}>
        <Icon d={Icons.back} size={16}/> Back to Party
      </button>

      {/* Hero card */}
      <div style={{background:`radial-gradient(ellipse at top left,${color}15,rgba(255,255,255,0.03))`,
        border:`1px solid ${color}30`,borderRadius:24,padding:"28px 24px",marginBottom:20,
        position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${color}80,transparent)`}}/>
        <div style={{display:"flex",alignItems:"center",gap:18,marginBottom:20}}>
          <div style={{width:72,height:72,borderRadius:20,flexShrink:0,
            background:`radial-gradient(circle at 35% 35%,${color}40,${color}12)`,
            border:`2.5px solid ${color}60`,display:"flex",alignItems:"center",
            justifyContent:"center",fontSize:36,boxShadow:`0 0 32px ${color}30`}}>{avatar}</div>
          <div>
            <h2 style={{margin:"0 0 6px",fontSize:22,fontWeight:700,color:"#F2F2F2",
              fontFamily:"'Cormorant Garamond',serif"}}>{member.name}</h2>
            <span style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
              color:color,background:`${color}15`,border:`1px solid ${color}30`,
              padding:"3px 10px",borderRadius:6}}>{member.role||getTitle(member.name)}</span>
          </div>
        </div>
        {member.note&&<p style={{margin:0,fontSize:13.5,color:"rgba(255,255,255,0.45)",
          fontFamily:"'DM Sans',sans-serif",lineHeight:1.65,fontStyle:"italic"}}>"{member.note}"</p>}

        {/* Stats row */}
        <div style={{display:"flex",gap:12,marginTop:20}}>
          {[
            {label:"Total Quests",value:myQuests.length,color:"#F0F0F0"},
            {label:"Active",value:activeTogether.length,color:"#A8FF78"},
            {label:"Completed",value:completedTogether.length,color:"#78C1FF"},
          ].map(({label,value,color:c})=>(
            <div key={label} style={{flex:1,textAlign:"center",background:"rgba(255,255,255,0.04)",
              borderRadius:12,padding:"12px 8px",border:"1px solid rgba(255,255,255,0.07)"}}>
              <div style={{fontSize:24,fontWeight:700,color:c,fontFamily:"'Cormorant Garamond',serif",lineHeight:1}}>{value}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:"0.08em",marginTop:4,
                fontFamily:"'DM Sans',sans-serif",textTransform:"uppercase"}}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Quest list */}
      {myQuests.length===0?(
        <div style={{textAlign:"center",padding:"40px 0"}}>
          <p style={{fontSize:14,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif"}}>
            {member.name} isn't part of any quests yet.
          </p>
        </div>
      ):(
        <div>
          <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
            color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginBottom:12}}>
            Shared Quests
          </p>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {myQuests.map(q=>{
              const p=getPalette(q.id);
              return(
                <div key={q.id} style={{background:"rgba(255,255,255,0.03)",
                  border:`1px solid ${p.color}20`,borderLeft:`3px solid ${p.color}`,
                  borderRadius:14,padding:"14px 16px",
                  display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:36,height:36,borderRadius:10,flexShrink:0,
                    background:`${p.color}15`,border:`1px solid ${p.color}25`,
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>
                    {q.emoji||"⚔"}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#F0F0F0",
                      fontFamily:"'Cormorant Garamond',serif",lineHeight:1.3,
                      whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{q.title}</div>
                    <div style={{marginTop:3}}><StatusBadge status={q.status}/></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button onClick={()=>onEdit(member)} style={{
        marginTop:24,width:"100%",padding:"14px",borderRadius:14,
        background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",
        color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:14,fontWeight:600,
        fontFamily:"'DM Sans',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        <Icon d={Icons.edit} size={14}/> Edit {member.name}
      </button>
    </div>
  );
}

// ─── QUEST CARD ───────────────────────────────────────────────────────────────
function QuestCard({quest,members,onEdit,onDelete,index}){
  const [expanded,setExpanded]=useState(false);
  const [hovered,setHovered]=useState(false);
  const palette=getPalette(quest.id);
  const {emoji}=STATUS_META[quest.status]||STATUS_META["Active"];
  const inviteeList=quest.invitees?quest.invitees.split(",").map(s=>s.trim()).filter(Boolean):[];
  const questMembers=members.filter(m=>inviteeList.map(n=>n.toLowerCase()).includes(m.name.toLowerCase()));
  const hasDetails=quest.description||inviteeList.length>0||quest.location?.name;
  const isShared=!!quest.board_id;

  return(
    <div onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
      style={{position:"relative",overflow:"hidden",
        background:expanded?"rgba(255,255,255,0.055)":hovered?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.025)",
        borderRadius:20,
        border:`1px solid ${expanded?palette.color+"35":hovered?palette.color+"25":"rgba(255,255,255,0.07)"}`,
        transition:"all 0.3s cubic-bezier(0.34,1.2,0.64,1)",
        transform:hovered&&!expanded?"translateY(-2px)":"translateY(0)",
        boxShadow:expanded?`0 16px 48px rgba(0,0,0,0.45),0 0 0 1px ${palette.color}15,inset 0 0 60px ${palette.color}04`
          :hovered?`0 8px 24px rgba(0,0,0,0.3),0 0 0 1px ${palette.color}10`:"none",
        animation:`cardIn 0.5s cubic-bezier(0.34,1.2,0.64,1) ${index*0.07}s both`,
      }}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:palette.grad,
        opacity:expanded?0.9:hovered?0.6:0.3,transition:"opacity 0.3s"}}/>
      <div style={{position:"absolute",top:-20,right:-20,width:120,height:120,borderRadius:"50%",
        background:`radial-gradient(circle,${palette.color}12 0%,transparent 70%)`,pointerEvents:"none"}}/>

      {quest.emoji?(
        <div style={{position:"absolute",right:16,top:"50%",
          transform:expanded?"translateY(-50%) scale(1.1)":"translateY(-50%) scale(1)",
          fontSize:28,opacity:expanded?0.55:hovered?0.4:0.25,userSelect:"none",transition:"all 0.3s"}}>{quest.emoji}</div>
      ):(
        <div style={{position:"absolute",right:16,bottom:12,fontSize:36,
          opacity:expanded?0.07:0.035,userSelect:"none",filter:"blur(1px)"}}>{emoji}</div>
      )}

      {/* Collapsed row */}
      <div onClick={()=>hasDetails&&setExpanded(e=>!e)}
        style={{padding:"16px 18px",display:"flex",alignItems:"center",gap:12,
          cursor:hasDetails?"pointer":"default",userSelect:"none"}}>
        <div style={{width:9,height:9,borderRadius:"50%",flexShrink:0,background:palette.color,
          boxShadow:`0 0 10px ${palette.color}`,
          animation:quest.status==="Active"?"pulseDot 2s ease-in-out infinite":"none"}}/>
        <div style={{flex:1,minWidth:0}}>
          <h3 style={{margin:0,fontSize:16,fontWeight:700,letterSpacing:"-0.02em",color:"#F2F2F2",lineHeight:1.3,
            fontFamily:"'Cormorant Garamond',serif",
            display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",
            overflow:"hidden",wordBreak:"break-word"}}>{quest.title}</h3>
          {!expanded&&(quest.description||quest.location?.name||quest.due_date)&&(
            <p style={{margin:"3px 0 0",fontSize:12,color:"rgba(255,255,255,0.3)",whiteSpace:"nowrap",
              overflow:"hidden",textOverflow:"ellipsis",fontFamily:"'DM Sans',sans-serif"}}>
              {quest.location?.name?`📍 ${quest.location.name}`:quest.description?.slice(0,60)+(quest.description?.length>60?"…":"")}
            </p>
          )}
          {!expanded&&quest.due_date&&quest.status!=="Completed"&&(()=>{
            const days=Math.ceil((new Date(quest.due_date)-new Date())/(1000*60*60*24));
            const overdue=days<0;
            const soon=days<=3&&days>=0;
            return(
              <span style={{fontSize:11,fontWeight:700,color:overdue?"#FF7878":soon?"#FFD478":"rgba(255,255,255,0.35)",
                fontFamily:"'DM Sans',sans-serif",marginTop:2,display:"block"}}>
                {overdue?`⚠ ${Math.abs(days)}d overdue`:days===0?"⚡ Due today":`🗓 ${days}d left`}
              </span>
            );
          })()}
        </div>
        {!expanded&&inviteeList.length>0&&(
          <div style={{display:"flex",alignItems:"center",flexShrink:0}}>
            {inviteeList.slice(0,4).map((name,i)=><MiniAvatar key={i} name={name} size={26} overlap={i>0}/>)}
            {inviteeList.length>4&&(
              <div style={{width:26,height:26,borderRadius:"50%",background:"rgba(255,255,255,0.08)",
                border:"2px solid rgba(255,255,255,0.15)",display:"flex",alignItems:"center",
                justifyContent:"center",fontSize:10,color:"rgba(255,255,255,0.5)",fontWeight:700,
                marginLeft:-8,fontFamily:"'DM Sans',sans-serif"}}>+{inviteeList.length-4}</div>
            )}
          </div>
        )}
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          {isShared&&(
            <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",
              color:"rgba(120,193,255,0.8)",background:"rgba(120,193,255,0.1)",
              border:"1px solid rgba(120,193,255,0.2)",padding:"2px 6px",borderRadius:4,flexShrink:0}}>
              Shared
            </span>
          )}
          <StatusBadge status={quest.status}/>
          {hasDetails&&(
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",width:24,height:24,
              borderRadius:6,background:"rgba(255,255,255,0.05)",
              transition:"transform 0.3s cubic-bezier(0.34,1.2,0.64,1)",
              transform:expanded?"rotate(180deg)":"rotate(0deg)"}}>
              <Icon d={Icons.chevron} size={14} stroke="rgba(255,255,255,0.4)"/>
            </div>
          )}
          <div style={{display:"flex",gap:5,opacity:hovered||expanded?1:0.3,transition:"opacity 0.2s"}}
            onClick={e=>e.stopPropagation()}>
            <ActionBtn onClick={()=>onEdit(quest)} title="Edit"><Icon d={Icons.edit} size={13}/></ActionBtn>
            <ActionBtn onClick={()=>onDelete(quest.id)} title="Delete" danger><Icon d={Icons.trash} size={13}/></ActionBtn>
          </div>
        </div>
      </div>

      {/* Expanded */}
      <div style={{maxHeight:expanded?900:0,overflow:"hidden",transition:"max-height 0.45s cubic-bezier(0.4,0,0.2,1)"}}>
        <div style={{padding:"0 18px 20px",display:"flex",flexDirection:"column",gap:16,
          borderTop:`1px solid ${palette.color}20`}}>
          {quest.emoji&&(
            <div style={{marginTop:14,display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
              borderRadius:12,background:`${palette.color}08`,border:`1px solid ${palette.color}18`}}>
              <span style={{fontSize:32}}>{quest.emoji}</span>
              <span style={{fontSize:12,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif",fontStyle:"italic"}}>Quest emblem</span>
            </div>
          )}
          {quest.description&&(
            <p style={{margin:quest.emoji?"0":"14px 0 0",fontSize:13.5,color:"rgba(255,255,255,0.5)",
              lineHeight:1.75,fontFamily:"'DM Sans',sans-serif"}}>{quest.description}</p>
          )}
          {quest.location?.name&&expanded&&(
            <div style={{animation:"cardIn 0.4s ease 0.08s both"}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
                <Icon d={Icons.map} size={13} stroke="rgba(255,255,255,0.3)"/>
                <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
                  color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif"}}>Location</span>
              </div>
              <MapView location={quest.location} height={200}/>
            </div>
          )}
          {(inviteeList.length>0||questMembers.length>0)&&(
            <PartySection names={quest.invitees} members={questMembers}/>
          )}
          {quest.photo&&(
            <div>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
                <Icon d={Icons.camera} size={13} stroke="rgba(255,255,255,0.3)"/>
                <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
                  color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif"}}>Completion Photo</span>
              </div>
              <div style={{borderRadius:14,overflow:"hidden",border:"1px solid rgba(255,255,255,0.1)"}}>
                <img src={quest.photo} alt="completion" style={{width:"100%",display:"block",maxHeight:200,objectFit:"cover"}}/>
              </div>
            </div>
          )}
          {(quest.created_at||quest.started_at||quest.due_date||quest.completed_at)&&(
            <div style={{display:"flex",flexDirection:"column",gap:4,padding:"12px 14px",borderRadius:12,
              background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.05)"}}>
              {quest.created_at&&(
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:11,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif"}}>Created</span>
                  <span style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>
                    {new Date(quest.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                  </span>
                </div>
              )}
              {quest.started_at&&(
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:11,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif"}}>Started</span>
                  <span style={{fontSize:11,color:"rgba(168,255,120,0.7)",fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>
                    {new Date(quest.started_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                  </span>
                </div>
              )}
              {quest.due_date&&quest.status!=="Completed"&&(()=>{
                const days=Math.ceil((new Date(quest.due_date)-new Date())/(1000*60*60*24));
                const overdue=days<0;
                return(
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontSize:11,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif"}}>Due</span>
                    <span style={{fontSize:11,fontWeight:600,fontFamily:"'DM Sans',sans-serif",
                      color:overdue?"#FF7878":days<=3?"#FFD478":"rgba(255,212,120,0.7)"}}>
                      {new Date(quest.due_date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                      {" "}{overdue?`(${Math.abs(days)}d overdue)`:days===0?"(today)":days<=3?`(${days}d left)`:""}
                    </span>
                  </div>
                );
              })()}
              {quest.completed_at&&(
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:11,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif"}}>🔥 Completed</span>
                  <span style={{fontSize:11,color:"#78C1FF",fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>
                    {new Date(quest.completed_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MEMBER CARD (party list) ─────────────────────────────────────────────────
function MemberCard({member,quests,onEdit,onDelete,onClick}){
  const {avatar,color}=getCharacter(member.name);
  const title=getTitle(member.name);
  const [h,setH]=useState(false);
  const myQuests=quests.filter(q=>q.invitees&&q.invitees.split(",").map(s=>s.trim().toLowerCase()).includes(member.name.toLowerCase()));
  const completed=myQuests.filter(q=>q.status==="Completed").length;
  return(
    <div onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{background:h?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.03)",
        border:`1px solid ${h?color+"40":"rgba(255,255,255,0.07)"}`,
        borderRadius:16,padding:"16px",display:"flex",alignItems:"flex-start",gap:14,
        transition:"all 0.25s cubic-bezier(0.34,1.2,0.64,1)",
        transform:h?"translateY(-2px)":"none",
        boxShadow:h?`0 8px 24px rgba(0,0,0,0.3),0 0 0 1px ${color}20`:"none",
        position:"relative",overflow:"hidden",cursor:"pointer"}}
      onClick={onClick}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:1,
        background:`linear-gradient(90deg,transparent,${color}60,transparent)`,
        opacity:h?1:0,transition:"opacity 0.3s"}}/>
      <div style={{width:52,height:52,borderRadius:14,flexShrink:0,
        background:`radial-gradient(circle at 35% 35%,${color}35,${color}10)`,
        border:`2px solid ${color}50`,display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:26,boxShadow:`0 0 20px ${color}25,inset 0 0 12px ${color}10`}}>{avatar}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <h4 style={{margin:0,fontSize:15,fontWeight:700,color:"#F2F2F2",fontFamily:"'Cormorant Garamond',serif"}}>{member.name}</h4>
                  {member.note==="Account owner"&&<span style={{fontSize:9,color:"#A8FF78",fontWeight:700,letterSpacing:"0.06em",background:"rgba(168,255,120,0.1)",border:"1px solid rgba(168,255,120,0.2)",padding:"1px 5px",borderRadius:4}}>YOU</span>}
                </div>
                {member.email&&<p style={{margin:"1px 0 0",fontSize:11,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif"}}>{member.email}</p>}
          <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color,
            background:`${color}15`,border:`1px solid ${color}30`,padding:"1px 6px",borderRadius:4,flexShrink:0}}>
            {member.role||title}
          </span>
        </div>
        {/* Quest stats */}
        <div style={{display:"flex",gap:10,marginBottom:member.note?4:0}}>
          <span style={{fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Sans',sans-serif"}}>
            ⚔ <strong style={{color:"rgba(255,255,255,0.6)"}}>{myQuests.length}</strong> quest{myQuests.length!==1?"s":""}
          </span>
          {completed>0&&(
            <span style={{fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Sans',sans-serif"}}>
              🏆 <strong style={{color:"#78C1FF"}}>{completed}</strong> done
            </span>
          )}
        </div>
        {member.note&&(
          <p style={{margin:0,fontSize:12.5,color:"rgba(255,255,255,0.38)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.55,
            whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>"{member.note}"</p>
        )}
      </div>
      <div style={{display:"flex",gap:5,opacity:h?1:0.2,transition:"opacity 0.2s",flexShrink:0}}
        onClick={e=>e.stopPropagation()}>
        <ActionBtn onClick={()=>onEdit(member)} title="Edit"><Icon d={Icons.edit} size={13}/></ActionBtn>
        <ActionBtn onClick={()=>onDelete(member.id)} title="Remove" danger><Icon d={Icons.trash} size={13}/></ActionBtn>
      </div>
    </div>
  );
}

// ─── QUEST MODAL ──────────────────────────────────────────────────────────────
function QuestModal({quest,onSave,onClose,friends=[]}){
  const [form,setForm]=useState({...EMPTY_QUEST,...quest});
  const [visible,setVisible]=useState(false);
  const [saving,setSaving]=useState(false);
  const titleRef=useRef(null);
  useEffect(()=>{
    requestAnimationFrame(()=>setVisible(true));
    setTimeout(()=>titleRef.current?.focus(),100);
    // Lock body scroll while modal is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return ()=>{ document.body.style.overflow = prev; };
  },[]);
  const close=()=>{setVisible(false);setTimeout(onClose,250);};
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));

  const handleSave=async()=>{
    if(!form.title.trim()) return;
    setSaving(true);
    const now=new Date().toISOString();
    const wasCompleted=quest?.status==="Completed";
    const nowCompleted=form.status==="Completed";
    // Use manual date if set, auto-set if newly completed, else keep existing
    const completed_at=form.completed_at||(nowCompleted&&!wasCompleted?now:null);
    await onSave({...form,id:form.id||crypto.randomUUID(),created_at:form.created_at||now,completed_at});
    setSaving(false);
  };

  // Photo upload
  const handlePhoto=(e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=(ev)=>set("photo",ev.target.result);
    reader.readAsDataURL(file);
  };

  const inp={width:"100%",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",
    borderRadius:12,padding:"12px 14px",color:"#F0F0F0",fontSize:14,outline:"none",
    fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",transition:"border-color 0.2s"};
  const lbl={fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
    color:"rgba(255,255,255,0.3)",marginBottom:7,display:"block",fontFamily:"'DM Sans',sans-serif"};

  const modal = (
    <div style={{position:"fixed",inset:0,
      background:`rgba(0,0,0,${visible?0.72:0})`,
      backdropFilter:`blur(${visible?18:0}px)`,
      display:"flex",alignItems:"flex-end",
      justifyContent:"center",zIndex:9999,
      transition:"background 0.25s,backdrop-filter 0.25s"}}
      onClick={e=>e.target===e.currentTarget&&close()}>
      <div style={{background:"linear-gradient(160deg,#111114 0%,#0C0C0F 100%)",
        borderRadius:"24px 24px 0 0",
        border:"1px solid rgba(255,255,255,0.09)",borderBottom:"none",
        width:"100%",maxWidth:560,padding:"12px 24px 52px",
        display:"flex",flexDirection:"column",gap:20,
        transform:visible?"translateY(0)":"translateY(100%)",
        transition:"transform 0.3s cubic-bezier(0.34,1.1,0.64,1)",
        maxHeight:"85vh",overflowY:"auto",overflowX:"hidden",
        WebkitOverflowScrolling:"touch"}}>
        <div style={{width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.1)",margin:"8px auto 0",flexShrink:0}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <h2 style={{margin:0,fontSize:20,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",color:"#F2F2F2"}}>
            {quest?.id?"Edit Quest":"New Quest"}
          </h2>
          <button onClick={close} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",
            borderRadius:10,padding:"7px 8px",cursor:"pointer",color:"rgba(255,255,255,0.4)"}}>
            <Icon d={Icons.x} size={16}/>
          </button>
        </div>
        <div><label style={lbl}>Title *</label>
          <input ref={titleRef} value={form.title} onChange={e=>set("title",e.target.value)}
            placeholder="Name your quest…" style={inp}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"}/>
        </div>
        <div><label style={lbl}>Description</label>
          <textarea value={form.description} onChange={e=>set("description",e.target.value)}
            placeholder="What does this quest involve?" rows={3}
            style={{...inp,resize:"vertical",lineHeight:1.65}}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"}/>
        </div>
        <div><label style={lbl}>Status</label>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {STATUSES.map(s=>{
              const active=form.status===s;const {color,glow}=STATUS_META[s];
              return<button key={s} onClick={()=>set("status",s)} style={{
                padding:"8px 16px",borderRadius:20,fontSize:12,fontWeight:600,
                letterSpacing:"0.04em",fontFamily:"'DM Sans',sans-serif",cursor:"pointer",
                border:`1px solid ${active?color:"rgba(255,255,255,0.09)"}`,
                background:active?`${color}18`:"transparent",color:active?color:"rgba(255,255,255,0.35)",
                boxShadow:active?`0 0 16px ${glow}`:"none",
                transform:active?"scale(1.04)":"scale(1)",
                transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)"}}>{s}</button>;
            })}
          </div>
        </div>
        <div><label style={lbl}>Quest Emoji</label>
          <EmojiPicker value={form.emoji} onChange={v=>set("emoji",v)}/>
        </div>
        <div><label style={lbl}>Location</label>
          <LocationSearch value={form.location} onChange={loc=>set("location",loc)}/>
          {form.location?.name&&<div style={{marginTop:12}}><MapView location={form.location} height={180}/></div>}
        </div>
        <div>
          <label style={lbl}>Invite Friends</label>
          {friends.length===0?(
            <div style={{padding:"12px 14px",borderRadius:12,background:"rgba(255,255,255,0.03)",
              border:"1px solid rgba(255,255,255,0.07)",fontSize:13,
              color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif"}}>
              No friends yet — add some in the Friends tab first.
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {friends.map(f=>{
                const {avatar,color}=getCharacter(f.name||"?");
                const invited=(form.invitees||"").split(",").map(s=>s.trim()).filter(Boolean)
                  .some(n=>n.toLowerCase()===f.name?.toLowerCase());
                return(
                  <button key={f.user_id||f.id} type="button"
                    onClick={()=>{
                      const current=(form.invitees||"").split(",").map(s=>s.trim()).filter(Boolean);
                      const already=current.some(n=>n.toLowerCase()===f.name?.toLowerCase());
                      const next=already?current.filter(n=>n.toLowerCase()!==f.name?.toLowerCase()):[...current,f.name];
                      set("invitees",next.join(", "));
                    }}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",
                      borderRadius:12,cursor:"pointer",textAlign:"left",
                      background:invited?`${color}12`:"rgba(255,255,255,0.03)",
                      border:`1px solid ${invited?color+"40":"rgba(255,255,255,0.07)"}`,
                      transition:"all 0.15s"}}>
                    <div style={{width:36,height:36,borderRadius:10,flexShrink:0,
                      background:`radial-gradient(circle at 35% 35%,${color}30,${color}08)`,
                      border:`1.5px solid ${color}40`,display:"flex",alignItems:"center",
                      justifyContent:"center",fontSize:18}}>{avatar}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,fontWeight:600,color:"#F0F0F0",
                        fontFamily:"'DM Sans',sans-serif"}}>{f.name}</div>
                      <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",
                        fontFamily:"'DM Sans',sans-serif"}}>{f.email}</div>
                    </div>
                    <div style={{width:20,height:20,borderRadius:"50%",flexShrink:0,
                      background:invited?color:"rgba(255,255,255,0.06)",
                      border:`2px solid ${invited?color:"rgba(255,255,255,0.1)"}`,
                      display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {invited&&<Icon d={Icons.check} size={11} stroke="#0A0A0C"/>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {/* Photo upload — shown when status is Completed */}
        <div>
          <label style={lbl}>Completion Photo {form.status!=="Completed"&&<span style={{opacity:0.4,fontWeight:400,textTransform:"none",fontSize:10}}>(mark as Completed first)</span>}</label>
          {form.photo?(
            <div style={{position:"relative",borderRadius:12,overflow:"hidden",border:"1px solid rgba(255,255,255,0.1)"}}>
              <img src={form.photo} alt="completion" style={{width:"100%",display:"block",maxHeight:160,objectFit:"cover"}}/>
              <button onClick={()=>set("photo",null)} style={{position:"absolute",top:8,right:8,
                background:"rgba(0,0,0,0.7)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,
                padding:"4px 8px",cursor:"pointer",color:"rgba(255,255,255,0.8)",fontSize:12}}>Remove</button>
            </div>
          ):(
            <label style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderRadius:12,
              cursor:form.status==="Completed"?"pointer":"not-allowed",
              background:"rgba(255,255,255,0.04)",border:"1px dashed rgba(255,255,255,0.12)",
              opacity:form.status==="Completed"?1:0.4}}>
              <Icon d={Icons.camera} size={16} stroke="rgba(255,255,255,0.4)"/>
              <span style={{fontSize:13,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif"}}>
                Upload a photo from this quest
              </span>
              <input type="file" accept="image/*" style={{display:"none"}}
                disabled={form.status!=="Completed"} onChange={handlePhoto}/>
            </label>
          )}
        </div>
        {/* Date fields */}
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <label style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
            color:"rgba(255,255,255,0.3)",display:"block",fontFamily:"'DM Sans',sans-serif",marginBottom:-6}}>
            Dates
          </label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <label style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",
                marginBottom:5,display:"block"}}>Started</label>
              <input type="date" value={form.started_at?form.started_at.slice(0,10):""}
                onChange={e=>set("started_at",e.target.value?new Date(e.target.value).toISOString():null)}
                style={{...inp,padding:"10px 12px",fontSize:13,colorScheme:"dark"}}
                onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
                onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"}/>
            </div>
            <div>
              <label style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",
                marginBottom:5,display:"block"}}>Due date</label>
              <input type="date" value={form.due_date?form.due_date.slice(0,10):""}
                onChange={e=>set("due_date",e.target.value?new Date(e.target.value).toISOString():null)}
                style={{...inp,padding:"10px 12px",fontSize:13,colorScheme:"dark"}}
                onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
                onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"}/>
            </div>
          </div>
          {/* Manual completion date — always editable */}
          <div>
            <label style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",
              marginBottom:5,display:"block"}}>🔥 Completion date</label>
            <input type="date" value={form.completed_at?form.completed_at.slice(0,10):""}
              onChange={e=>set("completed_at",e.target.value?new Date(e.target.value).toISOString():null)}
              style={{...inp,padding:"10px 12px",fontSize:13,colorScheme:"dark",
                borderColor:form.completed_at?"rgba(120,193,255,0.3)":"rgba(255,255,255,0.09)"}}
              onFocus={e=>e.target.style.borderColor="rgba(120,193,255,0.5)"}
              onBlur={e=>e.target.style.borderColor=form.completed_at?"rgba(120,193,255,0.3)":"rgba(255,255,255,0.09)"}/>
            <p style={{fontSize:11,color:"rgba(255,255,255,0.2)",margin:"5px 0 0",fontFamily:"'DM Sans',sans-serif"}}>
              Set this to mark a past completion on the streak calendar.
            </p>
          </div>
        </div>
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
  return createPortal(modal, document.body);
}

// ─── MEMBER MODAL ─────────────────────────────────────────────────────────────
function MemberModal({member,onSave,onClose}){
  const [form,setForm]=useState({...EMPTY_MEMBER,...member});
  const [visible,setVisible]=useState(false);
  useEffect(()=>{requestAnimationFrame(()=>setVisible(true));},[]);
  const close=()=>{setVisible(false);setTimeout(onClose,250);};
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const {avatar,color}=form.name?getCharacter(form.name):{avatar:"🧙",color:"#A8FF78"};
  const inp={width:"100%",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",
    borderRadius:12,padding:"12px 14px",color:"#F0F0F0",fontSize:14,outline:"none",
    fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",transition:"border-color 0.2s"};
  const lbl={fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
    color:"rgba(255,255,255,0.3)",marginBottom:7,display:"block",fontFamily:"'DM Sans',sans-serif"};
  return(
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
        <div style={{width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.1)",margin:"8px auto 0"}}/>
        {form.name&&(
          <div style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:16,
            background:`${color}08`,border:`1px solid ${color}25`,animation:"cardIn 0.3s ease both"}}>
            <div style={{width:52,height:52,borderRadius:14,flexShrink:0,
              background:`radial-gradient(circle at 35% 35%,${color}35,${color}10)`,
              border:`2px solid ${color}50`,display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:26,boxShadow:`0 0 20px ${color}20`}}>{avatar}</div>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:"#F2F2F2",fontFamily:"'Cormorant Garamond',serif"}}>{form.name}</div>
              <div style={{fontSize:11,color,fontWeight:600,letterSpacing:"0.06em",marginTop:2,textTransform:"uppercase"}}>{form.role||getTitle(form.name)}</div>
            </div>
          </div>
        )}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h2 style={{margin:0,fontSize:20,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",color:"#F2F2F2"}}>
            {member?.id?"Edit Member":"Add Party Member"}
          </h2>
          <button onClick={close} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",
            borderRadius:10,padding:"7px 8px",cursor:"pointer",color:"rgba(255,255,255,0.4)"}}>
            <Icon d={Icons.x} size={16}/>
          </button>
        </div>
        <div><label style={lbl}>Name *</label>
          <input value={form.name} onChange={e=>set("name",e.target.value)} placeholder="Their name…" style={inp}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"}/>
        </div>
        <div><label style={lbl}>Role / Class</label>
          <input value={form.role} onChange={e=>set("role",e.target.value)}
            placeholder={form.name?getTitle(form.name):"e.g. Navigator, Strategist, Hype Man…"} style={inp}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"}/>
        </div>
        <div><label style={lbl}>Note</label>
          <input value={form.note} onChange={e=>set("note",e.target.value)}
            placeholder="What's their vibe or contribution?" style={inp}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"}/>
        </div>
        <button onClick={()=>{if(!form.name.trim())return;onSave({...form,id:form.id||crypto.randomUUID(),created_at:form.created_at||new Date().toISOString()});}}
          disabled={!form.name.trim()} style={{
          background:form.name.trim()?"linear-gradient(135deg,#e8e8e8,#fff)":"rgba(255,255,255,0.08)",
          color:form.name.trim()?"#0A0A0C":"rgba(255,255,255,0.2)",border:"none",borderRadius:14,
          padding:"15px",fontSize:15,fontWeight:700,cursor:form.name.trim()?"pointer":"not-allowed",
          fontFamily:"'DM Sans',sans-serif"}}>
          {member?.id?"Save Changes":"Add to Party"}
        </button>
      </div>
    </div>
  );
}

// ─── STATS BAR ────────────────────────────────────────────────────────────────
function StatsBar({quests}){
  const active=quests.filter(q=>q.status==="Active").length;
  const done=quests.filter(q=>q.status==="Completed").length;
  const total=quests.length;const pct=total>0?Math.round((done/total)*100):0;
  if(total===0) return null;
  return(
    <div style={{marginBottom:16,padding:"14px 18px",borderRadius:16,
      background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.06)",
      display:"flex",gap:20,alignItems:"center",animation:"cardIn 0.5s cubic-bezier(0.34,1.2,0.64,1) 0.1s both"}}>
      <div style={{flex:1}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
          <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.06em"}}>PROGRESS</span>
          <span style={{fontSize:10,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>{pct}%</span>
        </div>
        <div style={{height:3,background:"rgba(255,255,255,0.06)",borderRadius:2}}>
          <div style={{height:"100%",borderRadius:2,width:`${pct}%`,
            background:"linear-gradient(90deg,#78C1FF,#A8FF78)",
            transition:"width 0.8s cubic-bezier(0.34,1.2,0.64,1)",
            boxShadow:"0 0 8px rgba(168,255,120,0.4)"}}/>
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
function DeleteConfirm({onConfirm,onCancel,label="quest"}){
  const [visible,setVisible]=useState(false);
  useEffect(()=>{requestAnimationFrame(()=>setVisible(true));},[]);
  const close=(cb)=>{setVisible(false);setTimeout(cb,200);};
  return(
    <div style={{position:"fixed",inset:0,background:`rgba(0,0,0,${visible?0.7:0})`,
      backdropFilter:`blur(${visible?12:0}px)`,display:"flex",alignItems:"center",
      justifyContent:"center",zIndex:3000,padding:24,transition:"all 0.2s"}}
      onClick={e=>e.target===e.currentTarget&&close(onCancel)}>
      <div style={{background:"linear-gradient(160deg,#111114,#0C0C0F)",
        border:"1px solid rgba(255,255,255,0.09)",borderRadius:22,padding:"28px 24px",maxWidth:320,width:"100%",
        transform:visible?"scale(1) translateY(0)":"scale(0.94) translateY(8px)",
        transition:"transform 0.25s cubic-bezier(0.34,1.2,0.64,1)"}}>
        <div style={{fontSize:36,marginBottom:12,textAlign:"center"}}>⚠</div>
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



// ─── BOARD CARD ───────────────────────────────────────────────────────────────
function BoardCard({ board, questCount, onClick, onDelete }) {
  const [h,setH] = useState(false);
  const palette = getPalette(board.id);
  return (
    <div onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      onClick={onClick}
      style={{
        position:"relative", overflow:"hidden", cursor:"pointer",
        background:h?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.03)",
        border:`1px solid ${h?palette.color+"40":"rgba(255,255,255,0.07)"}`,
        borderRadius:20, padding:"20px 20px 18px",
        transition:"all 0.25s cubic-bezier(0.34,1.2,0.64,1)",
        transform:h?"translateY(-2px)":"none",
        boxShadow:h?`0 12px 32px rgba(0,0,0,0.4),0 0 0 1px ${palette.color}15`:"none",
        animation:"cardIn 0.4s ease both",
      }}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:2,
        background:palette.grad,opacity:h?0.9:0.4,transition:"opacity 0.3s"}}/>
      <div style={{position:"absolute",top:-10,right:-10,width:80,height:80,borderRadius:"50%",
        background:`radial-gradient(circle,${palette.color}15 0%,transparent 70%)`,pointerEvents:"none"}}/>

      {/* Delete button — top right, visible on hover */}
      <button
        onClick={e=>{ e.stopPropagation(); onDelete(board.id); }}
        style={{
          position:"absolute", top:12, right:12,
          background:"rgba(255,80,80,0.08)", border:"1px solid rgba(255,80,80,0.2)",
          borderRadius:8, padding:"5px 7px", cursor:"pointer",
          color:"rgba(255,120,120,0.7)", display:"flex", alignItems:"center",
          opacity:h?1:0, transition:"opacity 0.2s, background 0.15s",
          zIndex:2,
        }}
        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,80,80,0.18)"}
        onMouseLeave={e=>e.currentTarget.style.background="rgba(255,80,80,0.08)"}
      >
        <Icon d={Icons.trash} size={13}/>
      </button>

      <div style={{fontSize:28,marginBottom:10}}>🗺</div>
      <h3 style={{margin:"0 0 4px",fontSize:17,fontWeight:700,color:"#F2F2F2",
        fontFamily:"'Cormorant Garamond',serif",letterSpacing:"-0.01em"}}>{board.name}</h3>
      {board.description&&(
        <p style={{margin:"0 0 12px",fontSize:13,color:"rgba(255,255,255,0.35)",
          fontFamily:"'DM Sans',sans-serif",lineHeight:1.5}}>{board.description}</p>
      )}
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>
          ⚔ <strong style={{color:palette.color}}>{questCount}</strong> quest{questCount!==1?"s":""}
        </span>
      </div>
    </div>
  );
}

// ─── CREATE BOARD MODAL ────────────────────────────────────────────────────────
function CreateBoardModal({ onSave, onClose }) {
  const [name,setName]   = useState("");
  const [desc,setDesc]   = useState("");
  const [saving,setSaving] = useState(false);
  const [visible,setVisible] = useState(false);
  useEffect(()=>{ requestAnimationFrame(()=>setVisible(true)); },[]);
  const close=()=>{ setVisible(false); setTimeout(onClose,250); };

  const inp = {width:"100%",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",
    borderRadius:12,padding:"12px 14px",color:"#F0F0F0",fontSize:14,outline:"none",
    fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",transition:"border-color 0.2s"};
  const lbl = {fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
    color:"rgba(255,255,255,0.3)",marginBottom:7,display:"block",fontFamily:"'DM Sans',sans-serif"};

  return (
    <div style={{position:"fixed",inset:0,background:`rgba(0,0,0,${visible?0.72:0})`,
      backdropFilter:`blur(${visible?18:0}px)`,display:"flex",alignItems:"flex-end",
      justifyContent:"center",zIndex:1000,transition:"all 0.25s"}}
      onClick={e=>e.target===e.currentTarget&&close()}>
      <div style={{background:"linear-gradient(160deg,#111114,#0C0C0F)",
        borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,0.09)",borderBottom:"none",
        width:"100%",maxWidth:560,padding:"12px 24px 52px",
        display:"flex",flexDirection:"column",gap:20,
        transform:visible?"translateY(0)":"translateY(100%)",
        transition:"transform 0.3s cubic-bezier(0.34,1.1,0.64,1)"}}>
        <div style={{width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.1)",margin:"8px auto 0"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h2 style={{margin:0,fontSize:20,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",color:"#F2F2F2"}}>
            New Board
          </h2>
          <button onClick={close} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",
            borderRadius:10,padding:"7px 8px",cursor:"pointer",color:"rgba(255,255,255,0.4)"}}>
            <Icon d={Icons.x} size={16}/>
          </button>
        </div>
        <p style={{margin:0,fontSize:13,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.6}}>
          A board is a shared space. Create it, share the invite link, and anyone who joins can see and add quests to it.
        </p>
        <div><label style={lbl}>Board Name *</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Istanbul Trip, Squad Goals…"
            style={inp} autoFocus
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"}/>
        </div>
        <div><label style={lbl}>Description</label>
          <input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="What's this board about?"
            style={inp}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.22)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.09)"}/>
        </div>
        <button onClick={async()=>{
          if(!name.trim()||saving) return;
          setSaving(true);
          await onSave(name.trim(), desc.trim());
          setSaving(false);
        }} disabled={!name.trim()||saving} style={{
          background:name.trim()?"linear-gradient(135deg,#e8e8e8,#fff)":"rgba(255,255,255,0.08)",
          color:name.trim()?"#0A0A0C":"rgba(255,255,255,0.2)",border:"none",borderRadius:14,
          padding:"15px",fontSize:15,fontWeight:700,cursor:name.trim()?"pointer":"not-allowed",
          fontFamily:"'DM Sans',sans-serif"}}>
          {saving?"Creating…":"Create Board"}
        </button>
      </div>
    </div>
  );
}

// ─── INVITE LINK MODAL ────────────────────────────────────────────────────────
function InviteModal({ board, onClose }) {
  const [copied,setCopied] = useState(false);
  const [visible,setVisible] = useState(false);
  useEffect(()=>{ requestAnimationFrame(()=>setVisible(true)); },[]);
  const close=()=>{ setVisible(false); setTimeout(onClose,250); };
  const link = `${window.location.origin}?join=${board.invite_code}`;

  const copy = () => {
    navigator.clipboard.writeText(link).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2000); });
  };

  return (
    <div style={{position:"fixed",inset:0,background:`rgba(0,0,0,${visible?0.72:0})`,
      backdropFilter:`blur(${visible?18:0}px)`,display:"flex",alignItems:"flex-end",
      justifyContent:"center",zIndex:1000,transition:"all 0.25s"}}
      onClick={e=>e.target===e.currentTarget&&close()}>
      <div style={{background:"linear-gradient(160deg,#111114,#0C0C0F)",
        borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,0.09)",borderBottom:"none",
        width:"100%",maxWidth:560,padding:"12px 24px 52px",
        display:"flex",flexDirection:"column",gap:20,
        transform:visible?"translateY(0)":"translateY(100%)",
        transition:"transform 0.3s cubic-bezier(0.34,1.1,0.64,1)"}}>
        <div style={{width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.1)",margin:"8px auto 0"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h2 style={{margin:0,fontSize:20,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",color:"#F2F2F2"}}>
            Invite to {board.name}
          </h2>
          <button onClick={close} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",
            borderRadius:10,padding:"7px 8px",cursor:"pointer",color:"rgba(255,255,255,0.4)"}}>
            <Icon d={Icons.x} size={16}/>
          </button>
        </div>
        <p style={{margin:0,fontSize:13,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.6}}>
          Share this link. Anyone who opens it can join the board and see all shared quests.
        </p>
        {/* Link display */}
        <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",
          borderRadius:12,padding:"14px 16px",display:"flex",alignItems:"center",gap:10}}>
          <Icon d={Icons.link} size={15} stroke="rgba(255,255,255,0.3)"/>
          <span style={{flex:1,fontSize:12.5,color:"rgba(255,255,255,0.5)",fontFamily:"'DM Sans',sans-serif",
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{link}</span>
        </div>
        <button onClick={copy} style={{
          background:copied?"rgba(168,255,120,0.15)":"linear-gradient(135deg,#e8e8e8,#fff)",
          color:copied?"#A8FF78":"#0A0A0C",border:copied?"1px solid rgba(168,255,120,0.3)":"none",
          borderRadius:14,padding:"15px",fontSize:15,fontWeight:700,cursor:"pointer",
          fontFamily:"'DM Sans',sans-serif",transition:"all 0.2s",
          display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <Icon d={Icons.copy} size={16} stroke="currentColor"/>
          {copied?"Copied!":"Copy Invite Link"}
        </button>
      </div>
    </div>
  );
}

// ─── JOIN BOARD SCREEN ────────────────────────────────────────────────────────
function JoinBoardScreen({ inviteCode, user, onJoined, onSkip }) {
  const [board,setBoard]   = useState(null);
  const [loading,setLoading] = useState(true);
  const [joining,setJoining] = useState(false);
  const [joined,setJoined]   = useState(false);
  const [error,setError]     = useState("");

  useEffect(()=>{
    sb.getBoardByInvite(inviteCode).then(b=>{
      setBoard(b); setLoading(false);
    }).catch(()=>{ setError("Board not found."); setLoading(false); });
  },[inviteCode]);

  const join = async () => {
    if(!board) return;
    setJoining(true);
    try {
      await sb.joinBoard(board.id, user.id);
      setJoined(true);
      setTimeout(()=>onJoined(board), 1500);
    } catch(e) {
      setError("Failed to join. Try again.");
    }
    setJoining(false);
  };

  if(loading) return (
    <div style={{minHeight:"100vh",background:"#08080A",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{width:28,height:28,border:"2px solid rgba(255,255,255,0.1)",borderTopColor:"rgba(255,255,255,0.5)",
        borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg);}}body{background:#08080A;}`}</style>
    </div>
  );

  const palette = board ? getPalette(board.id) : QUEST_PALETTES[0];

  return (
    <div style={{minHeight:"100vh",background:"#08080A",display:"flex",alignItems:"center",
      justifyContent:"center",padding:24,fontFamily:"'DM Sans',sans-serif",position:"relative",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:#08080A;}
        @keyframes cardIn{from{opacity:0;transform:translateY(20px) scale(0.97);}to{opacity:1;transform:translateY(0) scale(1);}}
        @keyframes spin{to{transform:rotate(360deg);}}
      `}</style>

      <div style={{position:"fixed",inset:0,pointerEvents:"none",overflow:"hidden"}}>
        <div style={{position:"absolute",width:400,height:400,borderRadius:"50%",
          background:`radial-gradient(circle,${palette.color}12 0%,transparent 70%)`,
          top:-50,left:-50}}/>
      </div>

      <div style={{maxWidth:380,width:"100%",animation:"cardIn 0.5s ease both",position:"relative",zIndex:1}}>
        {joined ? (
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:56,marginBottom:16}}>🎉</div>
            <h2 style={{fontSize:24,fontWeight:700,color:"#F2F2F2",fontFamily:"'Cormorant Garamond',serif",marginBottom:8}}>
              You joined!
            </h2>
            <p style={{fontSize:14,color:"rgba(255,255,255,0.4)"}}>Taking you to the board…</p>
          </div>
        ) : error && !board ? (
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:48,marginBottom:16}}>❌</div>
            <h2 style={{fontSize:20,fontWeight:700,color:"#F2F2F2",fontFamily:"'Cormorant Garamond',serif",marginBottom:8}}>
              Invalid invite
            </h2>
            <p style={{fontSize:14,color:"rgba(255,255,255,0.4)",marginBottom:24}}>This invite link doesn't exist or has expired.</p>
            <button onClick={onSkip} style={{padding:"13px 28px",borderRadius:14,border:"1px solid rgba(255,255,255,0.1)",
              background:"rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.7)",cursor:"pointer",
              fontSize:14,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>Go to My App</button>
          </div>
        ) : board ? (
          <div style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${palette.color}30`,
            borderRadius:24,padding:"32px 24px",textAlign:"center"}}>
            <div style={{position:"relative",height:2,background:palette.grad,borderRadius:1,marginBottom:28,
              boxShadow:`0 0 12px ${palette.glow}`}}/>
            <div style={{fontSize:48,marginBottom:16}}>🗺</div>
            <p style={{fontSize:12,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
              color:"rgba(255,255,255,0.3)",marginBottom:8,fontFamily:"'DM Sans',sans-serif"}}>
              You've been invited to
            </p>
            <h2 style={{fontSize:26,fontWeight:700,color:"#F2F2F2",fontFamily:"'Cormorant Garamond',serif",marginBottom:8}}>
              {board.name}
            </h2>
            {board.description&&(
              <p style={{fontSize:13,color:"rgba(255,255,255,0.4)",marginBottom:20,lineHeight:1.6}}>{board.description}</p>
            )}
            <p style={{fontSize:12,color:"rgba(255,255,255,0.25)",marginBottom:24}}>
              Joining as <strong style={{color:"rgba(255,255,255,0.5)"}}>{user.email}</strong>
            </p>
            {error&&<p style={{fontSize:12,color:"#FF7878",marginBottom:12}}>{error}</p>}
            <div style={{display:"flex",gap:10}}>
              <button onClick={onSkip} style={{flex:1,padding:"13px",borderRadius:12,
                background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",
                color:"rgba(255,255,255,0.5)",cursor:"pointer",fontSize:14,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>
                Skip
              </button>
              <button onClick={join} disabled={joining} style={{flex:2,padding:"13px",borderRadius:12,
                background:`linear-gradient(135deg,${palette.color}cc,${palette.color})`,
                color:"#0A0A0C",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,
                fontFamily:"'DM Sans',sans-serif",opacity:joining?0.7:1}}>
                {joining?"Joining…":"Join Board"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── BOARD DETAIL PAGE ────────────────────────────────────────────────────────
function BoardDetailPage({ board, user, members, allQuests, onBack, onSaveQuest, onDeleteQuest, onInvite, friends=[] }) {
  const [boardQuests, setBoardQuests]     = useState([]);
  const [boardMembers, setBoardMembers]   = useState([]);
  const [loading, setLoading]             = useState(true);
  const [questModal, setQuestModal]       = useState(null);
  const [deleteTarget, setDeleteTarget]   = useState(null);
  const palette = getPalette(board.id);

  useEffect(()=>{
    setLoading(true);
    Promise.all([
      sb.getBoardQuests(board.id),
      sb.getBoardMemberProfiles(board.id),
    ]).then(([q,m])=>{
      setBoardQuests(q);
      setBoardMembers(m);
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[board.id]);

  const saveQuest = async(q) => {
    const withBoard = {...q, user_id:user.id, board_id:board.id};
    await onSaveQuest(withBoard, true);
    setBoardQuests(prev => prev.find(x=>x.id===q.id) ? prev.map(x=>x.id===q.id?withBoard:x) : [withBoard,...prev]);
    setQuestModal(null);
  };

  const deleteQuest = async() => {
    await onDeleteQuest(deleteTarget);
    setBoardQuests(prev=>prev.filter(q=>q.id!==deleteTarget));
    setDeleteTarget(null);
  };

  const filter = "All";
  const counts = STATUSES.reduce((acc,s)=>({...acc,[s]:boardQuests.filter(q=>q.status===s).length}),{});

  return (
    <div style={{maxWidth:560,margin:"0 auto",padding:"0 24px 120px",animation:"cardIn 0.4s ease both"}}>
      {/* Back */}
      <button onClick={onBack} style={{display:"flex",alignItems:"center",gap:8,background:"none",border:"none",
        cursor:"pointer",color:"rgba(255,255,255,0.4)",fontSize:13,fontFamily:"'DM Sans',sans-serif",
        padding:"0 0 20px",fontWeight:600}}>
        <Icon d={Icons.back} size={16}/> All Boards
      </button>

      {/* Board header */}
      <div style={{position:"relative",background:`${palette.color}08`,border:`1px solid ${palette.color}25`,
        borderRadius:20,padding:"22px 20px",marginBottom:20,overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:palette.grad}}/>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12}}>
          <div>
            <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
              color:palette.color,marginBottom:6,fontFamily:"'DM Sans',sans-serif"}}>Shared Board</div>
            <h2 style={{fontSize:22,fontWeight:700,color:"#F2F2F2",fontFamily:"'Cormorant Garamond',serif",marginBottom:4}}>
              {board.name}
            </h2>
            {board.description&&<p style={{fontSize:13,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif"}}>{board.description}</p>}
          </div>
          <button onClick={onInvite} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",
            borderRadius:12,border:`1px solid ${palette.color}40`,background:`${palette.color}10`,
            color:palette.color,cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'DM Sans',sans-serif",
            flexShrink:0,whiteSpace:"nowrap"}}>
            <Icon d={Icons.link} size={13} stroke="currentColor"/> Invite
          </button>
        </div>
        <div style={{marginTop:14,display:"flex",gap:14}}>
          {[{l:"Quests",v:boardQuests.length,c:"#F0F0F0"},{l:"Active",v:counts["Active"]||0,c:"#A8FF78"},{l:"Done",v:counts["Completed"]||0,c:"#78C1FF"},{l:"Members",v:boardMembers.length,c:palette.color}].map(({l,v,c})=>(
            <div key={l} style={{textAlign:"center"}}>
              <div style={{fontSize:20,fontWeight:700,color:c,fontFamily:"'Cormorant Garamond',serif",lineHeight:1}}>{v}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:"0.08em",marginTop:3,fontFamily:"'DM Sans',sans-serif",textTransform:"uppercase"}}>{l}</div>
            </div>
          ))}
        </div>

        {/* Board members row */}
        {boardMembers.length>0&&(
          <div style={{marginTop:16,paddingTop:14,borderTop:`1px solid ${palette.color}15`}}>
            <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
              color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginBottom:10}}>
              Members
            </p>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {boardMembers.map(m=>{
                const {avatar,color}=getCharacter(m.name||"?");
                const isMe = m.user_id === user?.id;
                return(
                  <div key={m.user_id} style={{display:"flex",alignItems:"center",gap:10,
                    padding:"8px 12px",borderRadius:12,
                    background:isMe?`${palette.color}08`:"rgba(255,255,255,0.03)",
                    border:`1px solid ${isMe?palette.color+"25":"rgba(255,255,255,0.06)"}`}}>
                    <div style={{width:36,height:36,borderRadius:10,flexShrink:0,
                      background:`radial-gradient(circle at 35% 35%,${color}30,${color}08)`,
                      border:`1.5px solid ${color}40`,display:"flex",alignItems:"center",
                      justifyContent:"center",fontSize:18}}>{avatar}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:14,fontWeight:700,color:"#F0F0F0",
                          fontFamily:"'Cormorant Garamond',serif"}}>{m.name}</span>
                        {isMe&&<span style={{fontSize:9,fontWeight:700,color:palette.color,
                          background:`${palette.color}15`,border:`1px solid ${palette.color}30`,
                          padding:"1px 5px",borderRadius:4,letterSpacing:"0.06em"}}>YOU</span>}
                      </div>
                      <div style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginTop:1}}>
                        Joined {new Date(m.joined_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                      </div>
                    </div>
                    <div style={{width:8,height:8,borderRadius:"50%",background:"#A8FF78",flexShrink:0,
                      boxShadow:"0 0 6px rgba(168,255,120,0.6)"}}/>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Quest list */}
      {loading ? (
        <div style={{textAlign:"center",padding:"40px 0"}}>
          <div style={{width:24,height:24,border:"2px solid rgba(255,255,255,0.1)",borderTopColor:"rgba(255,255,255,0.5)",
            borderRadius:"50%",animation:"spin 0.8s linear infinite",margin:"0 auto"}}/>
        </div>
      ) : boardQuests.length===0 ? (
        <div style={{textAlign:"center",padding:"60px 0"}}>
          <div style={{fontSize:40,marginBottom:14,opacity:0.15}}>🗺</div>
          <p style={{fontSize:15,color:"rgba(255,255,255,0.2)",lineHeight:1.7}}>No quests yet.<br/>Add the first one!</p>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {boardQuests.map((q,i)=>(
            <QuestCard key={q.id} quest={q} members={members} index={i}
              onEdit={q=>setQuestModal(q)} onDelete={id=>setDeleteTarget(id)}/>
          ))}
        </div>
      )}

      {/* Add quest FAB */}
      <button onClick={()=>setQuestModal({...EMPTY_QUEST})}
        style={{position:"fixed",bottom:36,left:"50%",transform:"translateX(-50%)",
          background:`linear-gradient(135deg,${palette.color}cc,${palette.color})`,
          color:"#0A0A0C",border:"none",borderRadius:28,
          padding:"14px 28px",display:"flex",alignItems:"center",gap:9,
          fontSize:14,fontWeight:700,cursor:"pointer",
          fontFamily:"'DM Sans',sans-serif",zIndex:100,
          boxShadow:`0 8px 32px ${palette.glow}`}}>
        <Icon d={Icons.plus} size={16} stroke="#0A0A0C"/> Add Quest
      </button>

      {/* Made by footer */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:5,
        pointerEvents:"none",display:"flex",justifyContent:"center",paddingBottom:8}}>
        <span style={{fontSize:10,color:"rgba(255,255,255,0.12)",fontFamily:"'DM Sans',sans-serif",
          letterSpacing:"0.06em"}}>
          Made by <span style={{color:"rgba(255,255,255,0.2)",fontWeight:600}}>Murad Mirzayev</span>
        </span>
      </div>

      {questModal&&<QuestModal quest={questModal} onSave={saveQuest} friends={friends} onClose={()=>setQuestModal(null)}/>}
      {deleteTarget&&<DeleteConfirm label="quest" onConfirm={deleteQuest} onCancel={()=>setDeleteTarget(null)}/>}
    </div>
  );
}


// ─── RANK BADGE ───────────────────────────────────────────────────────────────
function RankBadge({ xp, size="sm" }) {
  const rank = getRank(xp);
  const next = RANKS.find(r=>r.min > xp);
  const pct  = next ? Math.round(((xp - getRank(xp).min) / (next.min - getRank(xp).min)) * 100) : 100;
  if(size==="sm") return (
    <div style={{display:"flex",alignItems:"center",gap:5}}>
      <span style={{fontSize:14}}>{rank.icon}</span>
      <span style={{fontSize:11,fontWeight:700,color:rank.color,fontFamily:"'DM Sans',sans-serif",
        letterSpacing:"0.04em"}}>{rank.name}</span>
      <span style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif"}}>
        {xp} XP
      </span>
    </div>
  );
  // Large version for profile
  return (
    <div style={{background:`${rank.color}10`,border:`1px solid ${rank.color}30`,
      borderRadius:16,padding:"16px 20px"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
        <span style={{fontSize:36}}>{rank.icon}</span>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:rank.color,
            fontFamily:"'Cormorant Garamond',serif"}}>{rank.name}</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif"}}>
            {xp} XP total
          </div>
        </div>
        {next&&<div style={{marginLeft:"auto",textAlign:"right"}}>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>Next rank</div>
          <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,0.6)",fontFamily:"'DM Sans',sans-serif"}}>{next.name}</div>
        </div>}
      </div>
      {next&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
            <span style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>PROGRESS</span>
            <span style={{fontSize:10,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>{pct}%</span>
          </div>
          <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2}}>
            <div style={{height:"100%",borderRadius:2,width:`${pct}%`,
              background:`linear-gradient(90deg,${rank.color}80,${rank.color})`,
              transition:"width 0.8s cubic-bezier(0.34,1.2,0.64,1)",
              boxShadow:`0 0 8px ${rank.color}60`}}/>
          </div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif",marginTop:5}}>
            {next.min - xp} XP to {next.name}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FRIENDS PAGE ─────────────────────────────────────────────────────────────
function FriendsPage({ user, quests, onAddToQuest, onFriendsLoaded }) {
  const [friends, setFriends]   = useState([]);
  const [pending, setPending]   = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [email, setEmail]       = useState("");
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");
  const userXP = calcXP(quests);

  const load = async() => {
    setLoading(true);
    try {
      const data = await sb.getFriendProfiles(user.id);
      setFriends(data.friends||[]);
      setPending(data.pending||[]);
      setIncoming(data.incoming||[]);
      if(onFriendsLoaded) onFriendsLoaded(data.friends||[]);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(()=>{
    load();
    // Auto-refresh every 10s to catch new incoming requests
    const interval = setInterval(load, 10000);
    return ()=>clearInterval(interval);
  },[]);

  const sendRequest = async() => {
    if(!email.trim()) return;
    setSending(true); setError(""); setSuccess("");
    try {
      const target = await sb.sendFriendRequest(user.id, email.trim());
      setSuccess(`Friend request sent to ${target.name||email}!`);
      setEmail("");
    } catch(e) { setError(e.message); }
    setSending(false);
  };

  const respond = async(id, accept) => {
    try {
      await sb.respondFriendRequest(id, accept);
      await load();
    } catch(e) {
      console.error("respond failed:", e);
      setError(e.message||"Could not respond. Try again.");
    }
  };

  return (
    <div style={{maxWidth:560,margin:"0 auto",padding:"20px 24px 0"}}>
      <div style={{marginBottom:20}}>
        <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",
          color:"rgba(255,255,255,0.2)",marginBottom:4}}>Your Adventure</p>
        <h2 style={{fontSize:24,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",
          background:"linear-gradient(135deg,#F2F2F2,rgba(242,242,242,0.5))",
          WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:16}}>
          Friends & Rank
        </h2>
        {/* Rank card */}
        <RankBadge xp={userXP} size="lg"/>
      </div>

      {/* Incoming requests */}
      {incoming.length>0&&(
        <div style={{marginBottom:20}}>
          <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
            color:"#FFD478",fontFamily:"'DM Sans',sans-serif",marginBottom:10}}>
            Incoming Requests ({incoming.length})
          </p>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {incoming.map(req=>{
              const {avatar,color}=getCharacter(req.profile?.name||"?");
              return(
                <div key={req.id} style={{background:"rgba(255,212,120,0.06)",
                  border:"1px solid rgba(255,212,120,0.2)",borderRadius:14,
                  padding:"14px 16px",display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:40,height:40,borderRadius:11,flexShrink:0,
                    background:`radial-gradient(circle at 35% 35%,${color}30,${color}08)`,
                    border:`1.5px solid ${color}40`,display:"flex",alignItems:"center",
                    justifyContent:"center",fontSize:20}}>{avatar}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#F0F0F0",
                      fontFamily:"'Cormorant Garamond',serif"}}>{req.profile?.name||"Unknown"}</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>
                      {req.profile?.email||""}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>respond(req.id,false)} style={{padding:"7px 12px",borderRadius:8,
                      background:"rgba(255,80,80,0.1)",border:"1px solid rgba(255,80,80,0.25)",
                      color:"#FF7878",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>
                      Decline
                    </button>
                    <button onClick={()=>respond(req.id,true)} style={{padding:"7px 12px",borderRadius:8,
                      background:"rgba(168,255,120,0.12)",border:"1px solid rgba(168,255,120,0.3)",
                      color:"#A8FF78",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>
                      Accept
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add friend */}
      <div style={{marginBottom:20,padding:"16px",background:"rgba(255,255,255,0.025)",
        border:"1px solid rgba(255,255,255,0.07)",borderRadius:16}}>
        <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
          color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginBottom:10}}>
          Add Friend
        </p>
        <div style={{display:"flex",gap:8}}>
          <input value={email} onChange={e=>setEmail(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&sendRequest()}
            placeholder="Their email address…"
            style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",
              borderRadius:10,padding:"10px 14px",color:"#F0F0F0",fontSize:13.5,outline:"none",
              fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box"}}/>
          <button onClick={sendRequest} disabled={!email.trim()||sending} style={{
            padding:"0 16px",borderRadius:10,border:"none",cursor:"pointer",
            background:"rgba(168,255,120,0.15)",color:"#A8FF78",
            fontSize:13,fontWeight:700,fontFamily:"'DM Sans',sans-serif",flexShrink:0,
            opacity:sending?0.6:1}}>
            {sending?"…":"Add"}
          </button>
        </div>
        {error&&<p style={{fontSize:12,color:"#FF7878",margin:"8px 0 0",fontFamily:"'DM Sans',sans-serif"}}>{error}</p>}
        {success&&<p style={{fontSize:12,color:"#A8FF78",margin:"8px 0 0",fontFamily:"'DM Sans',sans-serif"}}>{success}</p>}
      </div>

      {/* Friends list */}
      {loading ? (
        <div style={{textAlign:"center",padding:"40px 0"}}>
          <div style={{width:24,height:24,border:"2px solid rgba(255,255,255,0.1)",
            borderTopColor:"rgba(255,255,255,0.5)",borderRadius:"50%",
            animation:"spin 0.8s linear infinite",margin:"0 auto"}}/>
        </div>
      ) : friends.length===0 ? (
        <div style={{textAlign:"center",padding:"40px 0"}}>
          <div style={{fontSize:40,marginBottom:12,opacity:0.15}}>🤝</div>
          <p style={{fontSize:14,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.7}}>
            No friends yet.<br/>Add someone by their email.
          </p>
        </div>
      ) : (
        <div>
          <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
            color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginBottom:10}}>
            Friends ({friends.length})
          </p>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {friends.map(f=>{
              const {avatar,color}=getCharacter(f.name||"?");
              const friendQuests=quests.filter(q=>q.invitees&&q.invitees.toLowerCase().includes(f.name?.toLowerCase()));
              return(
                <div key={f.id} style={{background:"rgba(255,255,255,0.03)",
                  border:`1px solid ${color}25`,borderLeft:`3px solid ${color}`,
                  borderRadius:14,padding:"14px 16px",
                  display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:44,height:44,borderRadius:12,flexShrink:0,
                    background:`radial-gradient(circle at 35% 35%,${color}30,${color}08)`,
                    border:`1.5px solid ${color}40`,display:"flex",alignItems:"center",
                    justifyContent:"center",fontSize:22}}>{avatar}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:15,fontWeight:700,color:"#F0F0F0",
                      fontFamily:"'Cormorant Garamond',serif"}}>{f.name}</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif"}}>
                      {f.email}
                    </div>
                    <div style={{fontSize:11,color:color,fontFamily:"'DM Sans',sans-serif",marginTop:2}}>
                      {friendQuests.length} shared quest{friendQuests.length!==1?"s":""}
                    </div>
                  </div>
                  <button onClick={async(e)=>{e.stopPropagation();if(!window.confirm(`Remove ${f.name} from friends?`))return;try{await sb.removeFriend(user.id,f.user_id);load();}catch(e){console.error(e);}}}
                    style={{background:"rgba(255,80,80,0.08)",border:"1px solid rgba(255,80,80,0.2)",
                      borderRadius:8,padding:"6px 8px",cursor:"pointer",color:"rgba(255,120,120,0.7)",
                      display:"flex",alignItems:"center",flexShrink:0}}>
                    <Icon d={Icons.trash} size={13}/>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── PROFILE SETUP SCREEN ─────────────────────────────────────────────────────
function ProfileSetupScreen({ user, onDone }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const preview = name.trim() || user.email?.split("@")[0] || "Adventurer";
  const { avatar, color } = getCharacter(preview);

  const save = async() => {
    if(!name.trim()) return;
    setSaving(true);
    try {
      // Update the member record with chosen display name
      await sb.upsert("members", {
        id: crypto.randomUUID(),
        name: name.trim(),
        display_name: name.trim(),
        email: user.email,
        user_id: user.id,
        note: "Account owner",
        created_at: new Date().toISOString(),
      });
      onDone(name.trim());
    } catch(e) {
      setError("Could not save. Try again.");
      console.error(e);
    }
    setSaving(false);
  };

  return (
    <div style={{minHeight:"100vh",background:"#08080A",display:"flex",alignItems:"center",
      justifyContent:"center",padding:24,fontFamily:"'DM Sans',sans-serif",position:"relative",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:#08080A;}
        @keyframes cardIn{from{opacity:0;transform:translateY(20px) scale(0.97);}to{opacity:1;transform:translateY(0) scale(1);}}
        @keyframes orb1{0%,100%{transform:translate(0,0);}50%{transform:translate(40px,-30px);}}
      `}</style>

      {/* Orb */}
      <div style={{position:"fixed",inset:0,pointerEvents:"none",overflow:"hidden"}}>
        <div style={{position:"absolute",width:500,height:500,borderRadius:"50%",
          background:`radial-gradient(circle,${color}12 0%,transparent 70%)`,
          top:-100,left:-100,animation:"orb1 12s ease-in-out infinite"}}/>
      </div>

      <div style={{maxWidth:380,width:"100%",animation:"cardIn 0.5s ease both",position:"relative",zIndex:1}}>
        {/* Avatar preview */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{width:80,height:80,borderRadius:22,margin:"0 auto 14px",
            background:`radial-gradient(circle at 35% 35%,${color}35,${color}10)`,
            border:`2px solid ${color}50`,display:"flex",alignItems:"center",
            justifyContent:"center",fontSize:40,
            boxShadow:`0 0 32px ${color}30`}}>
            {avatar}
          </div>
          <h1 style={{fontSize:26,fontWeight:700,color:"#F2F2F2",
            fontFamily:"'Cormorant Garamond',serif",marginBottom:4}}>{preview}</h1>
          <p style={{fontSize:12,color:color,fontWeight:600,letterSpacing:"0.06em",
            textTransform:"uppercase"}}>{getTitle(preview)}</p>
        </div>

        <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.09)",
          borderRadius:24,padding:"28px 24px",display:"flex",flexDirection:"column",gap:16}}>
          <div style={{textAlign:"center",marginBottom:4}}>
            <h2 style={{fontSize:19,fontWeight:700,color:"#F2F2F2",
              fontFamily:"'Cormorant Garamond',serif",marginBottom:6}}>
              Choose your name
            </h2>
            <p style={{fontSize:13,color:"rgba(255,255,255,0.35)",lineHeight:1.6}}>
              This is what your friends will see. Your character is auto-generated from it.
            </p>
          </div>

          <input value={name} onChange={e=>setName(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&save()}
            placeholder="Your name or nickname…"
            autoFocus
            style={{width:"100%",background:"rgba(255,255,255,0.05)",
              border:"1px solid rgba(255,255,255,0.12)",borderRadius:14,
              padding:"14px 16px",color:"#F0F0F0",fontSize:15,outline:"none",
              fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",
              transition:"border-color 0.2s"}}
            onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.3)"}
            onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.12)"}/>

          {error&&<p style={{fontSize:12,color:"#FF7878",fontFamily:"'DM Sans',sans-serif"}}>{error}</p>}

          <button onClick={save} disabled={!name.trim()||saving} style={{
            background:name.trim()?"linear-gradient(135deg,#e8e8e8,#fff)":"rgba(255,255,255,0.07)",
            color:name.trim()?"#0A0A0C":"rgba(255,255,255,0.2)",
            border:"none",borderRadius:14,padding:"15px",fontSize:15,fontWeight:700,
            cursor:name.trim()?"pointer":"not-allowed",fontFamily:"'DM Sans',sans-serif",
            opacity:saving?0.7:1}}>
            {saving?"Saving…":"Begin My Journey"}
          </button>

          <button onClick={()=>onDone(user.email?.split("@")[0]||"Adventurer")}
            style={{background:"none",border:"none",cursor:"pointer",
              fontSize:12,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif"}}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── PROFILE PAGE ─────────────────────────────────────────────────────────────
function ProfilePage({ user, quests, onSignOut, onNameChange }) {
  const [name, setName]       = useState("");
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [loading, setLoading] = useState(true);

  const userXP   = calcXP(quests);
  const userRank = getRank(userXP);
  const completedCount = quests.filter(q=>q.status==="Completed").length;

  useEffect(()=>{
    // Load name from auth metadata (the source of truth)
    const authName = sb.getUser()?.name
      || localStorage.getItem("sq_name")
      || user.email?.split("@")[0]||"";
    setName(authName);
    setLoading(false);
  },[]);

  const saveName = async() => {
    if(!name.trim()) return;
    setSaving(true);
    try {
      // Get existing member record to preserve its ID
      const existing = await sb.getAll("members", user.id);
      const me = Array.isArray(existing)?existing.find(m=>m.user_id===user.id):null;
      await sb.upsert("members",{
        id: me?.id || crypto.randomUUID(),
        name: name.trim(),
        display_name: name.trim(),
        email: user.email,
        user_id: user.id,
        note: "Account owner",
        created_at: me?.created_at || new Date().toISOString(),
      });
      setSaved(true);
      onNameChange(name.trim());
      setTimeout(()=>setSaved(false),2500);
    } catch(e){console.error(e); setError("Could not save name.");}
    setSaving(false);
  };
  const [error, setError] = useState("");

  const preview = name.trim()||user.email?.split("@")[0]||"Adventurer";
  const {avatar,color} = getCharacter(preview);
  const nextRank = RANKS.find(r=>r.min>userXP);
  const pct = nextRank?Math.round(((userXP-userRank.min)/(nextRank.min-userRank.min))*100):100;

  return(
    <div style={{maxWidth:560,margin:"0 auto",padding:"20px 24px 100px"}}>
      <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",
        color:"rgba(255,255,255,0.2)",marginBottom:4}}>Your Identity</p>
      <h2 style={{fontSize:24,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",
        background:"linear-gradient(135deg,#F2F2F2,rgba(242,242,242,0.5))",
        WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:20}}>
        Profile
      </h2>

      {/* Avatar card */}
      <div style={{background:`${color}08`,border:`1px solid ${color}25`,borderRadius:20,
        padding:"24px 20px",marginBottom:16,position:"relative",overflow:"hidden",textAlign:"center"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,
          background:`linear-gradient(90deg,transparent,${color}80,transparent)`}}/>
        <div style={{width:76,height:76,borderRadius:20,margin:"0 auto 12px",
          background:`radial-gradient(circle at 35% 35%,${color}35,${color}10)`,
          border:`2px solid ${color}50`,display:"flex",alignItems:"center",
          justifyContent:"center",fontSize:38,
          boxShadow:`0 0 32px ${color}30`}}>{avatar}</div>
        <div style={{fontSize:22,fontWeight:700,color:"#F2F2F2",
          fontFamily:"'Cormorant Garamond',serif",marginBottom:4}}>{preview}</div>
        <div style={{fontSize:11,color:color,fontWeight:700,letterSpacing:"0.08em",
          textTransform:"uppercase",marginBottom:16}}>{getTitle(preview)}</div>
        {/* Stats row */}
        <div style={{display:"flex",gap:0,borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:14}}>
          {[
            {l:"Quests",v:quests.length},
            {l:"Completed",v:completedCount},
            {l:"XP",v:userXP},
          ].map(({l,v},i)=>(
            <div key={l} style={{flex:1,textAlign:"center",
              borderLeft:i>0?"1px solid rgba(255,255,255,0.06)":"none"}}>
              <div style={{fontSize:20,fontWeight:700,color:"#F0F0F0",
                fontFamily:"'Cormorant Garamond',serif",lineHeight:1}}>{v}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:"0.08em",
                marginTop:3,fontFamily:"'DM Sans',sans-serif",textTransform:"uppercase"}}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Rank card */}
      <div style={{background:`${userRank.color}10`,border:`1px solid ${userRank.color}30`,
        borderRadius:16,padding:"16px 18px",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
          <span style={{fontSize:32}}>{userRank.icon}</span>
          <div style={{flex:1}}>
            <div style={{fontSize:18,fontWeight:700,color:userRank.color,
              fontFamily:"'Cormorant Garamond',serif"}}>{userRank.name}</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Sans',sans-serif"}}>
              {userXP} XP total
            </div>
          </div>
          {nextRank&&<div style={{textAlign:"right"}}>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>Next</div>
            <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,0.6)",
              fontFamily:"'DM Sans',sans-serif"}}>{nextRank.name}</div>
          </div>}
        </div>
        {nextRank&&(
          <div>
            <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2}}>
              <div style={{height:"100%",borderRadius:2,width:`${pct}%`,
                background:`linear-gradient(90deg,${userRank.color}80,${userRank.color})`,
                transition:"width 0.8s cubic-bezier(0.34,1.2,0.64,1)",
                boxShadow:`0 0 8px ${userRank.color}60`}}/>
            </div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif",marginTop:5}}>
              {nextRank.min-userXP} XP to {nextRank.name}
            </div>
          </div>
        )}
      </div>

      {/* Name display — locked at signup */}
      <div style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.07)",
        borderRadius:16,padding:"18px 18px",marginBottom:16}}>
        <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
          color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginBottom:10}}>
          Account
        </p>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>Name</span>
            <span style={{fontSize:13,fontWeight:600,color:"rgba(255,255,255,0.7)",fontFamily:"'DM Sans',sans-serif"}}>{name||user.email?.split("@")[0]}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>Email</span>
            <span style={{fontSize:13,color:"rgba(255,255,255,0.5)",fontFamily:"'DM Sans',sans-serif"}}>{user.email}</span>
          </div>
          <p style={{fontSize:11,color:"rgba(255,255,255,0.15)",margin:"4px 0 0",
            fontFamily:"'DM Sans',sans-serif",fontStyle:"italic"}}>
            Name is set at signup and cannot be changed.
          </p>
        </div>
      </div>

      {/* Sign out */}
      <button onClick={onSignOut} style={{
        width:"100%",padding:"14px",borderRadius:14,
        background:"rgba(255,80,80,0.08)",border:"1px solid rgba(255,80,80,0.2)",
        color:"#FF7878",cursor:"pointer",fontSize:14,fontWeight:700,
        fontFamily:"'DM Sans',sans-serif"}}>
        Sign Out
      </button>
    </div>
  );
}


// ─── MEMORIES PAGE ────────────────────────────────────────────────────────────
function MemoriesPage({ user }) {
  const [viewDate, setViewDate]   = useState(new Date());
  const [memories, setMemories]   = useState([]);
  const [selected, setSelected]   = useState(null); // {date, memory|null}
  const [loading, setLoading]     = useState(true);

  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthName = viewDate.toLocaleDateString("en-US",{month:"long",year:"numeric"});
  const firstDay = new Date(year,month,1).getDay();
  const daysInMonth = new Date(year,month+1,0).getDate();
  const today = new Date();

  useEffect(()=>{
    setLoading(true);
    sb.getMemories(user.id).then(m=>{ setMemories(m); setLoading(false); }).catch(()=>setLoading(false));
  },[]);

  const getDayMemories = (d) => {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    return memories.filter(m=>m.date===dateStr);
  };

  const openDay = (d) => {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    setSelected({date:dateStr, memories:getDayMemories(d)});
  };

  const isToday = (d) => today.getFullYear()===year&&today.getMonth()===month&&today.getDate()===d;
  const isFuture = (d) => new Date(year,month,d) > today;

  return (
    <div style={{maxWidth:560,margin:"0 auto",padding:"20px 24px 100px"}}>
      <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",
        color:"rgba(255,255,255,0.2)",marginBottom:4}}>Your Story</p>
      <h2 style={{fontSize:24,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",
        background:"linear-gradient(135deg,#F2F2F2,rgba(242,242,242,0.5))",
        WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:20}}>
        Memories
      </h2>

      {/* Calendar */}
      <div style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.07)",
        borderRadius:20,padding:"20px",marginBottom:16}}>
        {/* Month nav */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <h3 style={{fontSize:16,fontWeight:700,color:"rgba(255,255,255,0.8)",
            fontFamily:"'Cormorant Garamond',serif"}}>{monthName}</h3>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setViewDate(new Date(year,month-1,1))}
              style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",
                borderRadius:8,padding:"5px 10px",cursor:"pointer",color:"rgba(255,255,255,0.5)",fontSize:16}}>
              ‹
            </button>
            <button onClick={()=>setViewDate(new Date(year,month+1,1))}
              style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",
                borderRadius:8,padding:"5px 10px",cursor:"pointer",color:"rgba(255,255,255,0.5)",fontSize:16}}>
              ›
            </button>
          </div>
        </div>

        {/* Day labels */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:3}}>
          {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=>(
            <div key={d} style={{textAlign:"center",fontSize:10,color:"rgba(255,255,255,0.2)",
              fontFamily:"'DM Sans',sans-serif",fontWeight:600,letterSpacing:"0.05em"}}>{d}</div>
          ))}
        </div>

        {/* Days grid */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
          {Array.from({length:firstDay}).map((_,i)=><div key={"e"+i}/>)}
          {Array.from({length:daysInMonth}).map((_,i)=>{
            const d = i+1;
            const dayMems = getDayMemories(d);
            const mem = dayMems[0]||null;
            const memCount = dayMems.length;
            const tod = isToday(d);
            const fut = isFuture(d);
            return(
              <button key={d} onClick={()=>!fut&&openDay(d)} style={{
                aspectRatio:"1",display:"flex",flexDirection:"column",alignItems:"center",
                justifyContent:"center",borderRadius:10,border:"none",cursor:fut?"default":"pointer",
                background: mem?"rgba(192,132,252,0.15)":tod?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.03)",
                outline: tod?"1px solid rgba(255,255,255,0.25)":mem?"1px solid rgba(192,132,252,0.4)":"1px solid transparent",
                transition:"all 0.15s",opacity:fut?0.3:1,
                position:"relative",
              }}
                onMouseEnter={e=>{ if(!fut) e.currentTarget.style.background=mem?"rgba(192,132,252,0.25)":"rgba(255,255,255,0.08)"; }}
                onMouseLeave={e=>e.currentTarget.style.background=mem?"rgba(192,132,252,0.15)":tod?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.03)"}
              >
                {mem?.photo?(
                  <img src={mem.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover",
                    borderRadius:9,position:"absolute",inset:0,opacity:0.6}}/>
                ):null}
                <span style={{fontSize:12,color:mem?"rgba(255,255,255,0.9)":tod?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.35)",
                  fontFamily:"'DM Sans',sans-serif",fontWeight:tod?700:400,
                  position:"relative",zIndex:1}}>{d}</span>
                {memCount>0&&<div style={{position:"absolute",bottom:3,zIndex:1,
                  display:"flex",gap:2,justifyContent:"center"}}>
                  {Array.from({length:Math.min(memCount,3)}).map((_,i)=>(
                    <div key={i} style={{width:3,height:3,borderRadius:"50%",background:"#C084FC"}}/>
                  ))}
                </div>}
              </button>
            );
          })}
        </div>
        <div style={{marginTop:12,display:"flex",alignItems:"center",gap:10,
          fontSize:10,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif"}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
            <span style={{width:8,height:8,borderRadius:2,background:"rgba(192,132,252,0.4)",display:"inline-block"}}/>
            has memory
          </span>
          <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
            <span style={{outline:"1px solid rgba(255,255,255,0.25)",width:8,height:8,borderRadius:2,display:"inline-block"}}/>
            today
          </span>
        </div>
      </div>

      {/* Recent memories list */}
      {memories.length>0&&(
        <div>
          <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
            color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginBottom:10}}>
            Recent Memories
          </p>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {memories.slice(0,10).map(m=>(
              <button key={m.id} onClick={()=>setSelected({date:m.date,memory:m})}
                style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
                  borderRadius:14,background:"rgba(255,255,255,0.025)",
                  border:"1px solid rgba(192,132,252,0.2)",cursor:"pointer",textAlign:"left",
                  transition:"all 0.15s"}}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(192,132,252,0.08)"}
                onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.025)"}
              >
                {m.photo?(
                  <img src={m.photo} alt="" style={{width:48,height:48,borderRadius:10,
                    objectFit:"cover",flexShrink:0,border:"1px solid rgba(192,132,252,0.3)"}}/>
                ):(
                  <div style={{width:48,height:48,borderRadius:10,flexShrink:0,
                    background:"rgba(192,132,252,0.1)",border:"1px solid rgba(192,132,252,0.2)",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>
                    {m.emoji||"📸"}
                  </div>
                )}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#F0F0F0",
                    fontFamily:"'Cormorant Garamond',serif",
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {m.title||"Memory"}
                  </div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",
                    fontFamily:"'DM Sans',sans-serif",marginTop:2}}>
                    {new Date(m.date+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}
                  </div>
                  {m.note&&<div style={{fontSize:11.5,color:"rgba(255,255,255,0.4)",
                    fontFamily:"'DM Sans',sans-serif",marginTop:2,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {m.note}
                  </div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Day modal */}
      {selected&&(
        <MemoryDayModal
          date={selected.date}
          dayMemories={selected.memories||[]}
          userId={user.id}
          onSave={async(mem)=>{
            await sb.upsertMemory({...mem,user_id:user.id});
            const updated = await sb.getMemories(user.id);
            setMemories(updated);
            // Keep modal open to allow adding more, just refresh
            setSelected(s=>({...s,memories:updated.filter(m=>m.date===s.date)}));
          }}
          onDelete={async(id)=>{
            await sb.deleteMemory(id);
            const updated = await sb.getMemories(user.id);
            setMemories(updated);
            setSelected(s=>({...s,memories:updated.filter(m=>m.date===s.date)}));
          }}
          onClose={()=>setSelected(null)}
        />
      )}
    </div>
  );
}

// ─── MEMORY DAY MODAL ─────────────────────────────────────────────────────────
function MemoryDayModal({ date, dayMemories=[], userId, onSave, onDelete, onClose }) {
  const [view, setView]     = useState("list");
  const [editing, setEditing] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(()=>{ requestAnimationFrame(()=>setVisible(true)); },[]);
  const close=()=>{ setVisible(false); setTimeout(onClose,250); };

  const displayDate = new Date(date+"T00:00:00").toLocaleDateString("en-US",
    {weekday:"long",month:"long",day:"numeric",year:"numeric"});

  return createPortal(
    <div style={{position:"fixed",inset:0,background:`rgba(0,0,0,${visible?0.75:0})`,
      backdropFilter:`blur(${visible?18:0}px)`,display:"flex",alignItems:"flex-end",
      justifyContent:"center",zIndex:9999,transition:"all 0.25s"}}
      onClick={e=>e.target===e.currentTarget&&close()}>
      <div style={{background:"linear-gradient(160deg,#111114,#0C0C0F)",
        borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,0.09)",borderBottom:"none",
        width:"100%",maxWidth:560,padding:"12px 24px 52px",
        display:"flex",flexDirection:"column",gap:16,
        transform:visible?"translateY(0)":"translateY(100%)",
        transition:"transform 0.3s cubic-bezier(0.34,1.1,0.64,1)",
        maxHeight:"85vh",overflowY:"auto",WebkitOverflowScrolling:"touch"}}>
        <div style={{width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.1)",margin:"8px auto 0",flexShrink:0}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            {(view==="add"||view==="edit")&&(
              <button onClick={()=>setView("list")} style={{background:"none",border:"none",
                cursor:"pointer",color:"rgba(255,255,255,0.4)",fontSize:12,
                fontFamily:"'DM Sans',sans-serif",padding:"0 0 4px",display:"flex",alignItems:"center",gap:4}}>
                <Icon d={Icons.back} size={13}/> Back
              </button>
            )}
            <h2 style={{margin:0,fontSize:17,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",color:"#F2F2F2"}}>
              {displayDate}
            </h2>
            <p style={{margin:"2px 0 0",fontSize:11,color:"rgba(192,132,252,0.6)",fontFamily:"'DM Sans',sans-serif"}}>
              {dayMemories.length} moment{dayMemories.length!==1?"s":""}
            </p>
          </div>
          <button onClick={close} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",
            borderRadius:10,padding:"7px 8px",cursor:"pointer",color:"rgba(255,255,255,0.4)"}}>
            <Icon d={Icons.x} size={16}/>
          </button>
        </div>

        {view==="list"&&(
          <>
            {dayMemories.length===0&&(
              <div style={{textAlign:"center",padding:"20px 0",color:"rgba(255,255,255,0.2)",
                fontSize:14,fontFamily:"'DM Sans',sans-serif"}}>No moments yet. Add your first!</div>
            )}
            {dayMemories.map(m=>(
              <div key={m.id} style={{background:"rgba(192,132,252,0.06)",
                border:"1px solid rgba(192,132,252,0.15)",borderRadius:14,overflow:"hidden"}}>
                {m.photo&&<img src={m.photo} alt="" style={{width:"100%",height:140,objectFit:"cover",display:"block"}}/>}
                <div style={{padding:"12px 14px",display:"flex",alignItems:"flex-start",gap:10}}>
                  {m.emoji&&<span style={{fontSize:20,flexShrink:0}}>{m.emoji}</span>}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#F0F0F0",fontFamily:"'Cormorant Garamond',serif"}}>{m.title||"Moment"}</div>
                    {m.note&&<div style={{fontSize:12.5,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif",marginTop:3,lineHeight:1.5}}>{m.note}</div>}
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    <button onClick={()=>{setEditing(m);setView("edit");}} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:7,padding:"5px 7px",cursor:"pointer",color:"rgba(255,255,255,0.4)"}}>
                      <Icon d={Icons.edit} size={13}/>
                    </button>
                    <button onClick={()=>onDelete(m.id)} style={{background:"rgba(255,80,80,0.08)",border:"1px solid rgba(255,80,80,0.2)",borderRadius:7,padding:"5px 7px",cursor:"pointer",color:"rgba(255,120,120,0.6)"}}>
                      <Icon d={Icons.trash} size={13}/>
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button onClick={()=>{setEditing(null);setView("add");}} style={{
              display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"13px",
              borderRadius:14,border:"1px dashed rgba(192,132,252,0.3)",
              background:"rgba(192,132,252,0.06)",color:"rgba(192,132,252,0.8)",
              cursor:"pointer",fontSize:14,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>
              <Icon d={Icons.plus} size={15} stroke="currentColor"/> Add Moment
            </button>
          </>
        )}

        {(view==="add"||view==="edit")&&(
          <MemoryForm
            initial={view==="edit"?editing:null}
            date={date}
            onSave={async(mem)=>{ await onSave(mem); setView("list"); }}
          />
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── MEMORY FORM ─────────────────────────────────────────────────────────────
function MemoryForm({ initial, date, onSave }) {
  const [title,setTitle] = useState(initial?.title||"");
  const [note,setNote]   = useState(initial?.note||"");
  const [photo,setPhoto] = useState(initial?.photo||null);
  const [emoji,setEmoji] = useState(initial?.emoji||"");
  const [saving,setSaving] = useState(false);
  const QUICK = ["😊","🥳","😔","🌟","❤","🔥","🌙","✈","🍕","🎵","💪","🤝","🌿","🎉","🫂"];
  const handlePhoto=(e)=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=(ev)=>setPhoto(ev.target.result);r.readAsDataURL(f);};
  const inp={width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"11px 14px",color:"#F0F0F0",fontSize:14,outline:"none",fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box"};
  const lbl={fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginBottom:7,display:"block"};
  const save=async()=>{setSaving(true);await onSave({id:initial?.id||crypto.randomUUID(),date,title:title.trim()||"Moment",note:note.trim(),photo,emoji,created_at:initial?.created_at||new Date().toISOString()});setSaving(false);};
  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div><label style={lbl}>Vibe</label>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {QUICK.map(e=><button key={e} onClick={()=>setEmoji(emoji===e?"":e)} style={{fontSize:20,padding:"6px",borderRadius:8,border:"none",cursor:"pointer",background:emoji===e?"rgba(192,132,252,0.2)":"rgba(255,255,255,0.04)",outline:emoji===e?"1px solid rgba(192,132,252,0.5)":"none",transition:"all 0.1s"}}>{e}</button>)}
        </div>
      </div>
      <div><label style={lbl}>Title</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="What happened?" style={inp}/></div>
      <div><label style={lbl}>Note</label><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="A few words…" rows={3} style={{...inp,resize:"vertical",lineHeight:1.6}}/></div>
      <div><label style={lbl}>Photo</label>
        {photo?(
          <div style={{position:"relative",borderRadius:12,overflow:"hidden",border:"1px solid rgba(255,255,255,0.1)"}}>
            <img src={photo} alt="" style={{width:"100%",display:"block",maxHeight:160,objectFit:"cover"}}/>
            <button onClick={()=>setPhoto(null)} style={{position:"absolute",top:8,right:8,background:"rgba(0,0,0,0.7)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,padding:"4px 10px",cursor:"pointer",color:"#fff",fontSize:12}}>Remove</button>
          </div>
        ):(
          <label style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderRadius:12,cursor:"pointer",background:"rgba(255,255,255,0.04)",border:"1px dashed rgba(255,255,255,0.12)"}}>
            <Icon d={Icons.camera} size={16} stroke="rgba(255,255,255,0.4)"/>
            <span style={{fontSize:13,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif"}}>Add photo</span>
            <input type="file" accept="image/*" style={{display:"none"}} onChange={handlePhoto}/>
          </label>
        )}
      </div>
      <button onClick={save} disabled={saving} style={{padding:"14px",borderRadius:12,background:"linear-gradient(135deg,#C084FC,#818CF8)",color:"#fff",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"'DM Sans',sans-serif",opacity:saving?0.7:1}}>
        {saving?"Saving…":initial?"Update Moment":"Save Moment"}
      </button>
    </div>
  );
}


// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode]       = useState("signin"); // signin | signup
  const [email, setEmail]     = useState("");
  const [name, setName]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);

  const submit = async () => {
    if(!email.trim()) { setError("Please enter your email."); return; }
    if(!password.trim()) { setError("Please enter your password."); return; }
    if(password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if(mode==="signup"&&!name.trim()){ setError("Please enter your name."); return; }
    setLoading(true); setError("");
    try {
      if(mode==="signup") {
        const d = await sb.signUp(email.trim(), password, name.trim());
        // If we got a token back, confirmation is off — log them in directly
        if(d.access_token) {
          onAuth({ id: d.user?.id||sb.getUser()?.id, email: email.trim() });
        } else {
          setDone(true); // confirmation email sent
        }
      } else {
        const d = await sb.signIn(email.trim(), password);
        onAuth({ id: d.user?.id||sb.getUser()?.id, email: email.trim() });
      }
    } catch(e) {
      setError(e.message||"Something went wrong. Try again.");
    }
    setLoading(false);
  };

  const inp = {
    width:"100%", background:"rgba(255,255,255,0.05)",
    border:"1px solid rgba(255,255,255,0.12)", borderRadius:14,
    padding:"14px 16px", color:"#F0F0F0", fontSize:15, outline:"none",
    fontFamily:"'DM Sans',sans-serif", boxSizing:"border-box",
    transition:"border-color 0.2s",
  };

  if(done) return (
    <div style={{minHeight:"100vh",background:"#08080A",display:"flex",alignItems:"center",
      justifyContent:"center",padding:24,fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{maxWidth:360,width:"100%",textAlign:"center",animation:"cardIn 0.5s ease both"}}>
        <div style={{fontSize:56,marginBottom:20}}>📬</div>
        <h2 style={{fontSize:22,fontWeight:700,color:"#F2F2F2",fontFamily:"'Cormorant Garamond',serif",marginBottom:12}}>
          Check your email
        </h2>
        <p style={{fontSize:14,color:"rgba(255,255,255,0.4)",lineHeight:1.7,marginBottom:24}}>
          We sent a confirmation link to <strong style={{color:"rgba(255,255,255,0.7)"}}>{email}</strong>.
          Click it to activate your account, then come back and sign in.
        </p>
        <button onClick={()=>{setDone(false);setMode("signin");}} style={{
          padding:"13px 28px",borderRadius:14,border:"1px solid rgba(255,255,255,0.12)",
          background:"rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.7)",
          cursor:"pointer",fontSize:14,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>
          Back to Sign In
        </button>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#08080A",display:"flex",alignItems:"center",
      justifyContent:"center",padding:24,fontFamily:"'DM Sans',sans-serif",position:"relative",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes cardIn{from{opacity:0;transform:translateY(20px) scale(0.97);}to{opacity:1;transform:translateY(0) scale(1);}}
        @keyframes orb1{0%,100%{transform:translate(0,0);}50%{transform:translate(40px,-30px);}}
        @keyframes orb2{0%,100%{transform:translate(0,0);}50%{transform:translate(-30px,40px);}}
      `}</style>

      {/* Orbs */}
      <div style={{position:"fixed",inset:0,pointerEvents:"none",overflow:"hidden"}}>
        <div style={{position:"absolute",width:500,height:500,borderRadius:"50%",
          background:"radial-gradient(circle,rgba(192,132,252,0.08) 0%,transparent 70%)",
          top:-100,left:-100,animation:"orb1 12s ease-in-out infinite"}}/>
        <div style={{position:"absolute",width:600,height:600,borderRadius:"50%",
          background:"radial-gradient(circle,rgba(168,255,120,0.06) 0%,transparent 70%)",
          bottom:-200,right:-100,animation:"orb2 16s ease-in-out infinite"}}/>
      </div>

      <div style={{maxWidth:380,width:"100%",animation:"cardIn 0.5s cubic-bezier(0.34,1.2,0.64,1) both",position:"relative",zIndex:1}}>

        {/* Logo area */}
        <div style={{textAlign:"center",marginBottom:40}}>
          <div style={{fontSize:42,marginBottom:12}}>⚔</div>
          <h1 style={{fontSize:32,fontWeight:700,letterSpacing:"-0.03em",
            fontFamily:"'Cormorant Garamond',serif",
            background:"linear-gradient(135deg,#F2F2F2,rgba(242,242,242,0.5))",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:6}}>
            Side Quests
          </h1>
          <p style={{fontSize:13,color:"rgba(255,255,255,0.3)"}}>
            {mode==="signin"?"Welcome back, adventurer.":"Begin your journey."}
          </p>
        </div>

        {/* Card */}
        <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.09)",
          borderRadius:24,padding:"28px 24px",display:"flex",flexDirection:"column",gap:16}}>

          {/* Mode indicator */}
          <div style={{display:"flex",background:"rgba(255,255,255,0.04)",borderRadius:12,padding:4,gap:4}}>
            {["signin","signup"].map(m=>(
              <button key={m} onClick={()=>{setMode(m);setError("");setName("");}} style={{
                flex:1,padding:"9px",borderRadius:9,border:"none",cursor:"pointer",
                background:mode===m?"rgba(255,255,255,0.1)":"transparent",
                color:mode===m?"#F0F0F0":"rgba(255,255,255,0.35)",
                fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif",
                transition:"all 0.2s",
              }}>{m==="signin"?"Sign In":"Sign Up"}</button>
            ))}
          </div>

          {/* Inputs */}
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {mode==="signup"&&(
              <input value={name} onChange={e=>setName(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&submit()}
                type="text" placeholder="Your name (can't be changed later)" style={inp}
                onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.3)"}
                onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.12)"}/>
            )}
            <input value={email} onChange={e=>setEmail(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&submit()}
              type="email" placeholder="Email address" style={inp}
              onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.3)"}
              onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.12)"}/>
            <input value={password} onChange={e=>setPassword(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&submit()}
              type="password" placeholder="Password" style={inp}
              onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.3)"}
              onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.12)"}/>
          </div>

          {/* Error */}
          {error&&(
            <div style={{padding:"10px 14px",borderRadius:10,background:"rgba(255,100,100,0.08)",
              border:"1px solid rgba(255,100,100,0.2)",fontSize:12.5,
              color:"rgba(255,150,150,0.9)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.5}}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button onClick={submit} disabled={loading||!email.trim()||!password.trim()} style={{
            background: email.trim()&&password.trim()
              ? "linear-gradient(135deg,#e8e8e8,#ffffff)"
              : "rgba(255,255,255,0.07)",
            color: email.trim()&&password.trim() ? "#0A0A0C" : "rgba(255,255,255,0.2)",
            border:"none",borderRadius:14,padding:"15px",
            fontSize:15,fontWeight:700,cursor:"pointer",
            fontFamily:"'DM Sans',sans-serif",
            transition:"all 0.2s",opacity:loading?0.7:1,
          }}>
            {loading ? "…" : mode==="signin" ? "Sign In" : "Create Account"}
          </button>
        </div>

        <p style={{textAlign:"center",marginTop:16,fontSize:12,color:"rgba(255,255,255,0.25)",
          fontFamily:"'DM Sans',sans-serif",lineHeight:1.6}}>
          {mode==="signin"?(
            <>Don't have an account?{" "}
              <span onClick={()=>{setMode("signup");setError("");}}
                style={{color:"rgba(255,255,255,0.6)",cursor:"pointer",fontWeight:600,textDecoration:"underline"}}>
                Sign Up
              </span>
            </>
          ):(
            <>Already have an account?{" "}
              <span onClick={()=>{setMode("signin");setError("");}}
                style={{color:"rgba(255,255,255,0.6)",cursor:"pointer",fontWeight:600,textDecoration:"underline"}}>
                Sign In
              </span>
            </>
          )}
        </p>
        <p style={{textAlign:"center",marginTop:8,fontSize:11,color:"rgba(255,255,255,0.15)",fontFamily:"'DM Sans',sans-serif"}}>
          Your quests are private and only visible to you.
        </p>
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [user,setUser]           = useState(undefined);

  const [quests,setQuests]       = useState([]);
  const [members,setMembers]     = useState([]);
  const [boards,setBoards]       = useState([]);
  const [friends,setFriends]     = useState([]);
  const [friendRequestCount,setFriendRequestCount] = useState(0);
  const [activeBoard,setActiveBoard] = useState(null); // board being viewed
  const [inviteBoard,setInviteBoard] = useState(null); // board to show invite modal for
  const [showCreateBoard,setShowCreateBoard] = useState(false);
  const [inviteCode,setInviteCode] = useState(null); // ?join=xxx from URL
  const [filter,setFilter]       = useState("All");
  const [tab,setTab]             = useState("quests");
  const [questModal,setQuestModal]   = useState(null);
  const [memberModal,setMemberModal] = useState(null);
  const [deleteTarget,setDeleteTarget] = useState(null);
  const [memberDetail,setMemberDetail] = useState(null);
  const [mounted,setMounted]     = useState(false);
  const [syncing,setSyncing]     = useState(false);

  // ── Boot: check existing session + invite code ────────────────────────────
  useEffect(()=>{
    setMounted(true);
    // Check for invite code in URL
    const params = new URLSearchParams(window.location.search);
    const code = params.get("join");
    if(code) setInviteCode(code);

    const token = localStorage.getItem("sq_token");
    if(token){
      try{
        const payload = JSON.parse(atob(token.split(".")[1]));
        if(payload.exp * 1000 > Date.now()){
          const u = { id: payload.sub, email: payload.email };
          sb._token = token;
          setUser(u);
          loadData(u.id);
          return;
        }
      } catch(e){ console.log("token parse failed", e); }
    }
    setUser(null);
  },[]);

  const ensureUserMember = async(userId, email, existingMembers) => {
    // Get name from auth metadata (set at signup) or localStorage cache
    const authName = sb.getUser()?.name
      || localStorage.getItem("sq_name")
      || email.split("@")[0];

    const existing = existingMembers.find(m => m.user_id === userId);
    if(existing) {
      // Update name from auth metadata if it changed
      if(existing.name !== authName && authName !== email.split("@")[0]) {
        const updated = {...existing, name:authName, display_name:authName};
        try { await sb.upsert("members", updated); } catch{}
        return existingMembers.map(m=>m.user_id===userId?updated:m);
      }
      return existingMembers;
    }
    // Create member record with auth name
    const member = {
      id: crypto.randomUUID(),
      name: authName,
      display_name: authName,
      email,
      user_id: userId,
      note: "Account owner",
      created_at: new Date().toISOString(),
    };
    try { await sb.upsert("members", member); } catch(e){ console.error(e); }
    return [member, ...existingMembers];
  };

  const loadData = async(userId) => {
    setSyncing(true);
    try {
      const [q,m,b] = await Promise.all([
        sb.getAll("quests", userId),
        sb.getAll("members", userId),
        sb.getMyBoards(userId),
      ]);
      const questList = Array.isArray(q)?q:[];
      const boardList = Array.isArray(b)?b:[];
      // Also load board quests so shared tab works
      const boardQuestLists = await Promise.all(
        boardList.map(board=>sb.getBoardQuests(board.id).catch(()=>[]))
      );
      const boardQuests = boardQuestLists.flat();
      const allQuests = [...questList, ...boardQuests.filter(bq=>!questList.find(pq=>pq.id===bq.id))];
      setQuests(allQuests);
      setBoards(boardList);
      setSyncing(false);
      // Ensure current user has a member profile
      const memberList = Array.isArray(m)?m:[];
      const updatedMembers = await ensureUserMember(userId, sb.getUser()?.email||"", memberList);
      setMembers(updatedMembers);
      // Load friends
      try {
        const fd = await sb.getFriendProfiles(userId);
        setFriends(fd.friends||[]);
      } catch(e) { console.error("friends load",e); }
    } catch(e) {
      console.error("loadData failed",e);
      setSyncing(false);
    }
  };

  const handleAuth = (u) => {
    setUser(u);
    // Small delay to ensure token is stored before fetching
    setTimeout(()=>loadData(u.id), 100);
  };

  const handleSignOut = async () => {
    await sb.signOut();
    setUser(null);
    setQuests([]);
    setMembers([]);
  };

  const saveQuest=async(q)=>{
    const withUser = {...q, user_id: user?.id};
    const next=quests.find(x=>x.id===q.id)?quests.map(x=>x.id===q.id?withUser:x):[withUser,...quests];
    setQuests(next);setQuestModal(null);
    try{await sb.upsert("quests",withUser);}catch(e){console.error(e);}
  };
  const deleteQuest=async()=>{
    const next=quests.filter(q=>q.id!==deleteTarget.id);
    setQuests(next);setDeleteTarget(null);
    try{await sb.delete("quests",deleteTarget.id);}catch(e){console.error(e);}
  };
  const saveMember=async(m)=>{
    const withUser = {...m, user_id: user?.id};
    const next=members.find(x=>x.id===m.id)?members.map(x=>x.id===m.id?withUser:x):[withUser,...members];
    setMembers(next);setMemberModal(null);
    try{await sb.upsert("members",withUser);}catch(e){console.error(e);}
  };
  const deleteMember=async()=>{
    const next=members.filter(m=>m.id!==deleteTarget.id);
    setMembers(next);setDeleteTarget(null);
    try{await sb.delete("members",deleteTarget.id);}catch(e){console.error(e);}
  };

  const deleteBoard = async(boardId) => {
    setBoards(prev=>prev.filter(b=>b.id!==boardId));
    setDeleteTarget({id:boardId, type:"board"});
  };

  const confirmDeleteBoard = async() => {
    const boardId = deleteTarget.id;
    try {
      await sb.delete("boards", boardId);
    } catch(e) { console.error(e); }
    setBoards(prev=>prev.filter(b=>b.id!==boardId));
    setDeleteTarget(null);
  };

  const createBoard = async(name, description) => {
    const invite_code = Math.random().toString(36).slice(2,8).toUpperCase();
    const board = { id:crypto.randomUUID(), name, description, created_by:user.id, invite_code };
    try {
      await sb.createBoard(board);
      setBoards(prev=>[board,...prev]);
      setShowCreateBoard(false);
      setActiveBoard(board);
      setTab("boards");
    } catch(e) { console.error("createBoard failed",e); }
  };

  const saveBoardQuest = async(q, isBoard=false) => {
    try { await sb.upsert("quests", q); } catch(e) { console.error(e); }
  };

  const deleteBoardQuest = async(id) => {
    try { await sb.delete("quests", id); } catch(e) { console.error(e); }
  };

  const handleJoinedBoard = (board) => {
    setBoards(prev=>[...prev.filter(b=>b.id!==board.id), board]);
    setInviteCode(null);
    setActiveBoard(board);
    setTab("boards");
    // Clear URL
    window.history.replaceState({}, "", window.location.pathname);
  };

  const [questScope, setQuestScope] = useState("personal"); // "personal" | "shared"
  const personalQuests = quests.filter(q=>!q.board_id);
  // Shared quests = quests that belong to any board the user is in
  const sharedQuests = quests.filter(q=>!!q.board_id);
  const scopedQuests = questScope==="personal" ? personalQuests : sharedQuests;
  const filtered = filter==="All" ? scopedQuests : scopedQuests.filter(q=>q.status===filter);
  const counts=STATUSES.reduce((acc,s)=>({...acc,[s]:scopedQuests.filter(q=>q.status===s).length}),{});
  const completedCount=personalQuests.filter(q=>q.status==="Completed").length;

  const userXP = calcXP(quests);
  const userRank = getRank(userXP);

  // Poll for friend requests every 15s to show badge
  useEffect(()=>{
    if(!user) return;
    const check = async()=>{
      try {
        const ships = await sb.getFriendships(user.id);
        const incoming = ships.filter(s=>s.status==="pending"&&s.to_id===user.id);
        setFriendRequestCount(incoming.length);
      } catch{}
    };
    check();
    const iv = setInterval(check, 15000);
    return ()=>clearInterval(iv);
  },[user]);

  const TABS=[
    {id:"quests",   label:"Quests",   icon:Icons.shield, count:personalQuests.length},
    {id:"boards",   label:"Boards",   icon:Icons.board,  count:boards.length},
    {id:"friends",  label:"Friends",  icon:Icons.users,  count:friendRequestCount},
    {id:"completed",label:"Done",     icon:Icons.check,  count:completedCount},
    {id:"memories", label:"Memories", icon:Icons.camera, count:0},
    {id:"calendar", label:"Calendar", icon:Icons.cal,    count:0},
    {id:"profile",  label:"Profile",  icon:Icons.user,   count:0},
  ];

  // Invite code gate — show join screen before main app if URL has ?join=
  if(user && inviteCode) return (
    <JoinBoardScreen
      inviteCode={inviteCode}
      user={user}
      onJoined={handleJoinedBoard}
      onSkip={()=>{ setInviteCode(null); window.history.replaceState({},"",window.location.pathname); }}
    />
  );

  // Auth gate
  if(user===undefined) return (
    <div style={{minHeight:"100vh",background:"#08080A",display:"flex",alignItems:"center",
      justifyContent:"center",flexDirection:"column",gap:16}}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg);}}
        body{background:#08080A;}
      `}</style>
      <div style={{width:32,height:32,border:"2px solid rgba(255,255,255,0.1)",
        borderTopColor:"rgba(255,255,255,0.5)",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
      <p style={{color:"rgba(255,255,255,0.3)",fontSize:13,fontFamily:"sans-serif"}}>Loading…</p>
    </div>
  );
  if(!user) return <AuthScreen onAuth={handleAuth}/>;

  return(
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

      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,overflow:"hidden"}}>
        <div style={{position:"absolute",width:500,height:500,borderRadius:"50%",background:"radial-gradient(circle,rgba(168,255,120,0.05) 0%,transparent 70%)",top:-100,left:-100,animation:"orb1 12s ease-in-out infinite"}}/>
        <div style={{position:"absolute",width:600,height:600,borderRadius:"50%",background:"radial-gradient(circle,rgba(192,132,252,0.04) 0%,transparent 70%)",bottom:-200,right:-100,animation:"orb2 16s ease-in-out infinite"}}/>
      </div>

      <header style={{position:"sticky",top:0,zIndex:10,background:"rgba(8,8,10,0.85)",backdropFilter:"blur(24px)",borderBottom:"1px solid rgba(255,255,255,0.05)",padding:"44px 24px 0"}}>
        <div style={{maxWidth:560,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
            <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.16em",textTransform:"uppercase",color:"rgba(255,255,255,0.2)"}}>Your Life</p>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              {syncing&&(
                <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"rgba(255,212,120,0.7)",fontFamily:"'DM Sans',sans-serif"}}>
                  <Icon d={Icons.cloud} size={11} stroke="currentColor"/> Syncing…
                </div>
              )}
              <button onClick={()=>setTab("profile")} style={{
                display:"flex",alignItems:"center",gap:6,
                background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",
                borderRadius:8,padding:"4px 10px 4px 6px",cursor:"pointer",transition:"all 0.15s",
              }}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.08)"}
                onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
              >
                <div style={{width:22,height:22,borderRadius:6,
                  background:`radial-gradient(circle at 35% 35%,${getRank(calcXP(quests)).color}40,${getRank(calcXP(quests)).color}10)`,
                  border:`1.5px solid ${getRank(calcXP(quests)).color}50`,
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>
                  {getCharacter(members.find(m=>m.user_id===user?.id)?.name||"?").avatar}
                </div>
                <span style={{fontSize:10,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif",
                  maxWidth:80,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {sb.getUser()?.name||localStorage.getItem("sq_name")||user?.email?.split("@")[0]||"Profile"}
                </span>
              </button>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
            <h1 style={{fontSize:30,fontWeight:700,letterSpacing:"-0.03em",margin:0,fontFamily:"'Cormorant Garamond',serif",background:"linear-gradient(135deg,#F2F2F2 0%,rgba(242,242,242,0.5) 100%)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Side Quests</h1>
            <div style={{flexShrink:0,cursor:"pointer"}} onClick={()=>setTab("friends")}>
              <RankBadge xp={userXP} size="sm"/>
            </div>
          </div>
          <div style={{display:"flex",gap:0,borderBottom:"1px solid rgba(255,255,255,0.06)",overflowX:"auto"}}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>{setTab(t.id);setMemberDetail(null);}} style={{
                display:"flex",alignItems:"center",gap:6,flexShrink:0,padding:"10px 14px 12px",
                background:"none",border:"none",borderBottom:`2px solid ${tab===t.id?"rgba(255,255,255,0.6)":"transparent"}`,
                color:tab===t.id?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.3)",
                cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",transition:"all 0.2s",marginBottom:-1,
              }}>
                <Icon d={t.icon} size={13} stroke="currentColor"/>{t.label}
                {t.count>0&&<span style={{fontSize:10,opacity:0.5,marginLeft:1}}>{t.count}</span>}
              </button>
            ))}
          </div>
          {tab==="quests"&&(
            <div style={{paddingTop:14,paddingBottom:2}}>
              {/* Personal / Shared scope toggle */}
              <div style={{display:"flex",background:"rgba(255,255,255,0.04)",borderRadius:12,padding:3,gap:3,marginBottom:10}}>
                {[
                  {id:"personal",label:"Personal",count:personalQuests.length},
                  {id:"shared",  label:"Shared",  count:sharedQuests.length},
                ].map(s=>(
                  <button key={s.id} onClick={()=>{setQuestScope(s.id);setFilter("All");}} style={{
                    flex:1, padding:"7px 12px", borderRadius:9, border:"none", cursor:"pointer",
                    background:questScope===s.id?"rgba(255,255,255,0.1)":"transparent",
                    color:questScope===s.id?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.3)",
                    fontSize:12, fontWeight:600, fontFamily:"'DM Sans',sans-serif",
                    transition:"all 0.2s", display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                  }}>
                    {s.label}
                    <span style={{fontSize:10,opacity:0.5,background:"rgba(255,255,255,0.08)",
                      padding:"1px 6px",borderRadius:8}}>{s.count}</span>
                  </button>
                ))}
              </div>
              {/* Status filter pills */}
              <div style={{display:"flex",gap:7,overflowX:"auto",paddingBottom:2}}>
                {["All",...STATUSES].map(s=>{
                  const active=filter===s;
                  const count=s==="All"?scopedQuests.length:counts[s];
                  const color=s==="All"?"#F0F0F0":STATUS_META[s]?.color;
                  const glow=s!=="All"?STATUS_META[s]?.glow:null;
                  return<button key={s} onClick={()=>setFilter(s)} style={{
                    flexShrink:0,padding:"5px 13px",borderRadius:20,fontSize:11.5,fontWeight:600,
                    cursor:"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",
                    border:`1px solid ${active?color:"rgba(255,255,255,0.09)"}`,
                    background:active?`${color}15`:"transparent",color:active?color:"rgba(255,255,255,0.3)",
                    boxShadow:active&&glow?`0 0 14px ${glow}`:"none",transform:active?"scale(1.04)":"scale(1)",
                    transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)",marginBottom:14,
                  }}>{s}{count>0&&<span style={{opacity:0.5,marginLeft:5,fontSize:10}}>{count}</span>}</button>;
                })}
              </div>
            </div>
          )}
          {tab!=="quests"&&<div style={{height:14}}/>}
        </div>
      </header>

      <main style={{position:"relative",zIndex:1}}>
        {tab==="quests"&&(
          <div style={{maxWidth:560,margin:"20px auto 0",padding:"0 24px"}}>
            <StatsBar quests={quests}/>
            {syncing?(
              <div style={{textAlign:"center",padding:"60px 0"}}>
                <div style={{width:24,height:24,border:"2px solid rgba(255,255,255,0.1)",borderTopColor:"rgba(255,255,255,0.5)",borderRadius:"50%",animation:"spin 0.8s linear infinite",margin:"0 auto 12px"}}/>
                <p style={{fontSize:14,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>Loading…</p>
              </div>
            ):filtered.length===0?(
              <div style={{textAlign:"center",padding:"80px 0",animation:"cardIn 0.5s ease both"}}>
                <div style={{fontSize:48,marginBottom:16,opacity:0.12}}>⚔</div>
                <p style={{fontSize:15,color:"rgba(255,255,255,0.18)",lineHeight:1.7}}>{filter==="All"?"No quests yet.\nBegin your journey.":`No ${filter} quests.`}</p>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {filtered.map((q,i)=>(
                  <QuestCard key={q.id} quest={q} members={members} index={i}
                    onEdit={q=>setQuestModal(q)} onDelete={id=>setDeleteTarget({id,type:"quest"})}/>
                ))}
              </div>
            )}

          </div>
        )}

        {/* BOARDS TAB */}
        {tab==="boards"&&!activeBoard&&(
          <div style={{maxWidth:560,margin:"0 auto",padding:"20px 24px 0"}}>
            <div style={{marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",
                  color:"rgba(255,255,255,0.2)",marginBottom:4}}>Shared</p>
                <h2 style={{fontSize:24,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",
                  background:"linear-gradient(135deg,#F2F2F2,rgba(242,242,242,0.5))",
                  WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Boards</h2>
              </div>
              <button onClick={()=>setShowCreateBoard(true)} style={{display:"flex",alignItems:"center",gap:7,
                padding:"10px 16px",borderRadius:14,border:"1px solid rgba(255,255,255,0.1)",
                background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.7)",
                cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>
                <Icon d={Icons.plus} size={14}/> New Board
              </button>
            </div>
            {boards.length===0 ? (
              <div style={{textAlign:"center",padding:"60px 0",animation:"cardIn 0.5s ease both"}}>
                <div style={{fontSize:48,marginBottom:16,opacity:0.15}}>🗺</div>
                <p style={{fontSize:15,color:"rgba(255,255,255,0.18)",lineHeight:1.7,marginBottom:20}}>
                  No boards yet.<br/>Create one or join via an invite link.
                </p>
                <button onClick={()=>setShowCreateBoard(true)} style={{padding:"12px 24px",borderRadius:14,
                  background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",
                  color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:14,fontWeight:600,
                  fontFamily:"'DM Sans',sans-serif"}}>Create your first board</button>
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {boards.map(board=>{
                  const bqCount = quests.filter(q=>q.board_id===board.id).length;
                  return(
                    <BoardCard key={board.id} board={board} questCount={bqCount}
                      onClick={()=>setActiveBoard(board)}
                      onDelete={()=>setDeleteTarget({id:board.id,type:"board"})}/>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab==="boards"&&activeBoard&&(
          <div style={{position:"relative"}}>
            <BoardDetailPage
              board={activeBoard} user={user} members={members}
              allQuests={quests} friends={friends}
              onBack={()=>setActiveBoard(null)}
              onSaveQuest={saveBoardQuest}
              onDeleteQuest={deleteBoardQuest}
              onInvite={()=>setInviteBoard(activeBoard)}
            />
          </div>
        )}

        {tab==="party"&&!memberDetail&&(
          <div style={{maxWidth:560,margin:"0 auto",padding:"20px 24px 0"}}>
            <div style={{marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(255,255,255,0.2)",marginBottom:4}}>Your Crew</p>
                <h2 style={{fontSize:24,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",background:"linear-gradient(135deg,#F2F2F2,rgba(242,242,242,0.5))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Party Members</h2>
              </div>
              <button onClick={()=>setMemberModal({...EMPTY_MEMBER})} style={{display:"flex",alignItems:"center",gap:7,padding:"10px 16px",borderRadius:14,border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.7)",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>
                <Icon d={Icons.plus} size={14}/> Add
              </button>
            </div>
            {members.length===0?(
              <div style={{textAlign:"center",padding:"60px 0",animation:"cardIn 0.5s ease both"}}>
                <div style={{fontSize:48,marginBottom:16,opacity:0.15}}>🧙</div>
                <p style={{fontSize:15,color:"rgba(255,255,255,0.18)",lineHeight:1.7}}>No party members yet.<br/>Add your companions.</p>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {members.map((m,i)=>(
                  <div key={m.id} style={{animation:`cardIn 0.4s ease ${i*0.06}s both`}}>
                    <MemberCard member={m} quests={quests} onClick={()=>setMemberDetail(m)}
                      onEdit={()=>setMemberModal(m)} onDelete={id=>setDeleteTarget({id,type:"member"})}/>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab==="party"&&memberDetail&&(
          <MemberDetailPage member={memberDetail} quests={quests}
            onBack={()=>setMemberDetail(null)}
            onEdit={m=>{setMemberModal(m);setMemberDetail(null);}}/>
        )}

        {tab==="friends"&&(
          <FriendsPage user={user} quests={quests} onFriendsLoaded={f=>setFriends(f)}/>
        )}

        {tab==="memories"&&(
          <MemoriesPage user={user}/>
        )}

        {tab==="profile"&&(
          <ProfilePage
            user={user}
            quests={quests}
            onSignOut={handleSignOut}
            onNameChange={(n)=>{
              // Update members list with new name
              setMembers(prev=>prev.map(m=>m.user_id===user.id?{...m,name:n,display_name:n}:m));
            }}
          />
        )}

        {tab==="completed"&&(
          <div style={{maxWidth:560,margin:"20px auto 0",padding:"0 24px"}}>
            <div style={{marginBottom:16}}>
              <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(255,255,255,0.2)",marginBottom:4}}>Hall of Fame</p>
              <h2 style={{fontSize:24,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",background:"linear-gradient(135deg,#F2F2F2,rgba(242,242,242,0.5))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Completed Quests</h2>
            </div>
            <CompletedTab quests={quests} onEdit={q=>setQuestModal(q)}/>
          </div>
        )}

        {tab==="calendar"&&(
          <div style={{maxWidth:560,margin:"20px auto 0",padding:"0 24px"}}>
            <div style={{marginBottom:16}}>
              <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(255,255,255,0.2)",marginBottom:4}}>Your Journey</p>
              <h2 style={{fontSize:24,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",background:"linear-gradient(135deg,#F2F2F2,rgba(242,242,242,0.5))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Streak Calendar</h2>
            </div>
            <StreakCalendar quests={quests}/>
            {quests.filter(q=>q.status==="Completed"&&q.completed_at).length>0&&(
              <div>
                <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginBottom:12}}>Completed Timeline</p>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {quests.filter(q=>q.status==="Completed"&&q.completed_at)
                    .sort((a,b)=>new Date(b.completed_at)-new Date(a.completed_at))
                    .map((q,i)=>{
                      const p=getPalette(q.id);
                      return(
                        <div key={q.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:14,background:"rgba(255,255,255,0.025)",border:`1px solid ${p.color}20`,animation:`cardIn 0.4s ease ${i*0.05}s both`}}>
                          <div style={{fontSize:24}}>🔥</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:14,fontWeight:700,color:"#F0F0F0",fontFamily:"'Cormorant Garamond',serif",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                              {q.emoji&&<span style={{marginRight:6}}>{q.emoji}</span>}{q.title}
                            </div>
                            <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Sans',sans-serif",marginTop:2}}>
                              {new Date(q.completed_at).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"})}
                            </div>
                          </div>
                          {q.photo&&<img src={q.photo} alt="" style={{width:40,height:40,borderRadius:8,objectFit:"cover",border:`1px solid ${p.color}30`,flexShrink:0}}/>}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {(tab==="quests"||tab==="party"||tab==="boards")&&!activeBoard&&(
        <button onClick={()=>{
          if(tab==="quests") setQuestModal({...EMPTY_QUEST});
          else if(tab==="party") setMemberModal({...EMPTY_MEMBER});
          else if(tab==="boards") setShowCreateBoard(true);
        }}
          style={{position:"fixed",bottom:36,left:"50%",transform:"translateX(-50%)",background:"linear-gradient(135deg,#e8e8e8,#ffffff)",color:"#0A0A0C",border:"none",borderRadius:28,padding:"14px 28px",display:"flex",alignItems:"center",gap:9,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",letterSpacing:"-0.01em",animation:"fabPulse 3s ease-in-out infinite",transition:"transform 0.2s cubic-bezier(0.34,1.56,0.64,1)",zIndex:100}}
          onMouseEnter={e=>{e.currentTarget.style.transform="translateX(-50%) scale(1.06)";e.currentTarget.style.animation="none";}}
          onMouseLeave={e=>{e.currentTarget.style.transform="translateX(-50%) scale(1)";e.currentTarget.style.animation="fabPulse 3s ease-in-out infinite";}}>
          <Icon d={Icons.plus} size={16} stroke="#0A0A0C"/>
          {tab==="quests"?"New Quest":tab==="boards"?"New Board":"Add Member"}
        </button>
      )}

      {/* Made by footer */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:5,
        pointerEvents:"none",display:"flex",justifyContent:"center",paddingBottom:8}}>
        <span style={{fontSize:10,color:"rgba(255,255,255,0.12)",fontFamily:"'DM Sans',sans-serif",
          letterSpacing:"0.06em"}}>
          Made by <span style={{color:"rgba(255,255,255,0.2)",fontWeight:600}}>Murad Mirzayev</span>
        </span>
      </div>

      {questModal&&<QuestModal quest={questModal} onSave={saveQuest} friends={friends} onClose={()=>setQuestModal(null)}/>}
      {showCreateBoard&&<CreateBoardModal onSave={createBoard} onClose={()=>setShowCreateBoard(false)}/>}
      {inviteBoard&&<InviteModal board={inviteBoard} onClose={()=>setInviteBoard(null)}/>}
      {memberModal&&<MemberModal member={memberModal} onSave={saveMember} onClose={()=>setMemberModal(null)}/>}
      {deleteTarget&&(
        <DeleteConfirm label={deleteTarget.type}
          onConfirm={
            deleteTarget.type==="quest"?deleteQuest:
            deleteTarget.type==="board"?confirmDeleteBoard:
            deleteMember
          }
          onCancel={()=>setDeleteTarget(null)}/>
      )}
    </div>
  );
}
