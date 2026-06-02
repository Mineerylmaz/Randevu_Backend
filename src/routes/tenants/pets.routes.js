const express = require("express");
const pool = require("../../db/pool");
const { uuid } = require("../../utils/id");
const { requireAuth } = require("../../middleware/auth");

const router = express.Router();

async function getIsletmeIdBySlug(slug) {
    const [[row]] = await pool.query(
        `SELECT id FROM isletmeler WHERE slug=? AND aktif=1 LIMIT 1`,
        [slug]
    );
    return row?.id || null;
}

function ensureVet(slug, res) {
    const isVet = slug.toLowerCase().includes("vet");
    if (!isVet) {
        res.status(404).json({ message: "Bu modül bu işletme için aktif değil" });
        return false;
    }
    return true;
}

// GET /tenants/:slug/pets
router.get("/tenants/:slug/pets", requireAuth, async (req, res) => {
    try {
        const { slug } = req.params;
        if (!ensureVet(slug, res)) return;

        const isletmeId = await getIsletmeIdBySlug(slug);
        if (!isletmeId) return res.status(404).json({ message: "İşletme bulunamadı" });

        const [rows] = await pool.query(
            `
            SELECT
              h.id,
              h.ad,
              h.tur,
              h.irk,
              h.cinsiyet,
              h.dogum_tarihi,
              h.kilo,
              h.foto_url,

              (
                SELECT DATE_FORMAT(t.tarih, '%d.%m.%Y')
                FROM evcil_hayvan_takipleri t
                WHERE t.hayvan_id = h.id
                  AND t.isletme_id = h.isletme_id
                  AND t.tamamlandi = 0
                  AND t.tarih >= CURDATE()
                ORDER BY t.tarih ASC
                LIMIT 1
              ) AS sonraki_takip

            FROM evcil_hayvanlar h
            WHERE h.isletme_id = ?
              AND h.musteri_id = ?
              AND h.aktif = 1
              AND h.deleted_at IS NULL
            ORDER BY h.olusturma_tarihi DESC
            `,
            [isletmeId, req.user.id]
        );

        return res.json({ data: rows });
    } catch (e) {
        console.error("GET pets error:", e);
        return res.status(500).json({ message: "Server error" });
    }
});

// POST /tenants/:slug/pets
router.post("/tenants/:slug/pets", requireAuth, async (req, res) => {
    try {
        const { slug } = req.params;
        if (!ensureVet(slug, res)) return;

        const isletmeId = await getIsletmeIdBySlug(slug);
        if (!isletmeId) return res.status(404).json({ message: "İşletme bulunamadı" });

        const {
            ad,
            tur,
            irk,
            cinsiyet,
            dogum_tarihi,
            kilo,
            foto_url,
        } = req.body || {};

        const adVal = String(ad || "").trim();
        const turVal = String(tur || "").trim();

        if (adVal.length < 2) {
            return res.status(400).json({ message: "Hayvan adı zorunlu" });
        }

        if (!turVal) {
            return res.status(400).json({ message: "Hayvan türü zorunlu" });
        }

        const id = uuid();

        await pool.query(
            `
            INSERT INTO evcil_hayvanlar
              (id, isletme_id, musteri_id, ad, tur, irk, cinsiyet, dogum_tarihi, kilo, foto_url)
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                id,
                isletmeId,
                req.user.id,
                adVal,
                turVal,
                irk || null,
                cinsiyet || null,
                dogum_tarihi || null,
                kilo || null,
                foto_url || null,
            ]
        );

        return res.status(201).json({
            data: {
                id,
                ad: adVal,
                tur: turVal,
                irk: irk || null,
                cinsiyet: cinsiyet || null,
                dogum_tarihi: dogum_tarihi || null,
                kilo: kilo || null,
                foto_url: foto_url || null,
            },
        });
    } catch (e) {
        console.error("POST pets error:", e);
        return res.status(500).json({ message: "Server error" });
    }
});

router.get("/tenants/:slug/pets/:id/takipler", requireAuth, async (req, res) => {
    try {
        const { slug, id } = req.params;
        const tip = String(req.query.tip || "").trim();
        const durum = String(req.query.durum || "").trim();

        if (!ensureVet(slug, res)) return;

        const isletmeId = await getIsletmeIdBySlug(slug);
        if (!isletmeId) {
            return res.status(404).json({ message: "İşletme bulunamadı" });
        }

        const where = [
            "t.isletme_id = ?",
            "t.hayvan_id = ?",
            "h.musteri_id = ?",
        ];

        const params = [isletmeId, id, req.user.id];

        if (tip) {
            where.push("t.takip_tipi = ?");
            params.push(tip);
        }

        if (durum === "tamamlanan") {
            where.push("t.tamamlandi = 1");
        }

        if (durum === "bekleyen") {
            where.push("t.tamamlandi = 0");
        }

        const [rows] = await pool.query(
            `
            SELECT
              t.id,
              t.baslik,
              t.aciklama,
              t.takip_tipi,
              DATE_FORMAT(t.tarih, '%Y-%m-%d') AS tarih,
              DATE_FORMAT(t.hatirlatma_tarihi, '%Y-%m-%d %H:%i') AS hatirlatma_tarihi,
              t.oncelik,
              t.tamamlandi,
              DATE_FORMAT(t.tamamlanma_tarihi, '%Y-%m-%d %H:%i') AS tamamlanma_tarihi,
              t.ekleyen_rol
            FROM evcil_hayvan_takipleri t
            JOIN evcil_hayvanlar h 
              ON h.id = t.hayvan_id
             AND h.isletme_id = t.isletme_id
            WHERE ${where.join(" AND ")}
            ORDER BY 
              t.tamamlandi ASC,
              t.tarih ASC
            `,
            params
        );

        return res.json({ data: rows });
    } catch (e) {
        console.error("GET pet takipler error:", e);
        return res.status(500).json({ message: "Server error" });
    }
});

// POST /tenants/:slug/pets/:id/takipler
router.post("/tenants/:slug/pets/:id/takipler", requireAuth, async (req, res) => {
    try {
        const { slug, id } = req.params;
        if (!ensureVet(slug, res)) return;

        const isletmeId = await getIsletmeIdBySlug(slug);
        if (!isletmeId) {
            return res.status(404).json({ message: "İşletme bulunamadı" });
        }

        const [[pet]] = await pool.query(
            `
            SELECT id
            FROM evcil_hayvanlar
            WHERE id = ?
              AND isletme_id = ?
              AND musteri_id = ?
              AND deleted_at IS NULL
            LIMIT 1
            `,
            [id, isletmeId, req.user.id]
        );

        if (!pet) {
            return res.status(404).json({ message: "Evcil hayvan bulunamadı" });
        }

        const {
            baslik,
            aciklama,
            takip_tipi,
            tarih,
            oncelik,
            hatirlatma_tarihi,
        } = req.body || {};

        const baslikVal = String(baslik || "").trim();
        const tipVal = String(takip_tipi || "").trim();
        const tarihVal = String(tarih || "").trim();

        const allowedTypes = ["asi", "kontrol", "ilac", "bakim", "not"];
        const allowedPriority = ["dusuk", "normal", "yuksek"];

        if (!baslikVal || !tipVal || !tarihVal) {
            return res.status(400).json({
                message: "baslik, takip_tipi ve tarih zorunlu",
            });
        }

        if (!allowedTypes.includes(tipVal)) {
            return res.status(400).json({
                message: "Geçersiz takip tipi",
            });
        }

        const oncelikVal = allowedPriority.includes(oncelik)
            ? oncelik
            : "normal";

        const takipId = uuid();

        await pool.query(
            `
            INSERT INTO evcil_hayvan_takipleri
              (
                id,
                isletme_id,
                hayvan_id,
                baslik,
                aciklama,
                takip_tipi,
                tarih,
                oncelik,
                hatirlatma_tarihi,
                tamamlandi,
                ekleyen_rol,
                ekleyen_kullanici_id
              )
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            `,
            [
                takipId,
                isletmeId,
                id,
                baslikVal,
                aciklama || null,
                tipVal,
                tarihVal,
                oncelikVal,
                hatirlatma_tarihi || null,
                req.user.rol || "MUSTERI",
                req.user.id,
            ]
        );

        return res.status(201).json({
            data: {
                id: takipId,
                hayvan_id: id,
                baslik: baslikVal,
                aciklama: aciklama || null,
                takip_tipi: tipVal,
                tarih: tarihVal,
                oncelik: oncelikVal,
                hatirlatma_tarihi: hatirlatma_tarihi || null,
                tamamlandi: 0,
            },
        });
    } catch (e) {
        console.error("POST pet takip error:", e);
        return res.status(500).json({ message: "Server error" });
    }
});
router.put("/tenants/:slug/pets/:petId/takipler/:takipId/tamamla", requireAuth, async (req, res) => {
    try {
        const { slug, petId, takipId } = req.params;
        if (!ensureVet(slug, res)) return;

        const isletmeId = await getIsletmeIdBySlug(slug);
        if (!isletmeId) {
            return res.status(404).json({ message: "İşletme bulunamadı" });
        }

        const [result] = await pool.query(
            `
            UPDATE evcil_hayvan_takipleri t
            JOIN evcil_hayvanlar h 
              ON h.id = t.hayvan_id
             AND h.isletme_id = t.isletme_id
            SET 
              t.tamamlandi = 1,
              t.tamamlanma_tarihi = NOW()
            WHERE t.id = ?
              AND t.hayvan_id = ?
              AND t.isletme_id = ?
              AND h.musteri_id = ?
            `,
            [takipId, petId, isletmeId, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Takip kaydı bulunamadı" });
        }

        return res.json({ status: "ok" });
    } catch (e) {
        console.error("PUT takip tamamla error:", e);
        return res.status(500).json({ message: "Server error" });
    }
});

module.exports = router;