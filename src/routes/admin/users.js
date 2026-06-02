// src/routes/admin/users.js
const express = require("express");
const pool = require("../../db/pool");
const bcrypt = require("bcrypt");
const { uuid } = require("../../utils/id");
const { requireAuth, requireRole, requireTenant } = require("../../middleware/auth");

const router = express.Router();

router.use(requireAuth, requireRole("admin"), requireTenant);

// GET /admin/users?search=&rol=&page=&limit=
router.get("/", async (req, res) => {
    const search = (req.query.search || "").toString().trim();
    const rol = (req.query.rol || "").toString().trim(); // admin|personel|musteri
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 50);
    const offset = (page - 1) * limit;

    const where = ["u.isletme_id=?"];
    const params = [req.user.isletme_id];

    if (search) {
        where.push("(u.ad_soyad LIKE ? OR u.email LIKE ?)");
        params.push(`%${search}%`, `%${search}%`);
    }
    if (rol) {
        where.push("u.rol=?");
        params.push(rol);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM kullanicilar u ${whereSql}`,
        params
    );

    const [rows] = await pool.query(
        `SELECT u.id, u.ad_soyad, u.email, u.rol, u.aktif, u.olusturma_tarihi
     FROM kullanicilar u
     ${whereSql}
     ORDER BY u.olusturma_tarihi DESC
     LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    res.json({ status: "ok", total, page, limit, totalPages: Math.ceil(total / limit), items: rows });
});

// POST /admin/users
router.post("/", async (req, res) => {
    const { ad_soyad, email, sifre, rol, aktif } = req.body || {};

    if (!ad_soyad || !email || !sifre || !rol) {
        return res.status(400).json({ status: "fail", message: "ad_soyad, email, sifre, rol zorunlu" });
    }

    const allowed = ["admin", "personel", "musteri"];
    if (!allowed.includes(rol)) {
        return res.status(400).json({ status: "fail", message: "Geçersiz rol" });
    }

    const emailNorm = email.toString().trim().toLowerCase();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm);

    if (!emailOk) {
        return res.status(400).json({ status: "fail", message: "Email formatı hatalı" });
    }

    try {
        const [exists] = await pool.query(
            "SELECT id FROM kullanicilar WHERE email=? LIMIT 1",
            [emailNorm]
        );
        if (exists.length) {
            return res.status(409).json({ status: "fail", message: "Bu email zaten kayıtlı" });
        }

        const id = uuid();
        const hash = await bcrypt.hash(sifre.toString(), 10);

        await pool.query(
            `INSERT INTO kullanicilar (id, isletme_id, ad_soyad, email, sifre_hash, rol, aktif)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                req.user.isletme_id,
                ad_soyad.toString().trim(),
                emailNorm,
                hash,
                rol,
                aktif === 0 ? 0 : 1,
            ]
        );

        res.status(201).json({ status: "ok", item: { id, ad_soyad, email: emailNorm, rol, aktif: aktif === 0 ? 0 : 1 } });
    } catch (e) {
        res.status(500).json({ status: "fail", message: "Kullanıcı eklenemedi" });
    }
});

// DELETE /admin/users/:id
router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const [r] = await pool.query(
            "DELETE FROM kullanicilar WHERE id=? AND isletme_id=?",
            [id, req.user.isletme_id]
        );

        if (r.affectedRows === 0) {
            return res.status(404).json({ status: "fail", message: "Kullanıcı bulunamadı" });
        }

        res.json({ status: "ok" });
    } catch (e) {
        res.status(500).json({ status: "fail", message: "Silme başarısız" });
    }
});

module.exports = router;

