const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const requireRole = require("../src/middlewares/requireRole");
const { Attendance, ClassSession } = require("../src/models");

const router = express.Router();

// GET /me/attendance?courseId=1
router.get("/attendance", requireLogin, requireRole("STUDENT"), async (req, res) => {
    try {
        const user = req.session.user;
        const { courseId } = req.query;

        const where = { studentId: user.id };
        // courseId 필터는 session을 통해 걸어야 해서, 간단히 include로 처리
        const list = await Attendance.findAll({
            where,
            include: [
                {
                    model: ClassSession,
                    as: "session",
                    where: courseId ? { courseId: Number(courseId) } : undefined,
                },
            ],
            order: [["id", "DESC"]],
        });

        res.json({ list });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

module.exports = router;