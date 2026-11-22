/* Homi · POST /api/lead
   1. Valida los datos y el consentimiento.
   2. Toma depa, proyecto y broker asignado del catálogo (no confía en el navegador).
   3. Guarda el lead en Supabase (tabla leads) y obtiene el folio HOMI-0001.
   4. Avisa por email (Resend) al broker asignado y a ti, y manda confirmación al cliente.
      Opcional: también lo manda a un webhook (LEAD_WEBHOOK_URL).
   Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM, OWNER_EMAIL,
              BROKER_EMAILS, OPERATOR_WHATSAPP, SITE_URL, LEAD_WEBHOOK_URL (opcional). */
const fs = require("fs");
const path = require("path");

const env = k => (process.env[k] || "").trim();
let CAT = null;
const catalog = () => CAT || (CAT = JSON.parse(fs.readFileSync(path.join(process.cwd(), "catalogo.json"), "utf8")));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (s, n) => String(s == null ? "" : s).trim().slice(0, n);
const money = (n, cur) => "$" + Math.round(n).toLocaleString("en-US") + " " + cur;

/* Límite simple por IP (por instancia): 6 envíos cada 10 minutos */
const hits = new Map();
function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 600000);
  list.push(now); hits.set(ip, list);
  return list.length > 6;
}

function brokerEmail(id) {
  try { const map = JSON.parse(env("BROKER_EMAILS") || "{}"); return (map[id] || "").trim(); } catch (e) { console.error("BROKER_EMAILS no es JSON válido"); return ""; }
}

async function sendEmail(payload) {
  const key = env("RESEND_API_KEY");
  if (!key) return { skipped: "RESEND_API_KEY" };
  const r = await fetch(env("RESEND_API_URL") || "https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  return r.json();
}

const shell = (inner) => `<div style="font-family:Helvetica,Arial,sans-serif;background:#05080A;color:#EEF4F2;padding:28px">
  <div style="max-width:560px;margin:0 auto;background:#0C1215;border-radius:20px;padding:28px">
  <p style="font-size:22px;margin:0 0 18px;font-weight:300">Hom<b style="color:#D0FF78">i</b></p>${inner}</div></div>`;
const row = (k, v) => v ? `<tr><td style="padding:6px 12px 6px 0;color:#8A9A9E;font-size:14px;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-size:14px">${v}</td></tr>` : "";

module.exports = async (req, res) => {
  const json = (s, o) => { res.statusCode = s; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(o)); };
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(405, { error: "method" }); }

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || typeof b !== "object") return json(400, { error: "body" });
  if (b.hpf) return json(400, { error: "spam" });                       // campo trampa

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  if (limited(ip)) return json(429, { error: "too_many" });

  const nombre = clip(b.nombre, 80), email = clip(b.email, 120).toLowerCase();
  const whatsapp = clip(b.whatsapp, 24).replace(/[^\d+\s()-]/g, "");
  const digits = whatsapp.replace(/\D/g, "");
  const idioma = b.idioma === "en" ? "en" : "es";
  const errors = [];
  if (nombre.length < 2) errors.push("nombre");
  if (digits.length < 10 || digits.length > 15) errors.push("whatsapp");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.push("email");
  if (b.consent !== true) errors.push("consent");
  const c = catalog(), d = c.depas.find(x => x.id === b.depa);
  if (!d) errors.push("depa");
  if (errors.length) return json(400, { error: "invalid", fields: errors });

  const p = c.proyectos[d.proyecto], broker = c.brokers[d.broker] || { nombre: d.broker };
  const site = (env("SITE_URL") || `https://${req.headers["x-forwarded-host"] || req.headers.host}`).replace(/\/$/, "");
  const lead = {
    nombre, whatsapp, email, idioma,
    depa_id: d.id, depa_nombre: d.nombre, proyecto: p.nombre, broker: d.broker,
    origen_broker: clip(b.ref_broker, 60) || null, origen_ref: clip(b.ref, 60) || null,
    landing: clip(b.landing, 300) || null, pagina: clip(b.page, 300) || null,
    presupuesto: clip(b.presupuesto, 60) || null,
    user_agent: clip(req.headers["user-agent"], 300),
    consentimiento: true, consentimiento_at: new Date().toISOString(), estado: "nuevo"
  };

  /* ---- 1. Guardar en Supabase ---- */
  const SB = env("SUPABASE_URL").replace(/\/$/, ""), KEY = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!SB || !KEY) { console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); return json(503, { error: "storage_not_configured" }); }
  let saved;
  try {
    const r = await fetch(`${SB}/rest/v1/leads`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(lead), signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
    saved = (await r.json())[0];
  } catch (e) {
    console.error("No se guardó el lead", e.message);
    return json(502, { error: "storage_failed" });
  }
  const folio = saved.folio;

  /* ---- 2. Avisos (no bloquean el folio si fallan) ---- */
  const depaUrl = `${site}/depa?id=${encodeURIComponent(d.id)}`;
  const when = new Date(saved.created_at || Date.now()).toLocaleString("es-MX", { timeZone: "America/Cancun", dateStyle: "medium", timeStyle: "short" });
  const owner = env("OWNER_EMAIL").split(",").map(s => s.trim()).filter(Boolean);
  const bEmail = brokerEmail(d.broker);
  const team = [...new Set([bEmail, ...owner].filter(Boolean))];
  const from = env("RESEND_FROM") || "Homi <onboarding@resend.dev>";
  const wa = env("OPERATOR_WHATSAPP").replace(/\D/g, "");
  const origin = [lead.origen_broker && `broker: ${lead.origen_broker}`, lead.origen_ref && `ref: ${lead.origen_ref}`].filter(Boolean).join(" · ") || "directo";

  const tasks = [];
  if (team.length) tasks.push(sendEmail({
    from, to: team, reply_to: email,
    subject: `Nuevo lead ${folio} · ${d.nombre} (referido de Homi)`,
    html: shell(`<p style="font-size:20px;margin:0 0 6px">Nuevo cliente referido de Homi</p>
      <p style="color:#B3C1C3;margin:0 0 18px;font-size:14px">Este cliente llegó a través de Homi y queda registrado con el folio <b style="color:#D0FF78">${esc(folio)}</b>. Por favor menciona el folio en todo el seguimiento.</p>
      <table style="border-collapse:collapse">${row("Folio", `<b>${esc(folio)}</b>`)}${row("Fecha", esc(when) + " (Cancún)")}${row("Nombre", esc(nombre))}
      ${row("WhatsApp", `<a style="color:#D0FF78" href="https://wa.me/${digits}">${esc(whatsapp)}</a>`)}${row("Email", `<a style="color:#D0FF78" href="mailto:${esc(email)}">${esc(email)}</a>`)}
      ${row("Depa", `<a style="color:#D0FF78" href="${esc(depaUrl)}">${esc(d.nombre)}</a> · ${esc(money(d.precio, d.moneda))}`)}${row("Proyecto", esc(p.nombre))}
      ${row("Broker asignado", esc(broker.nombre))}${row("Idioma", idioma === "en" ? "Inglés" : "Español")}${row("Presupuesto", esc(lead.presupuesto))}${row("Origen", esc(origin))}</table>
      <p style="color:#8A9A9E;font-size:12px;margin:18px 0 0">El cliente aceptó el aviso de privacidad el ${esc(when)}.</p>`),
    text: `Nuevo cliente referido de Homi\nFolio: ${folio}\nFecha: ${when} (Cancún)\nNombre: ${nombre}\nWhatsApp: ${whatsapp}\nEmail: ${email}\nDepa: ${d.nombre} (${depaUrl})\nBroker: ${broker.nombre}\nIdioma: ${idioma}\nPresupuesto: ${lead.presupuesto || "-"}\nOrigen: ${origin}`
  }).then(() => "team"));

  const en = idioma === "en";
  const waMsg = en ? `Hi, I'm ${nombre}. My Homi reference is ${folio}. I'm interested in "${d.nombre}": ${depaUrl}`
                   : `Hola, soy ${nombre}. Mi folio de Homi es ${folio}. Me interesa "${d.nombre}": ${depaUrl}`;
  tasks.push(sendEmail({
    from, to: [email], reply_to: owner[0] || undefined,
    subject: en ? `We received your request · ${folio}` : `Recibimos tu solicitud · ${folio}`,
    html: shell(`<p style="font-size:20px;margin:0 0 10px">${en ? `Thanks, ${esc(nombre)}` : `Gracias, ${esc(nombre)}`}</p>
      <p style="color:#B3C1C3;font-size:15px;line-height:1.6">${en ? `We received your request about <b>${esc(d.nombre)}</b>. An advisor will contact you soon.` : `Recibimos tu solicitud sobre <b>${esc(d.nombre)}</b>. Un asesor te contactará pronto.`}</p>
      <p style="background:#121A1E;border-radius:14px;padding:14px 18px;font-size:14px;color:#B3C1C3">${en ? "Your reference" : "Tu folio"}<br><b style="font-size:22px;color:#D0FF78;font-family:monospace">${esc(folio)}</b></p>
      <p><a href="${esc(depaUrl)}${en ? "&lang=en" : ""}" style="color:#D0FF78">${en ? "View the apartment" : "Ver el departamento"}</a>${wa ? ` &nbsp;·&nbsp; <a href="https://wa.me/${wa}?text=${encodeURIComponent(waMsg)}" style="color:#D0FF78">WhatsApp</a>` : ""}</p>
      <p style="color:#8A9A9E;font-size:12px;margin-top:22px">${en ? "You received this email because you requested information on Homi." : "Recibiste este correo porque pediste información en Homi."} <a href="${esc(site)}/aviso-privacidad${en ? "?lang=en" : ""}" style="color:#8A9A9E">${en ? "Privacy notice" : "Aviso de privacidad"}</a></p>`),
    text: en ? `We received your request about ${d.nombre}. Your reference: ${folio}. ${depaUrl}` : `Recibimos tu solicitud sobre ${d.nombre}. Tu folio: ${folio}. ${depaUrl}`
  }).then(() => "client"));

  const hook = env("LEAD_WEBHOOK_URL");
  if (hook) tasks.push(fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ folio, created_at: saved.created_at, depa_url: depaUrl, broker_nombre: broker.nombre }, lead)), signal: AbortSignal.timeout(6000) })
    .then(r => { if (!r.ok) throw new Error("webhook " + r.status); return "webhook"; }));

  const out = await Promise.allSettled(tasks);
  out.filter(o => o.status === "rejected").forEach(o => console.error("Aviso falló:", o.reason && o.reason.message));
  if (!team.length) console.error("Sin destinatarios para el aviso interno: configura OWNER_EMAIL y BROKER_EMAILS");

  return json(200, { folio, notified: out.filter(o => o.status === "fulfilled").map(o => o.value) });
};
