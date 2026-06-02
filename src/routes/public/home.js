// src/routes/public/home.js
const express = require("express");
const pool = require("../../db/pool");

const router = express.Router();

/**
 * GET /public/home/:slug
 */
router.get("/:slug", async (req, res) => {
    try {
        const slug = decodeURIComponent(req.params.slug || "").trim();
        if (!slug) return res.status(400).json({ status: "fail", message: "slug zorunlu" });

        // 1) işletme + ayarlar
        const [bizRows] = await pool.query(
            `SELECT 
        i.id, i.ad, i.slug, i.aktif,
        a.logo_url, a.ana_renk, a.ikincil_renk, a.yazi_renk, a.giris_baslik, a.hosgeldin_yazi
      FROM isletmeler i
      LEFT JOIN isletme_ayarlari a ON a.isletme_id = i.id
      WHERE i.slug=? LIMIT 1`,
            [slug]
        );

        const biz = bizRows[0];
        if (!biz) return res.status(404).json({ status: "fail", message: "İşletme bulunamadı" });
        if (Number(biz.aktif) === 0) return res.status(404).json({ status: "fail", message: "İşletme pasif" });

        // 2) hizmetler
        const [services] = await pool.query(
            `SELECT id, ad, sure_dk, fiyat
       FROM hizmetler
       WHERE isletme_id=? AND aktif=1
       ORDER BY ad ASC`,
            [biz.id]
        );
        // 3) personeller
        const limit = Math.min(
            Math.max(parseInt(req.query.limit || "10", 10), 1),
            50
        );


        const [rows] = await pool.query(
            `
  SELECT
    p.id,
    p.ad_soyad,
    p.unvan,
    p.foto_url,

    COALESCE(ROUND(AVG(CASE WHEN y.aktif = 1 THEN y.puan END), 1), 0) AS rating,
    COUNT(CASE WHEN y.aktif = 1 THEN y.id END) AS count

  FROM personeller p
  LEFT JOIN yorumlar y
    ON y.personel_id = p.id
   AND y.isletme_id = p.isletme_id

  WHERE p.isletme_id = ?
    AND p.aktif = 1
    AND p.deleted_at IS NULL

  GROUP BY p.id, p.ad_soyad, p.unvan, p.foto_url
  ORDER BY p.ad_soyad ASC
  LIMIT ?
  `,
            [biz.id, limit]
        );

        const experts = rows.map((p) => ({
            id: p.id,
            name: p.ad_soyad,
            title: p.unvan || "Uzman",
            image: p.foto_url || "",
            rating: Number(p.rating || 0),
            count: Number(p.count || 0),
        }));

        return res.json({
            status: "ok",
            tenant: {
                id: biz.id,
                ad: biz.ad,
                slug: biz.slug,
                logo_url: biz.logo_url || "",
                ana_renk: biz.ana_renk || "#2563EB",
                ikincil_renk: biz.ikincil_renk || "#0EA5E9",
                yazi_renk: biz.yazi_renk || "#0F172A",
                giris_baslik: biz.giris_baslik || "Merhaba",
                hosgeldin_yazi: biz.hosgeldin_yazi || "Randevunu kolayca planla",
            },
            services,
            experts,
        });
    } catch (e) {
        console.error("GET /public/home/:slug ERROR:", e);
        return res.status(500).json({ status: "fail", message: "Sunucu hatası" });
    }
});

module.exports = router;
