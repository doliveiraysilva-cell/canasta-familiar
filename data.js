// Canasta Familiar: conexión con Supabase (login, base de datos, fotos y lectura con IA)
(() => {
const C = window.CANASTA_CONFIG || {};
const view = document.getElementById("view");
const nav = document.querySelector("nav.tabs");
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

if(!C.url || !C.anonKey || C.url.includes("PEGAR")){
  view.innerHTML = `<div class="card"><div class="empty"><b>Falta configurar la base de datos</b>Completá el archivo config.js con la URL y la clave pública de Supabase.</div></div>`;
  nav.hidden = true; return;
}
const sb = window.supabase.createClient(C.url, C.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
window.CANASTA_SB = sb;

// ---------- adaptador de base de datos (tablas con columnas id + data) ----------
const errOf = e => ({ code: (e && (e.code === "42501" || /row-level|permission|violates/i.test(e.message||""))) ? "invalid_argument" : "unavailable", message: e && e.message });
const listeners = {}, timers = {};
async function refetch(t){
  const { data, error } = await sb.from(t).select("id,data").order("created_at");
  if(error){ console.warn(t, error); (listeners[t]||[]).forEach(l=>l.fail && l.fail(errOf(error))); return; }
  (listeners[t]||[]).forEach(l=>l.next(data));
}
const soon = t => { clearTimeout(timers[t]); timers[t] = setTimeout(()=>refetch(t), 120); };
function watch(t, next, fail){ (listeners[t] ||= []).push({next, fail}); soon(t); return ()=>{ listeners[t] = (listeners[t]||[]).filter(l=>l.next!==next); }; }
const snapOf = rows => { const docs = rows.map(r=>({ id: String(r.id), exists: true, data: () => r.data, metadata: { fromCache: false, hasPendingWrites: false } }));
  return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false } }; };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));
const db = {
  collection(t){ return {
    async add(d){ const id = uuid(); const { error } = await sb.from(t).insert({ id, data: d }); if(error) throw errOf(error); soon(t); return { id }; },
    onSnapshot(next, fail){ return watch(t, rows => next(snapOf(rows)), fail); },
  }; },
  doc(path){ const [t, id] = path.split("/"); return {
    async set(d){
      const { data: upd, error } = await sb.from(t).update({ data: d }).eq("id", id).select("id");
      if(error) throw errOf(error);
      if(!upd || !upd.length){ const { error: e2 } = await sb.from(t).insert({ id, data: d }); if(e2) throw errOf(e2); }
      soon(t);
    },
    async update(d){
      const { data: row, error } = await sb.from(t).select("data").eq("id", id).single(); if(error) throw errOf(error);
      const { error: e2 } = await sb.from(t).update({ data: { ...row.data, ...d } }).eq("id", id); if(e2) throw errOf(e2); soon(t);
    },
    async delete(){ const { error } = await sb.from(t).delete().eq("id", id); if(error) throw errOf(error); soon(t); },
    onSnapshot(next, fail){ return watch(t, rows => { const r = rows.find(x=>String(x.id)===id); next({ id, exists: !!r, data: () => r && r.data, metadata: { fromCache: false } }); }, fail); },
  }; },
};
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") Object.keys(listeners).forEach(soon); });

// ---------- lectura de fotos con IA (Edge Function "leer") ----------
const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
const sample = () => {};
sample.json = async (prompt, opts = {}) => {
  const image = await toB64(opts.images[0]);
  const { data, error } = await sb.functions.invoke("leer", { body: { prompt, image } });
  if(opts.signal && opts.signal.aborted) throw { code: "cancelled" };
  if(error){
    let detail = "";
    try{ const j = await error.context.json(); detail = [j.error, j.detail, j.msg, j.message].filter(Boolean).join(": "); }
    catch{ try{ detail = "HTTP " + error.context.status; }catch{} }
    throw { code: /^sin_clave/.test(detail) ? "not_granted" : "unavailable", message: detail || error.message || "sin respuesta del servidor" };
  }
  return data;
};

// ---------- fotos de tickets (Storage) ----------
const assets = {
  async upload(blob){ const path = uuid() + ".jpg"; const { error } = await sb.storage.from("tickets").upload(path, blob, { contentType: "image/jpeg" }); if(error) throw error; return { id: path }; },
};
window.CANASTA_PHOTO_URL = async path => { const { data } = await sb.storage.from("tickets").createSignedUrl(path, 3600); return data && data.signedUrl; };

// ---------- usuario ----------
let uid = null, ownerId = null;
const user = {
  async me(){ return { id: uid, name: "", email: null, isOwner: uid === ownerId, canEdit: true }; },
  async id(){ return uid; },
  async can(){ return true; },
  async isOwner(){ return uid === ownerId; },
  async canEdit(){ return true; },
  async profiles(ids){ return Object.fromEntries([].concat(ids).map(i=>[i,{ id:i, name:"" }])); },
};
window.claude = { use: async n => ({ db, user, sample, assets })[n] || null };

sb.channel("canasta").on("postgres_changes", { event: "*", schema: "public" }, p => soon(p.table)).subscribe();

// ---------- pantallas de ingreso ----------
const PALETTE = ["#1E6A44","#B5562E","#3B6FB0","#8A4FB0","#A0632A","#2A8C8F","#B0456F"];
const ROLES = ["Papá","Mamá","Hijo/a","Empleada","Otro"];
function msg(t, warn){ return `<div class="banner ${warn?"warn":""}">${esc(t)}</div>`; }

function loginScreen(note){
  nav.hidden = true;
  view.innerHTML = `<div class="card" style="padding:18px;display:flex;flex-direction:column;gap:12px">
    <h2 style="font-family:var(--display);margin:0">Entrar a la canasta</h2>
    <div class="hint">Usá tu email y una contraseña. La primera vez tocá "Crear cuenta".</div>
    ${note||""}
    <form id="lf" style="display:flex;flex-direction:column;gap:10px" autocomplete="on">
      <input id="lfEmail" type="email" placeholder="Email" required autocomplete="email" aria-label="Email">
      <input id="lfPass" type="password" placeholder="Contraseña (mínimo 6)" required minlength="6" autocomplete="current-password" aria-label="Contraseña">
      <div style="display:flex;gap:8px"><button class="btn" type="submit" style="flex:1" id="lfIn">Entrar</button><button class="btn ghost" type="button" style="flex:1" id="lfUp">Crear cuenta</button></div>
    </form></div>`;
  const go = async signup => {
    const email = document.getElementById("lfEmail").value.trim(), password = document.getElementById("lfPass").value;
    if(!email || password.length < 6){ loginScreen(msg("Escribí un email y una contraseña de al menos 6 caracteres.", true)); return; }
    const r = signup ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
    if(r.error){
      const m = /invalid login/i.test(r.error.message) ? "Email o contraseña incorrectos." : /already registered/i.test(r.error.message) ? "Ese email ya tiene cuenta. Tocá Entrar." : "No se pudo: " + r.error.message;
      loginScreen(msg(m, true)); return;
    }
    if(signup && !r.data.session){ loginScreen(msg("Te mandamos un email para confirmar la cuenta. Confirmalo y después tocá Entrar.")); return; }
    gate();
  };
  document.getElementById("lf").onsubmit = e => { e.preventDefault(); go(false); };
  document.getElementById("lfUp").onclick = () => go(true);
}

function joinScreen(first, note){
  nav.hidden = true; let role = "", color = PALETTE[0];
  view.innerHTML = `<div class="card" style="padding:18px;display:flex;flex-direction:column;gap:12px">
    <h2 style="font-family:var(--display);margin:0">${first ? "Crear la canasta de la familia" : "Unirte a la familia"}</h2>
    <div class="hint">${first ? "Sos la primera persona: vas a ser el administrador principal." : "Pedile el código familiar a quien administra la app (está en la pestaña Familia)."}</div>
    ${note||""}
    <form id="jf" style="display:flex;flex-direction:column;gap:12px" autocomplete="off">
      ${first ? "" : `<input id="jfCode" placeholder="Código familiar (6 letras)" required maxlength="6" style="text-transform:uppercase;letter-spacing:.2em" aria-label="Código familiar">`}
      <input id="jfName" placeholder="Tu nombre" required maxlength="30" aria-label="Tu nombre">
      <div><div class="label" style="margin-bottom:6px">En casa soy</div><div class="chips" style="flex-wrap:wrap">${ROLES.map(r=>`<button type="button" class="chip" data-role="${r}" aria-pressed="false">${r}</button>`).join("")}</div></div>
      <div><div class="label" style="margin-bottom:6px">Mi color</div><div class="chips">${PALETTE.map((c,i)=>`<button type="button" class="avatar" data-color="${c}" style="background:${c};${i===0?"outline:3px solid var(--ink);outline-offset:2px":""}" aria-label="Color"></button>`).join("")}</div></div>
      <div class="btns"><button type="button" class="btn ghost" id="jfOut">Salir</button><button class="btn" type="submit">Entrar</button></div>
    </form></div>`;
  view.querySelectorAll("[data-role]").forEach(b=>b.onclick=()=>{ role=b.dataset.role; view.querySelectorAll("[data-role]").forEach(x=>x.setAttribute("aria-pressed", x===b)); });
  view.querySelectorAll("[data-color]").forEach(b=>b.onclick=()=>{ color=b.dataset.color; view.querySelectorAll("[data-color]").forEach(x=>{ x.style.outline = x===b ? "3px solid var(--ink)" : "none"; x.style.outlineOffset="2px"; }); });
  document.getElementById("jfOut").onclick = async () => { await sb.auth.signOut(); gate(); };
  document.getElementById("jf").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.rpc("join_family", { p_code: first ? "" : document.getElementById("jfCode").value, p_name: document.getElementById("jfName").value.trim(), p_role: role, p_color: color });
    if(error){ joinScreen(first, msg(/codigo_invalido/.test(error.message) ? "Ese código no es correcto. Revisalo con quien administra la app." : "No se pudo entrar: " + error.message, true)); return; }
    gate();
  };
}

let started = false;
async function gate(){
  const { data: { session } } = await sb.auth.getSession();
  if(!session){ loginScreen(); return; }
  uid = session.user.id;
  const { data: me, error } = await sb.from("members").select("id").eq("id", uid).maybeSingle();
  if(error){ view.innerHTML = msg("No se pudo conectar con la base de datos: " + error.message, true); return; }
  if(!me){
    const { data: anyone } = await sb.rpc("family_exists");
    joinScreen(anyone === false); return;
  }
  const { data: own } = await sb.from("config").select("data").eq("id", "owner").maybeSingle();
  ownerId = own && own.data && own.data.id; window.CANASTA_OWNER = ownerId;
  nav.hidden = false;
  if(!started){ started = true; window.startApp(); }
}
window.CANASTA_LOGOUT = async () => { await sb.auth.signOut(); location.reload(); };
gate();
})();
