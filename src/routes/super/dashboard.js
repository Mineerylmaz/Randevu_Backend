const express = require("express");
const pool = require("../../db/pool");

const router = express.Router();

/**
 * GET /super/dashboard
 * Response:
 * {
 *   status: "ok",
 *   stats: { totalBusinesses, activeBusinesses, totalUsers, uptimePct },
 *   charts: {
 *     businessStatus: { active, inactive },
 *     usersLast12Months: [{ label, value }],
 *     newBusinessesLast7Days: [{ label, value }]
 *   },
 *   recentBusinesses: [{ id, ad, slug, aktif, olusturma_tarihi }]
 * }
 */
router.get("/dashboard", async (req, res) => {
    try {
        // 1) Temel istatistikler
        const [[{ totalBusinesses }]] = await pool.query(
            "SELECT COUNT(*) AS totalBusinesses FROM isletmeler"
        );

        const [[{ activeBusinesses }]] = await pool.query(
            "SELECT COUNT(*) AS activeBusinesses FROM isletmeler WHERE aktif=1"
        );

        const [[{ totalUsers }]] = await pool.query(
            "SELECT COUNT(*) AS totalUsers FROM kullanicilar"
        );

        const uptimePct = 99.9;

        const [recentBusinesses] = await pool.query(
            "SELECT id, ad, slug, aktif, olusturma_tarihi FROM isletmeler ORDER BY olusturma_tarihi DESC LIMIT 6"
        );

        // 2) Grafik: Aktif/Pasif işletme
        const inactiveBusinesses = Math.max(0, totalBusinesses - activeBusinesses);

        // 3) Grafik: Son 12 ay kullanıcı trendi (kullanici oluşturma tarihi varsa)
        // kullanicilar.olusturma_tarihi yoksa, bu sorgu boş döner; Flutter zaten "veri yok" gösterir.
        const [usersLast12MonthsRaw] = await pool.query(`
      SELECT
        DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL n.n MONTH), '%b') AS label,
        (
          SELECT COUNT(*)
          FROM kullanicilar k
          WHERE k.olusturma_tarihi >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL n.n MONTH), '%Y-%m-01')
            AND k.olusturma_tarihi <  DATE_ADD(DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL n.n MONTH), '%Y-%m-01'), INTERVAL 1 MONTH)
        ) AS value,
        n.n AS idx
      FROM (
        SELECT 11 AS n UNION ALL SELECT 10 UNION ALL SELECT 9 UNION ALL SELECT 8 UNION ALL
        SELECT 7 UNION ALL SELECT 6 UNION ALL SELECT 5 UNION ALL SELECT 4 UNION ALL
        SELECT 3 UNION ALL SELECT 2 UNION ALL SELECT 1 UNION ALL SELECT 0
      ) n
      ORDER BY n.n ASC;
    `);

        // 4) Grafik: Son 7 gün yeni işletme sayısı (günlük)
        const [newBusinessesLast7DaysRaw] = await pool.query(`
      SELECT
        DATE_FORMAT(d.dt, '%a') AS label,
        (
          SELECT COUNT(*)
          FROM isletmeler i
          WHERE DATE(i.olusturma_tarihi) = d.dt
        ) AS value,
        d.ord AS idx
      FROM (
        SELECT DATE_SUB(CURDATE(), INTERVAL 6 DAY) AS dt, 0 AS ord UNION ALL
        SELECT DATE_SUB(CURDATE(), INTERVAL 5 DAY), 1 UNION ALL
        SELECT DATE_SUB(CURDATE(), INTERVAL 4 DAY), 2 UNION ALL
        SELECT DATE_SUB(CURDATE(), INTERVAL 3 DAY), 3 UNION ALL
        SELECT DATE_SUB(CURDATE(), INTERVAL 2 DAY), 4 UNION ALL
        SELECT DATE_SUB(CURDATE(), INTERVAL 1 DAY), 5 UNION ALL
        SELECT CURDATE(), 6
      ) d
      ORDER BY d.ord ASC;
    `);

        // kullanıcı tablosunda olusturma_tarihi yoksa hata alırsın.
        // Hata almamak için try/catch içinde ayrı da alınabilir; ama en temiz yol kolon var mı kontrol etmek.
        // Şimdilik: eğer sorgu hata fırlatırsa 500 döner; istersen aşağıda "toleranslı" versiyonunu da yazayım.

        const charts = {
            businessStatus: {
                active: activeBusinesses,
                inactive: inactiveBusinesses,
            },
            usersLast12Months: Array.isArray(usersLast12MonthsRaw)
                ? usersLast12MonthsRaw.map((r) => ({
                    label: r.label,
                    value: Number(r.value || 0),
                }))
                : [],
            newBusinessesLast7Days: Array.isArray(newBusinessesLast7DaysRaw)
                ? newBusinessesLast7DaysRaw.map((r) => ({
                    label: r.label,
                    value: Number(r.value || 0),
                }))
                : [],
        };

        res.json({
            status: "ok",
            stats: { totalBusinesses, activeBusinesses, totalUsers, uptimePct },
            charts,
            recentBusinesses,
        });
    } catch (err) {
        console.error("DASHBOARD ERROR:", err);
        res.status(500).json({ status: "fail", message: err.message });
    }
});

module.exports = router;
