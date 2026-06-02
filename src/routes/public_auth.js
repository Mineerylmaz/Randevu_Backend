// src/routes/public_auth.js
const express = require("express");
const pool = require("../db/pool");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { uuid } = require("../utils/id");

const router = express.Router();

function signToken(payload) {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET env yok (secretOrPrivateKey must have a value)");
    }
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "30d" });
}

async function getTenantBySlug(slug) {
    const [rows] = await pool.query(
        "SELECT id, ad, slug, aktif FROM isletmeler WHERE slug=? LIMIT 1",
        [slug]
    );
    return rows[0] || null;
}

// POST /public/auth/:slug/register
router.post("/auth/:slug/register", async (req, res) => {
    try {
        const { slug } = req.params;
        const { ad_soyad, email, sifre } = req.body || {};

        if (!ad_soyad || !email || !sifre) {
            return res.status(400).json({ status: "fail", message: "ad_soyad, email, sifre zorunlu" });
        }

        const tenant = await getTenantBySlug(slug);
        if (!tenant || tenant.aktif !== 1) {
            return res.status(404).json({ status: "fail", message: "İşletme bulunamadı/pasif" });
        }

        const emailNorm = email.toString().trim().toLowerCase();

        const [exists] = await pool.query(
            "SELECT id FROM kullanicilar WHERE isletme_id=? AND email=? LIMIT 1",
            [tenant.id, emailNorm]
        );
        if (exists.length) {
            return res.status(409).json({ status: "fail", message: "Bu email zaten kayıtlı" });
        }

        const id = uuid();
        const hash = await bcrypt.hash(sifre.toString(), 10);

        await pool.query(
            `INSERT INTO kullanicilar (id, isletme_id, ad_soyad, email, sifre_hash, rol, aktif)
       VALUES (?, ?, ?, ?, ?, 'MUSTERI', 1)`,
            [id, tenant.id, ad_soyad.toString().trim(), emailNorm, hash]
        );

        const token = signToken({
            id,
            isletme_id: tenant.id,
            rol: "MUSTERI",
            email: emailNorm,
            slug: tenant.slug,
        });

        return res.status(201).json({
            status: "ok",
            token,
            user: { id, ad_soyad: ad_soyad.toString().trim(), email: emailNorm, rol: "MUSTERI" },
            tenant: { id: tenant.id, ad: tenant.ad, slug: tenant.slug },
        });
    } catch (err) {
        console.error("PUBLIC REGISTER ERROR:", err);
        return res.status(500).json({ status: "fail", message: err.message });
    }
});

// POST /public/auth/:slug/login
router.post("/auth/:slug/login", async (req, res) => {
    try {
        const { slug } = req.params;
        const { email, sifre } = req.body || {};

        if (!email || !sifre) {
            return res.status(400).json({ status: "fail", message: "email ve sifre zorunlu" });
        }

        const tenant = await getTenantBySlug(slug);
        if (!tenant || tenant.aktif !== 1) {
            return res.status(404).json({ status: "fail", message: "İşletme bulunamadı/pasif" });
        }

        const emailNorm = email.toString().trim().toLowerCase();

        const [rows] = await pool.query(
            `SELECT id, ad_soyad, email, sifre_hash, rol, aktif
       FROM kullanicilar
       WHERE isletme_id=? AND email=? LIMIT 1`,
            [tenant.id, emailNorm]
        );

        const u = rows[0];
        if (!u) return res.status(401).json({ status: "fail", message: "Hatalı giriş" });
        if (u.aktif !== 1) return res.status(403).json({ status: "fail", message: "Kullanıcı pasif" });

        const ok = await bcrypt.compare(sifre.toString(), u.sifre_hash);
        if (!ok) return res.status(401).json({ status: "fail", message: "Hatalı giriş" });

        const token = signToken({
            id: u.id,
            isletme_id: tenant.id,
            rol: u.rol,
            email: u.email,
            slug: tenant.slug,
        });

        return res.json({
            status: "ok",
            token,
            user: { id: u.id, ad_soyad: u.ad_soyad, email: u.email, rol: u.rol },
            tenant: { id: tenant.id, ad: tenant.ad, slug: tenant.slug },
        });
    } catch (err) {
        console.error("PUBLIC LOGIN ERROR:", err);
        return res.status(500).json({ status: "fail", message: err.message });
    }
});


module.exports = router;
