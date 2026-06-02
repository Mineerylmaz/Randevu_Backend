const express = require("express");
const pool = require("../../db/pool");
const bcrypt = require("bcrypt");

const router = express.Router();

// GET /public/invite/:token  (token geçerli mi?)
router.get("/invite/:token", async (req, res) => {
    const token = (req.params.token || "").toString().trim();
    if (!token) return res.status(400).json({ status: "fail", message: "token gerekli" });

    const [rows] = await pool.query(
        `SELECT d.token, d.expires_at, d.used_at, u.id AS kullanici_id, u.email, u.ad_soyad
     FROM davetler d
     JOIN kullanicilar u ON u.id = d.kullanici_id
     WHERE d.token=? LIMIT 1`,
        [token]
    );

    if (!rows.length) return res.status(404).json({ status: "fail", message: "Davet bulunamadı" });

    const r = rows[0];
    if (r.used_at) return res.status(410).json({ status: "fail", message: "Davet daha önce kullanılmış" });

    // expires check
    const [expRows] = await pool.query(`SELECT (NOW() > ?) AS expired`, [r.expires_at]);
    if (expRows?.[0]?.expired === 1) return res.status(410).json({ status: "fail", message: "Davet süresi dolmuş" });

    return res.json({
        status: "ok",
        user: { kullanici_id: r.kullanici_id, email: r.email, ad_soyad: r.ad_soyad },
        expires_at: r.expires_at,
    });
});

// POST /public/invite/:token/set-password { sifre }
router.post("/invite/:token/set-password", async (req, res) => {
    const token = (req.params.token || "").toString().trim();
    const sifre = (req.body?.sifre || "").toString();

    if (!token) return res.status(400).json({ status: "fail", message: "token gerekli" });
    if (!sifre || sifre.length < 6) return res.status(400).json({ status: "fail", message: "Şifre en az 6 karakter" });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query(
            `SELECT d.id AS davet_id, d.expires_at, d.used_at, u.id AS kullanici_id
       FROM davetler d
       JOIN kullanicilar u ON u.id = d.kullanici_id
       WHERE d.token=? LIMIT 1`,
            [token]
        );

        if (!rows.length) {
            await conn.rollback();
            return res.status(404).json({ status: "fail", message: "Davet bulunamadı" });
        }

        const r = rows[0];
        if (r.used_at) {
            await conn.rollback();
            return res.status(410).json({ status: "fail", message: "Davet daha önce kullanılmış" });
        }

        const [expRows] = await conn.query(`SELECT (NOW() > ?) AS expired`, [r.expires_at]);
        if (expRows?.[0]?.expired === 1) {
            await conn.rollback();
            return res.status(410).json({ status: "fail", message: "Davet süresi dolmuş" });
        }

        const hash = await bcrypt.hash(sifre, 10);

        await conn.query(
            `UPDATE kullanicilar SET sifre_hash=?, aktif=1 WHERE id=?`,
            [hash, r.kullanici_id]
        );

        await conn.query(
            `UPDATE davetler SET used_at=NOW() WHERE id=?`,
            [r.davet_id]
        );

        await conn.commit();
        return res.json({ status: "ok" });
    } catch (e) {
        try { await conn.rollback(); } catch (_) { }
        return res.status(500).json({ status: "fail", message: "Şifre belirleme başarısız" });
    } finally {
        conn.release();
    }
});

module.exports = router;
