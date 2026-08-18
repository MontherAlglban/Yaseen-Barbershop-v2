# YASEEN BARBERSHOP

نسخة جاهزة لـ Vercel + Supabase.

## 1) Supabase
نفّذ الملف `supabase/schema.sql` داخل Supabase SQL Editor.

## 2) Vercel Environment Variables
أضف:
- `SUPABASE_URL` = رابط مشروع Supabase الكامل مثل `https://xxxxx.supabase.co`
- `SUPABASE_SECRET_KEY` = مفتاح server-side السري
- `ADMIN_PASSWORD` = كلمة مرور لوحة الإدارة
- `ADMIN_SESSION_SECRET` = قيمة عشوائية طويلة وسرية
- `NODE_ENV` = `production`

لا ترفع `.env` أو أي مفتاح سري إلى GitHub.

## 3) التشغيل المحلي
```bash
npm install
npm run check
npm start
```

افتح `/` للموقع و`/admin` للوحة الإدارة.

## ملاحظة
تم إصلاح منطق المواعيد لمنع تداخل الحجوزات، بما في ذلك خدمات 60 و90 دقيقة، وإضافة إعداد Vercel واضح لتشغيل Express.
