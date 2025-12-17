const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const requireRole = require("../src/middlewares/requireRole");
const { Attendance, ClassSession, Course, AuditLog } = require("../src/models");

const router = express.Router();

// PATCH /attendance/:id  { status: 1|2|3|4 }
router.patch("/attendance/:id", requireLogin, requireRole("INSTRUCTOR", "ADMIN"), async (req, res) => {
    try {
        const user = req.session.user;
        const attendance = await Attendance.findByPk(req.params.id);
        if (!attendance) return res.status(404).json({ message: "출석 데이터 없음" });

        const session = await ClassSession.findByPk(attendance.sessionId);
        const course = await Course.findByPk(session.courseId);

        // 교원은 본인 과목만 수정
        if (user.role === "INSTRUCTOR" && course.instructorId !== user.id) {
            return res.status(403).json({ message: "본인 과목만 정정 가능" });
        }

        const { status } = req.body;
        if (![1,2,3,4].includes(Number(status))) {
            return res.status(400).json({ message: "status는 1~4만 가능(출석/지각/결석/공결)" });
        }

        const before = attendance.toJSON();
        attendance.status = Number(status);
        attendance.updatedBy = user.id;
        await attendance.save();

        await AuditLog.create({
            targetType: "ATTENDANCE",
            targetId: attendance.id,
            action: "UPDATE",
            actorId: user.id,
            beforeValue: before,
            afterValue: attendance.toJSON(),
        });

        res.json({ attendance });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

module.exports = router;