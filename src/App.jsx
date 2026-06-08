import { useState, useEffect, useRef } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STATUSES = ["Active", "Completed", "On Hold", "Abandoned"];
const STATUS_META = {
  Active:    { color: "#A8FF78", glow: "rgba(168,255,120,0.25)", emoji: "⚔️" },
  Completed: { color: "#78C1FF", glow: "rgba(120,193,255,0.25)", emoji: "✦"  },
  "On Hold": { color: "#FFD478", glow: "rgba(255,212,120,0.25)", emoji: "⏸"  },
  Abandoned: { color: "#FF7878", glow: "rgba(255,120,120,0.25)", emoji: "✗"  },
};
const EMPTY_QUEST = {
  id: null, title: "", description: "",
  status: "Active", invitees: "", createdAt: null,
  location: null,
};

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const load = () => { try { return JSON.parse(localStorage.getItem("sidequests") || "[]"); } catch { return []; } };
const save = (q) => localStorage.setItem("sidequests", JSON.stringify(q));

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Icon = ({ d, size = 18, stroke = "currentColor", fill = "none", sw = "1.8" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
    stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const Icons = {
  plus:    "M12 5v14M5 12h14",
  x:       "M18 6 6 18M6 6l12 12",
  edit:    "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  trash:   "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  user:    "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  chevron: "M6 9l6 6 6-6",
  pin:     "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 10a1 1 0 1 1-2 0 1 1 0 0 1 2 0z",
  search:  "M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z",
  map:     "M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7zM9 4v13M15 7v13",
};

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const { color } = STATUS_META[status] || STATUS_META["Active"];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:7,
      fontSize:10, fontWeight:700, letterSpacing:"0.1em", color, textTransform:"uppercase" }}>
      <span style={{ width:7, height:7, borderRadius:"50%", background:color, flexShrink:0,
        animation: status==="Active" ? "pulseDot 2s ease-in-out infinite" : "none" }} />
      {status}
    </span>
  );
}

// ─── ACTION BTN ───────────────────────────────────────────────────────────────
function ActionBtn({ onClick, children, danger, title }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} title={title} style={{
      background: h ? (danger ? "rgba(255,100,100,0.15)" : "rgba(255,255,255,0.09)") : "transparent",
      border:`1px solid ${h?(danger?"rgba(255,100,100,0.4)":"rgba(255,255,255,0.18)"):"rgba(255,255,255,0.08)"}`,
      borderRadius:9, padding:"6px 8px",
      color: h ? (danger?"#FF7878":"#fff") : "rgba(255,255,255,0.4)",
      cursor:"pointer", display:"flex", alignItems:"center",
      transition:"all 0.15s", transform: h?"scale(1.08)":"scale(1)",
    }} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}>
      {children}
    </button>
  );
}

// ─── MAP VIEW (Google Maps embed — shows pin, works without API key) ──────────
function MapView({ location, height = 200 }) {
  if (!location) return null;

  // Google Maps embed with marker — works for public use without billing key
  const q = encodeURIComponent(location.name);
  const src = `https://maps.google.com/maps?q=${q}&t=&z=15&ie=UTF8&iwloc=&output=embed`;

  return (
    <div style={{ position:"relative", borderRadius:14, overflow:"hidden",
      border:"1px solid rgba(255,255,255,0.1)", background:"#0d1117" }}>

      {/* Dark overlay tint — sits on top with pointer-events:none so map is still interactive */}
      <div style={{ position:"absolute", inset:0, zIndex:1, pointerEvents:"none",
        background:"rgba(10,12,18,0.28)", mixBlendMode:"multiply" }} />

      <iframe
        title="Quest location"
        src={src}
        width="100%"
        height={height}
        style={{ display:"block", border:"none",
          filter:"invert(1) hue-rotate(190deg) saturate(0.55) brightness(0.82) contrast(1.05)" }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />

      {/* Bottom label */}
      <div style={{ position:"absolute", bottom:0, left:0, right:0, zIndex:2,
        background:"linear-gradient(to top, rgba(8,8,12,0.97) 0%, transparent 100%)",
        padding:"24px 14px 11px", display:"flex", alignItems:"center", gap:7 }}>
        <Icon d={Icons.pin} size={14} stroke="#A8FF78" fill="rgba(168,255,120,0.25)" />
        <span style={{ fontSize:12.5, color:"rgba(255,255,255,0.75)",
          fontFamily:"'DM Sans',sans-serif", fontWeight:500, flex:1,
          whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {location.name}
        </span>
        <a href={`https://www.google.com/maps/search/?api=1&query=${q}`}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize:11, color:"rgba(255,255,255,0.35)", textDecoration:"none",
            fontFamily:"'DM Sans',sans-serif", flexShrink:0,
            padding:"3px 8px", borderRadius:6, border:"1px solid rgba(255,255,255,0.1)",
            background:"rgba(255,255,255,0.05)", transition:"color 0.15s" }}
          onMouseEnter={e=>e.currentTarget.style.color="#fff"}
          onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.35)"}>
          Open ↗
        </a>
      </div>
    </div>
  );
}

// ─── LOCATION SEARCH (corsproxy + Nominatim — free, no API key needed) ─────
function LocationSearch({ value, onChange }) {
  const [query, setQuery]     = useState(value?.name || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]       = useState(false);
  const [error, setError]     = useState("");
  const debounceRef           = useRef(null);

  const search = (q) => {
    clearTimeout(debounceRef.current);
    setError("");
    if (q.trim().length < 2) { setResults([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const nominatim = `https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=en&q=${encodeURIComponent(q + " Azerbaijan")}`;
        const url = `https://corsproxy.io/?url=${encodeURIComponent(nominatim)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("bad response");
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("bad format");
        setResults(data);
        setOpen(true);
        if (data.length === 0) setError("No results found. Try a different name.");
      } catch {
        setError("Search failed. Please try again.");
        setResults([]);
      }
      setLoading(false);
    }, 450);
  };

  const select = (r) => {
    const name = r.display_name.split(",").slice(0, 2).join(", ");
    onChange({ name, lat: parseFloat(r.lat), lng: parseFloat(r.lon) });
    setQuery(name);
    setResults([]);
    setOpen(false);
    setError("");
  };

  const clear = () => { onChange(null); setQuery(""); setResults([]); setOpen(false); setError(""); };

  return (
    <div style={{ position:"relative" }}>
      <div style={{ position:"relative" }}>
        <div style={{ position:"absolute", left:13, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}>
          {loading
            ? <div style={{ width:15, height:15, border:"1.5px solid rgba(255,255,255,0.2)",
                borderTopColor:"rgba(255,255,255,0.7)", borderRadius:"50%",
                animation:"spin 0.7s linear infinite" }} />
            : <Icon d={Icons.search} size={15} stroke="rgba(255,255,255,0.3)" />}
        </div>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); search(e.target.value); }}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="e.g. Baku, Nizami Street, Ganja…"
          style={{
            width:"100%", background:"rgba(255,255,255,0.05)",
            border:"1px solid rgba(255,255,255,0.12)", borderRadius:12,
            padding:"12px 38px 12px 38px", color:"#F0F0F0", fontSize:13.5,
            outline:"none", fontFamily:"'DM Sans',sans-serif",
            boxSizing:"border-box", transition:"border-color 0.2s",
          }}
          onFocus={e => e.target.style.borderColor="rgba(255,255,255,0.25)"}
          onBlur={e => e.target.style.borderColor="rgba(255,255,255,0.12)"}
        />
        {query && (
          <button onClick={clear} style={{ position:"absolute", right:11, top:"50%",
            transform:"translateY(-50%)", background:"rgba(255,255,255,0.07)",
            border:"none", borderRadius:6, cursor:"pointer", padding:"3px 4px",
            color:"rgba(255,255,255,0.4)", display:"flex", alignItems:"center" }}>
            <Icon d={Icons.x} size={13} />
          </button>
        )}
      </div>

      {error && <p style={{ fontSize:12, color:"rgba(255,160,100,0.8)", margin:"6px 0 0",
        fontFamily:"'DM Sans',sans-serif" }}>{error}</p>}

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, right:0, zIndex:9999,
          background:"#101014", border:"1px solid rgba(255,255,255,0.11)",
          borderRadius:14, overflow:"hidden", boxShadow:"0 20px 60px rgba(0,0,0,0.7)" }}>
          {results.map((r, i) => (
            <button key={i} onMouseDown={() => select(r)} style={{
              width:"100%", textAlign:"left", background:"transparent", border:"none",
              borderTop: i===0?"none":"1px solid rgba(255,255,255,0.05)",
              padding:"11px 14px", cursor:"pointer",
              display:"flex", alignItems:"flex-start", gap:11, transition:"background 0.12s",
            }}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
            >
              <div style={{ marginTop:2, flexShrink:0 }}>
                <Icon d={Icons.pin} size={15} stroke="rgba(168,255,120,0.6)" />
              </div>
              <div>
                <div style={{ fontSize:13.5, color:"#F0F0F0", fontFamily:"'DM Sans',sans-serif",
                  fontWeight:600, lineHeight:1.3 }}>{r.display_name.split(",").slice(0,2).join(", ")}</div>
                <div style={{ fontSize:11.5, color:"rgba(255,255,255,0.32)",
                  fontFamily:"'DM Sans',sans-serif", marginTop:2 }}>
                  {r.display_name.split(",").slice(2,4).join(", ")}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Selected pill */}
      {value && !open && (
        <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:8,
          padding:"8px 12px", borderRadius:10,
          background:"rgba(168,255,120,0.06)", border:"1px solid rgba(168,255,120,0.18)" }}>
          <Icon d={Icons.pin} size={13} stroke="#A8FF78" fill="rgba(168,255,120,0.2)" />
          <span style={{ fontSize:12.5, color:"rgba(255,255,255,0.65)",
            fontFamily:"'DM Sans',sans-serif", flex:1 }}>{value.name}</span>
          <button onClick={clear} style={{ background:"none", border:"none",
            cursor:"pointer", color:"rgba(255,255,255,0.25)", display:"flex", padding:2 }}>
            <Icon d={Icons.x} size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── QUEST CARD (collapsible) ─────────────────────────────────────────────────
function QuestCard({ quest, onEdit, onDelete, index }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered]   = useState(false);
  const { color, glow, emoji }  = STATUS_META[quest.status] || STATUS_META["Active"];
  const inviteeList = quest.invitees
    ? quest.invitees.split(",").map(s => s.trim()).filter(Boolean) : [];
  const hasDetails = quest.description || inviteeList.length > 0 || quest.location;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position:"relative", overflow:"hidden",
        background: expanded ? "rgba(255,255,255,0.05)" : hovered ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.025)",
        border:`1px solid ${expanded?"rgba(255,255,255,0.13)":hovered?"rgba(255,255,255,0.11)":"rgba(255,255,255,0.07)"}`,
        borderRadius:20,
        transition:"all 0.3s cubic-bezier(0.34,1.2,0.64,1)",
        transform: hovered && !expanded ? "translateY(-2px)" : "translateY(0)",
        boxShadow: expanded ? `0 16px 48px rgba(0,0,0,0.45)` : hovered ? "0 8px 24px rgba(0,0,0,0.3)" : "none",
        animation:`cardIn 0.5s cubic-bezier(0.34,1.2,0.64,1) ${index*0.07}s both`,
      }}
    >
      {/* Top accent line */}
      <div style={{
        position:"absolute", top:0, left:0, right:0, height:1,
        background:`linear-gradient(90deg,transparent,${color}70,transparent)`,
        opacity: expanded ? 1 : hovered ? 0.4 : 0, transition:"opacity 0.3s",
      }} />

      {/* Watermark */}
      <div style={{ position:"absolute", right:16, bottom:12, fontSize:36,
        opacity: expanded?0.06:0.03, userSelect:"none", filter:"blur(1px)", transition:"opacity 0.3s" }}>
        {emoji}
      </div>

      {/* ── Collapsed header ── */}
      <div
        onClick={() => hasDetails && setExpanded(e => !e)}
        style={{ padding:"18px 20px", display:"flex", alignItems:"center", gap:12,
          cursor: hasDetails?"pointer":"default", userSelect:"none" }}
      >
        {/* Status dot */}
        <div style={{ width:8, height:8, borderRadius:"50%", flexShrink:0, background:color,
          boxShadow: quest.status==="Active"?`0 0 8px ${color}`:"none",
          animation: quest.status==="Active"?"pulseDot 2s ease-in-out infinite":"none" }} />

        {/* Title + hint */}
        <div style={{ flex:1, minWidth:0 }}>
          <h3 style={{ margin:0, fontSize:16, fontWeight:700, letterSpacing:"-0.02em",
            color:"#F2F2F2", lineHeight:1.3, whiteSpace:"nowrap",
            overflow:"hidden", textOverflow:"ellipsis",
            fontFamily:"'Cormorant Garamond',serif" }}>
            {quest.title}
          </h3>
          {!expanded && (quest.description || quest.location) && (
            <p style={{ margin:"3px 0 0", fontSize:12, color:"rgba(255,255,255,0.3)",
              whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
              fontFamily:"'DM Sans',sans-serif", lineHeight:1.4 }}>
              {quest.location ? `📍 ${quest.location.name}` : quest.description?.slice(0,60)+(quest.description?.length>60?"…":"")}
            </p>
          )}
        </div>

        {/* Right controls */}
        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          <StatusBadge status={quest.status} />
          {hasDetails && (
            <div style={{
              display:"flex", alignItems:"center", justifyContent:"center",
              width:24, height:24, borderRadius:6, background:"rgba(255,255,255,0.05)",
              transition:"transform 0.3s cubic-bezier(0.34,1.2,0.64,1)",
              transform: expanded?"rotate(180deg)":"rotate(0deg)", flexShrink:0,
            }}>
              <Icon d={Icons.chevron} size={14} stroke="rgba(255,255,255,0.4)" />
            </div>
          )}
          <div style={{ display:"flex", gap:5, opacity:hovered||expanded?1:0.3, transition:"opacity 0.2s" }}
            onClick={e=>e.stopPropagation()}>
            <ActionBtn onClick={()=>onEdit(quest)} title="Edit"><Icon d={Icons.edit} size={13} /></ActionBtn>
            <ActionBtn onClick={()=>onDelete(quest.id)} title="Delete" danger><Icon d={Icons.trash} size={13} /></ActionBtn>
          </div>
        </div>
      </div>

      {/* ── Expanded content ── */}
      <div style={{
        maxHeight: expanded ? 700 : 0,
        overflow:"hidden",
        transition:"max-height 0.45s cubic-bezier(0.4,0,0.2,1)",
      }}>
        <div style={{ padding:"0 20px 20px", display:"flex", flexDirection:"column", gap:16,
          borderTop:"1px solid rgba(255,255,255,0.06)" }}>

          {quest.description && (
            <p style={{ margin:"14px 0 0", fontSize:13.5, color:"rgba(255,255,255,0.5)",
              lineHeight:1.75, fontFamily:"'DM Sans',sans-serif" }}>
              {quest.description}
            </p>
          )}

          {quest.location && expanded && (
            <div style={{ animation:"cardIn 0.4s ease 0.08s both" }}>
              <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:10 }}>
                <Icon d={Icons.map} size={13} stroke="rgba(255,255,255,0.3)" />
                <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em",
                  textTransform:"uppercase", color:"rgba(255,255,255,0.25)",
                  fontFamily:"'DM Sans',sans-serif" }}>Location</span>
              </div>
              <MapView location={quest.location} height={200} />
            </div>
          )}

          {inviteeList.length > 0 && (
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:8 }}>
                <Icon d={Icons.user} size={13} stroke="rgba(255,255,255,0.3)" />
                <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.1em",
                  textTransform:"uppercase", color:"rgba(255,255,255,0.25)",
                  fontFamily:"'DM Sans',sans-serif" }}>Party</span>
              </div>
              <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
                {inviteeList.map((name,i) => (
                  <span key={i} style={{ fontSize:12, padding:"4px 12px",
                    background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)",
                    borderRadius:20, color:"rgba(255,255,255,0.55)", fontFamily:"'DM Sans',sans-serif" }}>
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {quest.createdAt && (
            <p style={{ margin:0, fontSize:10.5, color:"rgba(255,255,255,0.18)",
              fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.04em" }}>
              Created {new Date(quest.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function Modal({ quest, onSave, onClose }) {
  const [form, setForm] = useState({ ...EMPTY_QUEST, ...quest });
  const [visible, setVisible] = useState(false);
  const titleRef = useRef(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    setTimeout(() => titleRef.current?.focus(), 100);
  }, []);

  const close = () => { setVisible(false); setTimeout(onClose, 250); };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!form.title.trim()) return;
    onSave({ ...form, id: form.id||Date.now(), createdAt: form.createdAt||new Date().toISOString() });
  };

  const inputStyle = {
    width:"100%", background:"rgba(255,255,255,0.04)",
    border:"1px solid rgba(255,255,255,0.09)", borderRadius:12,
    padding:"12px 14px", color:"#F0F0F0", fontSize:14, outline:"none",
    fontFamily:"'DM Sans',sans-serif", boxSizing:"border-box", transition:"border-color 0.2s",
  };
  const labelStyle = {
    fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase",
    color:"rgba(255,255,255,0.3)", marginBottom:7, display:"block", fontFamily:"'DM Sans',sans-serif",
  };

  return (
    <div style={{
      position:"fixed", inset:0,
      background:`rgba(0,0,0,${visible?0.72:0})`,
      backdropFilter:`blur(${visible?18:0}px)`,
      display:"flex", alignItems:"flex-end", justifyContent:"center",
      zIndex:1000, transition:"background 0.25s, backdrop-filter 0.25s",
    }} onClick={e=>e.target===e.currentTarget&&close()}>
      <div style={{
        background:"linear-gradient(160deg,#111114 0%,#0C0C0F 100%)",
        borderRadius:"24px 24px 0 0",
        border:"1px solid rgba(255,255,255,0.09)", borderBottom:"none",
        width:"100%", maxWidth:560,
        padding:"12px 24px 52px",
        display:"flex", flexDirection:"column", gap:20,
        transform: visible?"translateY(0)":"translateY(100%)",
        transition:"transform 0.3s cubic-bezier(0.34,1.1,0.64,1)",
        maxHeight:"92vh", overflowY:"auto",
      }}>
        <div style={{ width:40, height:4, borderRadius:2, background:"rgba(255,255,255,0.1)", margin:"8px auto 0" }} />

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <h2 style={{ margin:0, fontSize:20, fontWeight:700,
            fontFamily:"'Cormorant Garamond',serif", color:"#F2F2F2" }}>
            {quest?.id ? "Edit Quest" : "New Quest"}
          </h2>
          <button onClick={close} style={{ background:"rgba(255,255,255,0.06)",
            border:"1px solid rgba(255,255,255,0.08)", borderRadius:10,
            padding:"7px 8px", cursor:"pointer", color:"rgba(255,255,255,0.4)" }}>
            <Icon d={Icons.x} size={16} />
          </button>
        </div>

        <div>
          <label style={labelStyle}>Title *</label>
          <input ref={titleRef} value={form.title} onChange={e=>set("title",e.target.value)}
            placeholder="Name your quest…" style={inputStyle}
            onFocus={e=>{e.target.style.borderColor="rgba(255,255,255,0.22)";}}
            onBlur={e=>{e.target.style.borderColor="rgba(255,255,255,0.09)";}} />
        </div>

        <div>
          <label style={labelStyle}>Description</label>
          <textarea value={form.description} onChange={e=>set("description",e.target.value)}
            placeholder="What does this quest involve? Why does it matter?" rows={3}
            style={{...inputStyle, resize:"vertical", lineHeight:1.65}}
            onFocus={e=>{e.target.style.borderColor="rgba(255,255,255,0.22)";}}
            onBlur={e=>{e.target.style.borderColor="rgba(255,255,255,0.09)";}} />
        </div>

        <div>
          <label style={labelStyle}>Status</label>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {STATUSES.map(s => {
              const active = form.status===s;
              const { color, glow } = STATUS_META[s];
              return (
                <button key={s} onClick={()=>set("status",s)} style={{
                  padding:"8px 16px", borderRadius:20, fontSize:12, fontWeight:600,
                  letterSpacing:"0.04em", fontFamily:"'DM Sans',sans-serif", cursor:"pointer",
                  border:`1px solid ${active?color:"rgba(255,255,255,0.09)"}`,
                  background: active?`${color}18`:"transparent",
                  color: active?color:"rgba(255,255,255,0.35)",
                  boxShadow: active?`0 0 16px ${glow}`:"none",
                  transform: active?"scale(1.04)":"scale(1)",
                  transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)",
                }}>{s}</button>
              );
            })}
          </div>
        </div>

        <div>
          <label style={labelStyle}>Location</label>
          <LocationSearch value={form.location} onChange={loc=>set("location",loc)} />
          {form.location && (
            <div style={{ marginTop:12 }}>
              <MapView location={form.location} height={180} />
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle}>Invite People</label>
          <input value={form.invitees} onChange={e=>set("invitees",e.target.value)}
            placeholder="Alice, Bob, Charlie (comma separated)" style={inputStyle}
            onFocus={e=>{e.target.style.borderColor="rgba(255,255,255,0.22)";}}
            onBlur={e=>{e.target.style.borderColor="rgba(255,255,255,0.09)";}} />
        </div>

        <button onClick={handleSave} disabled={!form.title.trim()} style={{
          background: form.title.trim()?"linear-gradient(135deg,#e8e8e8,#ffffff)":"rgba(255,255,255,0.08)",
          color: form.title.trim()?"#0A0A0C":"rgba(255,255,255,0.2)",
          border:"none", borderRadius:14, padding:"15px",
          fontSize:15, fontWeight:700, cursor:form.title.trim()?"pointer":"not-allowed",
          fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.01em",
          transition:"all 0.25s cubic-bezier(0.34,1.2,0.64,1)",
          boxShadow: form.title.trim()?"0 4px 24px rgba(255,255,255,0.1)":"none",
        }}>
          {quest?.id ? "Save Changes" : "Add Quest"}
        </button>
      </div>
    </div>
  );
}

// ─── STATS BAR ────────────────────────────────────────────────────────────────
function StatsBar({ quests }) {
  const active = quests.filter(q=>q.status==="Active").length;
  const done   = quests.filter(q=>q.status==="Completed").length;
  const total  = quests.length;
  const pct    = total>0?Math.round((done/total)*100):0;
  if (total===0) return null;
  return (
    <div style={{ marginBottom:16, padding:"14px 18px", borderRadius:16,
      background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.06)",
      display:"flex", gap:20, alignItems:"center",
      animation:"cardIn 0.5s cubic-bezier(0.34,1.2,0.64,1) 0.1s both" }}>
      <div style={{ flex:1 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
          <span style={{ fontSize:10, color:"rgba(255,255,255,0.25)", fontFamily:"'DM Sans',sans-serif", letterSpacing:"0.06em" }}>PROGRESS</span>
          <span style={{ fontSize:10, color:"rgba(255,255,255,0.4)", fontFamily:"'DM Sans',sans-serif", fontWeight:600 }}>{pct}%</span>
        </div>
        <div style={{ height:3, background:"rgba(255,255,255,0.06)", borderRadius:2 }}>
          <div style={{ height:"100%", borderRadius:2, width:`${pct}%`,
            background:"linear-gradient(90deg,#78C1FF,#A8FF78)",
            transition:"width 0.8s cubic-bezier(0.34,1.2,0.64,1)",
            boxShadow:"0 0 8px rgba(168,255,120,0.4)" }} />
        </div>
      </div>
      {[{l:"Active",v:active,c:"#A8FF78"},{l:"Done",v:done,c:"#78C1FF"}].map(({l,v,c})=>(
        <div key={l} style={{ textAlign:"center" }}>
          <div style={{ fontSize:20, fontWeight:700, color:c, fontFamily:"'Cormorant Garamond',serif", lineHeight:1 }}>{v}</div>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.25)", letterSpacing:"0.08em", marginTop:3, fontFamily:"'DM Sans',sans-serif" }}>{l.toUpperCase()}</div>
        </div>
      ))}
    </div>
  );
}

// ─── DELETE CONFIRM ───────────────────────────────────────────────────────────
function DeleteConfirm({ onConfirm, onCancel }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);
  const close = (cb) => { setVisible(false); setTimeout(cb, 200); };
  return (
    <div style={{ position:"fixed", inset:0,
      background:`rgba(0,0,0,${visible?0.7:0})`, backdropFilter:`blur(${visible?12:0}px)`,
      display:"flex", alignItems:"center", justifyContent:"center",
      zIndex:1000, padding:24, transition:"all 0.2s" }}
      onClick={e=>e.target===e.currentTarget&&close(onCancel)}>
      <div style={{ background:"linear-gradient(160deg,#111114,#0C0C0F)",
        border:"1px solid rgba(255,255,255,0.09)", borderRadius:22,
        padding:"28px 24px", maxWidth:320, width:"100%",
        transform:visible?"scale(1) translateY(0)":"scale(0.94) translateY(8px)",
        transition:"transform 0.25s cubic-bezier(0.34,1.2,0.64,1)" }}>
        <div style={{ fontSize:36, marginBottom:12, textAlign:"center" }}>⚠️</div>
        <h3 style={{ margin:"0 0 8px", fontSize:18, textAlign:"center",
          fontFamily:"'Cormorant Garamond',serif", color:"#F2F2F2" }}>Abandon this quest?</h3>
        <p style={{ margin:"0 0 24px", fontSize:13.5, textAlign:"center",
          color:"rgba(255,255,255,0.3)", lineHeight:1.6, fontFamily:"'DM Sans',sans-serif" }}>
          This will permanently remove it. No going back.
        </p>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={()=>close(onCancel)} style={{ flex:1, padding:"13px", borderRadius:12,
            background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)",
            color:"rgba(255,255,255,0.5)", cursor:"pointer", fontSize:14, fontWeight:600,
            fontFamily:"'DM Sans',sans-serif" }}>Keep It</button>
          <button onClick={()=>close(onConfirm)} style={{ flex:1, padding:"13px", borderRadius:12,
            background:"rgba(255,80,80,0.1)", border:"1px solid rgba(255,80,80,0.25)",
            color:"#FF7878", cursor:"pointer", fontSize:14, fontWeight:700,
            fontFamily:"'DM Sans',sans-serif" }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [quests, setQuests] = useState(load);
  const [filter, setFilter] = useState("All");
  const [modal, setModal]   = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [mounted, setMounted]   = useState(false);

  useEffect(() => { setTimeout(() => setMounted(true), 50); }, []);
  useEffect(() => save(quests), [quests]);

  const saveQuest = (q) => {
    setQuests(prev => {
      const exists = prev.find(x=>x.id===q.id);
      return exists ? prev.map(x=>x.id===q.id?q:x) : [q,...prev];
    });
    setModal(null);
  };
  const deleteQuest = () => { setQuests(prev=>prev.filter(q=>q.id!==deleteId)); setDeleteId(null); };

  const filtered = filter==="All"?quests:quests.filter(q=>q.status===filter);
  const counts   = STATUSES.reduce((acc,s)=>({...acc,[s]:quests.filter(q=>q.status===s).length}),{});

  return (
    <div style={{ minHeight:"100vh", background:"#08080A", color:"#F0F0F0",
      fontFamily:"'DM Sans',sans-serif", paddingBottom:120,
      opacity:mounted?1:0, transition:"opacity 0.4s ease", position:"relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::placeholder{color:rgba(255,255,255,0.18)!important;}
        ::-webkit-scrollbar{width:0;}
        body{background:#08080A;}
        @keyframes pulseDot{0%,100%{opacity:1;box-shadow:0 0 0 0 currentColor;}50%{opacity:0.7;box-shadow:0 0 0 5px transparent;}}
        @keyframes cardIn{from{opacity:0;transform:translateY(18px) scale(0.97);}to{opacity:1;transform:translateY(0) scale(1);}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes orb1{0%,100%{transform:translate(0,0) scale(1);}50%{transform:translate(40px,-30px) scale(1.1);}}
        @keyframes orb2{0%,100%{transform:translate(0,0) scale(1);}50%{transform:translate(-30px,40px) scale(1.08);}}
        @keyframes orb3{0%,100%{transform:translate(0,0) scale(1);}33%{transform:translate(20px,20px) scale(1.05);}66%{transform:translate(-20px,-10px) scale(0.95);}}
        @keyframes titleIn{from{opacity:0;transform:translateY(-10px);}to{opacity:1;transform:translateY(0);}}
        @keyframes fabPulse{0%,100%{box-shadow:0 8px 32px rgba(0,0,0,0.5),0 0 0 0 rgba(240,240,240,0.1);}50%{box-shadow:0 8px 32px rgba(0,0,0,0.5),0 0 0 8px rgba(240,240,240,0);}}
      `}</style>

      {/* Ambient orbs */}
      <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0, overflow:"hidden" }}>
        {[
          {w:500,h:500,c:"rgba(168,255,120,0.06)",t:-100,l:-100,a:"orb1 12s ease-in-out infinite"},
          {w:600,h:600,c:"rgba(120,193,255,0.05)",b:-200,r:-100,a:"orb2 16s ease-in-out infinite"},
          {w:400,h:400,c:"rgba(255,212,120,0.04)",t:"40%",r:"20%",a:"orb3 20s ease-in-out infinite"},
        ].map((o,i)=>(
          <div key={i} style={{ position:"absolute", width:o.w, height:o.h, borderRadius:"50%",
            background:`radial-gradient(circle,${o.c} 0%,transparent 70%)`,
            top:o.t, left:o.l, bottom:o.b, right:o.r, animation:o.a }} />
        ))}
      </div>

      {/* Header */}
      <header style={{ position:"sticky", top:0, zIndex:10, background:"rgba(8,8,10,0.82)",
        backdropFilter:"blur(24px)", borderBottom:"1px solid rgba(255,255,255,0.05)",
        padding:"48px 24px 20px" }}>
        <div style={{ maxWidth:560, margin:"0 auto" }}>
          <p style={{ fontSize:10, fontWeight:700, letterSpacing:"0.16em",
            textTransform:"uppercase", color:"rgba(255,255,255,0.2)", marginBottom:4 }}>Your Life</p>
          <h1 style={{ fontSize:32, fontWeight:700, letterSpacing:"-0.03em", marginBottom:20,
            fontFamily:"'Cormorant Garamond',serif",
            animation:"titleIn 0.6s cubic-bezier(0.34,1.2,0.64,1) both",
            background:"linear-gradient(135deg,#F2F2F2 0%,rgba(242,242,242,0.55) 100%)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Side Quests</h1>
          <div style={{ display:"flex", gap:7, overflowX:"auto", paddingBottom:2 }}>
            {["All",...STATUSES].map((s,i) => {
              const active = filter===s;
              const count  = s==="All"?quests.length:counts[s];
              const color  = s==="All"?"#F0F0F0":STATUS_META[s]?.color;
              const glow   = s!=="All"?STATUS_META[s]?.glow:null;
              return (
                <button key={s} onClick={()=>setFilter(s)} style={{
                  flexShrink:0, padding:"6px 14px", borderRadius:20,
                  fontSize:11.5, fontWeight:600, cursor:"pointer",
                  fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap",
                  border:`1px solid ${active?color:"rgba(255,255,255,0.09)"}`,
                  background: active?`${color}15`:"transparent",
                  color: active?color:"rgba(255,255,255,0.3)",
                  boxShadow: active&&glow?`0 0 14px ${glow}`:"none",
                  transform: active?"scale(1.04)":"scale(1)",
                  transition:"all 0.2s cubic-bezier(0.34,1.2,0.64,1)",
                  animation:`cardIn 0.4s ease ${i*0.04}s both`,
                }}>
                  {s}{count>0&&<span style={{opacity:0.5,marginLeft:5,fontSize:10}}>{count}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Content */}
      <main style={{ position:"relative", zIndex:1, maxWidth:560, margin:"20px auto 0", padding:"0 24px" }}>
        <StatsBar quests={quests} />
        {filtered.length===0 ? (
          <div style={{ textAlign:"center", padding:"80px 0", animation:"cardIn 0.5s ease both" }}>
            <div style={{ fontSize:48, marginBottom:16, opacity:0.12 }}>⚔️</div>
            <p style={{ fontSize:15, color:"rgba(255,255,255,0.18)", lineHeight:1.7 }}>
              {filter==="All"?"No quests yet.\nBegin your journey.":`No ${filter} quests.`}
            </p>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {filtered.map((q,i)=>(
              <QuestCard key={q.id} quest={q} index={i}
                onEdit={q=>setModal(q)} onDelete={id=>setDeleteId(id)} />
            ))}
          </div>
        )}
      </main>

      {/* FAB */}
      <button onClick={()=>setModal({...EMPTY_QUEST})} style={{
        position:"fixed", bottom:36, left:"50%", transform:"translateX(-50%)",
        background:"linear-gradient(135deg,#e8e8e8,#ffffff)",
        color:"#0A0A0C", border:"none", borderRadius:28,
        padding:"14px 28px", display:"flex", alignItems:"center", gap:9,
        fontSize:14, fontWeight:700, cursor:"pointer",
        fontFamily:"'DM Sans',sans-serif", letterSpacing:"-0.01em",
        animation:"fabPulse 3s ease-in-out infinite",
        transition:"transform 0.2s cubic-bezier(0.34,1.56,0.64,1)", zIndex:100,
      }}
        onMouseEnter={e=>{e.currentTarget.style.transform="translateX(-50%) scale(1.06)";e.currentTarget.style.animation="none";e.currentTarget.style.boxShadow="0 12px 48px rgba(0,0,0,0.6)";}}
        onMouseLeave={e=>{e.currentTarget.style.transform="translateX(-50%) scale(1)";e.currentTarget.style.animation="fabPulse 3s ease-in-out infinite";e.currentTarget.style.boxShadow="";}}
        onMouseDown={e=>{e.currentTarget.style.transform="translateX(-50%) scale(0.97)";}}
        onMouseUp={e=>{e.currentTarget.style.transform="translateX(-50%) scale(1.06)";}}
      >
        <Icon d={Icons.plus} size={16} stroke="#0A0A0C" />
        New Quest
      </button>

      {modal   && <Modal quest={modal} onSave={saveQuest} onClose={()=>setModal(null)} />}
      {deleteId && <DeleteConfirm onConfirm={deleteQuest} onCancel={()=>setDeleteId(null)} />}
    </div>
  );
}