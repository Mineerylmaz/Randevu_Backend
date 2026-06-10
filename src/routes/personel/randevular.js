const express = require("express");
const pool = require("../../db/pool");

const { requireAuth, requireTenant } = require("../../middleware/auth");
const { requireRole } = require("../../middleware/role");

const router = express.Router();
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");

// PERSONEL koruması
router.use(requireAuth, requireRole("PERSONEL"), requireTenant);

// personelin kendi personel_id’sini bul
async function getPersonelId(conn, kullaniciId, isletmeId) {
    const [rows] = await conn.query(
        `SELECT id
     FROM personeller
     WHERE kullanici_id=? AND isletme_id=? AND deleted_at IS NULL
     LIMIT 1`,
        [kullaniciId, isletmeId]
    );
    return rows.length ? rows[0].id : null;
}
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/profiles");
    },

    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);

        cb(
            null,
            `${req.user.id}-${Date.now()}${ext}`
        );
    },
});

const upload = multer({ storage });

router.get("/bildirimler", async (req, res) => {
    const conn = await pool.getConnection();

    try {
        const personelId = await getPersonelId(
            conn,
            req.user.id,
            req.user.isletme_id
        );

        if (!personelId) {
            return res.status(404).json({
                status: "fail",
                message: "Personel kaydı bulunamadı",
            });
        }

        const [rows] = await conn.query(
            `
  SELECT
    pb.id,
    pb.randevu_id AS randevuId,
    pb.baslik,
    pb.mesaj,
    pb.okundu,
    DATE_FORMAT(pb.olusturma_tarihi, '%Y-%m-%dT%H:%i:%s') AS createdAt,

    k.ad_soyad AS musteriAdi,
    h.ad AS hizmetAdi,
    DATE_FORMAT(r.baslangic, '%d.%m.%Y %H:%i') AS randevuBaslangic,
    DATE_FORMAT(r.bitis, '%d.%m.%Y %H:%i') AS randevuBitis,
    r.durum AS randevuDurum

  FROM personel_bildirimleri pb

  LEFT JOIN randevular r
    ON r.id COLLATE utf8mb4_turkish_ci = pb.randevu_id COLLATE utf8mb4_turkish_ci
   AND r.isletme_id COLLATE utf8mb4_turkish_ci = pb.isletme_id COLLATE utf8mb4_turkish_ci

  LEFT JOIN kullanicilar k
    ON k.id COLLATE utf8mb4_turkish_ci = r.musteri_id COLLATE utf8mb4_turkish_ci
   AND k.isletme_id COLLATE utf8mb4_turkish_ci = pb.isletme_id COLLATE utf8mb4_turkish_ci

  LEFT JOIN hizmetler h
    ON h.id COLLATE utf8mb4_turkish_ci = r.hizmet_id COLLATE utf8mb4_turkish_ci
   AND h.isletme_id COLLATE utf8mb4_turkish_ci = pb.isletme_id COLLATE utf8mb4_turkish_ci

  WHERE pb.isletme_id COLLATE utf8mb4_turkish_ci = ? COLLATE utf8mb4_turkish_ci
    AND pb.personel_id COLLATE utf8mb4_turkish_ci = ? COLLATE utf8mb4_turkish_ci

  ORDER BY pb.olusturma_tarihi DESC
  LIMIT 100
  `,
            [req.user.isletme_id, personelId]
        );

        return res.json({
            status: "ok",
            data: rows,
        });
    } catch (e) {
        console.error("GET /personel/randevular/bildirimler ERROR:", e);
        return res.status(500).json({
            status: "fail",
            message: "Bildirimler alınamadı",
        });
    } finally {
        conn.release();
    }
});

/**
 * PATCH /personel/randevular/bildirimler/:id/okundu
 */
router.patch("/bildirimler/:id/okundu", async (req, res) => {
    const conn = await pool.getConnection();

    try {
        const personelId = await getPersonelId(
            conn,
            req.user.id,
            req.user.isletme_id
        );

        if (!personelId) {
            return res.status(404).json({
                status: "fail",
                message: "Personel kaydı bulunamadı",
            });
        }

        const [result] = await conn.query(
            `
  UPDATE personel_bildirimleri
  SET okundu = 1
  WHERE id COLLATE utf8mb4_turkish_ci = ? COLLATE utf8mb4_turkish_ci
    AND isletme_id COLLATE utf8mb4_turkish_ci = ? COLLATE utf8mb4_turkish_ci
    AND personel_id COLLATE utf8mb4_turkish_ci = ? COLLATE utf8mb4_turkish_ci
  `,
            [req.params.id, req.user.isletme_id, personelId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                status: "fail",
                message: "Bildirim bulunamadı",
            });
        }

        return res.json({
            status: "ok",
        });
    } catch (e) {
        console.error("PATCH /personel/randevular/bildirimler/:id/okundu ERROR:", e);
        return res.status(500).json({
            status: "fail",
            message: "Bildirim güncellenemedi",
        });
    } finally {
        conn.release();
    }
});

router.get("/", async (req, res) => {
    const status = (req.query.status || "bekleyen").toString().trim();
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 50);
    const offset = (page - 1) * limit;

    const conn = await pool.getConnection();
    try {
        const personelId = await getPersonelId(conn, req.user.id, req.user.isletme_id);
        if (!personelId) {
            return res.status(404).json({ status: "fail", message: "Personel kaydı bulunamadı" });
        }

        const where = ["r.isletme_id=?", "r.personel_id=?"];
        const params = [req.user.isletme_id, personelId];

        if (status !== "all") {
            where.push("r.durum=?");
            params.push(status);
        }

        const whereSql = `WHERE ${where.join(" AND ")}`;

        const [[{ total }]] = await conn.query(
            `SELECT COUNT(*) AS total
       FROM randevular r
       ${whereSql}`,
            params
        );

        const [rows] = await conn.query(
            `SELECT
     r.id,
     DATE_FORMAT(r.baslangic, '%Y-%m-%d %H:%i:%s') AS baslangic,
     DATE_FORMAT(r.bitis, '%Y-%m-%d %H:%i:%s') AS bitis,
     r.durum,
     r.notlar,
     h.ad AS hizmet_ad,
     u.ad_soyad AS musteri_ad_soyad
   FROM randevular r
   LEFT JOIN hizmetler h
     ON h.id = r.hizmet_id AND h.isletme_id = r.isletme_id
   LEFT JOIN kullanicilar u
     ON u.id = r.musteri_id AND u.isletme_id = r.isletme_id
   ${whereSql}
   ORDER BY r.olusturma_tarihi DESC
   LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        return res.json({
            status: "ok",
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            items: rows.map((x) => ({
                id: x.id,
                baslangic: x.baslangic, // ISO döner
                bitis: x.bitis,
                durum: x.durum,
                notlar: x.notlar,
                musteri_ad_soyad: x.musteri_ad_soyad || "Müşteri",
                hizmet_ad: x.hizmet_ad || "",
            })),
        });
    } catch (e) {
        console.error("GET /personel/randevular ERROR:", e);
        return res.status(500).json({ status: "fail", message: "Randevular alınamadı" });
    } finally {
        conn.release();
    }
});

/**
 * POST /personel/randevular/:id/onayla
 */
router.post("/:id/onayla", async (req, res) => {
    const id = req.params.id;

    const conn = await pool.getConnection();
    try {
        const personelId = await getPersonelId(conn, req.user.id, req.user.isletme_id);
        if (!personelId) return res.status(404).json({ status: "fail", message: "Personel yok" });

        const [r] = await conn.query(
            `UPDATE randevular
       SET durum='onayli'
       WHERE id=? AND isletme_id=? AND personel_id=?`,
            [id, req.user.isletme_id, personelId]
        );

        if (r.affectedRows === 0) {
            return res.status(404).json({ status: "fail", message: "Randevu bulunamadı" });
        }
        return res.json({ status: "ok" });
    } catch (e) {
        console.error("POST /personel/randevular/:id/onayla ERROR:", e);
        return res.status(500).json({ status: "fail", message: "Onaylama başarısız" });
    } finally {
        conn.release();
    }
});

/**
 * POST /personel/randevular/:id/iptal
 */
router.post("/:id/iptal", async (req, res) => {
    const id = req.params.id;

    const conn = await pool.getConnection();
    try {
        const personelId = await getPersonelId(conn, req.user.id, req.user.isletme_id);
        if (!personelId) return res.status(404).json({ status: "fail", message: "Personel yok" });

        const [r] = await conn.query(
            `UPDATE randevular
       SET durum='iptal'
       WHERE id=? AND isletme_id=? AND personel_id=?`,
            [id, req.user.isletme_id, personelId]
        );

        if (r.affectedRows === 0) {
            return res.status(404).json({ status: "fail", message: "Randevu bulunamadı" });
        }
        return res.json({ status: "ok" });
    } catch (e) {
        console.error("POST /personel/randevular/:id/iptal ERROR:", e);
        return res.status(500).json({ status: "fail", message: "İptal başarısız" });
    } finally {
        conn.release();
    }
});


router.get("/yorumlar", async (req, res) => {
    const conn = await pool.getConnection();

    try {
        const personelId = await getPersonelId(
            conn,
            req.user.id,
            req.user.isletme_id
        );

        if (!personelId) {
            return res.status(404).json({
                status: "fail",
                message: "Personel kaydı bulunamadı",
            });
        }

        const [rows] = await conn.query(
            `
            SELECT
              y.id,
              y.puan AS rating,
              y.yorum AS comment,
              DATE_FORMAT(y.olusturma_tarihi, '%Y-%m-%d %H:%i:%s') AS createdAt,
              k.ad_soyad AS customerName
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
            data: rows,
        });
    } catch (e) {
        console.error("GET /personel/randevular/yorumlar ERROR:", e);
        return res.status(500).json({
            status: "fail",
            message: "Yorumlar alınamadı",
        });
    } finally {
        conn.release();
    }
});

/**
 * GET /personel/randevular/profil
 */
router.get("/profil", async (req, res) => {
    const conn = await pool.getConnection();

    try {
        const personelId = await getPersonelId(
            conn,
            req.user.id,
            req.user.isletme_id
        );

        if (!personelId) {
            return res.status(404).json({
                status: "fail",
                message: "Personel kaydı bulunamadı",
            });
        }

        const [[personel]] = await conn.query(
            `
            SELECT
              id,
              ad_soyad,
              unvan,
              email,
              foto_url
            FROM personeller
            WHERE id = ?
              AND isletme_id = ?
              AND deleted_at IS NULL
            LIMIT 1
            `,
            [personelId, req.user.isletme_id]
        );

        return res.json({
            status: "ok",
            data: personel,
        });
    } catch (e) {
        console.error("GET /personel/randevular/profil ERROR:", e);
        return res.status(500).json({
            status: "fail",
            message: "Profil alınamadı",
        });
    } finally {
        conn.release();
    }
});

router.put("/profil", async (req, res) => {
    const conn = await pool.getConnection();

    try {
        const personelId = await getPersonelId(
            conn,
            req.user.id,
            req.user.isletme_id
        );

        if (!personelId) {
            return res.status(404).json({
                status: "fail",
                message: "Personel kaydı bulunamadı",
            });
        }

        const adSoyad = String(req.body.adSoyad ?? req.body.ad_soyad ?? "").trim();
        const unvan = String(req.body.unvan ?? "").trim();

        if (adSoyad.length < 2) {
            return res.status(400).json({
                status: "fail",
                message: "Ad soyad en az 2 karakter olmalı",
            });
        }

        await conn.query(
            `
            UPDATE personeller
            SET
              ad_soyad = ?,
              unvan = ?
            WHERE id = ?
              AND isletme_id = ?
            `,
            [
                adSoyad,
                unvan,
                personelId,
                req.user.isletme_id,
            ]
        );

        return res.json({
            status: "ok",
        });
    } catch (e) {
        console.error("PUT /personel/randevular/profil ERROR:", e);
        return res.status(500).json({
            status: "fail",
            message: "Profil güncellenemedi",
        });
    } finally {
        conn.release();
    }
});


router.get("/calisma-saatlerim", async (req, res) => {
    const conn = await pool.getConnection();

    try {
        const personelId = await getPersonelId(
            conn,
            req.user.id,
            req.user.isletme_id
        );

        if (!personelId) {
            return res.status(404).json({
                status: "fail",
                message: "Personel kaydı bulunamadı",
            });
        }

        const [rows] = await conn.query(
            `
            SELECT
              id,
              gun,
              TIME_FORMAT(baslangic_saati, '%H:%i') AS baslangic_saati,
              TIME_FORMAT(bitis_saati, '%H:%i') AS bitis_saati,
              aktif
            FROM personel_calisma_saatleri
            WHERE isletme_id = ?
              AND personel_id = ?
              AND aktif = 1
            ORDER BY gun ASC, baslangic_saati ASC
            `,
            [req.user.isletme_id, personelId]
        );

        return res.json({
            status: "ok",
            data: rows,
        });
    } catch (e) {
        console.error("GET /personel/randevular/calisma-saatlerim ERROR:", e);
        return res.status(500).json({
            status: "fail",
            message: "Çalışma saatleri yüklenemedi",
        });
    } finally {
        conn.release();
    }
});
router.post(
    "/profil/foto",
    upload.single("foto"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    status: "fail",
                    message: "Fotoğraf bulunamadı",
                });
            }

            const fotoUrl = `/uploads/profiles/${req.file.filename}`;

            await pool.query(
                `
  UPDATE personeller
  SET foto_url = ?
  WHERE kullanici_id = ?
    AND isletme_id = ?
    AND deleted_at IS NULL
  `,
                [fotoUrl, req.user.id, req.user.isletme_id]
            );

            res.json({
                status: "success",
                foto_url: fotoUrl,
            });
        } catch (e) {
            console.error("profil foto error:", e);

            res.status(500).json({
                status: "error",
                message: "Fotoğraf yüklenemedi",
            });
        }
    }
);

router.put("/profil/sifre", async (req, res) => {
    try {
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({
                status: "fail",
                message: "Şifre en az 6 karakter olmalı",
            });
        }

        const hash = await bcrypt.hash(newPassword, 10);

        await pool.query(
            `
      UPDATE kullanicilar
      SET sifre_hash = ?
      WHERE id = ?
      `,
            [hash, req.user.id]
        );

        res.json({
            status: "success",
            message: "Şifre değiştirildi",
        });
    } catch (e) {
        console.error("change password error:", e);

        res.status(500).json({
            status: "error",
            message: "Şifre değiştirilemedi",
        });
    }
});

module.exports = router;