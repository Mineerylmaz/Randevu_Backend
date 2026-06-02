const express = require("express");
const pool = require("../../db/pool");
const { uuid } = require("../../utils/id");

const router = express.Router();

const DEFAULTS = {
    logo_url: null,
    ana_renk: "#2563EB",
    ikincil_renk: "#0EA5E9",
    yazi_renk: "#111827",
    yazi_tipi: "Inter",
    giris_baslik: "Tekrar Hoş Geldiniz",
    hosgeldin_yazi: "Randevularınızı yönetmek için giriş yapın",
};

function normHex(v, fallback) {
    if (v == null) return null; // PUT'ta null geldiyse DB'ye null yazmak yerine COALESCE ile korunacak
    const s = String(v).trim();
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}

function normText(v, maxLen) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return "";
    return s.length > maxLen ? s.slice(0, maxLen) : s;
}

// Ayar kaydı yoksa otomatik oluştur
async function ensureSettingsRow(isletmeId) {
    const [rows] = await pool.query(
        "SELECT isletme_id FROM isletme_ayarlari WHERE isletme_id=? LIMIT 1",
        [isletmeId]
    );
    if (rows.length > 0) return;

    await pool.query(
        `INSERT INTO isletme_ayarlari
     (id, isletme_id, logo_url, ana_renk, ikincil_renk, yazi_renk, yazi_tipi, giris_baslik, hosgeldin_yazi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            uuid(),
            isletmeId,
            DEFAULTS.logo_url,
            DEFAULTS.ana_renk,
            DEFAULTS.ikincil_renk,
            DEFAULTS.yazi_renk,
            DEFAULTS.yazi_tipi,
            DEFAULTS.giris_baslik,
            DEFAULTS.hosgeldin_yazi,
        ]
    );
}

/**
 * GET /super/isletme-ayarlari/:isletmeId
 */
router.get("/isletme-ayarlari/:isletmeId", async (req, res) => {
    try {
        const { isletmeId } = req.params;

        await ensureSettingsRow(isletmeId);

        const [rows] = await pool.query(
            `SELECT isletme_id, logo_url, ana_renk, ikincil_renk, yazi_renk, yazi_tipi, giris_baslik, hosgeldin_yazi, guncelleme_tarihi
       FROM isletme_ayarlari WHERE isletme_id=?`,
            [isletmeId]
        );

        res.json({ status: "ok", data: rows[0] });
    } catch (e) {
        res.status(500).json({ status: "fail", error: "Ayarlar getirilemedi" });
    }
});

/**
 * PUT /super/isletme-ayarlari/:isletmeId
 * body: { ana_renk, ikincil_renk, yazi_renk, yazi_tipi, giris_baslik, hosgeldin_yazi, logo_url? }
 */
router.put("/isletme-ayarlari/:isletmeId", async (req, res) => {
    try {
        const { isletmeId } = req.params;
        const body = req.body || {};

        await ensureSettingsRow(isletmeId);

        const ana_renk = normHex(body.ana_renk, DEFAULTS.ana_renk);
        const ikincil_renk = normHex(body.ikincil_renk, DEFAULTS.ikincil_renk);
        const yazi_renk = normHex(body.yazi_renk, DEFAULTS.yazi_renk);

        const yazi_tipi = normText(body.yazi_tipi, 50);
        const giris_baslik = normText(body.giris_baslik, 80);
        const hosgeldin_yazi = normText(body.hosgeldin_yazi, 120);

        await pool.query(
            `UPDATE isletme_ayarlari
       SET
         ana_renk = COALESCE(?, ana_renk),
         ikincil_renk = COALESCE(?, ikincil_renk),
         yazi_renk = COALESCE(?, yazi_renk),
         yazi_tipi = COALESCE(?, yazi_tipi),
         giris_baslik = COALESCE(?, giris_baslik),
         hosgeldin_yazi = COALESCE(?, hosgeldin_yazi)
       WHERE isletme_id=?`,
            [
                ana_renk ?? null,
                ikincil_renk ?? null,
                yazi_renk ?? null,
                yazi_tipi ?? null,
                giris_baslik ?? null,
                hosgeldin_yazi ?? null,
                isletmeId,
            ]
        );

        res.json({ status: "ok" });
    } catch (e) {
        res.status(500).json({ status: "fail", error: "Ayarlar güncellenemedi" });
    }
});

/**
 * POST /super/isletme-ayarlari/:isletmeId/reset
 */
router.post("/isletme-ayarlari/:isletmeId/reset", async (req, res) => {
    try {
        const { isletmeId } = req.params;

        await ensureSettingsRow(isletmeId);

        await pool.query(
            `UPDATE isletme_ayarlari
       SET ana_renk=?, ikincil_renk=?, yazi_renk=?, yazi_tipi=?, giris_baslik=?, hosgeldin_yazi=?
       WHERE isletme_id=?`,
            [
                DEFAULTS.ana_renk,
                DEFAULTS.ikincil_renk,
                DEFAULTS.yazi_renk,
                DEFAULTS.yazi_tipi,
                DEFAULTS.giris_baslik,
                DEFAULTS.hosgeldin_yazi,
                isletmeId,
            ]
        );

        res.json({ status: "ok" });
    } catch (e) {
        res.status(500).json({ status: "fail", error: "Reset başarısız" });
    }
});

module.exports = router;
