const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");

const router = express.Router();

/**
 * POST /auth/superadmin/login
 * body: { email, sifre }
 */
router.post("/superadmin/login", async (req, res) => {
    const { email, sifre } = req.body || {};
    if (!email || !sifre) return res.status(400).json({ message: "email ve sifre gerekli" });

    const [rows] = await pool.query(
        "SELECT id, email, sifre_hash, rol FROM kullanicilar WHERE email=? AND aktif=1 LIMIT 1",
        [email]
    );

    const user = rows?.[0];
    if (!user) return res.status(401).json({ message: "Hatalı giriş" });

    if (user.rol !== "SUPER_ADMIN") {
        return res.status(403).json({ message: "Super admin değil" });
    }

    const ok = await bcrypt.compare(sifre, user.sifre_hash);
    if (!ok) return res.status(401).json({ message: "Hatalı giriş" });

    const token = jwt.sign(
        { id: user.id, rol: user.rol },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );

    res.json({ token, user: { id: user.id, email: user.email, rol: user.rol } });
});
/**
 * POST /auth/admin/login
 * body: { email, sifre }
 */
router.post("/admin/login", async (req, res) => {
    const { email, sifre } = req.body || {};
    if (!email || !sifre) {
        return res.status(400).json({ message: "email ve sifre gerekli" });
    }

    const emailNorm = email.toLowerCase().trim();

    const [rows] = await pool.query(
        `
    SELECT 
      u.id, u.email, u.sifre_hash, u.rol, u.isletme_id,
      i.ad AS isletme_ad,
      a.logo_url,
      a.giris_baslik,
      a.hosgeldin_yazi
    FROM kullanicilar u
    JOIN isletmeler i ON i.id = u.isletme_id
    LEFT JOIN isletme_ayarlari a ON a.isletme_id = i.id
    WHERE u.email=? AND u.aktif=1
    LIMIT 1
    `,
        [emailNorm]
    );

    const user = rows?.[0];
    if (!user) return res.status(401).json({ message: "Hatalı giriş" });

    if (user.rol !== "ISLETME_ADMIN") {
        return res.status(403).json({ message: "Yetkisiz rol" });
    }

    const ok = await bcrypt.compare(sifre, user.sifre_hash);
    if (!ok) return res.status(401).json({ message: "Hatalı giriş" });

    const token = jwt.sign(
        { id: user.id, rol: user.rol, isletme_id: user.isletme_id },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );

    res.json({
        token,
        user: {
            email: user.email,
            rol: user.rol,
            isletme_ad: user.isletme_ad,
        },
        branding: {
            logo_url: user.logo_url,
            giris_baslik: user.giris_baslik ?? "İşletme Admin Paneli",
            hosgeldin_yazi: user.hosgeldin_yazi ?? "Hoş geldiniz",
        },
    });
});
router.post("/personel/login", async (req, res) => {
    console.log("1 LOGIN GELDİ", req.body);

    try {
        const { email, sifre, password } = req.body || {};
        const pass = (sifre ?? password);

        console.log("2 EMAIL/PASS OK");

        if (!email || !pass) {
            return res.status(400).json({ message: "email ve sifre gerekli" });
        }

        const emailNorm = String(email).toLowerCase().trim();

        console.log("3 DB SORGUSU BAŞLIYOR");

        const [rows] = await pool.query(
            `
            SELECT u.id, u.email, u.sifre_hash, u.rol, u.isletme_id,
                   i.ad AS isletme_ad, i.slug AS isletme_slug,
                   a.logo_url, a.giris_baslik, a.hosgeldin_yazi
            FROM kullanicilar u
            JOIN isletmeler i ON i.id = u.isletme_id
            LEFT JOIN isletme_ayarlari a ON a.isletme_id = i.id
            WHERE LOWER(u.email)=? AND u.aktif=1 AND u.deleted_at IS NULL
            LIMIT 2
            `,
            [emailNorm]
        );

        console.log("4 DB BİTTİ rows:", rows.length);

        if (!rows.length) {
            return res.status(401).json({ message: "Hatalı giriş" });
        }

        const user = rows[0];

        console.log("5 ROL:", user.rol);

        if (user.rol !== "PERSONEL") {
            return res.status(403).json({ message: "Yetkisiz rol" });
        }

        console.log("6 BCRYPT BAŞLIYOR");

        const ok = await bcrypt.compare(pass, user.sifre_hash);

        console.log("7 BCRYPT BİTTİ:", ok);

        if (!ok) {
            return res.status(401).json({ message: "Hatalı giriş" });
        }

        const token = jwt.sign(
            { id: user.id, rol: user.rol, isletme_id: user.isletme_id },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        console.log("8 RESPONSE DÖNÜYOR");

        return res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                rol: user.rol,
                isletme_id: user.isletme_id,
                isletme_ad: user.isletme_ad,
                isletme_slug: user.isletme_slug,
            },
            branding: {
                logo_url: user.logo_url,
                giris_baslik: user.giris_baslik ?? "Personel Paneli",
                hosgeldin_yazi: user.hosgeldin_yazi ?? "Hoş geldiniz",
            },
        });
    } catch (err) {
        console.error("PERSONEL LOGIN ERROR:", err);
        return res.status(500).json({ message: "Sunucu hatası" });
    }
});


module.exports = router;
