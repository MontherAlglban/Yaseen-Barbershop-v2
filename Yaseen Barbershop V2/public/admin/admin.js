const $ = id => document.getElementById(id);
const api = '/api';
let data = { services: [], days: [], settings: {} };
let allBookingsCache = []; // كاش للحجوزات لتفعيل البحث المباشر
const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// طلبات الـ API المركزية
async function request(path, opts = {}) {
  const r = await fetch(api + path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) {
    logout(false);
    throw new Error('401');
  }
  if (!r.ok) throw new Error(d.message || 'حدث خطأ في العملية');
  return d;
}

function showApp(v) {
  $('login').classList.toggle('hidden', v);
  $('app').classList.toggle('hidden', !v);
}

function toast(t) {
  const el = $('toast');
  if (!el) return;
  el.textContent = t;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

// تسجيل الدخول والخروج
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await request('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: $('password').value })
    });
    $('password').value = '';
    $('loginMsg').textContent = '';
    showApp(true);
    loadAll();
  } catch (err) {
    $('loginMsg').textContent = err.message === '401' ? 'كلمة المرور غير صحيحة' : err.message;
  }
});

async function logout(remote = true) {
  if (remote) try { await request('/admin/logout', { method: 'POST' }); } catch {}
  showApp(false);
}
$('logout').addEventListener('click', () => logout());
$('refresh').addEventListener('click', loadAll);

// التنقل بين التبويبات (Tabs)
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  document.querySelectorAll('[data-panel]').forEach(p => p.classList.add('hidden'));
  document.querySelector(`[data-panel="${t.dataset.tab}"]`).classList.remove('hidden');
}));

// تحميل كافة البيانات من السيرفر
async function loadAll() {
  try {
    const [s, d, set, b] = await Promise.all([
      request('/admin/services'),
      request('/admin/working-days'),
      request('/admin/settings'),
      request('/admin/bookings')
    ]);

    data = {
      services: s.services || [],
      days: d.days || [],
      settings: Object.fromEntries((set.settings || []).map(x => [x.key, x.value]))
    };

    allBookingsCache = b.bookings || [];

    renderDashboard(allBookingsCache);
    renderBookings(allBookingsCache);
    renderServices();
    renderDays();
    renderSettings();
  } catch (err) {
    if (err.message !== '401') toast(err.message);
  }
}

// لوحة الإحصائيات (Dashboard)
function renderDashboard(bookings) {
  const td = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const confirmed = bookings.filter(b => b.status === 'confirmed').length;
  const cancelled = bookings.filter(b => b.status === 'cancelled').length;
  const today = bookings.filter(b => b.booking_date === td && b.status === 'confirmed');

  $('sConfirmed').textContent = confirmed;
  $('sCancelled').textContent = cancelled;
  $('sToday').textContent = today.length;
  $('sServices').textContent = data.services.length;

  $('todayList').innerHTML = today.length ? today.map(b => `
    <div class="list-item">
      <span><b>${esc(b.start_time.slice(0, 5))}</b> — ${esc(b.customer_name)} (${esc(b.customer_phone)})</span>
      <span>${esc(b.service?.name_ar || '')}</span>
    </div>
  `).join('') : '<div class="list-item">لا توجد حجوزات مؤكدة اليوم.</div>';
}

// عرض الحجوزات وإدارتها
function renderBookings(bookings) {
  $('bookingsBody').innerHTML = bookings.map(b => `
    <tr>
      <td>${esc(b.booking_date)}</td>
      <td><b>${esc(b.start_time.slice(0, 5))}</b></td>
      <td>${esc(b.customer_name)}</td>
      <td><a href="tel:${esc(b.customer_phone)}">${esc(b.customer_phone)}</a></td>
      <td>${esc(b.service?.name_ar || b.service_id)}</td>
      <td><span class="badge ${b.status}">${statusText(b.status)}</span></td>
      <td>
        ${b.status === 'confirmed' ? `
          <button class="btn secondary" onclick="setStatus('${b.id}','completed')">مكتمل</button>
          <button class="btn danger" onclick="setStatus('${b.id}','cancelled')">إلغاء</button>
        ` : b.status === 'cancelled' ? `
          <span>—</span>
        ` : `
          <button class="btn secondary" onclick="setStatus('${b.id}','confirmed')">إرجاع</button>
        `}
      </td>
    </tr>
  `).join('');
}

function statusText(s) {
  return s === 'confirmed' ? 'مؤكد' : s === 'completed' ? 'مكتمل' : 'ملغى';
}

window.setStatus = async (id, status) => {
  try {
    await request(`/admin/bookings/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    toast('تم تحديث حالة الموعد');
    loadAll();
  } catch (e) {
    toast(e.message);
  }
};

// إدارة الخدمات
function renderServices() {
  $('servicesAdmin').innerHTML = data.services.map(s => `
    <div class="service-row">
      <div>
        <h3>${esc(s.name_ar)} / ${esc(s.name_he)}</h3>
        <div class="service-meta">${esc(s.description_ar || '')} · ${s.price} ₪ · ${s.duration_minutes} دقيقة · ${s.active ? 'مفعلة' : 'موقوفة'}</div>
      </div>
      <div class="service-actions">
        <button class="btn secondary" onclick="editService('${s.id}')">تعديل</button>
        <button class="btn ${s.active ? 'danger' : 'secondary'}" onclick="toggleService('${s.id}',${!s.active})">${s.active ? 'تعطيل' : 'تفعيل'}</button>
      </div>
    </div>
  `).join('');
}

window.toggleService = async (id, active) => {
  try {
    await request(`/admin/services/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) });
    loadAll();
  } catch (e) {
    toast(e.message);
  }
};

window.editService = id => {
  const s = data.services.find(x => x.id === id);
  openModal('تعديل الخدمة', `
    <label>اسم الخدمة (عربي)<input id="m_ar" value="${esc(s.name_ar)}"></label>
    <label>اسم الخدمة (عبري)<input id="m_he" value="${esc(s.name_he)}"></label>
    <label>الوصف<input id="m_desc" value="${esc(s.description_ar || '')}"></label>
    <label>السعر (₪)<input id="m_price" type="number" step="0.5" value="${s.price}"></label>
    <label>المدة (بالدقائق)<select id="m_d">
      <option ${s.duration_minutes === 30 ? 'selected' : ''}>30</option>
      <option ${s.duration_minutes === 60 ? 'selected' : ''}>60</option>
      <option ${s.duration_minutes === 90 ? 'selected' : ''}>90</option>
    </select></label>
    <div class="modal-actions"><button class="btn" onclick="saveService('${id}')">حفظ والتحديث</button></div>
  `);
};

$('addService').addEventListener('click', () => openModal('إضافة خدمة جديدة', `
  <label>اسم الخدمة (عربي)<input id="m_ar"></label>
  <label>اسم الخدمة (عبري)<input id="m_he"></label>
  <label>الوصف<input id="m_desc"></label>
  <label>السعر (₪)<input id="m_price" type="number" step="0.5"></label>
  <label>المدة (بالدقائق)<select id="m_d"><option>30</option><option>60</option><option>90</option></select></label>
  <div class="modal-actions"><button class="btn" onclick="createService()">إضافة الخدمة</button></div>
`));

window.saveService = async id => {
  try {
    await request(`/admin/services/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name_ar: $('m_ar').value,
        name_he: $('m_he').value,
        description_ar: $('m_desc').value,
        description_he: $('m_desc').value,
        price: $('m_price').value,
        duration_minutes: Number($('m_d').value)
      })
    });
    closeModal();
    loadAll();
  } catch (e) {
    toast(e.message);
  }
};

window.createService = async () => {
  try {
    await request('/admin/services', {
      method: 'POST',
      body: JSON.stringify({
        name_ar: $('m_ar').value,
        name_he: $('m_he').value,
        description_ar: $('m_desc').value,
        description_he: $('m_desc').value,
        price: $('m_price').value,
        duration_minutes: Number($('m_d').value)
      })
    });
    closeModal();
    loadAll();
  } catch (e) {
    toast(e.message);
  }
};

// أوقات العمل والأيام
function renderDays() {
  $('daysAdmin').innerHTML = data.days.map(d => `
    <div class="day-row">
      <div>
        <h3>${dayNames[d.day_of_week]}</h3>
        <label><input type="checkbox" id="open_${d.day_of_week}" ${d.is_open ? 'checked' : ''}> اليوم مفتوح للعمل</label>
      </div>
      <div class="day-controls">
        <input id="start_${d.day_of_week}" type="time" value="${d.open_time.slice(0, 5)}">
        <input id="end_${d.day_of_week}" type="time" value="${d.close_time.slice(0, 5)}">
        <button class="btn secondary" onclick="saveDay(${d.day_of_week})">حفظ اليوم</button>
      </div>
    </div>
  `).join('');
}

window.saveDay = async d => {
  try {
    await request(`/admin/working-days/${d}`, {
      method: 'PATCH',
      body: JSON.stringify({
        is_open: $(`open_${d}`).checked,
        open_time: $(`start_${d}`).value,
        close_time: $(`end_${d}`).value
      })
    });
    toast('تم حفظ إعدادات اليوم بنجاح');
    loadAll();
  } catch (e) {
    toast(e.message);
  }
};

// إعدادات الموقع العامة
function renderSettings() {
  const labels = {
    whatsapp: 'رقم الواتساب الرئيسي',
    location_ar: 'عنوان الصالون (عربي)',
    location_he: 'عنوان الصالون (عبري)',
    hours_note_ar: 'ملاحظة أوقات العمل (عربي)',
    hours_note_he: 'ملاحظة أوقات العمل (عبري)'
  };
  $('settingsForm').innerHTML = Object.entries(labels).map(([k, l]) => `
    <div class="setting-row">
      <strong>${l}</strong>
      <input id="set_${k}" value="${esc(data.settings[k] || (k === 'whatsapp' ? '972535245543' : ''))}">
      <button class="btn secondary" onclick="saveSetting('${k}')">حفظ</button>
    </div>
  `).join('');
}

window.saveSetting = async key => {
  try {
    await request(`/admin/settings/${key}`, {
      method: 'PATCH',
      body: JSON.stringify({ value: $(`set_${key}`).value })
    });
    toast('تم تحديث الإعداد');
    loadAll();
  } catch (e) {
    toast(e.message);
  }
};

// إضافة موعد يدوي بواسطة الأدمن
$('addBooking').addEventListener('click', async () => {
  const services = data.services.filter(s => s.active);
  openModal('إضافة موعد جديد يدويًا', `
    <label>اسم الزبون<input id="m_name"></label>
    <label>رقم الهاتف<input id="m_phone"></label>
    <label>الخدمة<select id="m_service">${services.map(s => `<option value="${s.id}">${esc(s.name_ar)} — ${s.price} ₪</option>`).join('')}</select></label>
    <label>التاريخ<input id="m_date" type="date" value="${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())}"></label>
    <label>الوقت<input id="m_time" type="time" step="1800" value="10:00"></label>
    <div class="modal-actions"><button class="btn" onclick="createBooking()">تأكيد وإضافة الموعد</button></div>
  `);
});

window.createBooking = async () => {
  try {
    await request('/admin/bookings', {
      method: 'POST',
      body: JSON.stringify({
        name: $('m_name').value,
        phone: $('m_phone').value,
        service: $('m_service').value,
        date: $('m_date').value,
        time: $('m_time').value
      })
    });
    closeModal();
    toast('تمت إضافة الموعد بنجاح');
    loadAll();
  } catch (e) {
    toast(e.message);
  }
};

// الفلترة والبحث في الحجوزات
$('filterBookings').addEventListener('click', async () => {
  try {
    const q = new URLSearchParams();
    if ($('bDate').value) q.set('date', $('bDate').value);
    if ($('bStatus').value) q.set('status', $('bStatus').value);
    const d = await request(`/admin/bookings?${q}`);
    renderBookings(d.bookings || []);
  } catch (e) {
    toast(e.message);
  }
});

// Modal Helpers
function openModal(title, body) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = body;
  $('modal').classList.remove('hidden');
}
function closeModal() {
  $('modal').classList.add('hidden');
}
window.closeModal = closeModal;
$('closeModal').addEventListener('click', closeModal);
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}

// التحقق المباشر عند فتح اللوحة لأول مرة
fetch('/api/admin/me').then(r => {
  if (r.ok) {
    showApp(true);
    loadAll();
  }
}).catch(() => {});