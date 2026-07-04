import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://fbldconclzuckyotxvsk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibGRjb25jbHp1Y2t5b3R4dnNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MDUwMDcsImV4cCI6MjA5NjQ4MTAwN30.dFPSoQLShrnrhGdAt4K3TPZWLigtUAe4ZaI7XygCMO0";
const TMDB_KEY = "2f3454a6e973630c47e785e664612aeb"; // used client-side per TMDB's own ToS for personal apps

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
    console.log("Signup response:", JSON.stringify(d));
    if(d.error) {
      const msg = d.error.message||d.error_description||d.msg||"";
      if(msg.toLowerCase().includes("already registered")||msg.toLowerCase().includes("already exists"))
        throw new Error("This email already has an account. Click Sign In instead.");
      if(msg.toLowerCase().includes("password"))
        throw new Error("Password must be at least 6 characters.");
      if(msg.toLowerCase().includes("signup"))
        throw new Error("Signups are disabled. Contact the app owner.");
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

  // ── Board Invites ────────────────────────────────────────────────────────
  async sendBoardInvite(boardId, fromUserId, toUserId) {
    // Check not already a member
    const check = await fetch(`${SUPABASE_URL}/rest/v1/board_members?board_id=eq.${boardId}&user_id=eq.${toUserId}`, {headers:this.h});
    const existing = await check.json();
    if(Array.isArray(existing) && existing.length > 0) throw new Error("Already a member");
    // Delete any old declined/accepted invite first so we can re-invite
    await fetch(`${SUPABASE_URL}/rest/v1/board_invites?board_id=eq.${boardId}&to_id=eq.${toUserId}`,
      {method:"DELETE", headers:this.h});
    // Send fresh invite
    const r = await fetch(`${SUPABASE_URL}/rest/v1/board_invites`, {
      method:"POST",
      headers:{...this.h,"Prefer":"return=minimal"},
      body:JSON.stringify({id:crypto.randomUUID(), board_id:boardId, from_id:fromUserId, to_id:toUserId, status:"pending", created_at:new Date().toISOString()})
    });
    if(!r.ok) {
      const err = await r.text();
      console.error("sendBoardInvite failed:", r.status, err);
      throw new Error("Could not send invite. Try again.");
    }
  },
  async getMyBoardInvites(userId) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/board_invites?to_id=eq.${userId}&status=eq.pending`, {headers:this.h});
    const invites = await r.json();
    if(!Array.isArray(invites) || invites.length===0) return [];
    // Also check which boards user is already a member of
    const memberCheck = await fetch(`${SUPABASE_URL}/rest/v1/board_members?user_id=eq.${userId}&select=board_id`, {headers:this.h});
    const memberships = await memberCheck.json();
    const memberBoardIds = Array.isArray(memberships)?memberships.map(m=>m.board_id):[];
    // Filter out invites for boards user already joined + auto-clean stale pending invites
    const validInvites = invites.filter(inv=>!memberBoardIds.includes(inv.board_id));
    // Auto-mark stale invites as accepted if user is already a member
    const stale = invites.filter(inv=>memberBoardIds.includes(inv.board_id));
    if(stale.length>0) {
      await Promise.all(stale.map(inv=>
        fetch(`${SUPABASE_URL}/rest/v1/board_invites?id=eq.${inv.id}`,{
          method:"PATCH",headers:{...this.h,"Content-Type":"application/json"},
          body:JSON.stringify({status:"accepted"})
        }).catch(()=>{})
      ));
    }
    if(validInvites.length===0) return [];
    // Get board details for each invite
    return Promise.all(invites.map(async inv=>{
      try {
        const br = await fetch(`${SUPABASE_URL}/rest/v1/boards?id=eq.${inv.board_id}`, {headers:this.h});
        const boards = await br.json();
        const board = Array.isArray(boards)?boards[0]:null;
        // Get sender name
        const sr = await fetch(`${SUPABASE_URL}/rest/v1/rpc/find_user_by_id`,{
          method:"POST", headers:{...this.h,"Content-Type":"application/json"},
          body:JSON.stringify({search_id:inv.from_id})
        });
        const senderData = await sr.json();
        const sender = Array.isArray(senderData)?senderData[0]:senderData;
        return {...inv, board, sender};
      } catch { return inv; }
    }));
  },
  async respondBoardInvite(inviteId, boardId, userId, accept) {
    // Update invite status
    const r = await fetch(`${SUPABASE_URL}/rest/v1/board_invites?id=eq.${inviteId}`, {
      method:"PATCH",
      headers:{...this.h,"Content-Type":"application/json","Prefer":"return=minimal"},
      body:JSON.stringify({status: accept?"accepted":"declined"})
    });
    if(!r.ok) console.error("invite update failed", r.status, await r.text());
    // If accepted, add to board members
    if(accept) {
      await fetch(`${SUPABASE_URL}/rest/v1/board_members`, {
        method:"POST",
        headers:{...this.h,"Prefer":"resolution=ignore-duplicates"},
        body:JSON.stringify({id:crypto.randomUUID(), board_id:boardId, user_id:userId, joined_at:new Date().toISOString()})
      });
    }
  },

  // ── Reactions ────────────────────────────────────────────────────────────
  async getReactions(questId) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/reactions?quest_id=eq.${questId}`, {headers:this.h});
    const d = await r.json(); return Array.isArray(d)?d:[];
  },
  async toggleReaction(questId, userId, emoji) {
    // Check if reaction exists
    const r = await fetch(`${SUPABASE_URL}/rest/v1/reactions?quest_id=eq.${questId}&user_id=eq.${userId}&emoji=eq.${encodeURIComponent(emoji)}`, {headers:this.h});
    const existing = await r.json();
    if(Array.isArray(existing) && existing.length > 0) {
      // Remove it
      await fetch(`${SUPABASE_URL}/rest/v1/reactions?id=eq.${existing[0].id}`, {method:"DELETE", headers:this.h});
      return false; // removed
    } else {
      // Add it
      await fetch(`${SUPABASE_URL}/rest/v1/reactions`, {
        method:"POST", headers:{...this.h,"Prefer":"return=minimal"},
        body:JSON.stringify({id:crypto.randomUUID(), quest_id:questId, user_id:userId, emoji, created_at:new Date().toISOString()})
      });
      return true; // added
    }
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

  // ── Movies (Letterboxd-style log) ───────────────────────────────────────────
  async getMovies(userId) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/movies?user_id=eq.${userId}&order=watched_date.desc.nullslast,created_at.desc`, {headers:this.h});
    const d = await r.json(); return Array.isArray(d)?d:[];
  },
  async upsertMovie(movie) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/movies`, {
      method:"POST", headers:{...this.h,"Prefer":"resolution=merge-duplicates"},
      body:JSON.stringify(movie)
    }); if(!r.ok) throw new Error();
  },
  async deleteMovie(id) {
    await fetch(`${SUPABASE_URL}/rest/v1/movies?id=eq.${id}`, {method:"DELETE", headers:this.h});
  },

  // ── Friend profile viewing ──────────────────────────────────────────────────
  async getFriendPublicQuests(userId) {
    // RLS already restricts this to quests marked public by an accepted friend —
    // the is_public filter here is just a client-side belt-and-suspenders check
    // so board-shared (but not explicitly public) quests never leak into this view.
    const all = await this.getAll("quests", userId);
    return Array.isArray(all) ? all.filter(q=>q.is_public===true) : [];
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
  async leaveBoard(boardId, userId) {
    await fetch(`${SUPABASE_URL}/rest/v1/board_members?board_id=eq.${boardId}&user_id=eq.${userId}`,
      {method:"DELETE", headers:this.h});
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
  async upsert(table,obj,onConflict) {
    // onConflict lets a table upsert by a natural key (e.g. "user_id" for members)
    // instead of the row's own id — this is what actually prevents duplicate rows
    // when local state has a stale/missing id.
    const url = onConflict
      ? `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`
      : `${SUPABASE_URL}/rest/v1/${table}`;
    const r = await fetch(url,{
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
const getPalette=(id, colorIndex)=>{
  if(colorIndex !== undefined && colorIndex !== null && QUEST_PALETTES[colorIndex])
    return QUEST_PALETTES[colorIndex];
  if(!id) return QUEST_PALETTES[0];
  let h=0; for(let i=0;i<id.length;i++) h=id.charCodeAt(i)+((h<<5)-h);
  return QUEST_PALETTES[Math.abs(h)%QUEST_PALETTES.length];
};

// ─── QUEST CATEGORIES & DIFFICULTY ───────────────────────────────────────────
const QUEST_CATEGORIES = [
  {id:"adventure",  label:"Adventure",  icon:"🗺"},
  {id:"social",     label:"Social",     icon:"🤝"},
  {id:"food",       label:"Food",       icon:"🍕"},
  {id:"fitness",    label:"Fitness",    icon:"💪"},
  {id:"creative",   label:"Creative",   icon:"🎨"},
  {id:"travel",     label:"Travel",     icon:"✈"},
  {id:"chaos",      label:"Chaos",      icon:"🔥"},
  {id:"personal",   label:"Personal",   icon:"🧠"},
  {id:"challenge",  label:"Challenge",  icon:"⚔"},
  {id:"night",      label:"Night Out",  icon:"🌙"},
];

const DIFFICULTIES = [
  {id:"easy",      label:"Easy",       icon:"🟢", color:"#34D399"},
  {id:"medium",    label:"Medium",     icon:"🟡", color:"#FBBF24"},
  {id:"hard",      label:"Hard",       icon:"🔴", color:"#F87171"},
  {id:"legendary", label:"Legendary",  icon:"💀", color:"#E879F9"},
];

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
const EMPTY_QUEST={id:null,title:"",description:"",status:"Active",invitees:"",created_at:null,location:null,emoji:"",completed_at:null,photo:null,due_date:null,started_at:null,color_index:null,category:null,difficulty:null,is_public:false};
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

// XP is earned ONLY by completing quests — creating/having active quests gives nothing.
// Harder quests are worth more, matching the difficulty badge you set on the quest.
const XP_VALUES = {
  Completed: 50,  // default completion XP (no difficulty set)
  easy:      25,
  medium:    50,
  hard:      75,
  legendary: 150,
};

const getRank = (xp) => RANKS.slice().reverse().find(r => xp >= r.min) || RANKS[0];

const calcXP = (quests) => {
  let xp = 0;
  quests.forEach(q => {
    if(q.status === "Completed") {
      xp += XP_VALUES[q.difficulty] || XP_VALUES.Completed;
    }
  });
  return xp;
};

// ─── EMOJI PICKER DATA ────────────────────────────────────────────────────────
const EMOJI_GROUPS={
  "🔥 Hype":    ["🔥","⚡","💥","🎯","🏆","👑","💎","🌟","✨","🎪","🎭","🎨","🎬","🎤","🎸","🥳","🎉","🎊","🏅","🥇"],
  "🌍 Travel":  ["✈","🗺","🧭","🏕","🌋","🏔","🏖","🏜","🌊","🌁","🗼","🏛","🕌","⛩","🏯","🌃","🌄","🌉","🚀","🛸"],
  "⚔ Quest":   ["⚔","🗡","🛡","🏴‍☠","🗝","🔮","🧙","🐉","🦅","🦁","🐺","🔱","☄","🌙","💫","🌠","🧿","🪬","⚜","🔰"],
  "🤸 Active":  ["🥊","🏄","🧗","🤿","🪂","🏇","🧘","🤺","🏋","🚴","🏊","⛷","🏂","🤸","🎿","🥋","🎯","🎱","🎳","🏓"],
  "🍕 Food":    ["🍕","🍣","🍜","🍔","🌮","🍷","🥂","🍻","☕","🧃","🍰","🎂","🍦","🍩","🥩","🍗","🌯","🥗","🍱","🧆"],
  "😂 Funny":   ["😂","🤡","👻","💀","🤪","😈","🥴","😵","🤯","🫠","👽","🤖","👾","🎭","🃏","🎲","🪄","🎪","🤹","🎠"],
  "❤ Feels":   ["❤","🧡","💛","💚","💙","💜","🖤","🤍","💕","💞","💓","💗","💖","💝","❣","💔","🫶","🤗","😍","🥰"],
  "🌿 Chill":   ["🌿","🌱","🍀","🌸","🌺","🌻","🌹","🌴","🌵","🍄","🪴","🌾","🍂","🍁","🌊","☁","🌈","🌙","⭐","🌤"],
  "🏠 Life":    ["🏠","💡","📚","🎵","🎮","📸","🎨","✏","📝","💻","📱","🔑","🧳","🛍","💰","💳","🧸","🪆","🎁","📦"],
  "🐾 Animals": ["🦁","🐯","🦊","🐺","🦝","🐻","🐼","🐨","🦋","🦅","🦆","🦜","🐬","🦈","🐙","🦑","🦞","🐊","🦕","🦖"],
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
  globe:   "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
  link:    "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  copy:    "M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  dots:    "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  chevronRight: "M9 18l6-6-6-6",
  star:    "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  film:    "M7 3v18M17 3v18M2 8h5M17 8h5M2 16h5M17 16h5M2 3h20a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
  lock:    "M5 11h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM7 11V7a5 5 0 0 1 10 0v4",
};

// ─── PROGRESS RING (Apple-Fitness-style circular XP indicator) ───────────────
function ProgressRing({ size=76, stroke=5, pct=0, color="#A8FF78", glow=true, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(Math.max(pct,0),100) / 100);
  return (
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} style={{position:"absolute",inset:0,
        transform:"rotate(-90deg)",filter:glow?`drop-shadow(0 0 6px ${color}70)`:"none"}}>
        {/* Track */}
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke="rgba(255,255,255,0.07)" strokeWidth={stroke}/>
        {/* Progress arc */}
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          style={{transition:"stroke-dashoffset 1s cubic-bezier(0.34,1.2,0.64,1)"}}/>
      </svg>
      {children&&(
        <div style={{position:"absolute",inset:stroke+3,borderRadius:"50%",
          display:"flex",alignItems:"center",justifyContent:"center"}}>
          {children}
        </div>
      )}
    </div>
  );
}

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
      transition:"all 0.15s cubic-bezier(0.34,1.2,0.64,1)",transform:h?"scale(1.08)":"scale(1)",
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
      transition:"transform 0.2s cubic-bezier(0.34,1.2,0.64,1)",cursor:"default",
    }}
      onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.15)";e.currentTarget.style.zIndex="10";}}
      onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.zIndex="1";}}
    >{avatar}</div>
  );
}

// ─── EMOJI PICKER ─────────────────────────────────────────────────────────────
function EmojiPicker({value,onChange}){
  const [open,setOpen]=useState(false);
  const [activeGroup,setActiveGroup]=useState(Object.keys(EMOJI_GROUPS)[0]);

  const groups = Object.keys(EMOJI_GROUPS);

  return(
    <div style={{position:"relative"}}>
      <button type="button" onClick={()=>setOpen(o=>!o)} style={{
        display:"flex",alignItems:"center",gap:10,padding:"10px 16px",borderRadius:12,
        cursor:"pointer",background:open?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.04)",
        border:`1px solid ${open?"rgba(255,255,255,0.18)":"rgba(255,255,255,0.09)"}`,
        transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)",width:"100%",
      }}>
        <span style={{fontSize:22,lineHeight:1}}>{value||"✨"}</span>
        <span style={{fontSize:13,color:value?"rgba(255,255,255,0.7)":"rgba(255,255,255,0.3)",
          fontFamily:"'DM Sans',sans-serif",fontWeight:500}}>
          {value?"Change emoji":"Pick an emoji"}
        </span>
        {value&&<span onClickCapture={e=>{e.stopPropagation();onChange("");setOpen(false);}}
          style={{marginLeft:"auto",cursor:"pointer",color:"rgba(255,255,255,0.3)",fontSize:13,padding:"2px 4px"}}>✕</span>}
      </button>

      {open&&createPortal(
        <>
          {/* Backdrop */}
          <div style={{position:"fixed",inset:0,zIndex:99990,background:"rgba(0,0,0,0.5)",backdropFilter:"blur(4px)"}}
            onClick={()=>setOpen(false)}/>
          {/* Panel */}
          <div style={{
            position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
            width:"min(420px, 92vw)",zIndex:99991,
            background:"#0E0E12",border:"1px solid rgba(255,255,255,0.12)",borderRadius:20,
            overflow:"hidden",boxShadow:"0 24px 64px rgba(0,0,0,0.95)",
            maxHeight:"70vh",display:"flex",flexDirection:"column",
          }}>
            {/* Header */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"14px 16px 0",flexShrink:0}}>
              <span style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,0.5)",
                fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.06em",textTransform:"uppercase"}}>
                Pick an emoji
              </span>
              <button type="button" onClick={()=>setOpen(false)} style={{
                background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",
                borderRadius:8,padding:"4px 6px",cursor:"pointer",color:"rgba(255,255,255,0.4)"}}>
                <Icon d={Icons.x} size={14}/>
              </button>
            </div>
            {/* Category tabs */}
            <div style={{display:"flex",overflowX:"auto",borderBottom:"1px solid rgba(255,255,255,0.07)",
              padding:"10px 10px 0",gap:3,flexShrink:0,WebkitOverflowScrolling:"touch"}}>
              {groups.map(g=>(
                <button type="button" key={g} onClick={()=>setActiveGroup(g)} style={{
                  flexShrink:0,padding:"5px 10px",borderRadius:"8px 8px 0 0",
                  background:activeGroup===g?"rgba(255,255,255,0.08)":"transparent",
                  border:"none",borderBottom:activeGroup===g?"2px solid rgba(255,255,255,0.6)":"2px solid transparent",
                  color:activeGroup===g?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.35)",
                  cursor:"pointer",fontSize:11,fontWeight:600,
                  fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",transition:"all 0.15s cubic-bezier(0.34,1.2,0.64,1)",
                }}>{g}</button>
              ))}
            </div>
            {/* Emoji grid */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:4,
              padding:12,overflowY:"auto",WebkitOverflowScrolling:"touch"}}>
              {(EMOJI_GROUPS[activeGroup]||[]).map((em,i)=>(
                <button type="button" key={i} onClick={()=>{onChange(em);setOpen(false);}} style={{
                  fontSize:26,padding:"8px",borderRadius:10,border:"none",
                  background:value===em?"rgba(255,255,255,0.15)":"transparent",
                  cursor:"pointer",lineHeight:1,aspectRatio:"1",
                  outline:value===em?"2px solid rgba(255,255,255,0.3)":"none",
                }}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.08)"}
                  onMouseLeave={e=>e.currentTarget.style.background=value===em?"rgba(255,255,255,0.15)":"transparent"}
                >{em}</button>
              ))}
            </div>
          </div>
        </>,
        document.body
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
  const [query,setQuery]       = useState(value?.name||"");
  const [suggestions,setSugg]  = useState([]);
  const [loading,setLoading]   = useState(false);
  const [showSugg,setShowSugg] = useState(false);
  const debounce = useRef(null);

  const search = async(q)=>{
    if(!q||q.length<2){ setSugg([]); return; }
    setLoading(true);
    try {
      // Search with Baku/Azerbaijan bias first
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lat=40.4093&lon=49.8671`
      );
      const d = await res.json();
      if(d?.features) setSugg(d.features);
    } catch{}
    setLoading(false);
  };

  const onType=(e)=>{
    const v=e.target.value;
    setQuery(v);
    setShowSugg(true);
    clearTimeout(debounce.current);
    debounce.current=setTimeout(()=>search(v),350);
  };

  const pick=(feat)=>{
    const [lng,lat]=feat.geometry.coordinates;
    const p=feat.properties;
    const name=[p.name,p.city||p.county,p.country].filter(Boolean).join(", ");
    onChange({name:p.name||name, lat, lng});
    setQuery(p.name||name);
    setSugg([]);
    setShowSugg(false);
  };

  const clear=()=>{onChange(null);setQuery("");setSugg([]);};

  return(
    <div style={{display:"flex",flexDirection:"column",gap:8,position:"relative"}}>
      <div style={{position:"relative"}}>
        <div style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",pointerEvents:"none",zIndex:1}}>
          {loading
            ? <div style={{width:14,height:14,border:"2px solid rgba(255,255,255,0.1)",borderTopColor:"rgba(255,255,255,0.5)",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>
            : <Icon d={Icons.search} size={15} stroke="rgba(255,255,255,0.3)"/>
          }
        </div>
        <input value={query} onChange={onType}
          onFocus={()=>setShowSugg(true)}
          onBlur={()=>setTimeout(()=>setShowSugg(false),200)}
          placeholder="Search for a place…"
          style={{width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:12,padding:"12px 12px 12px 38px",color:"#F0F0F0",fontSize:13.5,outline:"none",
            fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",transition:"border-color 0.2s"}}
          onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.25)"}
          onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.12)"}/>

        {/* Suggestions dropdown */}
        {showSugg&&suggestions.length>0&&(
          <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,zIndex:9999,
            background:"linear-gradient(160deg,#111114,#0D0D10)",
            border:"1px solid rgba(255,255,255,0.1)",borderRadius:14,
            overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.7)"}}>
            {suggestions.map((feat,i)=>{
              const p=feat.properties;
              const main=p.name||p.street||"Unknown";
              const sub=[p.city||p.county,p.country].filter(Boolean).join(", ");
              return(
                <button key={i} onMouseDown={()=>pick(feat)} style={{
                  width:"100%",padding:"11px 14px",cursor:"pointer",textAlign:"left",border:"none",
                  background:"transparent",borderBottom:i<suggestions.length-1?"1px solid rgba(255,255,255,0.05)":"none",
                  transition:"background 0.1s",display:"flex",flexDirection:"column",gap:2}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <span style={{fontSize:13,fontWeight:600,color:"#F0F0F0",fontFamily:"'DM Sans',sans-serif"}}>
                    📍 {main}
                  </span>
                  {sub&&<span style={{fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Sans',sans-serif"}}>
                    {sub}
                  </span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {value?.name&&(
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderRadius:10,
          background:"rgba(168,255,120,0.06)",border:"1px solid rgba(168,255,120,0.18)"}}>
          <Icon d={Icons.pin} size={13} stroke="#A8FF78" fill="rgba(168,255,120,0.2)"/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12.5,color:"rgba(255,255,255,0.65)",fontFamily:"'DM Sans',sans-serif"}}>{value.name}</div>
            {value.lat&&<div style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginTop:1}}>
              📌 {Number(value.lat).toFixed(4)}, {Number(value.lng).toFixed(4)}
            </div>}
          </div>
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
              transition:"all 0.15s cubic-bezier(0.34,1.2,0.64,1)",
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
function CompletedTab({quests,onEdit,onShare}){
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
        const palette=getPalette(q.id, q.color_index);
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
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  <button onClick={()=>onShare&&onShare(q)} style={{background:"rgba(192,132,252,0.1)",
                    border:"1px solid rgba(192,132,252,0.25)",
                    borderRadius:8,padding:"6px 8px",cursor:"pointer",color:"rgba(192,132,252,0.8)",flexShrink:0}}>
                    <Icon d={Icons.link} size={13}/>
                  </button>
                  <button onClick={()=>onEdit(q)} style={{background:"none",border:"1px solid rgba(255,255,255,0.1)",
                    borderRadius:8,padding:"6px 8px",cursor:"pointer",color:"rgba(255,255,255,0.35)",flexShrink:0}}>
                    <Icon d={Icons.edit} size={13}/>
                  </button>
                </div>
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
              const p=getPalette(q.id, q.color_index);
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



// ─── INSTAGRAM SHARE CARD ─────────────────────────────────────────────────────
function ShareQuestCard({ quest, user, onClose }) {
  const [visible, setVisible] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const palette = getPalette(quest.id);
  const rank = getRank(0); // placeholder
  useEffect(()=>{ requestAnimationFrame(()=>setVisible(true)); },[]);
  const close=()=>{ setVisible(false); setTimeout(onClose,250); };

  const cardStyle = {
    width:360, height:360,
    background:`linear-gradient(135deg,#0A0A0C 0%,#111116 100%)`,
    borderRadius:24,
    padding:28,
    position:"relative",
    overflow:"hidden",
    border:`1px solid ${palette.color}30`,
    display:"flex",flexDirection:"column",
    justifyContent:"space-between",
  };

  return createPortal(
    <div style={{position:"fixed",inset:0,background:`rgba(0,0,0,${visible?0.85:0})`,
      backdropFilter:`blur(${visible?20:0}px)`,display:"flex",alignItems:"center",
      justifyContent:"center",zIndex:9999,padding:24,transition:"all 0.25s"}}
      onClick={e=>e.target===e.currentTarget&&close()}>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16,
        transform:visible?"scale(1)":"scale(0.95)",transition:"transform 0.3s cubic-bezier(0.34,1.2,0.64,1)"}}>

        {/* The shareable card */}
        <div id="share-card" style={cardStyle}>
          {/* Background glow */}
          <div style={{position:"absolute",top:-60,right:-60,width:200,height:200,borderRadius:"50%",
            background:`radial-gradient(circle,${palette.color}20 0%,transparent 70%)`,pointerEvents:"none"}}/>
          <div style={{position:"absolute",bottom:-40,left:-40,width:160,height:160,borderRadius:"50%",
            background:`radial-gradient(circle,${palette.color}12 0%,transparent 70%)`,pointerEvents:"none"}}/>
          {/* Top accent */}
          <div style={{position:"absolute",top:0,left:0,right:0,height:3,
            background:palette.grad,borderRadius:"24px 24px 0 0"}}/>

          {/* Header */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",position:"relative",zIndex:1}}>
            <div>
              <p style={{fontSize:9,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",
                color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif",margin:0}}>SIDE QUESTS</p>
              <p style={{fontSize:10,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif",margin:"2px 0 0"}}>
                {user?.email?.split("@")[0]||"Adventurer"}
              </p>
            </div>
            <div style={{background:`${palette.color}15`,border:`1px solid ${palette.color}30`,
              borderRadius:8,padding:"4px 10px",fontSize:10,fontWeight:700,
              color:palette.color,fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.06em"}}>
              COMPLETED
            </div>
          </div>

          {/* Main content */}
          <div style={{position:"relative",zIndex:1}}>
            {quest.emoji&&<div style={{fontSize:44,marginBottom:12,lineHeight:1}}>{quest.emoji}</div>}
            <h2 style={{margin:"0 0 10px",fontSize:26,fontWeight:700,color:"#F2F2F2",
              fontFamily:"'Cormorant Garamond',serif",lineHeight:1.2,letterSpacing:"-0.02em"}}>
              {quest.title}
            </h2>
            {quest.description&&<p style={{margin:0,fontSize:12,color:"rgba(255,255,255,0.4)",
              fontFamily:"'DM Sans',sans-serif",lineHeight:1.5,
              display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
              {quest.description}
            </p>}
          </div>

          {/* Footer */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",position:"relative",zIndex:1}}>
            <div>
              {quest.completed_at&&<p style={{margin:0,fontSize:11,color:"rgba(255,255,255,0.35)",
                fontFamily:"'DM Sans',sans-serif"}}>
                🔥 {new Date(quest.completed_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
              </p>}
              {quest.location?.name&&<p style={{margin:"3px 0 0",fontSize:10,color:"rgba(255,255,255,0.25)",
                fontFamily:"'DM Sans',sans-serif"}}>📍 {quest.location.name}</p>}
            </div>
            <div style={{textAlign:"right"}}>
              <p style={{margin:0,fontSize:9,color:`${palette.color}80`,fontFamily:"'DM Sans',sans-serif",
                fontWeight:700,letterSpacing:"0.08em"}}>muradquestapp.xyz</p>
            </div>
          </div>
        </div>

        {/* Photo if available */}
        {quest.photo&&(
          <div style={{width:360,borderRadius:16,overflow:"hidden",border:`1px solid ${palette.color}30`}}>
            <img src={quest.photo} alt="" style={{width:"100%",height:200,objectFit:"cover",display:"block"}}/>
          </div>
        )}

        {/* Instructions */}
        <div style={{textAlign:"center",maxWidth:300}}>
          <p style={{fontSize:12,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.6,margin:0}}>
            Screenshot this card and share to Instagram! ✨
          </p>
        </div>

        <button onClick={close} style={{padding:"12px 32px",borderRadius:14,
          background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",
          color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:14,fontWeight:600,
          fontFamily:"'DM Sans',sans-serif"}}>
          Close
        </button>
      </div>
    </div>,
    document.body
  );
}

// ─── QUEST CARD ───────────────────────────────────────────────────────────────
function QuestCard({quest,members,onEdit,onDelete,index}){
  const [expanded,setExpanded]=useState(false);
  const [hovered,setHovered]=useState(false);
  const palette=getPalette(quest.id, quest.color_index);
  const {emoji}=STATUS_META[quest.status]||STATUS_META["Active"];
  const inviteeList=quest.invitees?quest.invitees.split(",").map(s=>s.trim()).filter(Boolean):[];
  const questMembers=members.filter(m=>inviteeList.map(n=>n.toLowerCase()).includes(m.name.toLowerCase()));
  const hasDetails=quest.description||inviteeList.length>0||quest.location?.name;
  const isShared=!!quest.board_id;

  return(
    <div onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
      style={{
        position:"relative",
        animation:`cardIn 0.5s cubic-bezier(0.34,1.2,0.64,1) ${index*0.07}s both`,
        transition:"all 0.3s cubic-bezier(0.34,1.2,0.64,1)",
        transform:hovered&&!expanded?"translateY(-3px) scale(1.01)":"translateY(0) scale(1)",
        borderRadius:20,
        overflow:"hidden",
        // Solid colored glass background like the reference
        background:expanded
          ?`linear-gradient(135deg,${palette.color}28 0%,${palette.color}12 100%)`
          :hovered
            ?`linear-gradient(135deg,${palette.color}20 0%,${palette.color}0A 100%)`
            :`linear-gradient(135deg,${palette.color}16 0%,${palette.color}06 100%)`,
        border:`1px solid ${expanded?palette.color+"60":hovered?palette.color+"40":palette.color+"25"}`,
        boxShadow:expanded
          ?`0 8px 32px ${palette.color}30, 0 0 0 1px ${palette.color}20, inset 0 1px 0 rgba(255,255,255,0.1)`
          :hovered
            ?`0 4px 20px ${palette.color}25, 0 0 0 1px ${palette.color}15`
            :`0 2px 12px ${palette.color}15`,
      }}>
      {/* Top accent line */}
      <div style={{position:"absolute",top:0,left:0,right:0,height:2,
        background:palette.grad,opacity:expanded?1:hovered?0.8:0.5,transition:"opacity 0.3s"}}/>
      {/* Inner glow top-right */}
      <div style={{position:"absolute",top:-30,right:-30,width:160,height:160,borderRadius:"50%",
        background:`radial-gradient(circle,${palette.color}20 0%,transparent 65%)`,
        pointerEvents:"none"}}/>
      {/* Bottom left subtle glow */}
      <div style={{position:"absolute",bottom:-20,left:-20,width:100,height:100,borderRadius:"50%",
        background:`radial-gradient(circle,${palette.color}12 0%,transparent 65%)`,
        pointerEvents:"none"}}/>

      {quest.emoji?(
        <div style={{position:"absolute",right:16,top:"50%",
          transform:expanded?"translateY(-50%) scale(1.1)":"translateY(-50%) scale(1)",
          fontSize:28,opacity:expanded?0.55:hovered?0.4:0.25,userSelect:"none",transition:"all 0.3s cubic-bezier(0.34,1.2,0.64,1)"}}>{quest.emoji}</div>
      ):(
        <div style={{position:"absolute",right:16,bottom:12,fontSize:36,
          opacity:expanded?0.07:0.035,userSelect:"none",filter:"blur(1px)"}}>{emoji}</div>
      )}

      {/* Collapsed row */}
      <div onClick={()=>hasDetails&&setExpanded(e=>!e)}
        style={{padding:"16px 18px",display:"flex",alignItems:"center",gap:10,
          cursor:hasDetails?"pointer":"default",userSelect:"none",minWidth:0}}>
        <div style={{width:9,height:9,borderRadius:"50%",flexShrink:0,background:palette.color,
          boxShadow:`0 0 10px ${palette.color}`,
          animation:quest.status==="Active"?"pulseDot 2s ease-in-out infinite":"none"}}/>
        <div style={{flex:1,minWidth:0,overflow:"hidden"}}>
          <h3 style={{margin:0,fontSize:17,fontWeight:700,letterSpacing:"-0.02em",
            color:"#FFFFFF",lineHeight:1.3,
            fontFamily:"'Cormorant Garamond',serif",
            wordBreak:"break-word",overflowWrap:"break-word",
            whiteSpace:"normal",minWidth:0,
            textShadow:"0 1px 8px rgba(0,0,0,0.3)"}}>{quest.title}</h3>
          {/* Category + Difficulty + Public badges */}
          {(quest.category||quest.difficulty||quest.is_public)&&(
            <div style={{display:"flex",gap:5,marginTop:5,flexWrap:"wrap"}}>
              {quest.is_public&&(
                <span style={{display:"inline-flex",alignItems:"center",gap:3,
                  padding:"2px 8px",borderRadius:20,
                  background:"rgba(168,255,120,0.12)",border:"1px solid rgba(168,255,120,0.3)",
                  fontSize:10,fontWeight:700,color:"#A8FF78",
                  fontFamily:"'DM Sans',sans-serif"}}>
                  <Icon d={Icons.globe} size={10} stroke="#A8FF78"/> Public
                </span>
              )}
              {quest.category&&(()=>{
                const cat=QUEST_CATEGORIES.find(c=>c.id===quest.category);
                return cat?(
                  <span style={{display:"inline-flex",alignItems:"center",gap:3,
                    padding:"2px 8px",borderRadius:20,
                    background:"rgba(255,255,255,0.1)",
                    fontSize:10,fontWeight:600,color:"rgba(255,255,255,0.7)",
                    fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.04em"}}>
                    {cat.icon} {cat.label}
                  </span>
                ):null;
              })()}
              {quest.difficulty&&(()=>{
                const d=DIFFICULTIES.find(d=>d.id===quest.difficulty);
                return d?(
                  <span style={{display:"inline-flex",alignItems:"center",gap:3,
                    padding:"2px 8px",borderRadius:20,
                    background:`${d.color}18`,
                    border:`1px solid ${d.color}40`,
                    fontSize:10,fontWeight:700,color:d.color,
                    fontFamily:"'DM Sans',sans-serif"}}>
                    {d.icon} {d.label}
                  </span>
                ):null;
              })()}
            </div>
          )}
          {!expanded&&(quest.description||quest.location?.name||quest.due_date)&&(
            <p style={{margin:"3px 0 0",fontSize:12,color:"rgba(255,255,255,0.55)",whiteSpace:"nowrap",
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
        <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
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
          {/* XP value — always visible in the detail view, scales with difficulty */}
          {(()=>{
            const xpValue = XP_VALUES[quest.difficulty] || XP_VALUES.Completed;
            const dMeta = DIFFICULTIES.find(d=>d.id===quest.difficulty);
            const xpColor = dMeta?.color || "#A8FF78";
            const isDone = quest.status==="Completed";
            return(
              <div style={{marginTop:14,display:"flex",alignItems:"center",gap:10,
                padding:"12px 14px",borderRadius:12,
                background:`${xpColor}10`,border:`1px solid ${xpColor}30`}}>
                <span style={{fontSize:20}}>⚡</span>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:xpColor,fontFamily:"'Cormorant Garamond',serif"}}>
                    {xpValue} XP
                  </div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Sans',sans-serif"}}>
                    {isDone?"Earned on completion":"Earned when this quest is completed"}
                    {dMeta&&` · ${dMeta.label} difficulty`}
                  </div>
                </div>
              </div>
            );
          })()}
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
  const [saveError,setSaveError]=useState("");
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
    setSaveError("");
    // A quest can't be marked Completed without proof — a photo is required.
    if(form.status==="Completed" && !form.photo) {
      setSaveError("Add a photo before you can mark this quest as completed.");
      return;
    }
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
        {/* Category */}
        <div>
          <label style={lbl}>Category</label>
          <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
            {QUEST_CATEGORIES.map(cat=>{
              const active=form.category===cat.id;
              return(
                <button key={cat.id} type="button" onClick={()=>set("category",active?null:cat.id)} style={{
                  display:"flex",alignItems:"center",gap:5,
                  padding:"6px 12px",borderRadius:20,border:"none",cursor:"pointer",
                  background:active?"rgba(255,255,255,0.15)":"rgba(255,255,255,0.05)",
                  outline:active?"1px solid rgba(255,255,255,0.4)":"1px solid rgba(255,255,255,0.08)",
                  color:active?"#fff":"rgba(255,255,255,0.4)",
                  fontSize:12,fontWeight:600,fontFamily:"'DM Sans',sans-serif",
                  transition:"all 0.15s cubic-bezier(0.34,1.2,0.64,1)",
                }}>
                  <span>{cat.icon}</span>
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Difficulty */}
        <div>
          <label style={lbl}>Difficulty</label>
          <div style={{display:"flex",gap:7}}>
            {DIFFICULTIES.map(d=>{
              const active=form.difficulty===d.id;
              return(
                <button key={d.id} type="button" onClick={()=>set("difficulty",active?null:d.id)} style={{
                  flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:5,
                  padding:"9px 8px",borderRadius:12,border:"none",cursor:"pointer",
                  background:active?`${d.color}20`:"rgba(255,255,255,0.04)",
                  outline:active?`1px solid ${d.color}60`:"1px solid rgba(255,255,255,0.08)",
                  color:active?d.color:"rgba(255,255,255,0.35)",
                  fontSize:12,fontWeight:700,fontFamily:"'DM Sans',sans-serif",
                  transition:"all 0.15s cubic-bezier(0.34,1.2,0.64,1)",
                }}>
                  <span style={{fontSize:14}}>{d.icon}</span>
                  <span>{d.label}</span>
                </button>
              );
            })}
          </div>
          {/* XP preview — updates live as difficulty changes */}
          {(()=>{
            const xpValue = XP_VALUES[form.difficulty] || XP_VALUES.Completed;
            const dMeta = DIFFICULTIES.find(d=>d.id===form.difficulty);
            const xpColor = dMeta?.color || "#A8FF78";
            return(
              <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8,
                padding:"9px 14px",borderRadius:12,
                background:`${xpColor}12`,border:`1px solid ${xpColor}30`}}>
                <span style={{fontSize:15}}>⚡</span>
                <span style={{fontSize:12.5,color:"rgba(255,255,255,0.6)",fontFamily:"'DM Sans',sans-serif"}}>
                  This quest is worth
                </span>
                <span style={{fontSize:14,fontWeight:700,color:xpColor,fontFamily:"'DM Sans',sans-serif"}}>
                  {xpValue} XP
                </span>
                <span style={{fontSize:12.5,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif"}}>
                  when completed
                </span>
              </div>
            );
          })()}
        </div>

        <div>
          <label style={lbl}>Quest Color</label>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {QUEST_PALETTES.map((p,i)=>{
              const active = (form.color_index===i) || (form.color_index==null && getPalette(form.id||"x").color===p.color);
              return(
                <button key={i} type="button" onClick={()=>set("color_index", form.color_index===i?null:i)}
                  style={{
                    width:36,height:36,borderRadius:10,border:"none",cursor:"pointer",
                    background:`linear-gradient(135deg,${p.color},${p.color}88)`,
                    boxShadow:active?`0 0 0 3px #fff, 0 0 0 5px ${p.color}, 0 4px 12px ${p.color}60`:`0 2px 8px ${p.color}40`,
                    transform:active?"scale(1.2)":"scale(1)",
                    transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)",
                    position:"relative",
                  }}>
                  {active&&<div style={{position:"absolute",inset:0,borderRadius:9,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:14,color:"#fff"}}>✓</div>}
                </button>
              );
            })}
          </div>
          <p style={{fontSize:11,color:"rgba(255,255,255,0.2)",margin:"6px 0 0",fontFamily:"'DM Sans',sans-serif"}}>
            Tap a color to set it. Tap again to reset to auto.
          </p>
        </div>
        <div>
          <label style={lbl}>Visibility</label>
          <div style={{display:"flex",gap:8}}>
            <button type="button" onClick={()=>set("is_public",false)} style={{
              flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:7,
              padding:"11px 8px",borderRadius:12,border:"none",cursor:"pointer",
              background:!form.is_public?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.04)",
              outline:!form.is_public?"1px solid rgba(255,255,255,0.25)":"1px solid rgba(255,255,255,0.08)",
              color:!form.is_public?"#fff":"rgba(255,255,255,0.35)",
              fontSize:12.5,fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>
              <Icon d={Icons.lock} size={14} stroke="currentColor"/> Private
            </button>
            <button type="button" onClick={()=>set("is_public",true)} style={{
              flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:7,
              padding:"11px 8px",borderRadius:12,border:"none",cursor:"pointer",
              background:form.is_public?"rgba(168,255,120,0.15)":"rgba(255,255,255,0.04)",
              outline:form.is_public?"1px solid rgba(168,255,120,0.4)":"1px solid rgba(255,255,255,0.08)",
              color:form.is_public?"#A8FF78":"rgba(255,255,255,0.35)",
              fontSize:12.5,fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>
              <Icon d={Icons.globe} size={14} stroke="currentColor"/> Public to Friends
            </button>
          </div>
          <p style={{fontSize:11,color:"rgba(255,255,255,0.2)",margin:"6px 0 0",fontFamily:"'DM Sans',sans-serif"}}>
            {form.is_public
              ?"Friends can see this quest on your profile."
              :"Only you can see this quest — the default."}
          </p>
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
                      transition:"all 0.15s cubic-bezier(0.34,1.2,0.64,1)"}}>
                    <div style={{width:36,height:36,borderRadius:10,flexShrink:0,overflow:"hidden",
                      background:f.photo?"transparent":`radial-gradient(circle at 35% 35%,${color}30,${color}08)`,
                      border:`1.5px solid ${color}40`,display:"flex",alignItems:"center",
                      justifyContent:"center",fontSize:18}}>
                      {f.photo?<img src={f.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:avatar}
                    </div>
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
          <label style={lbl}>Completion Photo {form.status==="Completed"
            ?<span style={{opacity:0.7,fontWeight:700,textTransform:"none",fontSize:10,color:"#FF9090"}}> · required</span>
            :<span style={{opacity:0.4,fontWeight:400,textTransform:"none",fontSize:10}}>(mark as Completed first)</span>}</label>
          {form.status==="Completed"&&!form.photo&&(
            <p style={{fontSize:11,color:"rgba(255,144,144,0.7)",margin:"0 0 8px",fontFamily:"'DM Sans',sans-serif"}}>
              You need a photo to prove it before this quest can be saved as completed.
            </p>
          )}
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
        {saveError&&(
          <div style={{padding:"10px 14px",borderRadius:12,background:"rgba(255,100,100,0.08)",
            border:"1px solid rgba(255,100,100,0.25)",display:"flex",alignItems:"center",gap:8}}>
            <Icon d={Icons.camera} size={14} stroke="#FF9090"/>
            <span style={{fontSize:12.5,color:"#FF9090",fontFamily:"'DM Sans',sans-serif",lineHeight:1.4}}>
              {saveError}
            </span>
          </div>
        )}
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
      justifyContent:"center",zIndex:3000,padding:24,transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)"}}
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

// ─── INVITE MODAL ─────────────────────────────────────────────────────────────
function InviteModal({ board, user, friends=[], onClose }) {
  const [copied, setCopied]     = useState(false);
  const [visible, setVisible]   = useState(false);
  const [sending, setSending]   = useState({});
  const [sent, setSent]         = useState({});
  const [error, setError]       = useState("");
  const [boardMembers, setBoardMembers] = useState([]);

  useEffect(()=>{
    requestAnimationFrame(()=>setVisible(true));
    // Load current board members to exclude them
    sb.getBoardMembers(board.id).then(m=>setBoardMembers(m||[])).catch(()=>{});
  },[]);

  const close=()=>{ setVisible(false); setTimeout(onClose,250); };
  const link = `${window.location.origin}?join=${board.invite_code}`;
  const copy = () => { navigator.clipboard.writeText(link).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2000); }); };

  const inviteFriend = async(friend) => {
    setSending(s=>({...s,[friend.user_id]:true}));
    setError("");
    try {
      await sb.sendBoardInvite(board.id, user.id, friend.user_id);
      setSent(s=>({...s,[friend.user_id]:true}));
    } catch(e) {
      setError(e.message||"Could not send invite.");
    }
    setSending(s=>({...s,[friend.user_id]:false}));
  };

  // Friends not already in the board
  const memberIds = boardMembers.map(m=>m.user_id);
  const invitableFriends = friends.filter(f=>!memberIds.includes(f.user_id));

  return(
    <div style={{position:"fixed",inset:0,background:`rgba(0,0,0,${visible?0.72:0})`,
      backdropFilter:`blur(${visible?18:0}px)`,display:"flex",alignItems:"flex-end",
      justifyContent:"center",zIndex:1000,transition:"all 0.25s"}}
      onClick={e=>e.target===e.currentTarget&&close()}>
      <div style={{background:"linear-gradient(160deg,#111114,#0C0C0F)",
        borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,0.09)",borderBottom:"none",
        width:"100%",maxWidth:560,padding:"12px 24px 52px",
        display:"flex",flexDirection:"column",gap:20,
        transform:visible?"translateY(0)":"translateY(100%)",
        transition:"transform 0.3s cubic-bezier(0.34,1.1,0.64,1)",
        maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.1)",margin:"8px auto 0",flexShrink:0}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h2 style={{margin:0,fontSize:20,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",color:"#F2F2F2"}}>
            Invite to {board.name}
          </h2>
          <button onClick={close} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",
            borderRadius:10,padding:"7px 8px",cursor:"pointer",color:"rgba(255,255,255,0.4)"}}>
            <Icon d={Icons.x} size={16}/>
          </button>
        </div>

        {/* Invite friends section */}
        {invitableFriends.length>0&&(
          <div>
            <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
              color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginBottom:10}}>
              Invite Friends
            </p>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {invitableFriends.map(f=>{
                const {avatar,color}=getCharacter(f.name||"?");
                const isSent=sent[f.user_id];
                const isSending=sending[f.user_id];
                return(
                  <div key={f.user_id} style={{display:"flex",alignItems:"center",gap:12,
                    padding:"10px 14px",borderRadius:14,
                    background:isSent?"rgba(168,255,120,0.06)":"rgba(255,255,255,0.03)",
                    border:`1px solid ${isSent?"rgba(168,255,120,0.2)":"rgba(255,255,255,0.07)"}`}}>
                    <div style={{width:38,height:38,borderRadius:10,flexShrink:0,
                      background:`radial-gradient(circle at 35% 35%,${color}30,${color}08)`,
                      border:`1.5px solid ${color}40`,display:"flex",alignItems:"center",
                      justifyContent:"center",fontSize:20}}>{avatar}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:600,color:"#F0F0F0",fontFamily:"'DM Sans',sans-serif"}}>{f.name}</div>
                      <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>{f.email}</div>
                    </div>
                    <button onClick={()=>!isSent&&inviteFriend(f)} disabled={isSent||isSending} style={{
                      padding:"7px 14px",borderRadius:10,border:"none",cursor:isSent?"default":"pointer",
                      background:isSent?"rgba(168,255,120,0.12)":"rgba(255,255,255,0.1)",
                      color:isSent?"#A8FF78":"rgba(255,255,255,0.7)",
                      fontSize:12,fontWeight:700,fontFamily:"'DM Sans',sans-serif",
                      flexShrink:0,transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)",opacity:isSending?0.5:1}}>
                      {isSending?"…":isSent?"Sent!":"Invite"}
                    </button>
                  </div>
                );
              })}
            </div>
            {error&&<p style={{fontSize:12,color:"#FF7878",margin:"8px 0 0",fontFamily:"'DM Sans',sans-serif"}}>{error}</p>}
          </div>
        )}

        {invitableFriends.length===0&&(
          <p style={{fontSize:13,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.6}}>
            {friends.length===0?"Add friends first in the Friends tab to invite them here.":"All your friends are already in this board!"}
          </p>
        )}

        {/* Divider */}
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{flex:1,height:1,background:"rgba(255,255,255,0.07)"}}/>
          <span style={{fontSize:11,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif"}}>or share link</span>
          <div style={{flex:1,height:1,background:"rgba(255,255,255,0.07)"}}/>
        </div>

        {/* Link */}
        <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",
          borderRadius:12,padding:"12px 14px",display:"flex",alignItems:"center",gap:10}}>
          <Icon d={Icons.link} size={14} stroke="rgba(255,255,255,0.3)"/>
          <span style={{flex:1,fontSize:11.5,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif",
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{link}</span>
        </div>
        <button onClick={copy} style={{
          background:copied?"rgba(168,255,120,0.15)":"rgba(255,255,255,0.08)",
          color:copied?"#A8FF78":"rgba(255,255,255,0.6)",
          border:copied?"1px solid rgba(168,255,120,0.3)":"1px solid rgba(255,255,255,0.1)",
          borderRadius:14,padding:"13px",fontSize:14,fontWeight:700,cursor:"pointer",
          fontFamily:"'DM Sans',sans-serif",transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)",
          display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <Icon d={Icons.copy} size={15} stroke="currentColor"/>
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
function BoardDetailPage({ board, user, members, allQuests, onBack, onSaveQuest, onDeleteQuest, onInvite, onLeave, friends=[] }) {
  const [boardQuests, setBoardQuests]     = useState([]);
  const [boardMembers, setBoardMembers]   = useState([]);
  const [loading, setLoading]             = useState(true);
  const [questModal, setQuestModal]       = useState(null);
  const [deleteTarget, setDeleteTarget]   = useState(null);
  const palette = getPalette(board.id);
  const isCreator = board.created_by === user?.id;

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
          <div style={{display:"flex",gap:8,flexShrink:0}}>
            <button onClick={onInvite} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",
              borderRadius:12,border:`1px solid ${palette.color}40`,background:`${palette.color}10`,
              color:palette.color,cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'DM Sans',sans-serif",
              whiteSpace:"nowrap"}}>
              <Icon d={Icons.link} size={13} stroke="currentColor"/> Invite
            </button>
            <button onClick={onLeave} style={{display:"flex",alignItems:"center",gap:5,padding:"8px 12px",
              borderRadius:12,border:"1px solid rgba(255,80,80,0.25)",background:"rgba(255,80,80,0.08)",
              color:"#FF7878",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'DM Sans',sans-serif",
              whiteSpace:"nowrap"}}>
              <Icon d={Icons.trash} size={13} stroke="currentColor"/>
              {isCreator?"Delete":"Leave"}
            </button>
          </div>
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
                    <div style={{width:36,height:36,borderRadius:10,flexShrink:0,overflow:"hidden",
                      background:m.photo?"transparent":`radial-gradient(circle at 35% 35%,${color}30,${color}08)`,
                      border:`1.5px solid ${color}40`,display:"flex",alignItems:"center",
                      justifyContent:"center",fontSize:18}}>
                      {m.photo?<img src={m.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:avatar}
                    </div>
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
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {boardQuests.map((q,i)=>(
            <div key={q.id}>
              <QuestCard quest={q} members={members} index={i}
                onEdit={q=>setQuestModal(q)} onDelete={id=>setDeleteTarget(id)}/>
              {/* Reactions row */}
              <div style={{padding:"8px 12px 0",display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:10,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif"}}>React:</span>
                <QuestReactions questId={q.id} userId={user?.id}/>
              </div>
            </div>
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
  // Large version for profile — Apple-Fitness-style ring around the rank icon
  return (
    <div style={{background:`${rank.color}10`,border:`1px solid ${rank.color}30`,
      borderRadius:16,padding:"16px 20px",display:"flex",alignItems:"center",gap:16}}>
      <ProgressRing size={66} stroke={5} pct={pct} color={rank.color}>
        <span style={{fontSize:26}}>{rank.icon}</span>
      </ProgressRing>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:19,fontWeight:700,color:rank.color,
          fontFamily:"'Cormorant Garamond',serif"}}>{rank.name}</div>
        <div style={{fontSize:12,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif"}}>
          {xp} XP total
        </div>
        {next?(
          <div style={{fontSize:11,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginTop:3}}>
            {next.min - xp} XP to <span style={{color:"rgba(255,255,255,0.5)",fontWeight:600}}>{next.name}</span>
          </div>
        ):(
          <div style={{fontSize:11,color:rank.color,fontFamily:"'DM Sans',sans-serif",marginTop:3,fontWeight:600}}>
            Max rank reached
          </div>
        )}
      </div>
      {next&&(
        <div style={{textAlign:"right",flexShrink:0}}>
          <div style={{fontSize:18,fontWeight:700,color:"#fff",fontFamily:"'Cormorant Garamond',serif"}}>{pct}%</div>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.06em"}}>TO NEXT</div>
        </div>
      )}
    </div>
  );
}

// ─── FRIENDS PAGE ─────────────────────────────────────────────────────────────
function FriendsPage({ user, quests, members=[], onAddToQuest, onFriendsLoaded }) {
  const [friends, setFriends]   = useState([]);
  const [pending, setPending]   = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [email, setEmail]       = useState("");
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");
  const [openFriend, setOpenFriend] = useState(null);
  const [view, setView]         = useState("friends"); // friends | leaderboard
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

      {/* Friends / Leaderboard toggle */}
      <div style={{display:"flex",background:"rgba(255,255,255,0.04)",borderRadius:12,
        padding:4,gap:4,marginBottom:20}}>
        {[{id:"friends",label:"Friends"},{id:"leaderboard",label:"Leaderboard"}].map(v=>(
          <button key={v.id} onClick={()=>setView(v.id)} style={{
            flex:1,padding:"9px",borderRadius:9,border:"none",cursor:"pointer",
            background:view===v.id?"rgba(255,255,255,0.1)":"transparent",
            color:view===v.id?"#F0F0F0":"rgba(255,255,255,0.35)",
            fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif",
            transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)"}}>
            {v.label}
          </button>
        ))}
      </div>

      {view==="leaderboard"&&(
        <LeaderboardView user={user} friends={friends} quests={quests} members={members}/>
      )}

      {view==="friends"&&(<>

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
                  <div style={{width:40,height:40,borderRadius:11,flexShrink:0,overflow:"hidden",
                    background:req.profile?.photo?"transparent":`radial-gradient(circle at 35% 35%,${color}30,${color}08)`,
                    border:`1.5px solid ${color}40`,display:"flex",alignItems:"center",
                    justifyContent:"center",fontSize:20}}>
                    {req.profile?.photo?<img src={req.profile.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:avatar}
                  </div>
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
                <button key={f.id} onClick={()=>setOpenFriend(f)} style={{background:"rgba(255,255,255,0.03)",
                  border:`1px solid ${color}25`,borderLeft:`3px solid ${color}`,textAlign:"left",cursor:"pointer",
                  borderRadius:14,padding:"14px 16px",width:"100%",
                  display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:44,height:44,borderRadius:12,flexShrink:0,overflow:"hidden",
                    background:f.photo?"transparent":`radial-gradient(circle at 35% 35%,${color}30,${color}08)`,
                    border:`1.5px solid ${color}40`,display:"flex",alignItems:"center",
                    justifyContent:"center",fontSize:22}}>
                    {f.photo?<img src={f.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:avatar}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:15,fontWeight:700,color:"#F0F0F0",
                      fontFamily:"'Cormorant Garamond',serif"}}>{f.name}</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif"}}>
                      {f.email}
                    </div>
                    <div style={{fontSize:11,color:color,fontFamily:"'DM Sans',sans-serif",marginTop:2}}>
                      {friendQuests.length} shared quest{friendQuests.length!==1?"s":""} · tap to view profile
                    </div>
                  </div>
                  <div onClick={async(e)=>{e.stopPropagation();if(!window.confirm(`Remove ${f.name} from friends?`))return;try{await sb.removeFriend(user.id,f.user_id);load();}catch(e){console.error(e);}}}
                    style={{background:"rgba(255,80,80,0.08)",border:"1px solid rgba(255,80,80,0.2)",
                      borderRadius:8,padding:"6px 8px",cursor:"pointer",color:"rgba(255,120,120,0.7)",
                      display:"flex",alignItems:"center",flexShrink:0}}>
                    <Icon d={Icons.trash} size={13}/>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      </>)}

      {openFriend&&(
        <FriendProfileModal friend={openFriend} onClose={()=>setOpenFriend(null)}/>
      )}
    </div>
  );
}




// ─── LEADERBOARD ──────────────────────────────────────────────────────────────
// Ranked fairly: everyone (including you) is scored only on PUBLIC quests, since
// that's the one dataset every person in the comparison actually has access to.
function LeaderboardView({ user, friends, quests, members }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric]   = useState("xp"); // xp | completed

  useEffect(()=>{
    let cancelled = false;
    (async()=>{
      setLoading(true);
      try {
        const friendPublicQuests = await Promise.all(
          friends.map(f=>sb.getFriendPublicQuests(f.user_id).catch(()=>[]))
        );
        if(cancelled) return;

        const me = members.find(m=>m.user_id===user.id);
        const myName = sb.getUser()?.name || localStorage.getItem("sq_name") || me?.name || user.email?.split("@")[0] || "You";
        const myPublicQuests = quests.filter(q=>q.is_public===true);

        const buildEntry = (id, name, photo, questList, isMe) => {
          const xp = calcXP(questList);
          const completedCount = questList.filter(q=>q.status==="Completed").length;
          return { id, name, photo, isMe, xp, completedCount, rank: getRank(xp) };
        };

        const list = [
          buildEntry(user.id, myName, me?.photo||null, myPublicQuests, true),
          ...friends.map((f,i)=>buildEntry(f.user_id, f.name, f.photo||null, friendPublicQuests[i]||[], false)),
        ];

        if(!cancelled) setEntries(list);
      } catch(e){ console.error(e); }
      if(!cancelled) setLoading(false);
    })();
    return ()=>{ cancelled=true; };
  },[friends.length]);

  const sorted = [...entries].sort((a,b)=>
    metric==="xp" ? b.xp-a.xp : b.completedCount-a.completedCount
  );
  const top3 = sorted.slice(0,3);
  const rest = sorted.slice(3);
  const podiumOrder = top3.length===3 ? [top3[1],top3[0],top3[2]] : top3; // silver, gold, bronze visual order

  const medalColor = (place)=>place===0?"#FBBF24":place===1?"#D1D5DB":"#CD7F32";
  const value = (e)=>metric==="xp"?e.xp:e.completedCount;
  const label = metric==="xp"?"XP":"Completed";

  return (
    <div>
      <p style={{fontSize:11,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",
        lineHeight:1.6,marginBottom:14}}>
        Ranked on public quests only — the one dataset everyone here can fairly see.
      </p>

      {/* Metric switch */}
      <div style={{display:"flex",gap:7,marginBottom:20}}>
        {[{id:"xp",label:"Most XP"},{id:"completed",label:"Most Completed"}].map(m=>{
          const active = metric===m.id;
          return(
            <button key={m.id} onClick={()=>setMetric(m.id)} style={{
              padding:"7px 14px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",
              fontFamily:"'DM Sans',sans-serif",
              border:`1px solid ${active?"#A8FF78":"rgba(255,255,255,0.09)"}`,
              background:active?"rgba(168,255,120,0.12)":"transparent",
              color:active?"#A8FF78":"rgba(255,255,255,0.35)",
              transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)",
            }}>{m.label}</button>
          );
        })}
      </div>

      {loading?(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {[...Array(4)].map((_,i)=>(
            <div key={i} style={{height:60,borderRadius:14,background:"rgba(255,255,255,0.04)",
              animation:"pulseDot 1.4s ease-in-out infinite",animationDelay:`${i*0.1}s`}}/>
          ))}
        </div>
      ):entries.length<=1?(
        <div style={{textAlign:"center",padding:"50px 0"}}>
          <div style={{fontSize:36,marginBottom:10,opacity:0.15}}>🏆</div>
          <p style={{fontSize:13,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.6}}>
            Add some friends to start a leaderboard.
          </p>
        </div>
      ):(
        <>
          {/* Podium — top 3 */}
          <div style={{display:"flex",alignItems:"flex-end",gap:8,marginBottom:20,padding:"0 4px"}}>
            {podiumOrder.map((e)=>{
              const place = top3.indexOf(e); // 0=gold,1=silver,2=bronze
              const isFirst = place===0;
              const {avatar,color} = getCharacter(e.name||"?");
              const mColor = medalColor(place);
              return(
                <div key={e.id} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",
                  order: place===0?2:place===1?1:3}}>
                  <div style={{fontSize:isFirst?20:15,marginBottom:4}}>
                    {place===0?"👑":place===1?"🥈":"🥉"}
                  </div>
                  <div style={{width:isFirst?60:48,height:isFirst?60:48,borderRadius:isFirst?18:14,
                    overflow:"hidden",flexShrink:0,marginBottom:8,
                    background:e.photo?"transparent":`radial-gradient(circle at 35% 35%,${color}35,${color}10)`,
                    border:`2.5px solid ${mColor}`,display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:isFirst?28:22,boxShadow:`0 0 20px ${mColor}50`}}>
                    {e.photo?<img src={e.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:avatar}
                  </div>
                  <div style={{fontSize:isFirst?13:12,fontWeight:700,color:"#F0F0F0",
                    fontFamily:"'Cormorant Garamond',serif",textAlign:"center",
                    whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>
                    {e.isMe?"You":e.name}
                  </div>
                  <div style={{fontSize:isFirst?15:13,fontWeight:700,color:mColor,
                    fontFamily:"'Cormorant Garamond',serif",marginTop:2}}>
                    {value(e)}
                  </div>
                  <div style={{width:"100%",height:isFirst?54:36,borderRadius:"10px 10px 0 0",
                    background:`linear-gradient(180deg,${mColor}30,${mColor}08)`,
                    border:`1px solid ${mColor}30`,borderBottom:"none",marginTop:8}}/>
                </div>
              );
            })}
          </div>

          {/* Rest of the list */}
          {rest.length>0&&(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {rest.map((e,i)=>{
                const {avatar,color} = getCharacter(e.name||"?");
                return(
                  <div key={e.id} style={{display:"flex",alignItems:"center",gap:12,
                    padding:"11px 14px",borderRadius:14,
                    background:e.isMe?"rgba(168,255,120,0.06)":"rgba(255,255,255,0.03)",
                    border:`1px solid ${e.isMe?"rgba(168,255,120,0.25)":"rgba(255,255,255,0.07)"}`}}>
                    <div style={{width:22,textAlign:"center",fontSize:13,fontWeight:700,
                      color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif",flexShrink:0}}>
                      {i+4}
                    </div>
                    <div style={{width:36,height:36,borderRadius:10,flexShrink:0,overflow:"hidden",
                      background:e.photo?"transparent":`radial-gradient(circle at 35% 35%,${color}30,${color}08)`,
                      border:`1.5px solid ${color}40`,display:"flex",alignItems:"center",
                      justifyContent:"center",fontSize:18}}>
                      {e.photo?<img src={e.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:avatar}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:700,color:"#F0F0F0",
                        fontFamily:"'Cormorant Garamond',serif",display:"flex",alignItems:"center",gap:6}}>
                        {e.isMe?"You":e.name}
                        <span style={{fontSize:12}}>{e.rank.icon}</span>
                      </div>
                      <div style={{fontSize:10.5,color:e.rank.color,fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>
                        {e.rank.name}
                      </div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:16,fontWeight:700,color:"#F0F0F0",
                        fontFamily:"'Cormorant Garamond',serif",lineHeight:1}}>{value(e)}</div>
                      <div style={{fontSize:8.5,color:"rgba(255,255,255,0.25)",letterSpacing:"0.06em",
                        marginTop:2,fontFamily:"'DM Sans',sans-serif",textTransform:"uppercase"}}>{label}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── FRIEND PROFILE MODAL — public quests + movie log, read-only ─────────────
function FriendProfileModal({ friend, onClose }) {
  const [visible, setVisible]   = useState(false);
  const [tab, setTab]           = useState("quests"); // quests | movies
  const [questFilter, setQuestFilter] = useState("Active");
  const [quests, setQuests]     = useState([]);
  const [movies, setMovies]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selectedMovie, setSelectedMovie] = useState(null);

  const {avatar,color} = getCharacter(friend.name||"?");

  useEffect(()=>{
    requestAnimationFrame(()=>setVisible(true));
    (async()=>{
      setLoading(true);
      try {
        const [q,m] = await Promise.all([
          sb.getFriendPublicQuests(friend.user_id),
          sb.getMovies(friend.user_id),
        ]);
        setQuests(q); setMovies(m);
      } catch(e){ console.error(e); }
      setLoading(false);
    })();
  },[]);

  const close=()=>{ setVisible(false); setTimeout(onClose,250); };

  const completedCount = quests.filter(q=>q.status==="Completed").length;
  const activeCount = quests.filter(q=>q.status==="Active").length;
  const filteredQuests = quests.filter(q=>q.status===questFilter);
  const ratedMovies = movies.filter(m=>m.rating>0);
  const avgRating = ratedMovies.length ? (ratedMovies.reduce((s,m)=>s+m.rating,0)/ratedMovies.length).toFixed(1) : "—";

  // XP/rank computed from what's actually visible to us — their public completed quests
  const friendXP = calcXP(quests);
  const friendRank = getRank(friendXP);
  const friendNextRank = RANKS.find(r=>r.min>friendXP);
  const friendPct = friendNextRank
    ? Math.round(((friendXP-friendRank.min)/(friendNextRank.min-friendRank.min))*100)
    : 100;

  return createPortal(
    <div style={{position:"fixed",inset:0,zIndex:9998,background:`rgba(0,0,0,${visible?0.8:0})`,
      backdropFilter:`blur(${visible?18:0}px)`,transition:"all 0.25s"}}
      onClick={e=>e.target===e.currentTarget&&close()}>
      <div style={{
        position:"fixed",top:0,left:0,right:0,bottom:0,margin:"0 auto",maxWidth:560,
        background:"linear-gradient(160deg,#111114,#0A0A0C)",
        overflowY:"auto",WebkitOverflowScrolling:"touch",
        transform:visible?"translateY(0)":"translateY(100%)",
        transition:"transform 0.35s cubic-bezier(0.34,1.1,0.64,1)",
      }}>
        {/* Header */}
        <div style={{position:"sticky",top:0,zIndex:2,background:"rgba(10,10,12,0.9)",
          backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(255,255,255,0.06)",
          padding:"18px 20px 0"}}>
          <button onClick={close} style={{background:"rgba(255,255,255,0.06)",
            border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"7px 10px",
            cursor:"pointer",color:"rgba(255,255,255,0.5)",display:"flex",alignItems:"center",gap:6,
            fontSize:12,fontFamily:"'DM Sans',sans-serif",marginBottom:16}}>
            <Icon d={Icons.back} size={14}/> Back
          </button>

          <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16}}>
            <ProgressRing size={76} stroke={4} pct={friendPct} color={friendRank.color}>
              <div style={{width:58,height:58,borderRadius:15,flexShrink:0,overflow:"hidden",
                background:friend.photo?"transparent":`radial-gradient(circle at 35% 35%,${color}35,${color}10)`,
                border:`2px solid ${color}50`,display:"flex",alignItems:"center",
                justifyContent:"center",fontSize:28,boxShadow:`0 0 24px ${color}25`}}>
                {friend.photo?<img src={friend.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:avatar}
              </div>
            </ProgressRing>
            <div style={{minWidth:0}}>
              <div style={{fontSize:20,fontWeight:700,color:"#F2F2F2",
                fontFamily:"'Cormorant Garamond',serif"}}>{friend.name}</div>
              <div style={{fontSize:11,color,fontWeight:700,letterSpacing:"0.06em",
                textTransform:"uppercase",fontFamily:"'DM Sans',sans-serif",marginBottom:4}}>{getTitle(friend.name||"?")}</div>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <span style={{fontSize:13}}>{friendRank.icon}</span>
                <span style={{fontSize:12,fontWeight:700,color:friendRank.color,
                  fontFamily:"'DM Sans',sans-serif"}}>{friendRank.name}</span>
                <span style={{fontSize:11,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif"}}>
                  · {friendXP} XP
                </span>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            {[
              {l:"Active",v:activeCount},
              {l:"Completed",v:completedCount},
              {l:"Movies",v:movies.length},
              {l:"Avg ★",v:avgRating},
            ].map(({l,v})=>(
              <div key={l} style={{flex:1,textAlign:"center",background:"rgba(255,255,255,0.03)",
                border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"8px 4px"}}>
                <div style={{fontSize:17,fontWeight:700,color:"#F0F0F0",
                  fontFamily:"'Cormorant Garamond',serif",lineHeight:1}}>{v}</div>
                <div style={{fontSize:8.5,color:"rgba(255,255,255,0.3)",letterSpacing:"0.06em",
                  marginTop:3,fontFamily:"'DM Sans',sans-serif",textTransform:"uppercase"}}>{l}</div>
              </div>
            ))}
          </div>

          {/* Tab switch */}
          <div style={{display:"flex",gap:6,marginBottom:0}}>
            {[{id:"quests",label:"Quests",icon:Icons.shield},{id:"movies",label:"Movies",icon:Icons.film}].map(t=>{
              const active = tab===t.id;
              return(
                <button key={t.id} onClick={()=>setTab(t.id)} style={{
                  flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,
                  padding:"10px 0",background:"none",border:"none",cursor:"pointer",
                  borderBottom:`2px solid ${active?"rgba(255,255,255,0.6)":"transparent"}`,
                  color:active?"#fff":"rgba(255,255,255,0.35)",
                  fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>
                  <Icon d={t.icon} size={14} stroke="currentColor"/> {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div style={{padding:"18px 20px 60px"}}>
          {loading?(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {[...Array(3)].map((_,i)=>(
                <div key={i} style={{height:64,borderRadius:16,background:"rgba(255,255,255,0.04)",
                  animation:"pulseDot 1.4s ease-in-out infinite",animationDelay:`${i*0.1}s`}}/>
              ))}
            </div>
          ):tab==="quests"?(
            <>
              <div style={{display:"flex",gap:7,marginBottom:14}}>
                {["Active","Completed"].map(s=>{
                  const active=questFilter===s;
                  const sColor = STATUS_META[s]?.color||"#A8FF78";
                  return(
                    <button key={s} onClick={()=>setQuestFilter(s)} style={{
                      padding:"6px 14px",borderRadius:20,fontSize:11,fontWeight:600,
                      cursor:"pointer",fontFamily:"'DM Sans',sans-serif",
                      border:`1px solid ${active?sColor:"rgba(255,255,255,0.09)"}`,
                      background:active?`${sColor}15`:"transparent",
                      color:active?sColor:"rgba(255,255,255,0.3)",
                      transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)"}}>
                      {s} {s==="Active"?activeCount:completedCount}
                    </button>
                  );
                })}
              </div>

              {filteredQuests.length===0?(
                <div style={{textAlign:"center",padding:"50px 0"}}>
                  <div style={{fontSize:36,marginBottom:10,opacity:0.15}}>🔒</div>
                  <p style={{fontSize:13,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.6}}>
                    No public {questFilter.toLowerCase()} quests to show.
                  </p>
                </div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {filteredQuests.map((q,i)=>{
                    const palette = getPalette(q.id, q.color_index);
                    return(
                      <div key={q.id} style={{
                        position:"relative",overflow:"hidden",borderRadius:16,
                        background:`linear-gradient(135deg,${palette.color}16 0%,${palette.color}06 100%)`,
                        border:`1px solid ${palette.color}25`,padding:"14px 16px",
                        animation:`cardIn 0.4s cubic-bezier(0.34,1.2,0.64,1) ${i*0.04}s both`,
                      }}>
                        <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:palette.grad,opacity:0.6}}/>
                        <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                          {q.emoji&&<span style={{fontSize:20,flexShrink:0}}>{q.emoji}</span>}
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:15,fontWeight:700,color:"#fff",
                              fontFamily:"'Cormorant Garamond',serif",lineHeight:1.3,wordBreak:"break-word"}}>
                              {q.title}
                            </div>
                            {q.description&&<div style={{fontSize:12,color:"rgba(255,255,255,0.4)",
                              fontFamily:"'DM Sans',sans-serif",marginTop:4,lineHeight:1.5}}>{q.description}</div>}
                            {q.location?.name&&<div style={{fontSize:11,color:"rgba(255,255,255,0.3)",
                              fontFamily:"'DM Sans',sans-serif",marginTop:4}}>📍 {q.location.name}</div>}
                          </div>
                        </div>
                        {q.photo&&<img src={q.photo} alt="" style={{width:"100%",height:140,objectFit:"cover",
                          borderRadius:10,marginTop:10}}/>}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ):(
            movies.length===0?(
              <div style={{textAlign:"center",padding:"50px 0"}}>
                <div style={{fontSize:36,marginBottom:10,opacity:0.15}}>🎬</div>
                <p style={{fontSize:13,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.6}}>
                  Nothing logged yet.
                </p>
              </div>
            ):(
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
                {movies.map((m,i)=>(
                  <button key={m.id} onClick={()=>setSelectedMovie(m)} style={{
                    position:"relative",aspectRatio:"2/3",borderRadius:12,overflow:"hidden",padding:0,
                    border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.03)",cursor:"pointer",
                    animation:`cardIn 0.4s cubic-bezier(0.34,1.2,0.64,1) ${i*0.03}s both`,
                  }}>
                    {m.poster?(
                      <img src={m.poster} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                    ):(
                      <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",
                        justifyContent:"center",padding:8,textAlign:"center",
                        background:`linear-gradient(160deg,${MOVIE_ACCENT}18,rgba(255,255,255,0.02))`}}>
                        <span style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.5)",
                          fontFamily:"'Cormorant Garamond',serif",lineHeight:1.3}}>{m.title}</span>
                      </div>
                    )}
                    {m.season_number!=null&&(
                      <div style={{position:"absolute",top:5,left:5,fontSize:9.5,fontWeight:700,
                        background:"rgba(0,0,0,0.65)",color:MOVIE_ACCENT,borderRadius:5,
                        padding:"2px 5px",fontFamily:"'DM Sans',sans-serif"}}>
                        S{m.season_number}
                      </div>
                    )}
                    {m.review&&(
                      <div style={{position:"absolute",top:5,right:5,width:16,height:16,borderRadius:"50%",
                        background:"rgba(0,0,0,0.65)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <Icon d={Icons.film} size={9} stroke={MOVIE_ACCENT}/>
                      </div>
                    )}
                    {m.status!=="watched"&&(
                      <div style={{position:"absolute",top:m.review?26:5,right:5,fontSize:12,
                        background:"rgba(0,0,0,0.6)",borderRadius:6,padding:"2px 4px"}}>
                        {MOVIE_STATUSES.find(s=>s.id===m.status)?.icon}
                      </div>
                    )}
                    {m.rating>0&&(
                      <div style={{position:"absolute",bottom:0,left:0,right:0,
                        background:"linear-gradient(to top,rgba(0,0,0,0.85),transparent)",
                        padding:"14px 5px 5px",display:"flex",justifyContent:"center",gap:1}}>
                        {[1,2,3,4,5].map(n=>(
                          <Icon key={n} d={Icons.star} size={9}
                            fill={n<=m.rating?MOVIE_ACCENT:"none"}
                            stroke={n<=m.rating?MOVIE_ACCENT:"rgba(255,255,255,0.3)"}/>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )
          )}
        </div>

        {selectedMovie&&(
          <FriendMovieDetail movie={selectedMovie} onClose={()=>setSelectedMovie(null)}/>
        )}
      </div>
    </div>,
    document.body
  );
}


// ─── FRIEND MOVIE DETAIL — read-only, surfaces the review/comment not just the rating ──
function FriendMovieDetail({ movie, onClose }) {
  const [visible, setVisible] = useState(false);
  useEffect(()=>{ requestAnimationFrame(()=>setVisible(true)); },[]);
  const close=()=>{ setVisible(false); setTimeout(onClose,250); };
  const statusMeta = MOVIE_STATUSES.find(s=>s.id===movie.status);

  return createPortal(
    <div style={{position:"fixed",inset:0,zIndex:10000,background:`rgba(0,0,0,${visible?0.82:0})`,
      backdropFilter:`blur(${visible?18:0}px)`,display:"flex",alignItems:"flex-end",
      justifyContent:"center",transition:"all 0.25s"}}
      onClick={e=>e.target===e.currentTarget&&close()}>
      <div style={{background:"linear-gradient(160deg,#111114,#0C0C0F)",
        borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,0.09)",borderBottom:"none",
        width:"100%",maxWidth:560,padding:"12px 22px 44px",
        display:"flex",flexDirection:"column",gap:14,
        transform:visible?"translateY(0)":"translateY(100%)",
        transition:"transform 0.3s cubic-bezier(0.34,1.1,0.64,1)",
        maxHeight:"85vh",overflowY:"auto",WebkitOverflowScrolling:"touch"}}>
        <div style={{width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.1)",margin:"8px auto 0"}}/>

        <div style={{display:"flex",justifyContent:"flex-end"}}>
          <button onClick={close} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",
            borderRadius:10,padding:"7px 8px",cursor:"pointer",color:"rgba(255,255,255,0.4)"}}>
            <Icon d={Icons.x} size={16}/>
          </button>
        </div>

        {/* Poster + title */}
        <div style={{display:"flex",gap:14}}>
          {movie.poster?(
            <img src={movie.poster} alt="" style={{width:80,height:114,objectFit:"cover",
              borderRadius:10,flexShrink:0,border:"1px solid rgba(255,255,255,0.08)"}}/>
          ):(
            <div style={{width:80,height:114,borderRadius:10,flexShrink:0,
              background:`linear-gradient(160deg,${MOVIE_ACCENT}18,rgba(255,255,255,0.02))`,
              display:"flex",alignItems:"center",justifyContent:"center",padding:6,textAlign:"center"}}>
              <span style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.5)",
                fontFamily:"'Cormorant Garamond',serif"}}>{movie.title}</span>
            </div>
          )}
          <div style={{minWidth:0,display:"flex",flexDirection:"column",gap:6}}>
            <div>
              <div style={{fontSize:18,fontWeight:700,color:"#F2F2F2",
                fontFamily:"'Cormorant Garamond',serif",lineHeight:1.25}}>{movie.title}</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Sans',sans-serif",marginTop:2}}>
                {movie.year}{movie.season_number!=null?` · Season ${movie.season_number}`:""}
                {" · "}{movie.media_type==="tv"?"TV Show":"Movie"}
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:11,fontWeight:700,padding:"3px 9px",borderRadius:20,
                background:`${MOVIE_ACCENT}15`,border:`1px solid ${MOVIE_ACCENT}30`,color:MOVIE_ACCENT,
                fontFamily:"'DM Sans',sans-serif"}}>
                {statusMeta?.icon} {statusMeta?.label}
              </span>
            </div>
            {movie.rating>0&&<StarRating value={movie.rating} readOnly size={16}/>}
            {movie.watched_date&&(
              <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>
                {movie.status==="watching"?"Started":"Watched"} {new Date(movie.watched_date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
              </div>
            )}
          </div>
        </div>

        {/* The comment/review — the whole point of this view */}
        <div>
          <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
            color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginBottom:8}}>
            {friend_review_label(movie)}
          </p>
          {movie.review?(
            <p style={{fontSize:14,color:"rgba(255,255,255,0.75)",fontFamily:"'DM Sans',sans-serif",
              lineHeight:1.6,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",
              borderRadius:14,padding:"14px 16px",margin:0}}>
              {movie.review}
            </p>
          ):(
            <p style={{fontSize:13,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif",
              fontStyle:"italic",margin:0}}>
              No comment left for this one.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
function friend_review_label(movie){
  return movie.media_type==="tv" && movie.season_number!=null
    ? `Thoughts on Season ${movie.season_number}`
    : "Thoughts";
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
      }, "user_id");
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
function ProfilePage({ user, quests, onSignOut, onNameChange, onPhotoChange }) {
  const [name, setName]       = useState("");
  const [photo, setPhoto]     = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [loading, setLoading] = useState(true);
  const [memberId, setMemberId] = useState(null);
  const [memberCreatedAt, setMemberCreatedAt] = useState(null);

  const userXP   = calcXP(quests);
  const userRank = getRank(userXP);
  const completedCount = quests.filter(q=>q.status==="Completed").length;

  useEffect(()=>{
    // Load name from auth metadata (the source of truth)
    const authName = sb.getUser()?.name
      || localStorage.getItem("sq_name")
      || user.email?.split("@")[0]||"";
    setName(authName);
    // Load own member record for photo + to know the row id when saving
    sb.getAll("members", user.id).then(rows=>{
      const me = Array.isArray(rows)?rows.find(m=>m.user_id===user.id):null;
      if(me) { setPhoto(me.photo||null); setMemberId(me.id); setMemberCreatedAt(me.created_at); }
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[]);

  const saveName = async() => {
    if(!name.trim()) return;
    setSaving(true);
    try {
      await sb.upsert("members",{
        id: memberId || crypto.randomUUID(),
        name: name.trim(),
        display_name: name.trim(),
        email: user.email,
        user_id: user.id,
        photo,
        note: "Account owner",
        created_at: memberCreatedAt || new Date().toISOString(),
      }, "user_id");
      setSaved(true);
      onNameChange(name.trim());
      setTimeout(()=>setSaved(false),2500);
    } catch(e){console.error(e); setError("Could not save name.");}
    setSaving(false);
  };
  const [error, setError] = useState("");

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if(!file) return;
    setUploadingPhoto(true);
    const reader = new FileReader();
    reader.onload = async(ev) => {
      const dataUrl = ev.target.result;
      setPhoto(dataUrl);
      try {
        await sb.upsert("members",{
          id: memberId || crypto.randomUUID(),
          name: name.trim()||user.email?.split("@")[0]||"Adventurer",
          display_name: name.trim()||user.email?.split("@")[0]||"Adventurer",
          email: user.email,
          user_id: user.id,
          photo: dataUrl,
          note: "Account owner",
          created_at: memberCreatedAt || new Date().toISOString(),
        }, "user_id");
        onPhotoChange&&onPhotoChange(dataUrl);
      } catch(e){ console.error(e); }
      setUploadingPhoto(false);
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = async() => {
    setPhoto(null);
    try {
      await sb.upsert("members",{
        id: memberId || crypto.randomUUID(),
        name: name.trim()||user.email?.split("@")[0]||"Adventurer",
        display_name: name.trim()||user.email?.split("@")[0]||"Adventurer",
        email: user.email,
        user_id: user.id,
        photo: null,
        note: "Account owner",
        created_at: memberCreatedAt || new Date().toISOString(),
      }, "user_id");
      onPhotoChange&&onPhotoChange(null);
    } catch(e){ console.error(e); }
  };

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

      {/* Avatar card — ring shows XP progress to next rank, Apple-Fitness style */}
      <div style={{background:`${color}08`,border:`1px solid ${color}25`,borderRadius:20,
        padding:"24px 20px",marginBottom:16,position:"relative",overflow:"hidden",textAlign:"center"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,
          background:`linear-gradient(90deg,transparent,${color}80,transparent)`}}/>
        <div style={{display:"flex",justifyContent:"center",marginBottom:12}}>
          <ProgressRing size={96} stroke={5} pct={pct} color={userRank.color}>
            <label style={{width:76,height:76,borderRadius:20,cursor:"pointer",position:"relative",
              background:photo?"transparent":`radial-gradient(circle at 35% 35%,${color}35,${color}10)`,
              border:`2px solid ${color}50`,display:"flex",alignItems:"center",overflow:"hidden",
              justifyContent:"center",fontSize:38,
              boxShadow:`0 0 32px ${color}30`}}>
              {photo?(
                <img src={photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              ):avatar}
              {/* Camera badge — tap the avatar to upload/change your photo */}
              <div style={{position:"absolute",bottom:-2,right:-2,width:26,height:26,borderRadius:9,
                background:"rgba(10,10,12,0.95)",border:"2px solid #08080A",
                display:"flex",alignItems:"center",justifyContent:"center",
                opacity:uploadingPhoto?0.5:1}}>
                {uploadingPhoto?(
                  <div style={{width:11,height:11,border:"2px solid rgba(255,255,255,0.15)",
                    borderTopColor:"#fff",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>
                ):(
                  <Icon d={Icons.camera} size={12} stroke="rgba(255,255,255,0.8)"/>
                )}
              </div>
              <input type="file" accept="image/*" style={{display:"none"}}
                disabled={uploadingPhoto} onChange={handlePhotoUpload}/>
            </label>
          </ProgressRing>
        </div>
        {photo&&(
          <button onClick={removePhoto} style={{background:"none",border:"none",cursor:"pointer",
            color:"rgba(255,120,120,0.6)",fontSize:11,fontFamily:"'DM Sans',sans-serif",
            marginBottom:8,textDecoration:"underline"}}>
            Remove photo
          </button>
        )}
        <div style={{fontSize:22,fontWeight:700,color:"#F2F2F2",
          fontFamily:"'Cormorant Garamond',serif",marginBottom:4}}>{preview}</div>
        <div style={{fontSize:11,color:color,fontWeight:700,letterSpacing:"0.08em",
          textTransform:"uppercase",marginBottom:14}}>{getTitle(preview)}</div>

        {/* Rank + progress readout — the ring above already IS the progress bar */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginBottom:16}}>
          <span style={{fontSize:15}}>{userRank.icon}</span>
          <span style={{fontSize:13,fontWeight:700,color:userRank.color,
            fontFamily:"'DM Sans',sans-serif"}}>{userRank.name}</span>
          {nextRank?(
            <span style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>
              · {nextRank.min-userXP} XP to {nextRank.name}
            </span>
          ):(
            <span style={{fontSize:11,color:userRank.color,fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>
              · Max rank
            </span>
          )}
        </div>

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

      {/* Lifetime stats */}
      <LifetimeStats user={user} quests={quests}/>

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



// ─── MOVIES / SHOWS LOG (Letterboxd-style) ────────────────────────────────────
const MOVIE_ACCENT = "#FBBF24"; // cinematic gold — used for ratings & accents

function StarRating({ value=0, onChange, size=18, readOnly=false }) {
  const [hover, setHover] = useState(0);
  const display = hover || value;
  return (
    <div style={{display:"flex",gap:2}} onMouseLeave={()=>setHover(0)}>
      {[1,2,3,4,5].map(n=>(
        <button key={n} type="button" disabled={readOnly}
          onClick={()=>onChange&&onChange(n===value?0:n)}
          onMouseEnter={()=>!readOnly&&setHover(n)}
          style={{background:"none",border:"none",padding:1,
            cursor:readOnly?"default":"pointer",lineHeight:0}}>
          <Icon d={Icons.star} size={size}
            fill={n<=display?MOVIE_ACCENT:"none"}
            stroke={n<=display?MOVIE_ACCENT:"rgba(255,255,255,0.25)"}/>
        </button>
      ))}
    </div>
  );
}

const MOVIE_STATUSES = [
  {id:"watched",  label:"Watched",       icon:"🎬"},
  {id:"watching", label:"Watching",      icon:"👀"},
  {id:"want",     label:"Want to Watch", icon:"🍿"},
];

function MoviesPage({ user }) {
  const [movies, setMovies]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState("all");
  const [editing, setEditing]     = useState(null); // movie object or "new" or null

  const load = async()=>{
    setLoading(true);
    try { setMovies(await sb.getMovies(user.id)); } catch(e){ console.error(e); }
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  const filtered = filter==="all" ? movies : movies.filter(m=>m.status===filter);
  const watchedCount = movies.filter(m=>m.status==="watched").length;
  const thisYear = new Date().getFullYear();
  const thisYearCount = movies.filter(m=>m.status==="watched" && m.watched_date && new Date(m.watched_date).getFullYear()===thisYear).length;
  const rated = movies.filter(m=>m.rating>0);
  const avgRating = rated.length ? (rated.reduce((s,m)=>s+m.rating,0)/rated.length).toFixed(1) : "—";

  const handleSave = async(movie)=>{
    await sb.upsertMovie({...movie, user_id:user.id});
    await load();
    setEditing(null);
  };
  const handleDelete = async(id)=>{
    await sb.deleteMovie(id);
    await load();
    setEditing(null);
  };

  return (
    <div style={{maxWidth:560,margin:"0 auto",padding:"20px 24px 100px"}}>
      <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",
        color:"rgba(255,255,255,0.2)",marginBottom:4}}>Your Watchlist</p>
      <h2 style={{fontSize:24,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",
        background:"linear-gradient(135deg,#F2F2F2,rgba(242,242,242,0.5))",
        WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:16}}>
        Movies & Shows
      </h2>

      {/* Stats */}
      <div style={{display:"flex",gap:10,marginBottom:16}}>
        {[
          {l:"Watched",v:watchedCount},
          {l:`${thisYear}`,v:thisYearCount},
          {l:"Avg Rating",v:avgRating},
        ].map(({l,v})=>(
          <div key={l} style={{flex:1,textAlign:"center",background:"rgba(255,255,255,0.03)",
            border:`1px solid ${MOVIE_ACCENT}20`,borderRadius:12,padding:"10px 8px"}}>
            <div style={{fontSize:20,fontWeight:700,color:MOVIE_ACCENT,
              fontFamily:"'Cormorant Garamond',serif",lineHeight:1}}>{v}</div>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:"0.08em",
              marginTop:3,fontFamily:"'DM Sans',sans-serif",textTransform:"uppercase"}}>{l}</div>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{display:"flex",gap:7,marginBottom:16,overflowX:"auto"}}>
        {[{id:"all",label:"All",icon:"🎞"},...MOVIE_STATUSES].map(s=>{
          const active=filter===s.id;
          return(
            <button key={s.id} onClick={()=>setFilter(s.id)} style={{
              padding:"6px 13px",borderRadius:20,fontSize:11,fontWeight:600,
              cursor:"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",
              border:`1px solid ${active?MOVIE_ACCENT:"rgba(255,255,255,0.09)"}`,
              background:active?`${MOVIE_ACCENT}18`:"transparent",
              color:active?MOVIE_ACCENT:"rgba(255,255,255,0.3)",
              transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)",flexShrink:0,
            }}>{s.icon} {s.label}</button>
          );
        })}
      </div>

      {loading?(
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
          {[...Array(6)].map((_,i)=>(
            <div key={i} style={{aspectRatio:"2/3",borderRadius:12,
              background:"rgba(255,255,255,0.04)",animation:"pulseDot 1.4s ease-in-out infinite",
              animationDelay:`${i*0.08}s`}}/>
          ))}
        </div>
      ):filtered.length===0?(
        <div style={{textAlign:"center",padding:"60px 0"}}>
          <div style={{fontSize:40,marginBottom:12,opacity:0.15}}>🎬</div>
          <p style={{fontSize:14,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.7}}>
            Nothing logged yet.<br/>Add the first thing you watched.
          </p>
        </div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
          {filtered.map((m,i)=>(
            <button key={m.id} onClick={()=>setEditing(m)} style={{
              position:"relative",aspectRatio:"2/3",borderRadius:12,overflow:"hidden",
              border:"1px solid rgba(255,255,255,0.08)",cursor:"pointer",padding:0,
              background:"rgba(255,255,255,0.03)",
              animation:`cardIn 0.4s cubic-bezier(0.34,1.2,0.64,1) ${i*0.03}s both`,
            }}>
              {m.poster?(
                <img src={m.poster} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
              ):(
                <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",
                  justifyContent:"center",padding:8,textAlign:"center",
                  background:`linear-gradient(160deg,${MOVIE_ACCENT}18,rgba(255,255,255,0.02))`}}>
                  <span style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",
                    fontFamily:"'Cormorant Garamond',serif",lineHeight:1.3}}>{m.title}</span>
                </div>
              )}
              {/* Season tag — top left */}
              {m.season_number!=null&&(
                <div style={{position:"absolute",top:5,left:5,fontSize:9.5,fontWeight:700,
                  background:"rgba(0,0,0,0.65)",color:MOVIE_ACCENT,borderRadius:5,
                  padding:"2px 5px",fontFamily:"'DM Sans',sans-serif"}}>
                  S{m.season_number}
                </div>
              )}
              {/* Status corner tag */}
              {m.status!=="watched"&&(
                <div style={{position:"absolute",top:5,right:5,fontSize:13,
                  background:"rgba(0,0,0,0.6)",borderRadius:6,padding:"2px 4px"}}>
                  {MOVIE_STATUSES.find(s=>s.id===m.status)?.icon}
                </div>
              )}
              {/* Rating strip */}
              {m.rating>0&&(
                <div style={{position:"absolute",bottom:0,left:0,right:0,
                  background:"linear-gradient(to top,rgba(0,0,0,0.85),transparent)",
                  padding:"14px 5px 5px",display:"flex",justifyContent:"center",gap:1}}>
                  {[1,2,3,4,5].map(n=>(
                    <Icon key={n} d={Icons.star} size={9}
                      fill={n<=m.rating?MOVIE_ACCENT:"none"}
                      stroke={n<=m.rating?MOVIE_ACCENT:"rgba(255,255,255,0.3)"}/>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* FAB */}
      <button onClick={()=>setEditing("new")} style={{
        position:"fixed",right:20,bottom:96,zIndex:60,
        width:56,height:56,borderRadius:18,border:"none",cursor:"pointer",
        background:`linear-gradient(135deg,${MOVIE_ACCENT},#F59E0B)`,color:"#0A0A0C",
        display:"flex",alignItems:"center",justifyContent:"center",
        boxShadow:`0 6px 24px ${MOVIE_ACCENT}40,0 2px 10px rgba(0,0,0,0.5)`,
        transition:"transform 0.2s cubic-bezier(0.34,1.56,0.64,1)"}}
        onMouseEnter={e=>e.currentTarget.style.transform="scale(1.08)"}
        onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
        <Icon d={Icons.plus} size={24} stroke="#0A0A0C"/>
      </button>

      {editing&&(
        <MovieModal
          movie={editing==="new"?null:editing}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={()=>setEditing(null)}
        />
      )}
    </div>
  );
}

// ─── MOVIE ADD/EDIT MODAL — search via iTunes (free, no API key) ─────────────
function MovieModal({ movie, onSave, onDelete, onClose }) {
  const [visible, setVisible]   = useState(false);
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [saving, setSaving]     = useState(false);
  const debounce = useRef(null);
  const latestQuery = useRef(""); // guards against a slower, older request overwriting a newer one

  const [title, setTitle]     = useState(movie?.title||"");
  const [poster, setPoster]   = useState(movie?.poster||null);
  const [year, setYear]       = useState(movie?.year||"");
  const [mediaType, setMediaType] = useState(movie?.media_type||"movie");
  const [status, setStatus]   = useState(movie?.status||"watched");
  const [rating, setRating]   = useState(movie?.rating||0);
  const [watchedDate, setWatchedDate] = useState(movie?.watched_date||new Date().toISOString().slice(0,10));
  const [review, setReview]   = useState(movie?.review||"");
  const [pickedFromSearch, setPickedFromSearch] = useState(!!movie);

  // TV season tracking — a show is made of seasons, each logged as its own entry
  const [showId, setShowId]         = useState(movie?.tmdb_id||null);
  const [seasonNumber, setSeasonNumber] = useState(
    movie?.season_number!=null ? movie.season_number : null
  );
  const [tvSeasons, setTvSeasons]   = useState([]);
  const [loadingSeasons, setLoadingSeasons] = useState(false);
  const [showSeasonList, setShowSeasonList] = useState(false);

  useEffect(()=>{ requestAnimationFrame(()=>setVisible(true)); },[]);
  const close=()=>{ setVisible(false); setTimeout(onClose,250); };

  const fetchSeasons = async(id)=>{
    setLoadingSeasons(true);
    try {
      const res = await fetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_KEY}&language=en-US`);
      const data = await res.json();
      const seasons = (data.seasons||[])
        .filter(s=>s.season_number>0) // skip "Specials" (season 0) clutter, still watchable via "Whole Series"
        .map(s=>({
          season_number: s.season_number,
          name: s.name || `Season ${s.season_number}`,
          poster: s.poster_path ? `https://image.tmdb.org/t/p/w300${s.poster_path}` : null,
          episode_count: s.episode_count,
          air_date: s.air_date,
        }));
      setTvSeasons(seasons);
    } catch(e){ console.error("Season fetch failed:", e); setTvSeasons([]); }
    setLoadingSeasons(false);
  };

  const pickSeason = (s)=>{
    if(s===null) { setSeasonNumber(null); setShowSeasonList(false); return; }
    setSeasonNumber(s.season_number);
    if(s.poster) setPoster(s.poster);
    setShowSeasonList(false);
  };

  // TMDB (themoviedb.org) — the actual database Letterboxd itself runs on.
  // One call covers movies + TV together and is far more complete/reliable than
  // iTunes' catalog, which is only what's sellable/rentable in the store.
  const search = async(q)=>{
    const trimmed = q.trim();
    latestQuery.current = trimmed;
    if(!trimmed||trimmed.length<2){ setResults([]); setSearching(false); return; }
    setSearching(true);
    setSearchError(false);
    try {
      const res = await fetch(
        `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(trimmed)}&include_adult=false&language=en-US`
      );
      if(!res.ok) throw new Error(`TMDB responded ${res.status}`);
      const data = await res.json();

      // A newer keystroke already kicked off a fresher search — throw this stale
      // response away instead of letting it clobber what's currently on screen.
      if(latestQuery.current !== trimmed) return;

      let items = (data.results||[])
        .filter(r=>r.media_type==="movie"||r.media_type==="tv")
        .map(r=>{
          const isMovie = r.media_type==="movie";
          const title = isMovie ? r.title : r.name;
          const date  = isMovie ? r.release_date : r.first_air_date;
          return {
            id: r.id, // TMDB id — needed to fetch a TV show's season list
            title,
            year: (date||"").slice(0,4),
            poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
            type: isMovie ? "movie" : "tv",
            popularity: r.popularity||0,
          };
        })
        .filter(r=>r.title);

      // De-dupe by title+year
      const seen = new Set();
      items = items.filter(r=>{
        const k=(r.title+r.year).toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true;
      });

      // Relevance sort: exact/starts-with/contains tier first, popularity breaks ties —
      // this is what puts Dune (2021) above obscure same-word results.
      const qLower = trimmed.toLowerCase();
      const score = (t)=>{
        const s = t.toLowerCase();
        if(s===qLower) return 0;
        if(s.startsWith(qLower)) return 1;
        if(s.includes(qLower)) return 2;
        return 3;
      };
      items.sort((a,b)=> score(a.title)-score(b.title) || b.popularity-a.popularity);

      setResults(items.slice(0,16));
    } catch(e) {
      console.error("Movie search failed:", e);
      if(latestQuery.current === trimmed) { setResults([]); setSearchError(true); }
    }
    if(latestQuery.current === trimmed) setSearching(false);
  };

  const onTitleChange = (v)=>{
    setTitle(v); setPickedFromSearch(false);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(()=>search(v), 300);
  };

  const pick = (r)=>{
    setTitle(r.title); setPoster(r.poster); setYear(r.year);
    setMediaType(r.type); setResults([]); setPickedFromSearch(true);
    setSeasonNumber(null); setTvSeasons([]); setShowSeasonList(false);
    if(r.type==="tv" && r.id) {
      setShowId(r.id);
      fetchSeasons(r.id);
    } else {
      setShowId(null);
    }
  };

  const save = async()=>{
    if(!title.trim()) return;
    setSaving(true);
    await onSave({
      id: movie?.id || crypto.randomUUID(),
      title: title.trim(), poster, year, media_type: mediaType,
      tmdb_id: mediaType==="tv" ? showId : null,
      season_number: mediaType==="tv" ? seasonNumber : null,
      status, rating, watched_date: status==="want"?null:watchedDate,
      review: review.trim(), created_at: movie?.created_at || new Date().toISOString(),
    });
    setSaving(false);
  };

  const lbl = {fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
    color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginBottom:7,display:"block"};
  const inp = {width:"100%",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",
    borderRadius:12,padding:"11px 14px",color:"#F0F0F0",fontSize:14,outline:"none",
    fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box"};

  return createPortal(
    <div style={{position:"fixed",inset:0,background:`rgba(0,0,0,${visible?0.78:0})`,
      backdropFilter:`blur(${visible?18:0}px)`,display:"flex",alignItems:"flex-end",
      justifyContent:"center",zIndex:9999,transition:"all 0.25s"}}
      onClick={e=>e.target===e.currentTarget&&close()}>
      <div style={{background:"linear-gradient(160deg,#111114,#0C0C0F)",
        borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,0.09)",borderBottom:"none",
        width:"100%",maxWidth:560,padding:"12px 22px 44px",
        display:"flex",flexDirection:"column",gap:14,
        transform:visible?"translateY(0)":"translateY(100%)",
        transition:"transform 0.3s cubic-bezier(0.34,1.1,0.64,1)",
        maxHeight:"88vh",overflowY:"auto",WebkitOverflowScrolling:"touch"}}>
        <div style={{width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.1)",margin:"8px auto 0"}}/>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h2 style={{margin:0,fontSize:19,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",color:"#F2F2F2"}}>
            {movie?"Edit Entry":"Log a Watch"}
          </h2>
          <button onClick={close} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",
            borderRadius:10,padding:"7px 8px",cursor:"pointer",color:"rgba(255,255,255,0.4)"}}>
            <Icon d={Icons.x} size={16}/>
          </button>
        </div>

        {/* Title + search */}
        <div style={{position:"relative"}}>
          <label style={lbl}>Title</label>
          <input value={title} onChange={e=>onTitleChange(e.target.value)}
            placeholder="Search a movie or show…" style={inp}/>
          {searching&&<div style={{position:"absolute",right:12,top:34}}>
            <div style={{width:14,height:14,border:"2px solid rgba(255,255,255,0.1)",
              borderTopColor:MOVIE_ACCENT,borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>
          </div>}
          {results.length>0&&!pickedFromSearch&&(
            <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:6,
              maxHeight:280,overflowY:"auto",border:"1px solid rgba(255,255,255,0.08)",
              borderRadius:14,padding:6,background:"rgba(255,255,255,0.02)"}}>
              {results.map((r,i)=>(
                <button key={i} onClick={()=>pick(r)} style={{
                  display:"flex",alignItems:"center",gap:10,padding:6,borderRadius:10,
                  border:"none",background:"transparent",cursor:"pointer",textAlign:"left"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  {r.poster?(
                    <img src={r.poster} alt="" style={{width:32,height:46,objectFit:"cover",
                      borderRadius:5,flexShrink:0}}/>
                  ):(
                    <div style={{width:32,height:46,borderRadius:5,flexShrink:0,
                      background:"rgba(255,255,255,0.06)"}}/>
                  )}
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:"#F0F0F0",
                      fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",overflow:"hidden",
                      textOverflow:"ellipsis"}}>{r.title}</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",
                      fontFamily:"'DM Sans',sans-serif"}}>{r.year} · {r.type==="tv"?"TV":"Movie"}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {!searching&&!pickedFromSearch&&title.trim().length>=2&&results.length===0&&(
            <div style={{marginTop:8,padding:"12px 14px",borderRadius:12,
              background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)"}}>
              <p style={{fontSize:12,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Sans',sans-serif",margin:0,lineHeight:1.5}}>
                {searchError
                  ? "Search hiccuped — check your connection and try again, or just save with the title as-is."
                  : "No matches found — you can still save with just the title, no poster needed."}
              </p>
            </div>
          )}
          {poster&&pickedFromSearch&&(
            <div style={{marginTop:8,display:"flex",alignItems:"center",gap:10,
              padding:"8px 10px",borderRadius:12,background:`${MOVIE_ACCENT}0C`,
              border:`1px solid ${MOVIE_ACCENT}25`}}>
              <img src={poster} alt="" style={{width:34,height:48,objectFit:"cover",borderRadius:6}}/>
              <div style={{fontSize:12,color:"rgba(255,255,255,0.6)",fontFamily:"'DM Sans',sans-serif"}}>
                {year} · {mediaType==="tv"?"TV Show":"Movie"}
              </div>
            </div>
          )}
        </div>

        {/* Type toggle (manual override) */}
        <div style={{display:"flex",gap:8}}>
          {["movie","tv"].map(t=>(
            <button key={t} onClick={()=>setMediaType(t)} style={{
              flex:1,padding:"9px",borderRadius:12,border:"none",cursor:"pointer",
              background:mediaType===t?`${MOVIE_ACCENT}18`:"rgba(255,255,255,0.04)",
              outline:mediaType===t?`1px solid ${MOVIE_ACCENT}50`:"1px solid rgba(255,255,255,0.08)",
              color:mediaType===t?MOVIE_ACCENT:"rgba(255,255,255,0.35)",
              fontSize:12,fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>
              {t==="movie"?"🎬 Movie":"📺 TV Show"}
            </button>
          ))}
        </div>

        {/* Season picker — TV shows are tracked per-season, not as one blob */}
        {mediaType==="tv"&&(
          <div>
            <label style={lbl}>Season</label>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",borderRadius:12,
              background:seasonNumber!=null?`${MOVIE_ACCENT}0C`:"rgba(255,255,255,0.04)",
              border:`1px solid ${seasonNumber!=null?MOVIE_ACCENT+"25":"rgba(255,255,255,0.08)"}`}}>
              <span style={{fontSize:13,fontWeight:seasonNumber!=null?700:400,
                color:seasonNumber!=null?MOVIE_ACCENT:"rgba(255,255,255,0.4)",
                fontFamily:"'DM Sans',sans-serif"}}>
                {seasonNumber!=null ? `Season ${seasonNumber}` : "Whole series (no specific season)"}
              </span>
              {showId&&(
                <button type="button" onClick={()=>{
                  if(tvSeasons.length===0) fetchSeasons(showId);
                  setShowSeasonList(v=>!v);
                }} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",
                  color:"rgba(255,255,255,0.4)",fontSize:11,fontWeight:600,textDecoration:"underline",
                  fontFamily:"'DM Sans',sans-serif"}}>
                  {seasonNumber!=null?"Change":"Pick a season"}
                </button>
              )}
            </div>

            {showSeasonList&&(
              <div style={{marginTop:8,maxHeight:240,overflowY:"auto",display:"flex",flexDirection:"column",
                gap:4,border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:6,
                background:"rgba(255,255,255,0.02)"}}>
                {loadingSeasons?(
                  <div style={{padding:24,textAlign:"center"}}>
                    <div style={{width:16,height:16,border:"2px solid rgba(255,255,255,0.1)",
                      borderTopColor:MOVIE_ACCENT,borderRadius:"50%",
                      animation:"spin 0.7s linear infinite",margin:"0 auto"}}/>
                  </div>
                ):(
                  <>
                    <button type="button" onClick={()=>pickSeason(null)} style={{
                      display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:9,
                      border:"none",cursor:"pointer",textAlign:"left",
                      background:seasonNumber==null?"rgba(255,255,255,0.06)":"transparent"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
                      onMouseLeave={e=>e.currentTarget.style.background=seasonNumber==null?"rgba(255,255,255,0.06)":"transparent"}>
                      <span style={{fontSize:13,fontWeight:600,color:"#F0F0F0",fontFamily:"'DM Sans',sans-serif"}}>
                        Whole Series
                      </span>
                      <span style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>
                        (no specific season)
                      </span>
                    </button>
                    {tvSeasons.map(s=>(
                      <button key={s.season_number} type="button" onClick={()=>pickSeason(s)} style={{
                        display:"flex",alignItems:"center",gap:10,padding:"6px 10px",borderRadius:9,
                        border:"none",cursor:"pointer",textAlign:"left",
                        background:seasonNumber===s.season_number?"rgba(255,255,255,0.08)":"transparent"}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
                        onMouseLeave={e=>e.currentTarget.style.background=seasonNumber===s.season_number?"rgba(255,255,255,0.08)":"transparent"}>
                        {s.poster?(
                          <img src={s.poster} alt="" style={{width:28,height:40,objectFit:"cover",
                            borderRadius:5,flexShrink:0}}/>
                        ):(
                          <div style={{width:28,height:40,borderRadius:5,flexShrink:0,background:"rgba(255,255,255,0.06)"}}/>
                        )}
                        <div style={{minWidth:0}}>
                          <div style={{fontSize:13,fontWeight:600,color:"#F0F0F0",fontFamily:"'DM Sans',sans-serif",
                            whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.name}</div>
                          <div style={{fontSize:10.5,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>
                            {s.episode_count?`${s.episode_count} episodes`:""}{s.air_date?` · ${s.air_date.slice(0,4)}`:""}
                          </div>
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Status */}
        <div>
          <label style={lbl}>Status</label>
          <div style={{display:"flex",gap:8}}>
            {MOVIE_STATUSES.map(s=>(
              <button key={s.id} onClick={()=>setStatus(s.id)} style={{
                flex:1,padding:"9px 6px",borderRadius:12,border:"none",cursor:"pointer",
                background:status===s.id?`${MOVIE_ACCENT}18`:"rgba(255,255,255,0.04)",
                outline:status===s.id?`1px solid ${MOVIE_ACCENT}50`:"1px solid rgba(255,255,255,0.08)",
                color:status===s.id?MOVIE_ACCENT:"rgba(255,255,255,0.35)",
                fontSize:11,fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>
                {s.icon} {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Rating */}
        <div>
          <label style={lbl}>Your Rating</label>
          <StarRating value={rating} onChange={setRating} size={26}/>
        </div>

        {/* Watched date */}
        {status!=="want"&&(
          <div>
            <label style={lbl}>{status==="watching"?"Started":"Watched On"}</label>
            <input type="date" value={watchedDate} onChange={e=>setWatchedDate(e.target.value)} style={inp}/>
          </div>
        )}

        {/* Review */}
        <div>
          <label style={lbl}>Review / Thoughts</label>
          <textarea value={review} onChange={e=>setReview(e.target.value)}
            placeholder="What did you think?" rows={3}
            style={{...inp,resize:"vertical",lineHeight:1.6}}/>
        </div>

        {/* Buttons */}
        <div style={{display:"flex",gap:10}}>
          {movie&&(
            <button onClick={()=>onDelete(movie.id)} style={{padding:"14px",borderRadius:12,
              background:"rgba(255,80,80,0.08)",border:"1px solid rgba(255,80,80,0.2)",
              color:"#FF7878",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>
              Delete
            </button>
          )}
          <button onClick={save} disabled={!title.trim()||saving} style={{flex:1,padding:"14px",borderRadius:12,
            background:`linear-gradient(135deg,${MOVIE_ACCENT},#F59E0B)`,
            color:"#0A0A0C",border:"none",cursor:"pointer",fontSize:14,fontWeight:700,
            fontFamily:"'DM Sans',sans-serif",opacity:(!title.trim()||saving)?0.6:1}}>
            {saving?"Saving…":movie?"Update Entry":"Log It"}
          </button>
        </div>
      </div>
    </div>,
    document.body
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
                transition:"all 0.15s cubic-bezier(0.34,1.2,0.64,1)",opacity:fut?0.3:1,
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

      {/* This month's memories — grouped by day, same-day photos bundle into a stack */}
      {(()=>{
        const monthPrefix = `${year}-${String(month+1).padStart(2,"0")}`;
        const monthMemories = memories.filter(m=>m.date.startsWith(monthPrefix));
        const groups = {};
        monthMemories.forEach(m=>{ (groups[m.date] = groups[m.date]||[]).push(m); });
        const dayGroups = Object.entries(groups)
          .sort((a,b)=>b[0].localeCompare(a[0]))
          .map(([date,mems])=>({date,mems}));

        if(dayGroups.length===0) return (
          <div style={{textAlign:"center",padding:"30px 0"}}>
            <p style={{fontSize:12,color:"rgba(255,255,255,0.15)",fontFamily:"'DM Sans',sans-serif"}}>
              No memories logged in {monthName} yet.
            </p>
          </div>
        );

        return (
          <div>
            <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
              color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginBottom:10}}>
              {monthName} Memories
            </p>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {dayGroups.map(({date,mems})=>{
                const photos = mems.filter(m=>m.photo).map(m=>m.photo);
                const primary = mems[0];
                const multi = mems.length>1;
                return (
                  <button key={date} onClick={()=>setSelected({date,memories:mems})}
                    style={{display:"flex",alignItems:"center",gap:16,padding:"12px 14px",
                      borderRadius:14,background:"rgba(255,255,255,0.025)",
                      border:"1px solid rgba(192,132,252,0.2)",cursor:"pointer",textAlign:"left",
                      transition:"all 0.15s cubic-bezier(0.34,1.2,0.64,1)"}}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(192,132,252,0.08)"}
                    onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.025)"}
                  >
                    {/* Stacked photo thumbnails when a day has more than one memory */}
                    <div style={{position:"relative",width:56,height:48,flexShrink:0}}>
                      {photos.length>0?(
                        photos.slice(0,3).map((p,idx)=>(
                          <img key={idx} src={p} alt="" style={{
                            position:"absolute",width:40,height:40,borderRadius:9,objectFit:"cover",
                            border:"2px solid #0C0C0F",
                            top:idx*3, left:idx*7,
                            zIndex:3-idx,
                            transform:`rotate(${(idx-1)*7}deg)`,
                            boxShadow:"0 2px 6px rgba(0,0,0,0.4)",
                          }}/>
                        ))
                      ):(
                        <div style={{width:44,height:44,borderRadius:10,
                          background:"rgba(192,132,252,0.1)",border:"1px solid rgba(192,132,252,0.2)",
                          display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>
                          {primary.emoji||"📸"}
                        </div>
                      )}
                      {multi&&(
                        <div style={{position:"absolute",bottom:-3,right:-3,zIndex:4,
                          background:"#C084FC",color:"#0A0A0C",fontSize:9.5,fontWeight:700,
                          borderRadius:9,padding:"1px 5px",border:"2px solid #0C0C0F",
                          fontFamily:"'DM Sans',sans-serif"}}>
                          {mems.length}
                        </div>
                      )}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,color:"#F0F0F0",
                        fontFamily:"'Cormorant Garamond',serif",
                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {multi ? `${mems.length} moments` : (primary.title||"Memory")}
                      </div>
                      <div style={{fontSize:11,color:"rgba(255,255,255,0.3)",
                        fontFamily:"'DM Sans',sans-serif",marginTop:2}}>
                        {new Date(date+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}
                      </div>
                      {!multi&&primary.note&&<div style={{fontSize:11.5,color:"rgba(255,255,255,0.4)",
                        fontFamily:"'DM Sans',sans-serif",marginTop:2,
                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {primary.note}
                      </div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

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
  const [expandedPhoto, setExpandedPhoto] = useState(null); // memory whose photo is shown full-size

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
                {m.photo&&(
                  <button onClick={()=>setExpandedPhoto(m)} style={{
                    width:"100%",height:140,padding:0,border:"none",cursor:"zoom-in",
                    display:"block",position:"relative"}}>
                    <img src={m.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                    <div style={{position:"absolute",bottom:6,right:6,background:"rgba(0,0,0,0.55)",
                      borderRadius:7,padding:"3px 6px",display:"flex",alignItems:"center",gap:3}}>
                      <Icon d={Icons.search} size={10} stroke="rgba(255,255,255,0.8)"/>
                    </div>
                  </button>
                )}
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

      {expandedPhoto&&(
        <MemoryPhotoLightbox memory={expandedPhoto} onClose={()=>setExpandedPhoto(null)}/>
      )}
    </div>,
    document.body
  );
}

// ─── MEMORY PHOTO LIGHTBOX — full uncropped photo + title/description ────────
function MemoryPhotoLightbox({ memory, onClose }) {
  const [visible, setVisible] = useState(false);
  useEffect(()=>{ requestAnimationFrame(()=>setVisible(true)); },[]);
  const close=()=>{ setVisible(false); setTimeout(onClose,200); };

  return createPortal(
    <div style={{position:"fixed",inset:0,zIndex:10001,
      background:`rgba(4,4,6,${visible?0.96:0})`,backdropFilter:`blur(${visible?10:0}px)`,
      display:"flex",flexDirection:"column",transition:"all 0.25s",
      opacity:visible?1:0}}
      onClick={e=>e.target===e.currentTarget&&close()}>

      <div style={{display:"flex",justifyContent:"flex-end",padding:"20px 20px 0",flexShrink:0}}>
        <button onClick={close} style={{background:"rgba(255,255,255,0.08)",
          border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"8px 9px",
          cursor:"pointer",color:"rgba(255,255,255,0.7)"}}>
          <Icon d={Icons.x} size={17}/>
        </button>
      </div>

      {/* Full, uncropped image */}
      <div style={{flex:1,minHeight:0,display:"flex",alignItems:"center",justifyContent:"center",
        padding:"8px 16px",overflow:"hidden"}}
        onClick={e=>e.target===e.currentTarget&&close()}>
        <img src={memory.photo} alt="" style={{
          maxWidth:"100%",maxHeight:"100%",objectFit:"contain",borderRadius:12,
          boxShadow:"0 12px 48px rgba(0,0,0,0.6)",
          transform:visible?"scale(1)":"scale(0.94)",transition:"transform 0.3s cubic-bezier(0.34,1.1,0.64,1)"}}/>
      </div>

      {/* Title + description */}
      <div style={{flexShrink:0,padding:"16px 22px calc(env(safe-area-inset-bottom,0px) + 22px)",
        display:"flex",alignItems:"flex-start",gap:10}}>
        {memory.emoji&&<span style={{fontSize:22,flexShrink:0}}>{memory.emoji}</span>}
        <div style={{minWidth:0}}>
          <div style={{fontSize:17,fontWeight:700,color:"#F2F2F2",
            fontFamily:"'Cormorant Garamond',serif",lineHeight:1.3}}>
            {memory.title||"Moment"}
          </div>
          {memory.note&&<div style={{fontSize:13.5,color:"rgba(255,255,255,0.55)",
            fontFamily:"'DM Sans',sans-serif",marginTop:4,lineHeight:1.6}}>
            {memory.note}
          </div>}
        </div>
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



// ─── LIFETIME STATS ───────────────────────────────────────────────────────────
function LifetimeStats({ user, quests }) {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(()=>{
    sb.getMemories(user.id).then(m=>{ setMemories(m||[]); setLoading(false); }).catch(()=>setLoading(false));
  },[]);

  const completed   = quests.filter(q=>q.status==="Completed").length;
  const personal    = quests.filter(q=>!q.board_id).length;
  const shared      = quests.filter(q=>!!q.board_id).length;
  const withPhotos  = quests.filter(q=>q.photo).length;
  const withLocation= quests.filter(q=>q.location?.name).length;
  const memCount    = memories.length;
  const memPhotos   = memories.filter(m=>m.photo).length;

  // Extract unique countries/cities from quest locations
  const locations   = quests.filter(q=>q.location?.name).map(q=>q.location.name);
  const uniquePlaces= [...new Set(locations)].length;

  // Streak — longest consecutive days with completed quests
  const completedDates = [...new Set(
    quests.filter(q=>q.completed_at).map(q=>q.completed_at.slice(0,10))
  )].sort();
  let maxStreak=0, curStreak=0;
  for(let i=0;i<completedDates.length;i++){
    if(i===0){ curStreak=1; }
    else {
      const prev=new Date(completedDates[i-1]);
      const cur=new Date(completedDates[i]);
      const diff=(cur-prev)/(1000*60*60*24);
      curStreak = diff===1 ? curStreak+1 : 1;
    }
    maxStreak=Math.max(maxStreak,curStreak);
  }

  const stats = [
    {icon:"⚔",  label:"Total Quests",    value:quests.length,   color:"#F0F0F0"},
    {icon:"🏆",  label:"Completed",       value:completed,        color:"#78C1FF"},
    {icon:"🔒",  label:"Personal",        value:personal,         color:"#A8FF78"},
    {icon:"🤝",  label:"Shared",          value:shared,           color:"#C084FC"},
    {icon:"📍",  label:"Places Visited",  value:uniquePlaces,     color:"#FBBF24"},
    {icon:"📸",  label:"Quest Photos",    value:withPhotos,       color:"#F472B6"},
    {icon:"📖",  label:"Memories",        value:memCount,         color:"#E879F9"},
    {icon:"🖼",  label:"Memory Photos",   value:memPhotos,        color:"#2DD4BF"},
    {icon:"🔥",  label:"Best Streak",     value:`${maxStreak}d`,  color:"#FB923C"},
  ];

  return(
    <div style={{background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.07)",
      borderRadius:16,padding:"18px",marginBottom:16}}>
      <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
        color:"rgba(255,255,255,0.25)",fontFamily:"'DM Sans',sans-serif",marginBottom:14}}>
        Lifetime Stats
      </p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
        {stats.map(({icon,label,value,color})=>(
          <div key={label} style={{background:"rgba(255,255,255,0.03)",
            border:`1px solid ${color}20`,borderRadius:12,padding:"12px 10px",textAlign:"center"}}>
            <div style={{fontSize:20,marginBottom:4}}>{icon}</div>
            <div style={{fontSize:18,fontWeight:700,color,fontFamily:"'Cormorant Garamond',serif",lineHeight:1}}>{value}</div>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:"0.06em",
              marginTop:4,fontFamily:"'DM Sans',sans-serif",textTransform:"uppercase",lineHeight:1.3}}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── QUEST REACTIONS ─────────────────────────────────────────────────────────
const REACTION_EMOJIS = ["🔥","❤","👏","😮","😂","💀"];

function QuestReactions({ questId, userId }) {
  const [reactions, setReactions] = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(()=>{
    load();
  },[questId]);

  const load = async() => {
    try {
      const r = await sb.getReactions(questId);
      setReactions(r);
    } catch(e){ console.error(e); }
    setLoading(false);
  };

  const toggle = async(emoji) => {
    try {
      await sb.toggleReaction(questId, userId, emoji);
      await load();
    } catch(e){ console.error(e); }
  };

  // Group reactions by emoji
  const grouped = REACTION_EMOJIS.map(emoji=>({
    emoji,
    count: reactions.filter(r=>r.emoji===emoji).length,
    mine:  reactions.some(r=>r.emoji===emoji && r.user_id===userId),
  })).filter(g=>g.count>0||true);

  return(
    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
      {grouped.map(({emoji,count,mine})=>(
        <button key={emoji} onClick={()=>toggle(emoji)} style={{
          display:"flex",alignItems:"center",gap:4,
          padding:"4px 10px",borderRadius:20,border:"none",cursor:"pointer",
          background:mine?"rgba(255,255,255,0.12)":"rgba(255,255,255,0.04)",
          outline:mine?"1px solid rgba(255,255,255,0.2)":"none",
          transition:"all 0.15s cubic-bezier(0.34,1.2,0.64,1)",
        }}
          onMouseEnter={e=>e.currentTarget.style.background=mine?"rgba(255,255,255,0.16)":"rgba(255,255,255,0.08)"}
          onMouseLeave={e=>e.currentTarget.style.background=mine?"rgba(255,255,255,0.12)":"rgba(255,255,255,0.04)"}
        >
          <span style={{fontSize:16}}>{emoji}</span>
          {count>0&&<span style={{fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.6)",
            fontFamily:"'DM Sans',sans-serif"}}>{count}</span>}
        </button>
      ))}
    </div>
  );
}


// ─── QUEST MAP PAGE ───────────────────────────────────────────────────────────
function QuestMapPage({ quests }) {
  const [selected, setSelected] = useState(null);
  const [filter, setFilter]     = useState("All");
  const [coords, setCoords]     = useState({});
  const [loading, setLoading]   = useState(true);
  const mapRef    = useRef(null);
  const leafMap   = useRef(null);
  const markers   = useRef([]);

  const withLoc = quests.filter(q=>q.location?.name);
  const filtered = filter==="All"?withLoc:withLoc.filter(q=>q.status===filter);

  // Geocode all locations on mount
  useEffect(()=>{
    if(withLoc.length===0){ setLoading(false); return; }
    let cancelled = false;
    (async()=>{
      const result = {};
      for(const q of withLoc) {
        if(cancelled) break;
        // Check if already has lat/lng stored
        if(q.location?.lat && q.location?.lng) {
          result[q.id] = {lat:Number(q.location.lat), lng:Number(q.location.lng)};
          continue;
        }
        // Use Photon API (CORS-friendly, free, no key needed)
        const tries = [
          q.location.name + " Azerbaijan",
          q.location.name + " Baku",
          q.location.name,
        ];
        for(const t of tries) {
          try {
            await new Promise(r=>setTimeout(r,300));
            const res = await fetch(
              `https://photon.komoot.io/api/?q=${encodeURIComponent(t)}&limit=1&bbox=44.7,38.4,50.9,41.9`
            );
            const d = await res.json();
            if(d&&d.features&&d.features[0]) {
              const [lng,lat] = d.features[0].geometry.coordinates;
              result[q.id] = {lat, lng};
              break;
            }
          } catch(e){}
          // Also try without bbox for places outside Azerbaijan
          try {
            await new Promise(r=>setTimeout(r,300));
            const res = await fetch(
              `https://photon.komoot.io/api/?q=${encodeURIComponent(t)}&limit=1`
            );
            const d = await res.json();
            if(d&&d.features&&d.features[0]) {
              const [lng,lat] = d.features[0].geometry.coordinates;
              result[q.id] = {lat, lng};
              break;
            }
          } catch(e){}
        }
      }
      if(!cancelled) { setCoords(result); setLoading(false); }
    })();
    return ()=>{ cancelled=true; };
  },[]);

  // Load Leaflet + init map
  useEffect(()=>{
    if(!document.getElementById("leaflet-css")) {
      const l=document.createElement("link");
      l.id="leaflet-css"; l.rel="stylesheet";
      l.href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(l);
    }
    const init=()=>{
      if(!mapRef.current||leafMap.current) return;
      const m=window.L.map(mapRef.current,{center:[40.4093,49.8671],zoom:10,zoomControl:true});
      window.L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {subdomains:"abcd",maxZoom:19}).addTo(m);
      leafMap.current=m;
    };
    if(window.L) init();
    else {
      const s=document.createElement("script");
      s.src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      s.onload=init;
      document.head.appendChild(s);
    }
    return ()=>{ if(leafMap.current){leafMap.current.remove();leafMap.current=null;} };
  },[]);

  // Add/update markers whenever coords or filter changes
  useEffect(()=>{
    if(!leafMap.current||!window.L) return;
    // Clear markers
    markers.current.forEach(m=>m.remove());
    markers.current=[];
    const bounds=[];
    filtered.forEach(q=>{
      const c=coords[q.id];
      if(!c) return;
      const sc=q.status==="Completed"?"#78C1FF":q.status==="On Hold"?"#FBBF24":q.status==="Abandoned"?"#FF7878":"#A8FF78";
      const em=q.emoji||(q.title?q.title[0].toUpperCase():"⚔");
      const fontSize=q.emoji?"22px":"16px";
      const icon=window.L.divIcon({
        html:`<div style="width:44px;height:44px;border-radius:14px;background:rgba(10,10,14,0.94);border:2.5px solid ${sc};display:flex;align-items:center;justify-content:center;font-size:${fontSize};cursor:pointer;box-shadow:0 4px 24px rgba(0,0,0,0.7),0 0 0 1px rgba(255,255,255,0.04);transition:transform 0.15s;color:#F2F2F2;font-weight:700;font-family:'DM Sans',sans-serif;">${em}</div>`,
        className:"",iconSize:[44,44],iconAnchor:[22,22],
      });
      const mk=window.L.marker([c.lat,c.lng],{icon}).addTo(leafMap.current);
      mk.on("click",()=>setSelected(q));
      markers.current.push(mk);
      bounds.push([c.lat,c.lng]);
    });
    if(bounds.length>0){
      try{leafMap.current.fitBounds(bounds,{padding:[50,50],maxZoom:14,animate:true});}catch{}
    }
  },[coords,filter]);

  // Fly to selected
  useEffect(()=>{
    if(selected&&coords[selected.id]&&leafMap.current){
      leafMap.current.flyTo([coords[selected.id].lat,coords[selected.id].lng],15,{duration:1});
    }
  },[selected]);

  const palette=selected?getPalette(selected.id):null;
  const mappedCount=filtered.filter(q=>coords[q.id]).length;

  return(
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 140px)"}}>
      <style>{`
        .leaflet-container{background:#08080A;}
        .leaflet-control-zoom{border:1px solid rgba(255,255,255,0.08)!important;border-radius:10px!important;overflow:hidden;}
        .leaflet-control-zoom a{background:rgba(12,12,16,0.9)!important;color:rgba(255,255,255,0.5)!important;border-color:rgba(255,255,255,0.08)!important;}
        .leaflet-control-zoom a:hover{background:rgba(255,255,255,0.08)!important;color:#fff!important;}
        .leaflet-control-attribution{display:none!important;}
      `}</style>

      {/* Filter row */}
      <div style={{padding:"14px 20px 10px",display:"flex",gap:7,overflowX:"auto",flexShrink:0}}>
        {["All","Active","Completed","On Hold"].map(s=>{
          const on=filter===s;
          const col=s==="All"?"#F0F0F0":STATUS_META[s]?.color||"#F0F0F0";
          const cnt=s==="All"?withLoc.length:withLoc.filter(q=>q.status===s).length;
          return(
            <button key={s} onClick={()=>setFilter(s)} style={{
              padding:"6px 14px",borderRadius:20,fontSize:11,fontWeight:600,cursor:"pointer",
              whiteSpace:"nowrap",fontFamily:"'DM Sans',sans-serif",flexShrink:0,
              border:`1px solid ${on?col:"rgba(255,255,255,0.09)"}`,
              background:on?`${col}15`:"transparent",
              color:on?col:"rgba(255,255,255,0.3)",transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)",
            }}>{s} {cnt}</button>
          );
        })}
      </div>

      {withLoc.length===0?(
        <div style={{textAlign:"center",padding:"80px 24px"}}>
          <div style={{fontSize:48,marginBottom:16,opacity:0.12}}>📍</div>
          <p style={{fontSize:14,color:"rgba(255,255,255,0.2)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.7}}>
            No quests with locations yet.<br/>Add a location when creating a quest.
          </p>
        </div>
      ):(
        <div style={{flex:1,position:"relative",minHeight:0}}>
          <div ref={mapRef} style={{width:"100%",height:"100%"}}/>

          {/* Loading overlay */}
          {loading&&(
            <div style={{position:"absolute",top:12,left:"50%",transform:"translateX(-50%)",zIndex:999,
              background:"rgba(10,10,14,0.9)",backdropFilter:"blur(8px)",
              border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,
              padding:"7px 14px",display:"flex",alignItems:"center",gap:7,
              fontSize:11,color:"rgba(255,255,255,0.5)",fontFamily:"'DM Sans',sans-serif"}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:"#A8FF78",
                animation:"pulseDot 1s ease-in-out infinite"}}/>
              Mapping locations…
            </div>
          )}

          {/* Stats badge */}
          {!loading&&(
            <div style={{position:"absolute",top:12,right:12,zIndex:999,
              background:"rgba(10,10,14,0.88)",backdropFilter:"blur(8px)",
              border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,
              padding:"5px 12px",fontSize:11,fontWeight:600,
              color:"rgba(255,255,255,0.5)",fontFamily:"'DM Sans',sans-serif"}}>
              {mappedCount}/{filtered.length} on map
            </div>
          )}

          {/* Selected quest card */}
          {selected&&(
            <div style={{position:"absolute",bottom:16,left:16,right:16,zIndex:1000,
              background:"linear-gradient(160deg,rgba(14,14,18,0.97),rgba(10,10,14,0.97))",
              backdropFilter:"blur(20px)",border:`1px solid ${palette.color}30`,
              borderRadius:20,padding:"16px",boxShadow:"0 8px 40px rgba(0,0,0,0.7)",
              animation:"cardIn 0.3s ease both"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:2,
                background:palette.grad,borderRadius:"20px 20px 0 0"}}/>
              <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                <div style={{width:48,height:48,borderRadius:14,flexShrink:0,
                  background:`${palette.color}15`,border:`1.5px solid ${palette.color}30`,
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>
                  {selected.emoji||"⚔"}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:16,fontWeight:700,color:"#F2F2F2",
                    fontFamily:"'Cormorant Garamond',serif",lineHeight:1.3,wordBreak:"break-word"}}>
                    {selected.title}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginTop:5,flexWrap:"wrap"}}>
                    <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",
                      textTransform:"uppercase",color:STATUS_META[selected.status]?.color||"#A8FF78",
                      background:`${STATUS_META[selected.status]?.color||"#A8FF78"}15`,
                      border:`1px solid ${STATUS_META[selected.status]?.color||"#A8FF78"}30`,
                      padding:"2px 7px",borderRadius:4,fontFamily:"'DM Sans',sans-serif"}}>
                      {selected.status}
                    </span>
                    {selected.location?.name&&<span style={{fontSize:11,color:"rgba(255,255,255,0.35)",
                      fontFamily:"'DM Sans',sans-serif"}}>📍 {selected.location.name}</span>}
                  </div>
                </div>
                <button onClick={()=>setSelected(null)} style={{
                  background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.08)",
                  borderRadius:8,padding:"5px 6px",cursor:"pointer",color:"rgba(255,255,255,0.4)",flexShrink:0}}>
                  <Icon d={Icons.x} size={14}/>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ─── QUEST IDEA GENERATOR ─────────────────────────────────────────────────────
function QuestIdeaGenerator({ onAddQuest, onClose }) {
  const [ideas, setIdeas]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [visible, setVisible]   = useState(false);
  const [added, setAdded]       = useState({});

  useEffect(()=>{ requestAnimationFrame(()=>setVisible(true)); generateIdeas(); },[]);
  const close=()=>{ setVisible(false); setTimeout(onClose,250); };

  const generateIdeas = async() => {
    setLoading(true);
    try {
      // Use random seed to ensure different results every time
      const seeds = [
        "public stunts and pranks",
        "food and eating challenges", 
        "Baku city exploration",
        "brother challenges",
        "night missions",
        "disguise and costume missions",
        "social experiments",
        "sports and physical challenges",
        "creative and artistic",
        "unhinged solo missions"
      ];
      const seed = seeds[Math.floor(Math.random()*seeds.length)];
      const randomNum = Math.floor(Math.random()*1000);

      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-6",
          max_tokens:1000,
          messages:[{
            role:"user",
            content:`Generate 8 completely unique side quest ideas. Seed: ${seed} #${randomNum}

These are real life adventures. The person lives in Baku Azerbaijan and has a brother.

EXACT VIBE — match these existing quests exactly:
- "Trashbagging over Grass" (slide on grass in trash bags)
- "Cooking with Grabbers" (cook a full meal using grabber tools)  
- "Wear Inflatable Dino Costumes" (go places in dinosaur costumes)
- "Convince a Restaurant to Let You Cook One Dish on Their Menu"
- "Hot Wine Night" (make hot wine from scratch)
- "Giant Sand Castle" (build massive sandcastle)
- "Drunk Bowling"
- "Wig Snatching Party"

Rules:
- Short punchy titles (2-5 words max usually)
- Specific and weird, not generic
- Actually doable in real life
- Funny or Instagram-worthy
- Mix of solo, with brother, with crew
- Some Baku-specific, some universal
- Think: what would make a great story to tell later
- Category: ${seed}
- Every generation must be COMPLETELY DIFFERENT from before

Return ONLY a JSON array of 8 objects, no markdown, no backticks, no explanation:
[{"title":"Quest Title","description":"One punchy sentence","emoji":"🎯"}]`
          }]
        })
      });
      const d = await r.json();
      const text = d.content?.[0]?.text||"[]";
      const clean = text.replace(/\`\`\`json|\`\`\`/g,"").trim();
      const parsed = JSON.parse(clean);
      setIdeas(parsed);
    } catch(e) {
      console.error(e);
      setIdeas([
        {title:"Wear a Suit to the Bazaar",description:"Buy groceries in full formal attire",emoji:"🤵"},
        {title:"Midnight Food Crawl",description:"Hit every 24hr spot in Baku in one night",emoji:"🌙"},
        {title:"Convince a Stranger to Join Your Quest",description:"Recruit someone random off the street",emoji:"🤝"},
        {title:"Cook Blindfolded",description:"Full meal, eyes closed, kitchen chaos",emoji:"👨‍🍳"},
        {title:"Go Karting in Costume",description:"Race in whatever ridiculous outfit you own",emoji:"🏎"},
        {title:"Find the Best Cheesecake",description:"Full bracket tournament across Baku",emoji:"🍰"},
        {title:"Rooftop Barbecue",description:"Find a rooftop and grill something",emoji:"🔥"},
        {title:"Speak Only in Questions",description:"Full day, every sentence is a question",emoji:"❓"},
      ]);
    }
    setLoading(false);
  };

  const addIdea = (idea) => {
    onAddQuest({title:idea.title, description:idea.description, emoji:idea.emoji});
    setAdded(a=>({...a,[idea.title]:true}));
  };

  return createPortal(
    <div style={{position:"fixed",inset:0,background:`rgba(0,0,0,${visible?0.8:0})`,
      backdropFilter:`blur(${visible?20:0}px)`,display:"flex",alignItems:"flex-end",
      justifyContent:"center",zIndex:9999,transition:"all 0.25s"}}
      onClick={e=>e.target===e.currentTarget&&close()}>
      <div style={{background:"linear-gradient(160deg,#111114,#0C0C0F)",
        borderRadius:"24px 24px 0 0",border:"1px solid rgba(255,255,255,0.09)",borderBottom:"none",
        width:"100%",maxWidth:560,padding:"12px 20px 52px",
        display:"flex",flexDirection:"column",gap:0,
        transform:visible?"translateY(0)":"translateY(100%)",
        transition:"transform 0.3s cubic-bezier(0.34,1.1,0.64,1)",
        maxHeight:"88vh",overflowY:"auto",WebkitOverflowScrolling:"touch"}}>

        <div style={{width:40,height:4,borderRadius:2,background:"rgba(255,255,255,0.1)",
          margin:"8px auto 16px",flexShrink:0}}/>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexShrink:0}}>
          <div>
            <h2 style={{margin:0,fontSize:20,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",color:"#F2F2F2"}}>
              Quest Ideas ✨
            </h2>
            <p style={{margin:"3px 0 0",fontSize:12,color:"rgba(255,255,255,0.3)",fontFamily:"'DM Sans',sans-serif"}}>
              Tap + to add to your quests
            </p>
          </div>
          <button onClick={close} style={{background:"rgba(255,255,255,0.06)",
            border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,
            padding:"7px 8px",cursor:"pointer",color:"rgba(255,255,255,0.4)"}}>
            <Icon d={Icons.x} size={16}/>
          </button>
        </div>

        {loading?(
          <div style={{display:"flex",flexDirection:"column",gap:10,padding:"10px 0"}}>
            {[...Array(6)].map((_,i)=>(
              <div key={i} style={{height:72,borderRadius:16,
                background:"rgba(255,255,255,0.04)",
                animation:"pulse 1.5s ease-in-out infinite",
                animationDelay:`${i*0.1}s`}}/>
            ))}
            <style>{`@keyframes pulse{0%,100%{opacity:0.4}50%{opacity:0.8}}`}</style>
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {ideas.map((idea,i)=>{
              const isAdded = added[idea.title];
              const colors = ["#A8FF78","#78C1FF","#C084FC","#FBBF24","#F472B6","#34D399","#FB923C","#E879F9"];
              const color = colors[i%colors.length];
              return(
                <div key={i} style={{display:"flex",alignItems:"center",gap:12,
                  padding:"14px 14px",borderRadius:16,
                  background:isAdded?`${color}08`:"rgba(255,255,255,0.03)",
                  border:`1px solid ${isAdded?color+"30":"rgba(255,255,255,0.07)"}`,
                  transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)",
                  animation:`cardIn 0.4s ease ${i*0.06}s both`}}>
                  <div style={{width:42,height:42,borderRadius:12,flexShrink:0,
                    background:`${color}12`,border:`1px solid ${color}25`,
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>
                    {idea.emoji||"⚔"}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#F2F2F2",
                      fontFamily:"'Cormorant Garamond',serif",lineHeight:1.3,
                      wordBreak:"break-word"}}>{idea.title}</div>
                    {idea.description&&<div style={{fontSize:11.5,color:"rgba(255,255,255,0.35)",
                      fontFamily:"'DM Sans',sans-serif",marginTop:2,lineHeight:1.4}}>
                      {idea.description}
                    </div>}
                  </div>
                  <button onClick={()=>!isAdded&&addIdea(idea)} style={{
                    width:34,height:34,borderRadius:10,border:"none",cursor:isAdded?"default":"pointer",
                    background:isAdded?`${color}20`:"rgba(255,255,255,0.08)",
                    color:isAdded?color:"rgba(255,255,255,0.5)",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    flexShrink:0,fontSize:18,fontWeight:700,transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)"}}>
                    {isAdded?"✓":"+"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Generate more button */}
        {!loading&&(
          <button onClick={generateIdeas} style={{
            marginTop:14,padding:"15px",borderRadius:16,border:"1px solid rgba(255,255,255,0.1)",
            cursor:"pointer",
            background:"linear-gradient(135deg,rgba(168,255,120,0.12),rgba(120,193,255,0.12))",
            color:"rgba(255,255,255,0.9)",fontSize:14,fontWeight:700,
            fontFamily:"'DM Sans',sans-serif",flexShrink:0,
            display:"flex",alignItems:"center",justifyContent:"center",gap:8,
            transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)"}}
            onMouseEnter={e=>e.currentTarget.style.background="linear-gradient(135deg,rgba(168,255,120,0.2),rgba(120,193,255,0.2))"}
            onMouseLeave={e=>e.currentTarget.style.background="linear-gradient(135deg,rgba(168,255,120,0.12),rgba(120,193,255,0.12))"}>
            ✨ Generate 8 New Ideas
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}


// ─── BOTTOM NAV ───────────────────────────────────────────────────────────────
// A normal (non-fixed) flex item pinned to the bottom of the fixed-height app
// shell — it is physically impossible for this to "detach" while scrolling,
// because it never scrolls: only the content area above it does.
const PRIMARY_TAB_IDS = ["quests","boards","friends","profile"];

function BottomNav({ tabs, activeTab, onSelect }) {
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = PRIMARY_TAB_IDS
    .map(id=>tabs.find(t=>t.id===id))
    .filter(Boolean);
  const more = tabs.filter(t=>!PRIMARY_TAB_IDS.includes(t.id));
  const moreActive = more.some(t=>t.id===activeTab);
  const moreBadge = more.reduce((sum,t)=>sum+(t.count||0),0);

  const TabButton = ({ icon, label, active, count, onClick }) => (
    <button
      onClick={onClick}
      style={{
        flex:1,display:"flex",flexDirection:"column",alignItems:"center",
        justifyContent:"center",gap:5,padding:"10px 4px 8px",minWidth:0,
        background:"none",border:"none",cursor:"pointer",
        WebkitTapHighlightColor:"transparent",position:"relative",
      }}>
      {/* Active indicator bar */}
      <div style={{
        position:"absolute",top:0,left:"28%",right:"28%",height:2.5,
        borderRadius:"0 0 3px 3px",
        background:active?"linear-gradient(90deg,#A8FF78,#78C1FF)":"transparent",
        transition:"background 0.25s ease",
      }}/>
      <div style={{position:"relative"}}>
        <Icon d={icon} size={21} stroke={active?"#fff":"rgba(255,255,255,0.4)"}/>
        {count>0&&(
          <div style={{
            position:"absolute",top:-5,right:-7,
            minWidth:15,height:15,borderRadius:8,
            background:"#F472B6",border:"2px solid #08080A",
            fontSize:8,fontWeight:700,color:"#fff",
            display:"flex",alignItems:"center",justifyContent:"center",
            padding:"0 3px",fontFamily:"'DM Sans',sans-serif",
          }}>{count>9?"9+":count}</div>
        )}
      </div>
      <span style={{
        fontSize:10.5,fontWeight:active?700:500,
        fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.01em",
        color:active?"#fff":"rgba(255,255,255,0.38)",
        transition:"color 0.2s",whiteSpace:"nowrap",
      }}>{label}</span>
    </button>
  );

  return (
    <>
      {/* "More" sheet — clean list rows, generous spacing, not cramped */}
      {moreOpen&&createPortal(
        <div style={{position:"fixed",inset:0,zIndex:900,display:"flex",
          alignItems:"flex-end",justifyContent:"center"}}
          onClick={()=>setMoreOpen(false)}>
          <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.55)",
            backdropFilter:"blur(6px)"}}/>
          <div onClick={e=>e.stopPropagation()} style={{
            position:"relative",width:"100%",maxWidth:560,
            background:"linear-gradient(160deg,rgba(17,17,20,0.99),rgba(10,10,14,0.99))",
            border:"1px solid rgba(255,255,255,0.09)",borderBottom:"none",
            borderRadius:"26px 26px 0 0",
            padding:"14px 12px calc(env(safe-area-inset-bottom,0px) + 18px)",
            animation:"sheetIn 0.3s cubic-bezier(0.34,1.1,0.64,1) both",
          }}>
            <div style={{width:38,height:4,borderRadius:2,
              background:"rgba(255,255,255,0.15)",margin:"0 auto 18px"}}/>
            <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.14em",
              textTransform:"uppercase",color:"rgba(255,255,255,0.25)",
              fontFamily:"'DM Sans',sans-serif",margin:"0 10px 10px"}}>
              More
            </p>
            <div style={{display:"flex",flexDirection:"column",gap:2}}>
              {more.map(t=>{
                const active = activeTab===t.id;
                return(
                  <button key={t.id}
                    onClick={()=>{onSelect(t.id);setMoreOpen(false);}}
                    style={{
                      display:"flex",alignItems:"center",gap:14,
                      padding:"13px 12px",borderRadius:14,border:"none",
                      cursor:"pointer",textAlign:"left",
                      background:active?"rgba(255,255,255,0.07)":"transparent",
                      WebkitTapHighlightColor:"transparent",
                    }}>
                    <div style={{width:38,height:38,borderRadius:11,flexShrink:0,
                      background:active?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.05)",
                      display:"flex",alignItems:"center",justifyContent:"center",
                      position:"relative"}}>
                      <Icon d={t.icon} size={18} stroke={active?"#fff":"rgba(255,255,255,0.5)"}/>
                      {t.count>0&&(
                        <div style={{position:"absolute",top:-4,right:-4,
                          minWidth:16,height:16,borderRadius:8,background:"#F472B6",
                          border:"2px solid #131316",fontSize:8,fontWeight:700,color:"#fff",
                          display:"flex",alignItems:"center",justifyContent:"center",
                          padding:"0 3px",fontFamily:"'DM Sans',sans-serif"}}>
                          {t.count>9?"9+":t.count}
                        </div>
                      )}
                    </div>
                    <span style={{flex:1,fontSize:15,fontWeight:active?700:500,
                      color:active?"#fff":"rgba(255,255,255,0.7)",
                      fontFamily:"'DM Sans',sans-serif"}}>{t.label}</span>
                    <Icon d={Icons.chevronRight} size={16} stroke="rgba(255,255,255,0.2)"/>
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Main nav bar */}
      <div style={{
        flexShrink:0,position:"relative",zIndex:50,
        background:"rgba(9,9,12,0.97)",
        backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",
        borderTop:"1px solid rgba(255,255,255,0.06)",
        paddingBottom:"env(safe-area-inset-bottom,0px)",
      }}>
        <div style={{display:"flex",alignItems:"stretch",maxWidth:560,margin:"0 auto"}}>
          {primary.map(t=>(
            <TabButton key={t.id} icon={t.icon} label={t.label} count={t.count}
              active={activeTab===t.id} onClick={()=>onSelect(t.id)}/>
          ))}
          <TabButton icon={Icons.dots} label="More" count={moreBadge}
            active={moreActive||moreOpen} onClick={()=>setMoreOpen(true)}/>
        </div>
      </div>
    </>
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
        if(d.access_token) {
          // Email confirmation off — log in directly
          onAuth({ id: d.user?.id, email: email.trim() });
        } else {
          // Email confirmation on — show success and switch to sign in
          setDone(true);
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
      <style>{`body{background:#08080A;} @keyframes cardIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{maxWidth:360,width:"100%",textAlign:"center",animation:"cardIn 0.5s ease both"}}>
        <div style={{fontSize:56,marginBottom:20}}>📬</div>
        <h2 style={{fontSize:22,fontWeight:700,color:"#F2F2F2",fontFamily:"'Cormorant Garamond',serif",marginBottom:12}}>
          Check your email!
        </h2>
        <p style={{fontSize:14,color:"rgba(255,255,255,0.4)",lineHeight:1.7,marginBottom:8}}>
          We sent a confirmation link to
        </p>
        <p style={{fontSize:15,fontWeight:700,color:"rgba(255,255,255,0.8)",marginBottom:24}}>{email}</p>
        <p style={{fontSize:13,color:"rgba(255,255,255,0.3)",lineHeight:1.6,marginBottom:24}}>
          Click the link in your email to activate your account, then come back and sign in.
        </p>
        <button onClick={()=>{setDone(false);setMode("signin");}} style={{
          background:"linear-gradient(135deg,#e8e8e8,#fff)",color:"#0A0A0C",
          border:"none",borderRadius:14,padding:"14px 28px",
          cursor:"pointer",fontSize:15,fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>
          Go to Sign In
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
                transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)",
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
            <div style={{padding:"10px 14px",borderRadius:10,
              background:error.includes("created")?"rgba(168,255,120,0.08)":"rgba(255,100,100,0.08)",
              border:`1px solid ${error.includes("created")?"rgba(168,255,120,0.2)":"rgba(255,100,100,0.2)"}`,
              fontSize:12.5,
              color:error.includes("created")?"rgba(168,255,120,0.9)":"rgba(255,150,150,0.9)",
              fontFamily:"'DM Sans',sans-serif",lineHeight:1.5}}>
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
            transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)",opacity:loading?0.7:1,
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
  const [boardInvites,setBoardInvites]             = useState([]);
  const [activeBoard,setActiveBoard] = useState(null); // board being viewed
  const [inviteBoard,setInviteBoard] = useState(null); // board to show invite modal for
  const [showCreateBoard,setShowCreateBoard] = useState(false);
  const [inviteCode,setInviteCode] = useState(null); // ?join=xxx from URL
  const [filter,setFilter]       = useState("All");
  const [questSearch,setQuestSearch] = useState("");
  const [tab,setTab]             = useState("quests");
  const [questModal,setQuestModal]   = useState(null);
  const [memberModal,setMemberModal] = useState(null);
  const [deleteTarget,setDeleteTarget] = useState(null);
  const [memberDetail,setMemberDetail] = useState(null);
  const [shareQuest,setShareQuest]       = useState(null);
  const [showIdeas,setShowIdeas]         = useState(false);
  const [mounted,setMounted]     = useState(false);
  const [syncing,setSyncing]     = useState(false);

  // Enables the CSS :active pseudo-class on tap for iOS Safari (otherwise it
  // never fires on touch, so button press feedback would silently do nothing).
  useEffect(()=>{
    const noop=()=>{};
    document.addEventListener("touchstart", noop, {passive:true});
    return ()=>document.removeEventListener("touchstart", noop);
  },[]);

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
        try { await sb.upsert("members", updated, "user_id"); } catch{}
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
    try { await sb.upsert("members", member, "user_id"); } catch(e){ console.error(e); }
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
    try{await sb.upsert("members",withUser,"user_id");}catch(e){console.error(e);}
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

  const handleLeaveBoard = async(board) => {
    const isCreator = board.created_by === user?.id;
    const msg = isCreator
      ? `Delete "${board.name}"? This will remove the board and all its quests for everyone.`
      : `Leave "${board.name}"?`;
    if(!window.confirm(msg)) return;
    try {
      if(isCreator) {
        await sb.delete("boards", board.id);
      } else {
        await sb.leaveBoard(board.id, user.id);
      }
      setBoards(prev=>prev.filter(b=>b.id!==board.id));
      setActiveBoard(null);
    } catch(e) { console.error(e); }
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
  const statusFiltered = filter==="All" ? scopedQuests : scopedQuests.filter(q=>q.status===filter);
  const filtered = questSearch.trim()
    ? statusFiltered.filter(q=>{
        const q_ = questSearch.trim().toLowerCase();
        return (q.title||"").toLowerCase().includes(q_)
          || (q.description||"").toLowerCase().includes(q_)
          || (q.location?.name||"").toLowerCase().includes(q_);
      })
    : statusFiltered;
  const counts=STATUSES.reduce((acc,s)=>({...acc,[s]:scopedQuests.filter(q=>q.status===s).length}),{});
  const completedCount=quests.filter(q=>q.status==="Completed").length;

  const userXP = calcXP(quests);
  const userRank = getRank(userXP);

  // Poll for friend requests + board invites every 15s
  useEffect(()=>{
    if(!user) return;
    const check = async()=>{
      try {
        const ships = await sb.getFriendships(user.id);
        const incoming = ships.filter(s=>s.status==="pending"&&s.to_id===user.id);
        setFriendRequestCount(incoming.length);
      } catch{}
      try {
        const invites = await sb.getMyBoardInvites(user.id);
        setBoardInvites(Array.isArray(invites)?invites:[]);
      } catch{}
    };
    check();
    const iv = setInterval(check, 15000);
    return ()=>clearInterval(iv);
  },[user]);

  const TABS=[
    {id:"quests",   label:"Quests",   icon:Icons.shield, count:personalQuests.length},
    {id:"boards",   label:"Boards",   icon:Icons.board,  count:boards.length+(boardInvites.length>0?boardInvites.length:0)},
    {id:"friends",  label:"Friends",  icon:Icons.users,  count:friendRequestCount},
    {id:"completed",label:"Done",     icon:Icons.check,  count:completedCount},
    {id:"memories", label:"Memories", icon:Icons.camera, count:0},
    {id:"movies",   label:"Movies",   icon:Icons.film,   count:0},
    {id:"map",      label:"Map",      icon:Icons.globe,  count:quests.filter(q=>q.location?.name).length},
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
    <div className="app-shell" style={{background:"#08080A",color:"#F0F0F0",
      fontFamily:"'DM Sans',sans-serif",
      opacity:mounted?1:0,transition:"opacity 0.4s ease",
      display:"flex",flexDirection:"column",overflow:"hidden",position:"relative"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        html,body,#root{height:100%;overflow:hidden;overscroll-behavior:none;}
        body{background:#08080A;}
        .app-shell{height:100vh;height:100dvh;}
        ::placeholder{color:rgba(255,255,255,0.18)!important;}
        ::-webkit-scrollbar{width:0;}

        /* ── Global spring easing + tap feedback, applied app-wide ── */
        :root{--spring:cubic-bezier(0.34,1.2,0.64,1);}
        button{-webkit-tap-highlight-color:transparent;transition:transform 0.15s var(--spring);}
        button:active{transform:scale(0.97);}

        @keyframes pulseDot{0%,100%{opacity:1;transform:scale(1);}50%{opacity:0.5;transform:scale(1.3);}}
        @keyframes cardIn{from{opacity:0;transform:translateY(18px) scale(0.97);}to{opacity:1;transform:translateY(0) scale(1);}}
        @keyframes pageIn{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes orb1{0%,100%{transform:translate(0,0);}50%{transform:translate(40px,-30px);}}
        @keyframes orb2{0%,100%{transform:translate(0,0);}50%{transform:translate(-30px,40px);}}
        @keyframes fabPulse{0%,100%{box-shadow:0 8px 32px rgba(0,0,0,0.5),0 0 0 0 rgba(240,240,240,0.08);}50%{box-shadow:0 8px 32px rgba(0,0,0,0.5),0 0 0 10px rgba(240,240,240,0);}}
        @keyframes sheetIn{from{transform:translateY(100%);}to{transform:translateY(0);}}
        @keyframes grainShift{0%,100%{transform:translate(0,0);}10%{transform:translate(-1%,-2%);}20%{transform:translate(-3%,1%);}30%{transform:translate(2%,-3%);}40%{transform:translate(-2%,3%);}50%{transform:translate(3%,1%);}60%{transform:translate(-1%,2%);}70%{transform:translate(2%,2%);}80%{transform:translate(-3%,-1%);}90%{transform:translate(1%,-2%);}}
      `}</style>

      {/* Film-grain texture overlay — subtle depth, no visual noise/clutter */}
      <div style={{
        position:"absolute",inset:"-10%",pointerEvents:"none",zIndex:2,
        opacity:0.035,mixBlendMode:"overlay",
        backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27120%27 height=%27120%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.85%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E\")",
        backgroundRepeat:"repeat",
        animation:"grainShift 1.2s steps(1) infinite",
      }}/>

      <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:0,overflow:"hidden"}}>
        <div style={{position:"absolute",width:500,height:500,borderRadius:"50%",background:"radial-gradient(circle,rgba(168,255,120,0.05) 0%,transparent 70%)",top:-100,left:-100,animation:"orb1 12s ease-in-out infinite"}}/>
        <div style={{position:"absolute",width:600,height:600,borderRadius:"50%",background:"radial-gradient(circle,rgba(192,132,252,0.04) 0%,transparent 70%)",bottom:-200,right:-100,animation:"orb2 16s ease-in-out infinite"}}/>
      </div>

      {/* Scrollable content area — the ONLY thing that scrolls. Nav below never moves. */}
      <div style={{flex:1,minHeight:0,overflowY:"auto",WebkitOverflowScrolling:"touch",position:"relative",zIndex:1}}>

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
                borderRadius:8,padding:"4px 10px 4px 6px",cursor:"pointer",transition:"all 0.15s cubic-bezier(0.34,1.2,0.64,1)",
              }}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.08)"}
                onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
              >
                <div style={{width:22,height:22,borderRadius:6,overflow:"hidden",
                  background:members.find(m=>m.user_id===user?.id)?.photo?"transparent":`radial-gradient(circle at 35% 35%,${getRank(calcXP(quests)).color}40,${getRank(calcXP(quests)).color}10)`,
                  border:`1.5px solid ${getRank(calcXP(quests)).color}50`,
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>
                  {members.find(m=>m.user_id===user?.id)?.photo
                    ? <img src={members.find(m=>m.user_id===user?.id).photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                    : getCharacter(members.find(m=>m.user_id===user?.id)?.name||"?").avatar}
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
          {/* Spacer for bottom nav */}
          <div style={{height:0}}/>
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
                    transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)", display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                  }}>
                    {s.label}
                    <span style={{fontSize:10,opacity:0.5,background:"rgba(255,255,255,0.08)",
                      padding:"1px 6px",borderRadius:8}}>{s.count}</span>
                  </button>
                ))}
              </div>
              {/* Search bar */}
              <div style={{position:"relative",marginBottom:10}}>
                <div style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",
                  pointerEvents:"none"}}>
                  <Icon d={Icons.search} size={14} stroke="rgba(255,255,255,0.3)"/>
                </div>
                <input value={questSearch} onChange={e=>setQuestSearch(e.target.value)}
                  placeholder={`Search ${questScope} quests…`}
                  style={{width:"100%",background:"rgba(255,255,255,0.04)",
                    border:`1px solid ${questSearch?"rgba(255,255,255,0.18)":"rgba(255,255,255,0.08)"}`,
                    borderRadius:11,padding:"9px 34px 9px 34px",color:"#F0F0F0",fontSize:13,outline:"none",
                    fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box",
                    transition:"border-color 0.2s"}}
                  onFocus={e=>e.target.style.borderColor="rgba(255,255,255,0.3)"}
                  onBlur={e=>e.target.style.borderColor=questSearch?"rgba(255,255,255,0.18)":"rgba(255,255,255,0.08)"}/>
                {questSearch&&(
                  <button onClick={()=>setQuestSearch("")} style={{position:"absolute",right:8,top:"50%",
                    transform:"translateY(-50%)",background:"rgba(255,255,255,0.08)",border:"none",
                    borderRadius:"50%",width:20,height:20,cursor:"pointer",color:"rgba(255,255,255,0.5)",
                    display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Icon d={Icons.x} size={11}/>
                  </button>
                )}
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
        {/* Page transition — remounts with a fresh fade+slide every time the tab changes */}
        <div key={tab} style={{animation:"pageIn 0.4s cubic-bezier(0.34,1.2,0.64,1) both"}}>
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
                <p style={{fontSize:15,color:"rgba(255,255,255,0.18)",lineHeight:1.7}}>
                  {questSearch.trim()
                    ? `No quests match "${questSearch.trim()}".`
                    : filter==="All"?"No quests yet.\nBegin your journey.":`No ${filter} quests.`}
                </p>
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

            {/* Pending board invites */}
            {boardInvites.length>0&&(
              <div style={{marginBottom:20}}>
                <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",
                  color:"#FFD478",fontFamily:"'DM Sans',sans-serif",marginBottom:10}}>
                  Board Invites ({boardInvites.length})
                </p>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {boardInvites.map(inv=>{
                    const palette=getPalette(inv.board_id);
                    return(
                      <div key={inv.id} style={{background:`${palette.color}08`,
                        border:`1px solid ${palette.color}25`,borderRadius:16,padding:"16px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                          <div style={{fontSize:28}}>🗺</div>
                          <div style={{flex:1}}>
                            <div style={{fontSize:15,fontWeight:700,color:"#F2F2F2",
                              fontFamily:"'Cormorant Garamond',serif"}}>{inv.board?.name||"Board"}</div>
                            <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Sans',sans-serif",marginTop:2}}>
                              Invited by <strong style={{color:"rgba(255,255,255,0.6)"}}>{inv.sender?.name||"someone"}</strong>
                            </div>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:8}}>
                          <button onClick={async()=>{
                            try {
                              await sb.respondBoardInvite(inv.id,inv.board_id,user.id,false);
                              setBoardInvites(prev=>prev.filter(i=>i.id!==inv.id));
                            } catch(e){console.error(e);}
                          }} style={{flex:1,padding:"10px",borderRadius:10,
                            background:"rgba(255,80,80,0.08)",border:"1px solid rgba(255,80,80,0.2)",
                            color:"#FF7878",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>
                            Decline
                          </button>
                          <button onClick={async()=>{
                            try {
                              await sb.respondBoardInvite(inv.id,inv.board_id,user.id,true);
                              setBoardInvites(prev=>prev.filter(i=>i.id!==inv.id));
                              // Reload boards
                              const updated = await sb.getMyBoards(user.id);
                              setBoards(updated||[]);
                            } catch(e){console.error(e);}
                          }} style={{flex:2,padding:"10px",borderRadius:10,
                            background:`${palette.color}15`,border:`1px solid ${palette.color}30`,
                            color:palette.color,cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>
                            Join Board
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
              onLeave={()=>handleLeaveBoard(activeBoard)}
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
          <FriendsPage user={user} quests={quests} members={members} onFriendsLoaded={f=>setFriends(f)}/>
        )}

        {tab==="memories"&&(
          <MemoriesPage user={user}/>
        )}

        {tab==="movies"&&(
          <MoviesPage user={user}/>
        )}

        {/* MAP TAB */}
        {tab==="map"&&(
          <QuestMapPage quests={quests}/>
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
            onPhotoChange={(p)=>{
              // Update members list with new photo so header + everywhere else updates instantly
              setMembers(prev=>prev.map(m=>m.user_id===user.id?{...m,photo:p}:m));
            }}
          />
        )}

        {tab==="completed"&&(
          <div style={{maxWidth:560,margin:"20px auto 0",padding:"0 24px"}}>
            <div style={{marginBottom:16}}>
              <p style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(255,255,255,0.2)",marginBottom:4}}>Hall of Fame</p>
              <h2 style={{fontSize:24,fontWeight:700,fontFamily:"'Cormorant Garamond',serif",background:"linear-gradient(135deg,#F2F2F2,rgba(242,242,242,0.5))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Completed Quests</h2>
            </div>
            <CompletedTab quests={quests} onEdit={q=>setQuestModal(q)} onShare={q=>setShareQuest(q)}/>
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
                      const p=getPalette(q.id, q.color_index);
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
        </div>
      </main>
      </div>
      {/* end scrollable content area */}

      {/* ── FLOATING ACTION BUTTONS — anchored to the fixed-height shell, never scroll-jank ── */}
      {["quests","boards"].includes(tab)&&!activeBoard&&(
        <div style={{position:"absolute",right:16,bottom:88,zIndex:60,
          display:"flex",flexDirection:"column",alignItems:"flex-end",gap:10}}>
          {tab==="quests"&&(
            <button onClick={()=>setShowIdeas(true)} style={{
              width:46,height:46,borderRadius:15,
              border:"1px solid rgba(255,255,255,0.1)",cursor:"pointer",
              background:"rgba(14,14,18,0.92)",backdropFilter:"blur(12px)",
              boxShadow:"0 4px 20px rgba(0,0,0,0.5)",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:20,transition:"transform 0.2s cubic-bezier(0.34,1.2,0.64,1)"}}
              onMouseEnter={e=>e.currentTarget.style.transform="scale(1.08)"}
              onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
              ✨
            </button>
          )}
          <button onClick={()=>{
            if(tab==="quests") setQuestModal({...EMPTY_QUEST});
            else if(tab==="boards") setShowCreateBoard(true);
          }} style={{
            width:56,height:56,borderRadius:18,border:"none",cursor:"pointer",
            background:"linear-gradient(135deg,#f0f0f0,#ffffff)",color:"#0A0A0C",
            display:"flex",alignItems:"center",justifyContent:"center",
            boxShadow:"0 6px 24px rgba(255,255,255,0.2),0 2px 10px rgba(0,0,0,0.5)",
            transition:"transform 0.2s cubic-bezier(0.34,1.56,0.64,1)"}}
            onMouseEnter={e=>e.currentTarget.style.transform="scale(1.08)"}
            onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
            <Icon d={Icons.plus} size={24} stroke="#0A0A0C"/>
          </button>
        </div>
      )}

      {/* ── BOTTOM NAV — normal flex item, physically cannot detach on scroll ── */}
      <BottomNav
        tabs={TABS}
        activeTab={tab}
        onSelect={(id)=>{setTab(id);setMemberDetail(null);setActiveBoard(null);}}
      />

      {questModal&&<QuestModal quest={questModal} onSave={saveQuest} friends={friends} onClose={()=>setQuestModal(null)}/>}
      {shareQuest&&<ShareQuestCard quest={shareQuest} user={user} onClose={()=>setShareQuest(null)}/>}
      {showIdeas&&<QuestIdeaGenerator
        onAddQuest={(idea)=>{
          setQuestModal({...EMPTY_QUEST,...idea});
          setShowIdeas(false);
        }}
        onClose={()=>setShowIdeas(false)}
      />}
      {showCreateBoard&&<CreateBoardModal onSave={createBoard} onClose={()=>setShowCreateBoard(false)}/>}
      {inviteBoard&&<InviteModal board={inviteBoard} user={user} friends={friends} onClose={()=>setInviteBoard(null)}/>}
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
