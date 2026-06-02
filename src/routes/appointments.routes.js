const express = require("express");
const pool = require("../db/pool");
const router = express.Router();
const { uuid } = require("../utils/id");
const { requireAuth } = require("../middleware/auth");
const TABLES = {
    isletme: "isletmeler",
    hizmet: "hizmetler",
    personel: "personeller",
    randevu: "randevular",
};

async function getIsletmeIdBySlug(slug) {
    const [rows] = await pool.query(
        `SELECT id FROM ${TABLES.isletme} WHERE slug=? LIMIT 1`,
        [slug]
    );
    return rows.length ? rows[0].id : null;
}

function mapStatusLabel(status) {
    const t = String(status || "").toLowerCase();
    if (t.includes("onay") || t.includes("approved")) return "Onaylandı";
    if (t.includes("bek") || t.includes("pending")) return "Bekliyor";
    if (t.includes("iptal") || t.includes("cancel")) return "İptal";
    if (t.includes("tamam") || t.includes("done")) return "Tamamlandı";
    return status ? String(status) : "Bekliyor";
}

/**
 * . Booking akışı 404 almasın diye:
 * GET /tenants/:slug/services
 */
router.get("/tenants/:slug/services", async (req, res) => {
    try {
        const { slug } = req.params;
        const isletmeId = await getIsletmeIdBySlug(slug);
        if (!isletmeId) return res.status(404).json({ message: "İşletme bulunamadı" });

        const [rows] = await pool.query(
            `SELECT id, ad, sure_dk, fiyat
       FROM ${TABLES.hizmet}
       WHERE isletme_id=? AND aktif=1
       ORDER BY ad ASC`,
            [isletmeId]
        );

        return res.json({ data: rows });
    } catch (e) {
        console.error("GET services error:", e);
        return res.status(500).json({ message: "Server error" });
    }
});

/**
 * . Randevu listesi
 * GET /tenants/:slug/appointments?scope=upcoming|past
 */
// zaten diğer dosyada var

router.get("/tenants/:slug/appointments", requireAuth, async (req, res) => {
    try {
        const { slug } = req.params;

        const status = String(req.query.status || "all");
        const scope = String(req.query.scope || "upcoming");
        const serviceId = String(req.query.serviceId || "all");
        const staffId = String(req.query.staffId || "all");
        const isletmeId = await getIsletmeIdBySlug(slug);
        if (!isletmeId) return res.status(404).json({ message: "İşletme bulunamadı" });

        // ✅ Token işletme kontrolü
        if (req.user.isletme_id && String(req.user.isletme_id) !== String(isletmeId)) {
            return res.status(403).json({ message: "Isletme mismatch" });
        }


        const whereStatus = status === "all" ? "" : "AND r.durum = ?";
        const whereScope = scope === "past"
            ? "AND r.baslangic < NOW()"
            : "AND r.baslangic >= NOW()";

        const whereService = serviceId === "all" ? "" : "AND r.hizmet_id = ?";
        const whereStaff = staffId === "all" ? "" : "AND r.personel_id = ?";

        // ✅ Kullanıcı scope: müşteri sadece kendi randevularını görsün
        // rol alanın req.user.rol ise:
        const isCustomer = String(req.user.rol || "").toLowerCase() === "musteri";

        const whereUser = isCustomer ? "AND r.musteri_id = ?" : "";

        const params = [isletmeId];

        if (status !== "all") params.push(status);
        if (serviceId !== "all") params.push(serviceId);
        if (staffId !== "all") params.push(staffId);
        if (isCustomer) params.push(req.user.id);

        const [rows] = await pool.query(
            `
  SELECT
    r.id AS id,
    k.ad_soyad AS customerName,
    h.ad AS serviceName,
    p.ad_soyad AS staffName,
    r.baslangic AS startAt,
    r.durum AS status
  FROM randevular r
  JOIN hizmetler h ON h.id = r.hizmet_id AND h.isletme_id = r.isletme_id
  JOIN personeller p ON p.id = r.personel_id AND p.isletme_id = r.isletme_id
  LEFT JOIN kullanicilar k ON k.id = r.musteri_id AND k.isletme_id = r.isletme_id
  WHERE r.isletme_id = ?
  ${whereStatus}
  ${whereScope}
  ${whereService}
  ${whereStaff}
  ${whereUser}
  ORDER BY r.baslangic ${scope === "past" ? "DESC" : "ASC"}
  LIMIT 200
  `,
            params
        );

        const data = rows.map(r => {
            const dt = new Date(r.startAt);
            const pad = (n) => String(n).padStart(2, "0");
            const timeText = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

            return {
                id: r.id,
                customerName: r.customerName ?? "Müşteri",
                serviceName: r.serviceName ?? "Hizmet",
                staffName: r.staffName ?? "",
                timeText,
                status: r.status,
                statusLabel: mapStatusLabel(r.status),
                // groupTitle için istersen:
                groupTitle: dt.toISOString().slice(0, 10),
            };
        });

        return res.json({ data });


    } catch (e) {
        console.error("GET appointments error:", e);
        return res.status(500).json({ message: "Server error" });
    }
});
router.delete("/tenants/:slug/appointments/:id", requireAuth, async (req, res) => {
    try {
        const { slug, id } = req.params;

        const isletmeId = await getIsletmeIdBySlug(slug);
        if (!isletmeId) return res.status(404).json({ message: "İşletme bulunamadı" });

        await pool.query(
            `
      DELETE FROM randevular
      WHERE id = ?
        AND isletme_id = ?
        AND baslangic >= NOW()
      `,
            [id, isletmeId]
        );

        return res.json({ ok: true });
    } catch (e) {
        console.error("DELETE appointment error:", e);
        return res.status(500).json({ message: "Server error" });
    }
});
router.patch("/tenants/:slug/appointments/:id/time", requireAuth, async (req, res) => {
    try {
        const { slug, id } = req.params;
        const { baslangic, bitis } = req.body;

        if (!baslangic || !bitis) {
            return res.status(400).json({ message: "baslangic ve bitis zorunlu" });
        }

        const isletmeId = await getIsletmeIdBySlug(slug);
        if (!isletmeId) return res.status(404).json({ message: "İşletme bulunamadı" });

        const [[randevu]] = await pool.query(
            `
  SELECT id, personel_id, baslangic, bitis
  FROM randevular
  WHERE id = ?
    AND isletme_id = ?
    AND baslangic >= NOW()
  LIMIT 1
  `,
            [id, isletmeId]
        );
        if (!randevu) {
            return res.status(400).json({ message: "Geçmiş randevu düzenlenemez" });
        }

        const [conflicts] = await pool.query(
            `
      SELECT id
      FROM randevular
      WHERE isletme_id = ?
        AND personel_id = ?
        AND id <> ?
        AND durum NOT IN ('iptal', 'cancelled')
        AND NOT (bitis <= ? OR baslangic >= ?)
      LIMIT 1
      `,
            [isletmeId, randevu.personel_id, id, baslangic, bitis]
        );

        if (conflicts.length) {
            return res.status(409).json({ message: "Bu saat dolu" });
        }

        await pool.query(
            `
  UPDATE randevular
  SET baslangic = ?, bitis = ?
  WHERE id = ? AND isletme_id = ?
  `,
            [baslangic, bitis, id, isletmeId]
        );

        await pool.query(
            `
  INSERT INTO personel_bildirimleri
    (id, isletme_id, personel_id, randevu_id, baslik, mesaj)
  VALUES
    (UUID(), ?, ?, ?, ?, ?)
  `,
            [
                isletmeId,
                randevu.personel_id,
                id,
                "Randevu zamanı değişti",
                "Bir müşterinin randevu günü veya saati değiştirildi."
            ]
        );

        return res.json({ ok: true });
    } catch (e) {
        console.error("PATCH appointment time error:", e);
        return res.status(500).json({ message: "Server error" });
    }
});

router.get("/tenants/:slug/appointments/next", requireAuth, async (req, res) => {
    try {
        const { slug } = req.params;

        const isletmeId = await getIsletmeIdBySlug(slug);
        if (!isletmeId) return res.status(404).json({ message: "İşletme bulunamadı" });

        // ✅ token işletme kontrolü (multi-tenant güvenlik)
        if (req.user.isletme_id && String(req.user.isletme_id) !== String(isletmeId)) {
            return res.status(403).json({ message: "Isletme mismatch" });
        }

        // ✅ müşteri ise sadece kendi randevusu
        // rol değerini senin sistemine göre ayarla: 'musteri' / 'MUSTERI' vs
        const role = String(req.user.rol || "").toLowerCase();
        const isCustomer = role === "musteri" || role === "customer";

        const whereUser = isCustomer ? "AND r.musteri_id = ?" : "";
        const params = isCustomer ? [isletmeId, req.user.id] : [isletmeId];

        const [rows] = await pool.query(
            `
      SELECT
        r.id AS id,
        h.ad AS service,
        p.ad_soyad AS staff,
        DATE_FORMAT(r.baslangic, '%d.%m.%Y') AS dateText,
        DATE_FORMAT(r.baslangic, '%H:%i') AS timeText,
        r.durum AS status
      FROM randevular r
      JOIN hizmetler h ON h.id = r.hizmet_id
      JOIN personeller p ON p.id = r.personel_id
      WHERE r.isletme_id = ?
        AND r.durum = 'onayli'
        AND r.baslangic >= NOW()
        ${whereUser}
      ORDER BY r.baslangic ASC
      LIMIT 1
      `,
            params
        );

        if (!rows.length) return res.json({ data: null });

        const r = rows[0];
        return res.json({
            data: {
                id: r.id,
                service: r.service,
                staff: r.staff,
                dateText: r.dateText,
                timeText: r.timeText,
                badge: "Onaylı",
            },
        });
    } catch (err) {
        console.error("GET next appointment error:", err);
        return res.status(500).json({ message: "Server error" });
    }
});


// GET /tenants/:slug/staff?serviceId=...
router.get("/tenants/:slug/staff", async (req, res) => {
    try {
        const { slug } = req.params;
        const serviceId = (req.query.serviceId || "").toString().trim();

        const isletmeId = await getIsletmeIdBySlug(slug);
        if (!isletmeId) {
            return res.status(404).json({ message: "İşletme bulunamadı" });
        }

        const [rows] = await pool.query(
            `
            SELECT 
                p.id,
                p.ad_soyad,
                p.unvan,
                p.foto_url,

                COALESCE(ROUND(AVG(y.puan), 1), 0) AS rating,
                COUNT(y.id) AS count

            FROM personeller p

            LEFT JOIN yorumlar y
                ON y.personel_id = p.id
               AND y.isletme_id = p.isletme_id

            WHERE p.isletme_id = ?
              AND p.aktif = 1
              AND p.deleted_at IS NULL

            GROUP BY 
                p.id,
                p.ad_soyad,
                p.unvan,
                p.foto_url

            ORDER BY p.ad_soyad ASC
            `,
            [isletmeId]
        );

        const data = rows.map((p) => ({
            id: p.id,
            name: p.ad_soyad,
            title: p.unvan || "Uzman",
            image: p.foto_url || "",
            rating: Number(p.rating || 0),
            count: Number(p.count || 0),
        }));

        return res.json({ data });
    } catch (e) {
        console.error("GET staff error:", e);
        return res.status(500).json({ message: "Server error" });
    }
});
// GET /tenants/:slug/availability?serviceId=...&staffId=...&date=YYYY-MM-DD
router.get("/tenants/:slug/availability", async (req, res) => {
    try {
        const { slug } = req.params;
        const serviceId = String(req.query.serviceId || "").trim();
        const staffId = String(req.query.staffId || "").trim();
        const date = String(req.query.date || "").trim();

        if (!serviceId || !staffId || !date) {
            return res.status(400).json({
                message: "serviceId, staffId, date zorunlu",
            });
        }

        const isletmeId = await getIsletmeIdBySlug(slug);
        if (!isletmeId) {
            return res.status(404).json({ message: "İşletme bulunamadı" });
        }

        const [[svc]] = await pool.query(
            `
            SELECT id, sure_dk
            FROM hizmetler
            WHERE id = ?
              AND isletme_id = ?
              AND aktif = 1
            LIMIT 1
            `,
            [serviceId, isletmeId]
        );

        if (!svc) {
            return res.status(400).json({ message: "Geçersiz serviceId" });
        }

        const [[stf]] = await pool.query(
            `
            SELECT id
            FROM personeller
            WHERE id = ?
              AND isletme_id = ?
              AND aktif = 1
              AND deleted_at IS NULL
            LIMIT 1
            `,
            [staffId, isletmeId]
        );

        if (!stf) {
            return res.status(400).json({ message: "Geçersiz staffId" });
        }

        const serviceMinutes = Number(svc.sure_dk || 30);

        // JS: 0=Pazar, 1=Pazartesi...
        // DB: 1=Pazartesi, 2=Salı ... 7=Pazar
        const jsDay = new Date(`${date}T12:00:00`).getDay();
        const gun = jsDay === 0 ? 7 : jsDay;

        const [calismaRows] = await pool.query(
            `
            SELECT baslangic_saati, bitis_saati
            FROM personel_calisma_saatleri
            WHERE isletme_id = ?
              AND personel_id = ?
              AND gun = ?
              AND aktif = 1
            ORDER BY baslangic_saati ASC
            `,
            [isletmeId, staffId, gun]
        );

        // Personel o gün çalışmıyorsa saat yok
        if (!calismaRows.length) {
            return res.json({
                data: {
                    date,
                    serviceMinutes,
                    slots: [],
                },
            });
        }

        const [rows] = await pool.query(
            `
            SELECT baslangic, bitis, durum
            FROM randevular
            WHERE isletme_id = ?
              AND personel_id = ?
              AND DATE(baslangic) = ?
              AND durum NOT IN ('iptal', 'cancelled')
            ORDER BY baslangic ASC
            `,
            [isletmeId, staffId, date]
        );

        const busy = rows.map((r) => ({
            start: new Date(r.baslangic),
            end: new Date(r.bitis),
        }));

        const step = 30;
        const available = [];
        const now = new Date();

        for (const calisma of calismaRows) {
            const startText = String(calisma.baslangic_saati).slice(0, 5);
            const endText = String(calisma.bitis_saati).slice(0, 5);

            const dayStart = new Date(`${date}T${startText}:00`);
            const dayEnd = new Date(`${date}T${endText}:00`);

            for (
                let t = new Date(dayStart);
                t < dayEnd;
                t = new Date(t.getTime() + step * 60000)
            ) {
                const slotStart = new Date(t);
                const slotEnd = new Date(slotStart.getTime() + serviceMinutes * 60000);

                if (slotStart <= now) continue;
                if (slotEnd > dayEnd) break;

                const conflict = busy.some(
                    (b) => !(slotEnd <= b.start || slotStart >= b.end)
                );

                if (!conflict) {
                    const hh = String(slotStart.getHours()).padStart(2, "0");
                    const mm = String(slotStart.getMinutes()).padStart(2, "0");
                    available.push(`${hh}:${mm}`);
                }
            }
        }

        const uniqueSlots = [...new Set(available)].sort();

        return res.json({
            data: {
                date,
                serviceMinutes,
                slots: uniqueSlots,
            },
        });
    } catch (e) {
        console.error("GET availability error:", e);
        return res.status(500).json({ message: "Server error" });
    }
});


router.get("/tenants/:slug/reviews", async (req, res) => {
    try {
        const { slug } = req.params;

        const isletmeId = await getIsletmeIdBySlug(slug);

        if (!isletmeId) {
            return res.status(404).json({
                message: "İşletme bulunamadı",
            });
        }

        const [rows] = await pool.query(
            `
            SELECT
              y.id,
              y.puan AS rating,
              y.yorum AS comment,
              y.olusturma_tarihi AS createdAt,

              k.ad_soyad AS customerName,

              p.ad_soyad AS staffName,
              p.unvan AS staffTitle

            FROM yorumlar y

            LEFT JOIN kullanicilar k
              ON k.id = y.musteri_id

            LEFT JOIN personeller p
              ON p.id = y.personel_id

            WHERE y.isletme_id = ?
              AND y.aktif = 1

            ORDER BY y.olusturma_tarihi DESC
            LIMIT 100
            `,
            [isletmeId]
        );

        return res.json({
            data: rows,
        });

    } catch (e) {
        console.error("GET reviews error:", e);

        return res.status(500).json({
            message: "Server error",
        });
    }
});


router.post("/tenants/:slug/reviews", requireAuth, async (req, res) => {
    try {
        const { slug } = req.params;
        const { personelId, rating, comment } = req.body;

        const puan = Number(rating);

        if (!personelId) {
            return res.status(400).json({ message: "personelId zorunlu" });
        }

        if (!puan || puan < 1 || puan > 5) {
            return res.status(400).json({ message: "Puan 1 ile 5 arasında olmalı" });
        }

        const isletmeId = await getIsletmeIdBySlug(slug);
        if (!isletmeId) {
            return res.status(404).json({ message: "İşletme bulunamadı" });
        }

        if (req.user.isletme_id && String(req.user.isletme_id) !== String(isletmeId)) {
            return res.status(403).json({ message: "Isletme mismatch" });
        }

        const [[personel]] = await pool.query(
            `
            SELECT id
            FROM personeller
            WHERE id = ?
              AND isletme_id = ?
              AND aktif = 1
              AND deleted_at IS NULL
            LIMIT 1
            `,
            [personelId, isletmeId]
        );

        if (!personel) {
            return res.status(400).json({ message: "Geçersiz personel" });
        }

        const reviewId = uuid();

        await pool.query(
            `
            INSERT INTO yorumlar
              (id, isletme_id, musteri_id, personel_id, puan, yorum)
            VALUES
              (?, ?, ?, ?, ?, ?)
            `,
            [
                reviewId,
                isletmeId,
                req.user.id,
                personelId,
                puan,
                String(comment || "").trim(),
            ]
        );

        return res.status(201).json({
            data: {
                id: reviewId,
                personelId,
                rating: puan,
                comment: String(comment || "").trim(),
            },
        });
    } catch (e) {
        console.error("POST reviews error:", e);
        return res.status(500).json({ message: "Server error" });
    }
});








module.exports = router;