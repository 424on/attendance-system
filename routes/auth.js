const express = require("express");
const bcrypt = require("bcrypt");
const { User } = require("../src/models"); // ✅ 너 구조 기준

const router = express.Router();

// POST /auth/login
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "email/password 필요" });
        }

        const user = await User.findOne({ where: { email } });
        if (!user) return res.status(401).json({ message: "로그인 실패" });

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return res.status(401).json({ message: "로그인 실패" });

        req.session.user = { id: user.id, role: user.role, name: user.name };

        return res.json({ message: "로그인 성공", user: req.session.user });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ message: "서버 에러" });
    }
});

// POST /auth/logout
router.post("/logout", (req, res) => {
    req.session.destroy(() => {
        res.clearCookie(process.env.SESSION_NAME || "attendance.sid");
        res.json({ message: "로그아웃 완료" });
    });
});

// GET /auth/me
router.get("/me", (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: "로그인 필요" });
    res.json({ user: req.session.user });
});

module.exports = router;