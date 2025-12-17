const express = require("express");
const router = express.Router();

const requireLogin = require("../src/middlewares/requireLogin");
const { Course, Enrollment, User } = require("../src/models");

router.get("/", requireLogin, async (req, res) => {
    try {
        const user = req.session.user;

        // ✅ 기본값 적용 (쿼리 없으면 기본)
        const semester = (req.query.semester || "2025-2").trim();
        const department = (req.query.department || "소프트웨어").trim();

        // ✅ 공통 필터(where)
        const baseWhere = { semester, department };

        // ADMIN: 해당 학기/학과 과목 전체 조회
        if (user.role === "ADMIN") {
            const list = await Course.findAll({
                where: baseWhere,
                order: [["id", "DESC"]],
            });
            return res.json({ list, filter: { semester, department } });
        }

        // INSTRUCTOR: 본인 담당 과목만 + 학기/학과 필터
        if (user.role === "INSTRUCTOR") {
            const list = await Course.findAll({
                where: { ...baseWhere, instructorId: user.id },
                order: [["id", "DESC"]],
            });
            return res.json({ list, filter: { semester, department } });
        }

        // STUDENT: 수강중인 과목만 + 학기/학과 필터
        const enrollments = await Enrollment.findAll({
            where: { studentId: user.id },
            attributes: ["courseId"],
        });
        const courseIds = enrollments.map((e) => e.courseId);

        // 수강 과목이 없으면 빈 배열 반환
        if (courseIds.length === 0) {
            return res.json({ list: [], filter: { semester, department } });
        }

        const list = await Course.findAll({
            where: { ...baseWhere, id: courseIds },
            order: [["id", "DESC"]],
        });

        return res.json({ list, filter: { semester, department } });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

module.exports = router;