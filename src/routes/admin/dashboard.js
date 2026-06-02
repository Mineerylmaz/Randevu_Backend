// src/routes/admin/dashboard.js
const express = require("express");
const pool = require("../../db/pool");

const { requireAuth } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/role");

const router = express.Router();

// Sende middleware ayrı dosyalarda:
// - requireAuth: middleware/auth.js
// - requireRole: middleware/role.js
router.use(requireAuth, requireRole("ISLETME_ADMIN"));

// Tenant kontrolü: req.user.isletme_id şart
router.use((req, res, next) => {
    const isletmeId = req.user?.isletme_id;
    if (!isletmeId) {
        return res.status(403).json({ status: "fail", message: "İşletme bilgisi yok" });
    }
    next();
});
// POST /admin/dashboard/logout
router.post("/logout", async (req, res) => {
    return res.json({
        status: "ok",
        message: "Çıkış yapıldı",
    });
});

// GET /admin/dashboard
router.get("/", async (req, res) => {
    try {
        const isletmeId = req.user.isletme_id;

        // işletme bilgisi + ayarlar
        const [bizRows] = await pool.query(
            `SELECT i.id, i.ad, i.slug, i.aktif,
              a.logo_url, a.ana_renk, a.ikincil_renk, a.yazi_renk, a.giris_baslik, a.hosgeldin_yazi
       FROM isletmeler i
       LEFT JOIN isletme_ayarlari a ON a.isletme_id = i.id
       WHERE i.id=? LIMIT 1`,
            [isletmeId]
        );
        const isletme = bizRows?.[0] || null;

        // istatistikler
        const [[todayTotalRow]] = await pool.query(
            `SELECT COUNT(*) AS today_total
       FROM randevular
       WHERE isletme_id=? AND DATE(baslangic)=CURDATE()`,
            [isletmeId]
        );

        const [[pendingRow]] = await pool.query(
            `SELECT COUNT(*) AS pending
   FROM randevular
   WHERE isletme_id=? AND durum IN ('bekliyor','pending')`,
            [isletmeId]
        );

        const [[confirmedRow]] = await pool.query(
            `SELECT COUNT(*) AS confirmed
   FROM randevular
   WHERE isletme_id=? AND durum IN ('onayli','confirmed')`,
            [isletmeId]
        );

        const [[cancelledRow]] = await pool.query(
            `SELECT COUNT(*) AS cancelled
   FROM randevular
   WHERE isletme_id=? AND durum IN ('iptal','cancelled')`,
            [isletmeId]
        );
        const [[staffRow]] = await pool.query(
            `SELECT COUNT(*) AS staff_active
       FROM personeller
       WHERE isletme_id=? AND aktif=1`,
            [isletmeId]
        );

        const [[servicesRow]] = await pool.query(
            `SELECT COUNT(*) AS services_active
       FROM hizmetler
       WHERE isletme_id=? AND aktif=1`,
            [isletmeId]
        );

        const [today] = await pool.query(
            `
  SELECT
    r.id,
    r.baslangic,
    r.bitis,
    r.durum,
    r.notlar,

    m.ad_soyad AS musteri_ad,
    m.email    AS musteri_email,

    p.ad_soyad AS personel_ad,
    p.unvan    AS personel_unvan,

    h.ad       AS hizmet_ad,
    h.sure_dk,
    h.fiyat,

    DATE_FORMAT(r.baslangic, '%H:%i') AS saat,
    DATE_FORMAT(r.baslangic, '%d.%m.%Y') AS tarih
  FROM randevular r
  LEFT JOIN kullanicilar m ON m.id=r.musteri_id AND m.isletme_id=r.isletme_id
  LEFT JOIN personeller  p ON p.id=r.personel_id AND p.isletme_id=r.isletme_id
  LEFT JOIN hizmetler    h ON h.id=r.hizmet_id AND h.isletme_id=r.isletme_id
  WHERE r.isletme_id=? AND DATE(r.baslangic)=CURDATE()
  ORDER BY r.baslangic ASC
  LIMIT 20
  `,
            [isletmeId]
        );

        return res.json({
            status: "ok",
            isletme,
            stats: {
                today_total: todayTotalRow?.today_total ?? 0,
                pending: pendingRow?.pending ?? 0,
                confirmed: confirmedRow?.confirmed ?? 0,
                cancelled: cancelledRow?.cancelled ?? 0,
                staff_active: staffRow?.staff_active ?? 0,
                services_active: servicesRow?.services_active ?? 0,
            },
            today,
        });
    } catch (e) {
        return res.status(500).json({ status: "fail", message: "Dashboard yüklenemedi" });
    }
});

module.exports = router;
