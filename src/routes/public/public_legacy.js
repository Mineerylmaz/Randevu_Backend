// src/routes/public/public_legacy.js
const express = require("express");
const pool = require("../../db/pool");

const router = express.Router();

/**
 * GET /public/isletme-config/:slug
 */
router.get("/:slug", async (req, res) => {
    const slug = (req.params.slug || "").toString().trim();

    if (!slug) {
        return res.status(400).json({ message: "slug gerekli" });
    }

    const [rows] = await pool.query(
        `SELECT 
      i.id as isletme_id, i.ad, i.slug, i.aktif,
      a.logo_url, a.ana_renk, a.ikincil_renk, a.yazi_renk, a.giris_baslik, a.hosgeldin_yazi
     FROM isletmeler i
     LEFT JOIN isletme_ayarlari a ON a.isletme_id = i.id
     WHERE i.slug=? AND i.aktif=1
     LIMIT 1`,
        [slug]
    );

    const item = rows?.[0];
    if (!item) return res.status(404).json({ message: "İşletme bulunamadı" });

    return res.json(item);
});

module.exports = router;