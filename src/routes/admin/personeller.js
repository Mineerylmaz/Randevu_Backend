// src/routes/admin/personeller.js
const express = require("express");
const pool = require("../../db/pool");
const bcrypt = require("bcrypt");
const { uuid } = require("../../utils/id");

const { requireAuth, requireTenant } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/role");

const router = express.Router();

router.use(requireAuth, requireRole("ISLETME_ADMIN"), requireTenant);

// GET /admin/personeller?search=&status=&page=&limit=
router.get("/", async (req, res) => {
    const search = (req.query.search || "").toString().trim();
    const status = (req.query.status || "").toString().trim(); // "" | "aktif" | "pasif"
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 50);
    const offset = (page - 1) * limit;

    const where = ["p.isletme_id=?"];
    const params = [req.user.isletme_id];

    if (search) {
        where.push("(p.ad_soyad LIKE ? OR p.unvan LIKE ? OR u.email LIKE ?)");
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status === "aktif") where.push("p.aktif=1");
    if (status === "pasif") where.push("p.aktif=0");

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total
     FROM personeller p
     LEFT JOIN kullanicilar u ON u.id = p.kullanici_id
     ${whereSql}`,
        params
    );

    const [rows] = await pool.query(
        `SELECT
        p.id, p.kullanici_id, p.ad_soyad, p.unvan, p.foto_url, p.aktif,
        u.email
     FROM personeller p
     LEFT JOIN kullanicilar u ON u.id = p.kullanici_id
     ${whereSql}
     ORDER BY p.ad_soyad ASC
     LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    res.json({
        status: "ok",
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        items: rows,
    });
});

// POST /admin/personeller
// Body: { ad_soyad, unvan, foto_url, aktif, email }
// -> kullanicilar + personeller + davetler (transaction)
router.post("/", async (req, res) => {
    const { ad_soyad, unvan, foto_url, aktif, email } = req.body || {};

    const ad = (ad_soyad ?? "").toString().trim();
    const u = (unvan ?? "").toString().trim();
    const foto = (foto_url ?? "").toString().trim() || null;
    const aktifVal = aktif === 0 ? 0 : 1;

    const emailNorm = (email ?? "").toString().trim().toLowerCase();
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (ad.length < 2) {
        return res
            .status(400)
            .json({ status: "fail", message: "Ad soyad zorunlu (en az 2 karakter)" });
    }
    if (!emailNorm || !emailRe.test(emailNorm)) {
        return res
            .status(400)
            .json({ status: "fail", message: "Geçerli bir e-posta zorunlu" });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // . aynı işletmede email var mı? (multi-tenant doğru kontrol)
        const [exists] = await conn.query(
            "SELECT id FROM kullanicilar WHERE isletme_id=? AND email=? LIMIT 1",
            [req.user.isletme_id, emailNorm]
        );
        if (exists.length) {
            await conn.rollback();
            return res.status(409).json({ status: "fail", message: "Bu e-posta zaten kayıtlı" });
        }

        const kullaniciId = uuid();
        const personelId = uuid();

        // sifre_hash NOT NULL -> geçici şifre hash'i üret
        const tempPassword = uuid(); // random string
        const hash = await bcrypt.hash(tempPassword, 10);

        await conn.query(
            `INSERT INTO kullanicilar (id, isletme_id, ad_soyad, email, sifre_hash, rol, aktif)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [kullaniciId, req.user.isletme_id, ad, emailNorm, hash, "PERSONEL", aktifVal]
        );

        await conn.query(
            `INSERT INTO personeller (id, isletme_id, kullanici_id, ad_soyad, unvan, foto_url, aktif)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [personelId, req.user.isletme_id, kullaniciId, ad, u, foto, aktifVal]
        );

        // . davet oluştur (FIX: isletme_id + doğru parametre sayısı/sırası)
        const token = uuid();
        const davetId = uuid();

        await conn.query(
            `INSERT INTO davetler (id, isletme_id, kullanici_id, token, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 48 HOUR))`,
            [davetId, req.user.isletme_id, kullaniciId, token]
        );

        await conn.commit();

        return res.status(201).json({
            status: "ok",
            item: {
                id: personelId,
                kullanici_id: kullaniciId,
                ad_soyad: ad,
                unvan: u,
                foto_url: foto,
                aktif: aktifVal,
                email: emailNorm,
            },
            invite: {
                token,
                inviteLink: `randevu://invite/${token}`,
                expiresHours: 48,
            },
        });
    } catch (e) {
        console.error("POST /admin/personeller ERROR:", e);
        try {
            await conn.rollback();
        } catch (_) { }

        return res.status(500).json({
            status: "fail",
            message: e.sqlMessage || e.message || "Personel eklenemedi",
            code: e.code,
        });
    } finally {
        conn.release();
    }
});

// PUT /admin/personeller/:id
router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const { ad_soyad, unvan, foto_url, aktif } = req.body || {};

    const updates = [];
    const params = [];

    if (ad_soyad !== undefined) {
        const ad = ad_soyad.toString().trim();
        if (ad.length < 2)
            return res.status(400).json({ status: "fail", message: "Ad soyad en az 2 karakter" });
        updates.push("ad_soyad=?");
        params.push(ad);
    }
    if (unvan !== undefined) {
        updates.push("unvan=?");
        params.push((unvan ?? "").toString().trim());
    }
    if (foto_url !== undefined) {
        const foto = (foto_url ?? "").toString().trim();
        updates.push("foto_url=?");
        params.push(foto.length ? foto : null);
    }
    if (aktif !== undefined) {
        updates.push("aktif=?");
        params.push(aktif === 0 ? 0 : 1);
    }

    if (!updates.length) {
        return res.status(400).json({ status: "fail", message: "Güncellenecek alan yok" });
    }

    try {
        const [r] = await pool.query(
            `UPDATE personeller SET ${updates.join(", ")}
       WHERE id=? AND isletme_id=?`,
            [...params, id, req.user.isletme_id]
        );

        if (r.affectedRows === 0) {
            return res.status(404).json({ status: "fail", message: "Personel bulunamadı" });
        }
        return res.json({ status: "ok" });
    } catch (e) {
        return res.status(500).json({ status: "fail", message: "Güncelleme başarısız" });
    }
});

// DELETE /admin/personeller/:id
router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [pRows] = await conn.query(
            "SELECT kullanici_id FROM personeller WHERE id=? AND isletme_id=? AND deleted_at IS NULL LIMIT 1",
            [id, req.user.isletme_id]
        );

        if (!pRows.length) {
            await conn.rollback();
            return res.status(404).json({ status: "fail", message: "Personel bulunamadı" });
        }

        const kullaniciId = pRows[0].kullanici_id;

        await conn.query(
            "UPDATE personeller SET deleted_at=NOW() WHERE id=? AND isletme_id=?",
            [id, req.user.isletme_id]
        );

        await conn.query(
            "UPDATE kullanicilar SET deleted_at=NOW() WHERE id=? AND isletme_id=? AND rol='PERSONEL'",
            [kullaniciId, req.user.isletme_id]
        );

        await conn.commit();
        return res.json({ status: "ok" });

    } catch (e) {
        await conn.rollback();
        return res.status(500).json({ status: "fail" });
    } finally {
        conn.release();
    }
});
// GET /admin/personeller/:id/calisma-saatleri
router.get("/:id/calisma-saatleri", async (req, res) => {
    try {
        const personelId = req.params.id;

        const [rows] = await pool.query(
            `
            SELECT id, gun, baslangic_saati, bitis_saati, aktif
            FROM personel_calisma_saatleri
            WHERE isletme_id = ?
              AND personel_id = ?
            ORDER BY gun ASC, baslangic_saati ASC
            `,
            [req.user.isletme_id, personelId]
        );

        return res.json({
            status: "ok",
            items: rows,
        });
    } catch (e) {
        console.error("GET calisma saatleri ERROR:", e);
        return res.status(500).json({
            status: "fail",
            message: "Çalışma saatleri yüklenemedi",
        });
    }
});
// POST /admin/personeller/:id/calisma-saatleri
router.post("/:id/calisma-saatleri", async (req, res) => {
    try {
        const personelId = req.params.id;
        const { gun, baslangic_saati, bitis_saati, aktif } = req.body || {};

        if (!gun || gun < 1 || gun > 7) {
            return res.status(400).json({
                status: "fail",
                message: "Geçerli gün zorunlu",
            });
        }

        if (!baslangic_saati || !bitis_saati) {
            return res.status(400).json({
                status: "fail",
                message: "Başlangıç ve bitiş saati zorunlu",
            });
        }

        const [[personel]] = await pool.query(
            `
            SELECT id
            FROM personeller
            WHERE id = ?
              AND isletme_id = ?
              AND deleted_at IS NULL
            LIMIT 1
            `,
            [personelId, req.user.isletme_id]
        );

        if (!personel) {
            return res.status(404).json({
                status: "fail",
                message: "Personel bulunamadı",
            });
        }

        const id = uuid();

        await pool.query(
            `
            INSERT INTO personel_calisma_saatleri
              (id, isletme_id, personel_id, gun, baslangic_saati, bitis_saati, aktif)
            VALUES
              (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                id,
                req.user.isletme_id,
                personelId,
                gun,
                baslangic_saati,
                bitis_saati,
                aktif === 0 ? 0 : 1,
            ]
        );

        return res.status(201).json({
            status: "ok",
            item: {
                id,
                personel_id: personelId,
                gun,
                baslangic_saati,
                bitis_saati,
                aktif: aktif === 0 ? 0 : 1,
            },
        });
    } catch (e) {
        console.error("POST calisma saatleri ERROR:", e);
        return res.status(500).json({
            status: "fail",
            message: "Çalışma saati eklenemedi",
        });
    }
});
// DELETE /admin/personeller/:personelId/calisma-saatleri/:calismaId
router.delete("/:personelId/calisma-saatleri/:calismaId", async (req, res) => {
    try {
        const { personelId, calismaId } = req.params;

        await pool.query(
            `
            DELETE FROM personel_calisma_saatleri
            WHERE id = ?
              AND personel_id = ?
              AND isletme_id = ?
            `,
            [calismaId, personelId, req.user.isletme_id]
        );

        return res.json({ status: "ok" });
    } catch (e) {
        console.error("DELETE calisma saati ERROR:", e);
        return res.status(500).json({
            status: "fail",
            message: "Çalışma saati silinemedi",
        });
    }
});
// GET /admin/personeller/:id/yorumlar
router.get("/:id/yorumlar", async (req, res) => {
    try {
        const personelId = req.params.id;

        const [rows] = await pool.query(
            `
      SELECT
        y.id,
        y.puan,
        y.yorum,
        y.olusturma_tarihi,
        k.ad_soyad AS musteri_adi
      FROM yorumlar y
      LEFT JOIN kullanicilar k 
        ON k.id = y.musteri_id 
       AND k.isletme_id = y.isletme_id
      WHERE y.isletme_id = ?
        AND y.personel_id = ?
        AND y.aktif = 1
      ORDER BY y.olusturma_tarihi DESC
      LIMIT 100
      `,
            [req.user.isletme_id, personelId]
        );

        return res.json({
            status: "ok",
            items: rows,
        });
    } catch (e) {
        console.error("GET personel yorumlar ERROR:", e);
        return res.status(500).json({
            status: "fail",
            message: "Yorumlar yüklenemedi",
        });
    }
});
module.exports = router;
