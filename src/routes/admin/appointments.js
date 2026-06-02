// src/routes/admin/appointments.js
const express = require("express");
const pool = require("../../db/pool");
const { requireAuth } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/role");

const router = express.Router();

router.use(requireAuth, requireRole("ISLETME_ADMIN"));
router.use((req, res, next) => {
    if (!req.user?.isletme_id) {
        return res.status(403).json({ status: "fail", message: "İşletme bilgisi yok" });
    }
    next();
});

function mapAdminStatusToDb(s) {
    const t = String(s || "").toLowerCase();
    if (!t) return "";
    if (t === "pending") return "bekliyor";
    if (t === "confirmed") return "onayli";
    if (t === "cancelled") return "iptal";
    return t; // fallback
}

// GET /admin/randevular?status=&from=YYYY-MM-DD&to=YYYY-MM-DD&search=&page=&limit=
router.get("/", async (req, res) => {
    try {
        const isletmeId = req.user.isletme_id;

        const statusRaw = (req.query.status || "").toString().trim();
        const status = mapAdminStatusToDb(statusRaw);

        const search = (req.query.search || "").toString().trim();
        const from = (req.query.from || "").toString().trim(); // YYYY-MM-DD
        const to = (req.query.to || "").toString().trim();     // YYYY-MM-DD
        const page = Math.max(parseInt(req.query.page || "1", 10), 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 50);
        const offset = (page - 1) * limit;

        // ✅ önce tanımla
        const where = ["r.isletme_id=?"];
        const params = [isletmeId];

        // ✅ sonra kullan
        if (status) {
            where.push("r.durum=?");
            params.push(status);
        }

        if (from) {
            where.push("DATE(r.baslangic) >= ?");
            params.push(from);
        }
        if (to) {
            where.push("DATE(r.baslangic) <= ?");
            params.push(to);
        }

        if (search) {
            where.push(`(
        m.ad_soyad LIKE ? OR m.email LIKE ?
        OR h.ad LIKE ?
        OR p.ad_soyad LIKE ?
      )`);
            params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }

        const whereSql = `WHERE ${where.join(" AND ")}`;

        const [[{ total }]] = await pool.query(
            `
      SELECT COUNT(*) AS total
      FROM randevular r
      LEFT JOIN kullanicilar m ON m.id=r.musteri_id AND m.isletme_id=r.isletme_id
      LEFT JOIN personeller p ON p.id=r.personel_id AND p.isletme_id=r.isletme_id
      LEFT JOIN hizmetler h ON h.id=r.hizmet_id AND h.isletme_id=r.isletme_id
      ${whereSql}
      `,
            params
        );

        const [rows] = await pool.query(
            `
      SELECT
        r.id, r.baslangic, r.bitis, r.durum, r.notlar, r.olusturma_tarihi,
        r.musteri_id, r.personel_id, r.hizmet_id,
        m.ad_soyad AS musteri_ad, m.email AS musteri_email,
        p.ad_soyad AS personel_ad, p.unvan AS personel_unvan,
        h.ad AS hizmet_ad, h.sure_dk, h.fiyat
      FROM randevular r
      LEFT JOIN kullanicilar m ON m.id=r.musteri_id AND m.isletme_id=r.isletme_id
      LEFT JOIN personeller p ON p.id=r.personel_id AND p.isletme_id=r.isletme_id
      LEFT JOIN hizmetler h ON h.id=r.hizmet_id AND h.isletme_id=r.isletme_id
      ${whereSql}
      ORDER BY r.baslangic DESC
      LIMIT ? OFFSET ?
      `,
            [...params, limit, offset]
        );

        return res.json({
            status: "ok",
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            items: rows,
        });
    } catch (e) {
        console.error("ADMIN GET appointments error:", e);
        return res.status(500).json({ status: "fail", message: "Server error" });
    }
});

// PATCH /admin/randevular/:id  (durum / notlar)
router.patch("/:id", async (req, res) => {
    const isletmeId = req.user.isletme_id;
    const id = req.params.id;

    const { durum, notlar } = req.body || {};

    const updates = [];
    const params = [];

    const allowedDurum = ["bekliyor", "onayli", "iptal"];

    if (durum !== undefined) {
        const d = durum.toString().trim();
        if (!allowedDurum.includes(d)) {
            return res.status(400).json({ status: "fail", message: "Geçersiz durum" });
        }
        updates.push("durum=?");
        params.push(d);
    }

    if (notlar !== undefined) {
        updates.push("notlar=?");
        params.push(notlar === null ? null : notlar.toString());
    }

    if (!updates.length) {
        return res.status(400).json({ status: "fail", message: "Güncellenecek alan yok" });
    }

    try {
        const [r] = await pool.query(
            `UPDATE randevular
       SET ${updates.join(", ")}
       WHERE id=? AND isletme_id=?`,
            [...params, id, isletmeId]
        );

        if (r.affectedRows === 0) {
            return res.status(404).json({ status: "fail", message: "Randevu bulunamadı" });
        }

        return res.json({ status: "ok" });
    } catch (e) {
        console.error("ADMIN PATCH appointment error:", e);
        return res.status(500).json({ status: "fail", message: "Güncelleme başarısız" });
    }
});

router.delete("/:id", async (req, res) => {
    const isletmeId = req.user.isletme_id;
    const id = req.params.id;

    try {
        const [r] = await pool.query(
            "DELETE FROM randevular WHERE id=? AND isletme_id=?",
            [id, isletmeId]
        );

        if (r.affectedRows === 0) {
            return res.status(404).json({ status: "fail", message: "Randevu bulunamadı" });
        }

        return res.json({ status: "ok" });
    } catch (e) {
        console.error("ADMIN DELETE appointment error:", e);
        return res.status(500).json({ status: "fail", message: "Silme başarısız" });
    }
});

module.exports = router;