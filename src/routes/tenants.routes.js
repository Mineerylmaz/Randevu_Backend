// src/routes/tenants.routes.js
const express = require("express");
const { requireAuth } = require("../middleware/auth");
const bcrypt = require('bcryptjs');
module.exports = function tenantsRoutes(pool) {
    const router = express.Router();

    // slug -> tenant (isletme) bilgisi
    async function getTenantBySlug(slug) {
        const [rows] = await pool.query(
            "SELECT id, ad, slug, aktif FROM isletmeler WHERE slug=? LIMIT 1",
            [slug]
        );
        return rows[0] || null; // {id, ad, slug, aktif}
    }

    // isletme_id -> ayarlar
    async function getSettingsByIsletmeId(isletmeId) {
        const [rows] = await pool.query(
            "SELECT logo_url, ana_renk, ikincil_renk, yazi_renk, yazi_tipi FROM isletme_ayarlari WHERE isletme_id=? LIMIT 1",
            [isletmeId]
        );
        return rows[0] || null;
    }

    // . GET /tenants/:slug/theme
    router.get("/:slug/theme", async (req, res) => {
        try {
            const { slug } = req.params;

            const tenant = await getTenantBySlug(slug);
            if (!tenant || tenant.aktif !== 1) {
                return res
                    .status(404)
                    .json({ status: "fail", message: "Tenant not found/passive" });
            }

            const ayar = await getSettingsByIsletmeId(tenant.id);

            return res.json({
                status: "ok",
                data: {
                    brand_name: tenant.ad || "",
                    logo_url: ayar?.logo_url || "",
                    primary: ayar?.ana_renk || "#3B82F6",
                    secondary: ayar?.ikincil_renk || "#10B981",
                    background: "#F6F7FB",
                    surface: "#FFFFFF",
                    text: ayar?.yazi_renk || "#111827",
                    font_family: ayar?.yazi_tipi || "",
                    radius: 16,
                },
            });
        } catch (e) {
            console.error("GET theme error:", e);
            return res
                .status(500)
                .json({ status: "fail", message: "Server error" });
        }
    });
    const resetCodes = new Map();

    router.post("/:slug/auth/forgot-password", async (req, res) => {
        try {
            const { email } = req.body;
            const slug = req.params.slug;

            if (!email) {
                return res.status(400).json({ message: "Email zorunludur." });
            }

            const [tenants] = await pool.query(
                "SELECT id, ad FROM isletmeler WHERE slug = ? AND aktif = 1 LIMIT 1",
                [slug]
            );

            if (tenants.length === 0) {
                return res.status(404).json({ message: "İşletme bulunamadı." });
            }

            const tenant = tenants[0];

            const [users] = await pool.query(
                `SELECT id, email, ad_soyad 
       FROM kullanicilar 
       WHERE email = ? AND isletme_id = ? AND aktif = 1 
       LIMIT 1`,
                [email, tenant.id]
            );

            // Güvenlik için kullanıcı yoksa bile başarılı gibi dönüyoruz.
            if (users.length === 0) {
                return res.json({
                    ok: true,
                    message: "Şifre sıfırlama kodu gönderildi.",
                });
            }

            const code = Math.floor(100000 + Math.random() * 900000).toString();

            resetCodes.set(`${tenant.id}:${email}`, {
                code,
                userId: users[0].id,
                expiresAt: Date.now() + 10 * 60 * 1000,
            });

            console.log("🔐 DEMO ŞİFRE SIFIRLAMA KODU:", {
                isletme: tenant.ad,
                email,
                code,
            });

            return res.json({
                ok: true,
                message: "Şifre sıfırlama kodu gönderildi.",
                demoCode: code,
            });
        } catch (err) {
            console.error("forgot-password error:", err);
            return res.status(500).json({
                message: "Şifre sıfırlama isteği oluşturulamadı.",
            });
        }
    });

    router.post("/:slug/auth/reset-password", async (req, res) => {
        try {
            const { email, code, new_password } = req.body;
            const slug = req.params.slug;

            if (!email || !code || !new_password) {
                return res.status(400).json({
                    message: "Email, kod ve yeni şifre zorunludur.",
                });
            }

            if (new_password.length < 6) {
                return res.status(400).json({
                    message: "Yeni şifre en az 6 karakter olmalıdır.",
                });
            }

            const [tenants] = await pool.query(
                "SELECT id FROM isletmeler WHERE slug = ? AND aktif = 1 LIMIT 1",
                [slug]
            );

            if (tenants.length === 0) {
                return res.status(404).json({ message: "İşletme bulunamadı." });
            }

            const tenantId = tenants[0].id;
            const key = `${tenantId}:${email}`;
            const record = resetCodes.get(key);

            if (!record) {
                return res.status(400).json({ message: "Kod bulunamadı." });
            }

            if (Date.now() > record.expiresAt) {
                resetCodes.delete(key);
                return res.status(400).json({ message: "Kodun süresi dolmuş." });
            }

            if (record.code !== code) {
                return res.status(400).json({ message: "Kod hatalı." });
            }

            const hash = await bcrypt.hash(new_password, 10);

            await pool.query(
                "UPDATE kullanicilar SET sifre_hash = ? WHERE id = ? AND isletme_id = ?",
                [hash, record.userId, tenantId]
            );

            resetCodes.delete(key);

            return res.json({
                ok: true,
                message: "Şifre başarıyla güncellendi.",
            });
        } catch (err) {
            console.error("reset-password error:", err);
            return res.status(500).json({
                message: "Şifre güncellenemedi.",
            });
        }
    });

    // . GET /tenants/:slug/auth/me  (Bearer token)
    router.get("/:slug/auth/me", requireAuth, async (req, res) => {
        try {
            const { slug } = req.params;

            const tenant = await getTenantBySlug(slug);
            if (!tenant || tenant.aktif !== 1) {
                return res
                    .status(404)
                    .json({ status: "fail", message: "Tenant not found/passive" });
            }

            // . multi-tenant güvenliği
            if (req.user.slug && req.user.slug !== slug) {
                return res
                    .status(403)
                    .json({ status: "fail", message: "Tenant mismatch" });
            }
            if (
                req.user.isletme_id &&
                String(req.user.isletme_id) !== String(tenant.id)
            ) {
                return res
                    .status(403)
                    .json({ status: "fail", message: "Isletme mismatch" });
            }

            const [rows] = await pool.query(
                "SELECT id, isletme_id, ad_soyad, email, rol, aktif FROM kullanicilar WHERE id=? AND isletme_id=? LIMIT 1",
                [req.user.id, tenant.id]
            );

            const u = rows[0];
            if (!u) {
                return res
                    .status(404)
                    .json({ status: "fail", message: "User not found" });
            }

            return res.json({ status: "ok", data: u });
        } catch (e) {
            console.error("GET me error:", e);
            return res
                .status(500)
                .json({ status: "fail", message: "Server error" });
        }
    });
    router.post('/:slug/support', requireAuth, async (req, res) => {
        try {
            const { subject, message } = req.body;

            if (!subject || !message) {
                return res.status(400).json({
                    message: 'Konu ve mesaj zorunludur.',
                });
            }

            console.log('📩 Yeni destek talebi:', {
                tenant: req.params.slug,
                user: req.user?.id,
                subject,
                message,
                date: new Date().toISOString(),
            });

            return res.status(200).json({
                ok: true,
                message: 'Destek talebiniz başarıyla alındı.',
            });
        } catch (err) {
            console.error('support error:', err);

            return res.status(500).json({
                message: 'Destek talebi alınamadı.',
            });
        }
    });

    router.post('/:slug/auth/change-password', requireAuth, async (req, res) => {
        try {
            const { current_password, new_password } = req.body;

            if (!current_password || !new_password) {
                return res.status(400).json({
                    message: 'Mevcut şifre ve yeni şifre zorunludur.',
                });
            }

            if (new_password.length < 6) {
                return res.status(400).json({
                    message: 'Yeni şifre en az 6 karakter olmalıdır.',
                });
            }

            const slug = req.params.slug;

            const [tenants] = await pool.query(
                'SELECT id FROM isletmeler WHERE slug = ? AND aktif = 1 LIMIT 1',
                [slug]
            );

            if (tenants.length === 0) {
                return res.status(404).json({ message: 'İşletme bulunamadı.' });
            }

            const isletmeId = tenants[0].id;

            const [users] = await pool.query(
                `SELECT id, sifre_hash 
       FROM kullanicilar 
       WHERE id = ? AND isletme_id = ? AND aktif = 1
       LIMIT 1`,
                [req.user.id, isletmeId]
            );

            if (users.length === 0) {
                return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });
            }

            const user = users[0];

            const ok = await bcrypt.compare(current_password, user.sifre_hash);

            if (!ok) {
                return res.status(400).json({
                    message: 'Mevcut şifre hatalı.',
                });
            }

            const newHash = await bcrypt.hash(new_password, 10);

            await pool.query(
                'UPDATE kullanicilar SET sifre_hash = ? WHERE id = ?',
                [newHash, user.id]
            );

            return res.json({
                ok: true,
                message: 'Şifre başarıyla güncellendi.',
            });
        } catch (err) {
            console.error('change-password error:', err);
            return res.status(500).json({
                message: 'Şifre değiştirilemedi.',
            });
        }
    });
    // . GET /tenants/:slug/services
    router.get("/:slug/services", async (req, res) => {
        try {
            const { slug } = req.params;

            const tenant = await getTenantBySlug(slug);
            if (!tenant) return res.status(404).json({ message: "Tenant not found" });

            const [rows] = await pool.query(
                `SELECT id, ad, sure_dk, fiyat
         FROM hizmetler
         WHERE isletme_id=? AND aktif=1
         ORDER BY ad ASC`,
                [tenant.id]
            );

            return res.json({ data: rows });
        } catch (e) {
            console.error("GET services error:", e);
            return res.status(500).json({ message: "Server error" });
        }
    });

    // . GET /tenants/:slug/staff
    router.get("/:slug/staff", async (req, res) => {
        try {
            const { slug } = req.params;

            const tenant = await getTenantBySlug(slug);
            if (!tenant) return res.status(404).json({ message: "Tenant not found" });

            const [rows] = await pool.query(
                `SELECT id, ad_soyad, unvan, foto_url
         FROM personeller
         WHERE isletme_id=? AND aktif=1
         ORDER BY ad_soyad ASC`,
                [tenant.id]
            );

            const data = rows.map((r) => ({
                id: r.id,
                name: r.ad_soyad,
                title: r.unvan || "Uzman",
                image: r.foto_url || "",
            }));

            return res.json({ data });
        } catch (e) {
            console.error("GET staff error:", e);
            return res.status(500).json({ message: "Server error" });
        }
    });


    router.get("/:slug/availability", async (req, res) => {
        try {
            const { slug } = req.params;
            const { staffId, date } = req.query;

            const tenant = await getTenantBySlug(slug);
            if (!tenant) return res.status(404).json({ message: "Tenant not found" });
            if (!staffId || !date)
                return res.status(400).json({ message: "Missing staffId/date" });

            const dayStart = new Date(`${date}T00:00:00`);
            const dayEnd = new Date(`${date}T23:59:59`);

            const [busy] = await pool.query(
                `SELECT baslangic, bitis
   FROM randevular
   WHERE isletme_id=? AND personel_id=? AND durum='onayli'
     AND baslangic BETWEEN ? AND ?`,
                [tenant.id, staffId, dayStart, dayEnd]
            );

            const pad = (n) => String(n).padStart(2, "0");
            const toMin = (dt) => dt.getHours() * 60 + dt.getMinutes();
            const fmtMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

            // slot listesi
            const slots = [];
            for (let h = 9; h < 18; h++) {
                slots.push(`${pad(h)}:00`);
                slots.push(`${pad(h)}:30`);
            }

            // onaylı randevulardan busy slot set'i
            const busySet = new Set();
            for (const r of busy) {
                const s = toMin(new Date(r.baslangic));
                const e = toMin(new Date(r.bitis));
                for (let m = s; m < e; m += 30) {
                    busySet.add(fmtMin(m));
                }
            }

            const free = slots.filter((s) => !busySet.has(s));
            return res.json({ slots: free });
        } catch (e) {
            console.error("GET availability error:", e);
            return res.status(500).json({ message: "Server error" });
        }
    });
    // ✅ POST /tenants/:slug/appointments
    router.post("/:slug/appointments", async (req, res) => {
        try {
            const { slug } = req.params;
            const crypto = require("crypto");

            // 1) tenant'ı bul
            const tenant = await getTenantBySlug(slug);
            if (!tenant) return res.status(404).json({ message: "Tenant not found" });

            // 2) body'yi al
            const { serviceId, staffId, musteriId, startAt, endAt, notlar } = req.body || {};
            if (!serviceId || !staffId || !musteriId || !startAt || !endAt) {
                return res.status(400).json({ message: "Missing fields" });
            }

            // 3) UUID üret
            const apptId = crypto.randomUUID();

            // 4) log (artık hepsi tanımlı)
            console.log("apptId:", apptId, "len:", apptId.length);
            console.log("isletme:", tenant.id, "len:", String(tenant.id).length);
            console.log("musteriId:", musteriId, "len:", String(musteriId).length);
            console.log("staffId:", staffId, "len:", String(staffId).length);
            console.log("serviceId:", serviceId, "len:", String(serviceId).length);

            // 5) hizmet doğrulama
            const [[svc]] = await pool.query(
                "SELECT id FROM hizmetler WHERE id=? AND isletme_id=? AND aktif=1 LIMIT 1",
                [serviceId, tenant.id]
            );
            if (!svc) return res.status(400).json({ message: "Invalid serviceId" });

            // 6) personel doğrulama
            const [[stf]] = await pool.query(
                "SELECT id FROM personeller WHERE id=? AND isletme_id=? AND aktif=1 LIMIT 1",
                [staffId, tenant.id]
            );
            if (!stf) return res.status(400).json({ message: "Invalid staffId" });

            // 7) müşteri doğrulama -> kullanicilar
            const [[cus]] = await pool.query(
                "SELECT id, rol, aktif FROM kullanicilar WHERE id=? AND isletme_id=? AND deleted_at IS NULL LIMIT 1",
                [musteriId, tenant.id]
            );
            if (!cus || cus.aktif !== 1) {
                return res.status(400).json({ message: "Invalid musteriId" });
            }

            // 8) çakışma kontrolü
            const [conflicts] = await pool.query(
                `SELECT id FROM randevular
       WHERE isletme_id=? AND personel_id=? AND durum!='iptal'
         AND NOT (bitis <= ? OR baslangic >= ?)
       LIMIT 1`,
                [tenant.id, staffId, startAt, endAt]
            );
            if (conflicts.length) {
                return res.status(409).json({ message: "Time slot not available" });
            }

            // 9) insert
            await pool.query(
                `INSERT INTO randevular
       (id, isletme_id, musteri_id, personel_id, hizmet_id, baslangic, bitis, durum, notlar)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'bekliyor', ?)`,
                [apptId, tenant.id, musteriId, staffId, serviceId, startAt, endAt, notlar ?? null]
            );

            return res.status(201).json({ data: { id: apptId } });
        } catch (e) {
            console.error("POST appointments error:", e);
            return res.status(500).json({ message: "Server error" });
        }
    });

    return router;
};