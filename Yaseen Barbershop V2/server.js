const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SITE = {
  whatsapp: '972535245543',
  timezone: 'Asia/Jerusalem',
};

app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
// Serve the admin entry before the static middleware so /admin does not get redirected.
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function cfg() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !/^https:\/\/[^\s/]+(?:\.[^\s/]+)+(?:\/.*)?$/.test(url)) throw new Error('Invalid or missing SUPABASE_URL');
  if (!key) throw new Error('Missing SUPABASE_SECRET_KEY');
  return { url: url.replace(/\/$/, ''), key };
}

async function supabase(pathname, options = {}) {
  const { url, key } = cfg();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...(options.headers || {}),
  };
  const response = await fetch(`${url}/rest/v1/${pathname}`, { ...options, headers });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const err = new Error(data?.message || data?.hint || `Supabase error ${response.status}`);
    err.status = response.status;
    err.details = data;
    throw err;
  }
  return data;
}

function jsonError(res, err, fallback = 'حدث خطأ في الخادم.') {
  console.error(err);
  res.status(err.status && Number.isInteger(err.status) ? err.status : 500).json({ message: fallback });
}

function parseCookie(header = '') {
  return Object.fromEntries(header.split(';').map(v => v.trim()).filter(Boolean).map(pair => {
    const i = pair.indexOf('=');
    return [i >= 0 ? pair.slice(0, i) : pair, i >= 0 ? decodeURIComponent(pair.slice(i + 1)) : ''];
  }));
}

function hmac(input) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('Missing ADMIN_SESSION_SECRET');
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

function createSession() {
  const payload = Buffer.from(JSON.stringify({
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
    nonce: crypto.randomBytes(16).toString('hex')
  })).toString('base64url');
  return `${payload}.${hmac(payload)}`;
}

function validSession(token) {
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const a=Buffer.from(sig); const b=Buffer.from(hmac(payload)); if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return false;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return obj.exp > Date.now();
  } catch { return false; }
}

function requireAdmin(req, res, next) {
  const cookies = parseCookie(req.headers.cookie || '');
  if (!validSession(cookies.yaseen_admin)) return res.status(401).json({ message: 'غير مصرح.' });
  next();
}

function isDateString(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
function isTimeString(v) { return /^(?:10|11|12|13|14|15|16):(00|30)$/.test(String(v || '')); }
function normalizeName(v) { return String(v || '').trim().slice(0, 80); }
function normalizePhone(v) { return String(v || '').trim().slice(0, 30); }
function serviceId(v) { return String(v || '').trim(); }
function localTodayIsrael() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SITE.timezone }).format(new Date());
}
function timeToMinutes(t) { const [h,m]=t.split(':').map(Number); return h*60+m; }
function priceNumber(v) { const n=Number(v); return Number.isFinite(n) && n >= 0 && n <= 10000 ? Math.round(n * 100) / 100 : null; }

app.get('/api/health', async (_req, res) => {
  try {
    await supabase('services?select=id&limit=1', { method: 'GET' });
    res.json({ ok: true, service: 'yaseen-barbershop', database: 'connected' });
  } catch (err) {
    res.status(503).json({ ok: false, service: 'yaseen-barbershop', database: 'unavailable' });
  }
});

app.get('/api/public/settings', async (_req, res) => {
  try {
    const [services, days, settings] = await Promise.all([
      supabase('services?select=id,name_ar,name_he,description_ar,description_he,price,duration_minutes,sort_order,active&active=eq.true&order=sort_order.asc'),
      supabase('working_days?select=day_of_week,is_open,open_time,close_time&order=day_of_week.asc'),
      supabase('site_settings?select=key,value')
    ]);
    const settingsObj = Object.fromEntries((settings || []).map(s => [s.key, s.value]));
    res.json({ services, days, settings: { ...settingsObj, whatsapp: SITE.whatsapp } });
  } catch (err) { jsonError(res, err); }
});

app.get('/api/slots', async (req, res) => {
  const date = String(req.query.date || '');
  const selectedService = String(req.query.service || '');
  if (!isDateString(date)) return res.status(400).json({ message: 'تاريخ غير صحيح.' });
  if (date < localTodayIsrael()) return res.json({ date, slots: [] });
  try {
    const dayRows = await supabase(`working_days?day_of_week=eq.${new Date(`${date}T12:00:00Z`).getUTCDay()}&select=is_open,open_time,close_time&limit=1`);
    const day = dayRows?.[0];
    if (!day || !day.is_open) return res.json({ date, slots: [] });
    const serviceRows = selectedService ? await supabase(`services?id=eq.${encodeURIComponent(selectedService)}&active=eq.true&select=duration_minutes&limit=1`) : [];
    const duration = Math.max(30, Number(serviceRows?.[0]?.duration_minutes || 30));
    const open = timeToMinutes(day.open_time.slice(0,5));
    const close = timeToMinutes(day.close_time.slice(0,5));
    const candidates = [];
    for (let m = open; m + duration <= close; m += 30) candidates.push(`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`);
    const booked = await supabase(`bookings?booking_date=eq.${date}&status=eq.confirmed&select=start_time,end_time`);
    const slots = candidates.filter(t => {
      const start = timeToMinutes(t);
      const end = start + duration;
      return !booked.some(b => {
        const bStart = timeToMinutes(String(b.start_time).slice(0, 5));
        const bEnd = timeToMinutes(String(b.end_time).slice(0, 5));
        return start < bEnd && end > bStart;
      });
    });
    const nowParts = new Intl.DateTimeFormat('en-GB', { timeZone:SITE.timezone, hour:'2-digit', minute:'2-digit', hour12:false }).formatToParts(new Date());
    const nowDate = localTodayIsrael();
    const nowTime = `${nowParts.find(x=>x.type==='hour').value}:${nowParts.find(x=>x.type==='minute').value}`;
    const filtered = date === nowDate ? slots.filter(t => timeToMinutes(t) > timeToMinutes(nowTime)) : slots;
    res.json({ date, slots: filtered.map(time => ({ time })) });
  } catch (err) { jsonError(res, err, 'تعذر تحميل المواعيد.'); }
});

app.post('/api/book', async (req, res) => {
  const name = normalizeName(req.body?.name);
  const phone = normalizePhone(req.body?.phone);
  const service = serviceId(req.body?.service);
  const date = String(req.body?.date || '');
  const time = String(req.body?.time || '');
  if (!name || name.length < 2 || !phone || phone.length < 6 || !isDateString(date) || !isTimeString(time) || !service) {
    return res.status(400).json({ message: 'بيانات الحجز غير مكتملة أو غير صحيحة.' });
  }
  if (date < localTodayIsrael()) return res.status(400).json({ message: 'لا يمكن الحجز في تاريخ مضى.' });
  try {
    const rows = await supabase('rpc/book_appointment', {
      method: 'POST', body: JSON.stringify({ p_name:name, p_phone:phone, p_service_id:service, p_date:date, p_start_time:`${time}:00` })
    });
    const booking = Array.isArray(rows) ? rows[0] : rows;
    res.status(201).json({ ok:true, booking });
  } catch (err) {
    if (String(err.details?.message || err.message || '').toLowerCase().includes('slot')) return res.status(409).json({ message:'هذا الموعد لم يعد متاحًا. اختر وقتًا آخر.' });
    jsonError(res, err, 'تعذر حجز الموعد.');
  }
});

app.post('/api/admin/login', async (req,res) => {
  const password = String(req.body?.password || '');
  const expected = String(process.env.ADMIN_PASSWORD || '');
  if (!expected || password.length < 1 || !crypto.timingSafeEqual(crypto.createHash('sha256').update(password).digest(), crypto.createHash('sha256').update(expected).digest())) {
    return res.status(401).json({ message:'كلمة المرور غير صحيحة.' });
  }
  const token = createSession();
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  res.setHeader('Set-Cookie', `yaseen_admin=${encodeURIComponent(token)}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=604800`);
  res.json({ ok:true });
});

app.post('/api/admin/logout', requireAdmin, (_req,res) => {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  res.setHeader('Set-Cookie',`yaseen_admin=; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=0`);
  res.json({ ok:true });
});

app.get('/api/admin/me', requireAdmin, (_req,res)=>res.json({ok:true}));

app.get('/api/admin/bookings', requireAdmin, async (req,res)=>{
  try {
    const params = new URLSearchParams();
    params.set('select','id,customer_name,customer_phone,service_id,booking_date,start_time,end_time,status,notes,created_at');
    params.set('order','booking_date.asc,start_time.asc');
    if (isDateString(req.query.date)) params.set('booking_date',`eq.${req.query.date}`);
    if (req.query.status && ['confirmed','cancelled','completed'].includes(req.query.status)) params.set('status',`eq.${req.query.status}`);
    const [bookings, services] = await Promise.all([
      supabase(`bookings?${params.toString()}`),
      supabase('services?select=id,name_ar,name_he,price')
    ]);
    const map = Object.fromEntries(services.map(s=>[s.id,s]));
    res.json({ bookings: bookings.map(b=>({ ...b, service:map[b.service_id] || null })) });
  } catch(err){ jsonError(res,err,'تعذر تحميل الحجوزات.'); }
});

app.post('/api/admin/bookings', requireAdmin, async (req,res)=>{
  const name=normalizeName(req.body?.name), phone=normalizePhone(req.body?.phone), service=serviceId(req.body?.service), date=String(req.body?.date||''), time=String(req.body?.time||'');
  if(!name||!phone||!service||!isDateString(date)||!isTimeString(time)) return res.status(400).json({message:'بيانات الموعد غير صحيحة.'});
  try{
    const rows=await supabase('rpc/book_appointment',{method:'POST',body:JSON.stringify({p_name:name,p_phone:phone,p_service_id:service,p_date:date,p_start_time:`${time}:00`})});
    res.status(201).json({ok:true,booking:Array.isArray(rows)?rows[0]:rows});
  }catch(err){
    const msg=String(err.details?.message||err.message);
    if(msg.toLowerCase().includes('slot')) return res.status(409).json({message:'هذا الوقت غير متاح.'});
    jsonError(res,err,'تعذر إضافة الموعد.');
  }
});

app.patch('/api/admin/bookings/:id/status', requireAdmin, async (req,res)=>{
  const status=String(req.body?.status||'');
  if(!['confirmed','cancelled','completed'].includes(status)) return res.status(400).json({message:'حالة غير صحيحة.'});
  try{
    const data=await supabase(`bookings?id=eq.${encodeURIComponent(req.params.id)}`,{method:'PATCH',body:JSON.stringify({status})});
    res.json({ok:true,booking:data?.[0]||null});
  }catch(err){jsonError(res,err,'تعذر تحديث الحجز.');}
});

app.get('/api/admin/services', requireAdmin, async (_req,res)=>{
  try{ res.json({services:await supabase('services?select=*&order=sort_order.asc')}); }
  catch(err){jsonError(res,err,'تعذر تحميل الخدمات.');}
});

app.post('/api/admin/services', requireAdmin, async (req,res)=>{
  const body=req.body||{};
  const price=priceNumber(body.price); const duration=Number(body.duration_minutes||30);
  if(!body.name_ar||!body.name_he||price===null||![30,60,90].includes(duration)) return res.status(400).json({message:'بيانات الخدمة غير صحيحة.'});
  try{
    const data=await supabase('services',{method:'POST',body:JSON.stringify({id:crypto.randomUUID(),name_ar:String(body.name_ar).slice(0,80),name_he:String(body.name_he).slice(0,80),description_ar:String(body.description_ar||'').slice(0,180),description_he:String(body.description_he||'').slice(0,180),price,duration_minutes:duration,sort_order:Number(body.sort_order||100),active:body.active!==false})});
    res.status(201).json({service:data?.[0]});
  }catch(err){jsonError(res,err,'تعذر إنشاء الخدمة.');}
});

app.patch('/api/admin/services/:id', requireAdmin, async (req,res)=>{
  const body=req.body||{}; const patch={};
  if(body.name_ar!==undefined) patch.name_ar=String(body.name_ar).slice(0,80);
  if(body.name_he!==undefined) patch.name_he=String(body.name_he).slice(0,80);
  if(body.description_ar!==undefined) patch.description_ar=String(body.description_ar).slice(0,180);
  if(body.description_he!==undefined) patch.description_he=String(body.description_he).slice(0,180);
  if(body.price!==undefined){const p=priceNumber(body.price);if(p===null)return res.status(400).json({message:'السعر غير صحيح.'});patch.price=p;}
  if(body.duration_minutes!==undefined){const d=Number(body.duration_minutes);if(![30,60,90].includes(d))return res.status(400).json({message:'المدة غير صحيحة.'});patch.duration_minutes=d;}
  if(body.sort_order!==undefined) patch.sort_order=Number(body.sort_order)||0;
  if(body.active!==undefined) patch.active=Boolean(body.active);
  try{const data=await supabase(`services?id=eq.${encodeURIComponent(req.params.id)}`,{method:'PATCH',body:JSON.stringify(patch)});res.json({service:data?.[0]||null});}
  catch(err){jsonError(res,err,'تعذر تعديل الخدمة.');}
});

app.delete('/api/admin/services/:id', requireAdmin, async (req,res)=>{
  try{ await supabase(`services?id=eq.${encodeURIComponent(req.params.id)}`,{method:'PATCH',body:JSON.stringify({active:false})}); res.json({ok:true}); }
  catch(err){jsonError(res,err,'تعذر تعطيل الخدمة.');}
});

app.get('/api/admin/working-days', requireAdmin, async (_req,res)=>{
  try{res.json({days:await supabase('working_days?select=*&order=day_of_week.asc')});}catch(err){jsonError(res,err,'تعذر تحميل أيام العمل.');}
});

app.patch('/api/admin/working-days/:day', requireAdmin, async (req,res)=>{
  const day=Number(req.params.day); if(!Number.isInteger(day)||day<0||day>6)return res.status(400).json({message:'اليوم غير صحيح.'});
  const patch={is_open:Boolean(req.body?.is_open)};
  if(req.body?.open_time)patch.open_time=String(req.body.open_time).slice(0,5)+':00';
  if(req.body?.close_time)patch.close_time=String(req.body.close_time).slice(0,5)+':00';
  try{const data=await supabase(`working_days?day_of_week=eq.${day}`,{method:'PATCH',body:JSON.stringify(patch)});res.json({day:data?.[0]||null});}
  catch(err){jsonError(res,err,'تعذر تحديث يوم العمل.');}
});

app.get('/api/admin/settings', requireAdmin, async (_req,res)=>{
  try{res.json({settings:await supabase('site_settings?select=key,value')});}catch(err){jsonError(res,err,'تعذر تحميل الإعدادات.');}
});

app.patch('/api/admin/settings/:key', requireAdmin, async (req,res)=>{
  const key=String(req.params.key); const allowed=['whatsapp','location_ar','location_he','hours_note_ar','hours_note_he'];
  if(!allowed.includes(key)) return res.status(400).json({message:'إعداد غير مسموح.'});
  try{const data=await supabase(`site_settings?key=eq.${encodeURIComponent(key)}`,{method:'PATCH',body:JSON.stringify({value:String(req.body?.value||'').slice(0,300)})});res.json({setting:data?.[0]||null});}
  catch(err){jsonError(res,err,'تعذر تحديث الإعداد.');}
});

app.get('/admin', (_req,res)=>res.sendFile(path.join(__dirname,'public','admin','index.html')));
app.use((req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

if (require.main === module) {
  app.listen(PORT,()=>console.log(`Yaseen Barbershop running on http://localhost:${PORT}`));
}

module.exports = app;
