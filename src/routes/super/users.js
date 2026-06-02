// src/routes/super/users.js
const express = require("express");
const pool = require("../../db/pool");
const bcrypt = require("bcrypt");
const { uuid } = require("../../utils/id");

const router = express.Router();

// Tek kaynak rol enum
const ROLES = ["SUPER_ADMIN", "ISLETME_ADMIN", "PERSONEL", "MUSTERI"];

/**
 * Flutter eski değer yollarsa (admin/personel/musteri) normalize etsin diye mapper
 */
function normalizeRole(input) {
    if (!input) return "";
    const r = input.toString().trim();

    // zaten doğru enum geldiyse
    if (ROLES.includes(r)) return r;

    // küçük/büyük farkı
    const up = r.toUpperCase();

    // eski/alternatif mapping
    if (up === "ADMIN") return "ISLETME_ADMIN";
    if (up === "ISLETMEADMIN") return "ISLETME_ADMIN";
    if (up === "PERSONEL") return "PERSONEL";
    if (up === "MUSTERI") return "MUSTERI";
    if (up === "SUPER") return "SUPER_ADMIN";
    if (up === "SUPERADMIN") return "SUPER_ADMIN";

    // Flutter bazen "personel" gibi yolluyor
    if (r.toLowerCase() === "admin") return "ISLETME_ADMIN";
    if (r.toLowerCase() === "personel") return "PERSONEL";
    if (r.toLowerCase() === "musteri") return "MUSTERI";

    return up; // fallback
}

function isValidEmail(email) {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRe.test(email);
}

/**
 * GET /super/users?search=&rol=&status=&isletme_id=&page=&limit=
 */
router.get("/users", async (req, res) => {
    const search = (req.query.search || "").toString().trim();
    const isletmeId = (req.query.isletme_id || "").toString().trim();

    const rolRaw = (req.query.rol || "").toString().trim();
    const rol = normalizeRole(rolRaw); // artık tek tip enum’a dönüyor

    const status = (req.query.status || "").toString().trim(); // "" | active | inactive

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 50);
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];

    if (search) {
        where.push("(u.ad_soyad LIKE ? OR u.email LIKE ?)");
        params.push(`%${search}%`, `%${search}%`);
    }

    if (isletmeId) {
        where.push("u.isletme_id=?");
        params.push(isletmeId);
    }

    if (rol) {
        // rol yanlış gelirse boş döndürmesin diye: sadece valid ise filtre uygula
        if (ROLES.includes(rol)) {
            where.push("u.rol=?");
            params.push(rol);
        }
    }

    if (status === "active") where.push("u.aktif=1");
    if (status === "inactive") where.push("u.aktif=0");

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    try {
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) AS total FROM kullanicilar u ${whereSql}`,
            params
        );

        const [rows] = await pool.query(
            `SELECT
          u.id, u.isletme_id, u.ad_soyad, u.email, u.rol, u.aktif, u.olusturma_tarihi,
          i.ad AS isletme_ad, i.slug AS isletme_slug
       FROM kullanicilar u
       LEFT JOIN isletmeler i ON i.id = u.isletme_id
       ${whereSql}
       ORDER BY u.olusturma_tarihi DESC
       LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        return res.json({
            status: "ok",
            total,
            page,
            limit,
            totalPages: Math.max(Math.ceil(total / limit), 1),
            items: rows,
        });
    } catch (e) {
        return res.status(500).json({ status: "fail", message: "Kullanıcılar yüklenemedi" });
    }
});

/**
 * GET /super/users/email-available?email=
 */
router.get("/users/email-available", async (req, res) => {
    const email = (req.query.email || "").toString().trim().toLowerCase();
    if (!email || !isValidEmail(email)) return res.json({ available: false });

    const [rows] = await pool.query("SELECT 1 FROM kullanicilar WHERE email=? LIMIT 1", [email]);
    return res.json({ available: rows.length === 0 });
});

/**
 * POST /super/users
 * body: { ad_soyad, email, sifre, rol, isletme_id, aktif }
 */
// ... üst taraf aynı

router.post("/users", async (req, res) => {
    const { ad_soyad, email, sifre, rol: rolRaw, isletme_id, aktif, unvan, foto_url } = req.body || {};

    const ad = (ad_soyad || "").toString().trim();
    const emailNorm = (email || "").toString().trim().toLowerCase();
    const role = normalizeRole(rolRaw);

    if (!ad || !emailNorm || !sifre || !role) {
        return res.status(400).json({ status: "fail", message: "ad_soyad, email, sifre, rol zorunlu" });
    }
    if (!isValidEmail(emailNorm)) {
        return res.status(400).json({ status: "fail", message: "Geçersiz e-posta formatı" });
    }
    if (!ROLES.includes(role)) {
        return res.status(400).json({ status: "fail", message: "Geçersiz rol" });
    }

    if (role !== "SUPER_ADMIN") {
        const t = (isletme_id || "").toString().trim();
        if (!t) return res.status(400).json({ status: "fail", message: "Bu rol için isletme_id zorunlu" });
    }

    const id = uuid(); // kullanicilar.id
    const aktifVal = aktif === 0 ? 0 : 1;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [exists] = await conn.query("SELECT id FROM kullanicilar WHERE email=? LIMIT 1", [emailNorm]);
        if (exists.length) {
            await conn.rollback();
            return res.status(409).json({ status: "fail", message: "Bu email zaten kayıtlı" });
        }

        const hash = await bcrypt.hash(sifre.toString(), 10);

        await conn.query(
            `INSERT INTO kullanicilar (id, isletme_id, ad_soyad, email, sifre_hash, rol, aktif)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                role === "SUPER_ADMIN" ? null : isletme_id,
                ad,
                emailNorm,
                hash,
                role,
                aktifVal,
            ]
        );

        // . PERSONEL ise personeller tablosuna da kayıt aç
        if (role === "PERSONEL") {
            const personelId = uuid();
            await conn.query(
                `INSERT INTO personeller (id, isletme_id, ad_soyad, unvan, aktif, foto_url, kullanici_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    personelId,
                    isletme_id,               // personel her zaman işletmeye bağlı olmalı
                    ad,
                    (unvan || "").toString().trim() || null,
                    aktifVal,
                    (foto_url || "").toString().trim() || null,
                    id,                       // . kullanici_id bağlantısı
                ]
            );
        }

        await conn.commit();

        return res.status(201).json({
            status: "ok",
            item: {
                id,
                ad_soyad: ad,
                email: emailNorm,
                rol: role,
                isletme_id: role === "SUPER_ADMIN" ? null : isletme_id,
                aktif: aktifVal,
            },
        });
    } catch (e) {
        try { await conn.rollback(); } catch (_) { }
        return res.status(500).json({ status: "fail", message: "Kullanıcı eklenemedi" });
    } finally {
        conn.release();
    }
});


/**
 * PATCH /super/users/:id
 * body: { ad_soyad?, email?, sifre?, rol?, isletme_id?, aktif? }
 */
router.patch("/users/:id", async (req, res) => {
    const id = (req.params.id || "").toString().trim();
    if (!id) return res.status(400).json({ status: "fail", message: "id gerekli" });

    const { ad_soyad, email, sifre, rol: rolRaw, isletme_id, aktif } = req.body || {};
    const role = rolRaw != null ? normalizeRole(rolRaw) : null;

    if (role != null && !ROLES.includes(role)) {
        return res.status(400).json({ status: "fail", message: "Geçersiz rol" });
    }

    const sets = [];
    const params = [];

    if (ad_soyad != null) {
        const ad = ad_soyad.toString().trim();
        if (ad.length < 2) {
            return res.status(400).json({ status: "fail", message: "ad_soyad en az 2 karakter olmalı" });
        }
        sets.push("ad_soyad=?");
        params.push(ad);
    }

    if (email != null) {
        const emailNorm = email.toString().trim().toLowerCase();
        if (!isValidEmail(emailNorm)) {
            return res.status(400).json({ status: "fail", message: "Geçersiz e-posta formatı" });
        }

        const [exists] = await pool.query(
            "SELECT id FROM kullanicilar WHERE email=? AND id<>? LIMIT 1",
            [emailNorm, id]
        );
        if (exists.length) {
            return res.status(409).json({ status: "fail", message: "Bu email zaten kayıtlı" });
        }

        sets.push("email=?");
        params.push(emailNorm);
    }

    if (role != null) {
        sets.push("rol=?");
        params.push(role);

        // rol SUPER_ADMIN ise işletmeyi null yap
        if (role === "SUPER_ADMIN") {
            sets.push("isletme_id=?");
            params.push(null);
        }
    }

    // rol değiştirilmediyse ama isletme_id gönderildiyse, güncelle
    if (isletme_id != null) {
        const t = isletme_id.toString().trim();
        if (!t) {
            return res.status(400).json({ status: "fail", message: "isletme_id geçersiz" });
        }
        sets.push("isletme_id=?");
        params.push(t);
    }

    if (aktif != null) {
        sets.push("aktif=?");
        params.push(aktif === 0 ? 0 : 1);
    }

    if (sifre != null && sifre.toString().isNotEmpty) {
        const hash = await bcrypt.hash(sifre.toString(), 10);
        sets.push("sifre_hash=?");
        params.push(hash);
    }

    if (!sets.length) {
        return res.status(400).json({ status: "fail", message: "Güncellenecek alan yok" });
    }

    params.push(id);

    try {
        const [r] = await pool.query(`UPDATE kullanicilar SET ${sets.join(", ")} WHERE id=?`, params);

        if (r.affectedRows === 0) {
            return res.status(404).json({ status: "fail", message: "Kullanıcı bulunamadı" });
        }

        return res.json({ status: "ok" });
    } catch (e) {
        return res.status(500).json({ status: "fail", message: "Güncelleme başarısız" });
    }
});

/**
 * DELETE /super/users/:id  (soft delete)
 */
router.delete("/users/:id", async (req, res) => {
    const id = (req.params.id || "").toString().trim();
    if (!id) return res.status(400).json({ status: "fail", message: "id gerekli" });

    try {
        const [r] = await pool.query("UPDATE kullanicilar SET aktif=0 WHERE id=?", [id]);

        if (r.affectedRows === 0) {
            return res.status(404).json({ status: "fail", message: "Kullanıcı bulunamadı" });
        }

        return res.json({ status: "ok" });
    } catch (e) {
        return res.status(500).json({ status: "fail", message: "Silme başarısız" });
    }
});

module.exports = router;
