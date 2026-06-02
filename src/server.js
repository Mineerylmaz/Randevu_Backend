require("dotenv").config();
const app = require("./app");
const pool = require("./db/pool");

const PORT = Number(process.env.PORT || 4000);

app.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1 AS ok");
        res.json({ status: "ok", db: "connected" });
    } catch (err) {
        console.error("DB ERROR:", err);
        res.status(500).json({ status: "fail", error: err.message });
    }
});


app.listen(PORT, "0.0.0.0", () => {
    console.log(`API çalışıyor → Port: ${PORT} (Dış bağlantılara açık)`);
});
