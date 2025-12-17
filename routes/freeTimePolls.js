const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const requireRole = require("../src/middlewares/requireRole");

const {
    sequelize,
    Course,
    Enrollment,
    FreeTimePoll,
    FreeTimePollOption,
    FreeTimePollVote,
    Notification,
} = require("../src/models");

const router = express.Router();

async function notifyCourseStudents(courseId, payloadBuilder) {
    const enrollments = await Enrollment.findAll({ where: { courseId }, attributes: ["studentId"] });
    const ids = enrollments.map((e) => Number(e.studentId)).filter(Boolean);
    if (!ids.length) return;

    const rows = ids.map((sid) => payloadBuilder(sid)).filter(Boolean);
    if (!rows.length) return;

    await Notification.bulkCreate(rows);
}

// POST /courses/:courseId/free-time-polls  (교원/관리자)
router.post(
    "/courses/:courseId/free-time-polls",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        const t = await sequelize.transaction();
        try {
            const user = req.session.user;
            const courseId = Number(req.params.courseId);

            const course = await Course.findByPk(courseId, { transaction: t });
            if (!course) {
                await t.rollback();
                return res.status(404).json({ message: "과목 없음" });
            }
            if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
                await t.rollback();
                return res.status(403).json({ message: "본인 과목만 투표 생성 가능" });
            }

            const { title, description = "", deadlineAt = null, options } = req.body;
            if (!title) {
                await t.rollback();
                return res.status(400).json({ message: "title 필수" });
            }
            if (!Array.isArray(options) || options.length < 2) {
                await t.rollback();
                return res.status(400).json({ message: "options는 최소 2개 이상 필요" });
            }

            const poll = await FreeTimePoll.create(
                {
                    courseId,
                    creatorId: user.id,
                    title,
                    description,
                    status: "OPEN",
                    deadlineAt: deadlineAt ? new Date(deadlineAt) : null,
                },
                { transaction: t }
            );

            const optionRows = options.map((o) => ({
                pollId: poll.id,
                label: String(o.label || "").trim(),
                startAt: o.startAt ? new Date(o.startAt) : null,
                endAt: o.endAt ? new Date(o.endAt) : null,
            }));

            if (optionRows.some((r) => !r.label)) {
                await t.rollback();
                return res.status(400).json({ message: "options.label은 모두 필수" });
            }

            await FreeTimePollOption.bulkCreate(optionRows, { transaction: t });

            await t.commit();

            // ✅ 투표 오픈 알림(수강생)
            try {
                await notifyCourseStudents(courseId, (sid) => ({
                    userId: sid,
                    type: "POLL_OPENED",
                    title: "공강 투표가 열렸습니다",
                    message: `${course.title}: ${title}`,
                    linkUrl: `/free-time-polls/${poll.id}`,
                    isRead: false,
                }));
            } catch (err) {
                console.error("notification create failed (POLL_OPENED):", err);
            }

            res.status(201).json({ pollId: poll.id });
        } catch (e) {
            console.error(e);
            try { await t.rollback(); } catch (_) {}
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

// GET /courses/:courseId/free-time-polls (접근 가능 사용자)
router.get("/courses/:courseId/free-time-polls", requireLogin, async (req, res) => {
    try {
        const user = req.session.user;
        const courseId = Number(req.params.courseId);

        const course = await Course.findByPk(courseId);
        if (!course) return res.status(404).json({ message: "과목 없음" });

        if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
            return res.status(403).json({ message: "본인 과목만 조회 가능" });
        }
        if (user.role === "STUDENT") {
            const enr = await Enrollment.findOne({ where: { courseId, studentId: user.id } });
            if (!enr) return res.status(403).json({ message: "수강생만 조회 가능" });
        }

        const list = await FreeTimePoll.findAll({
            where: { courseId },
            order: [["createdAt", "DESC"]],
        });

        res.json({ count: list.length, list });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

// GET /free-time-polls/:id (상세)
router.get("/free-time-polls/:id", requireLogin, async (req, res) => {
    try {
        const user = req.session.user;
        const poll = await FreeTimePoll.findByPk(req.params.id, {
            include: [{ model: FreeTimePollOption, as: "options" }],
        });
        if (!poll) return res.status(404).json({ message: "투표 없음" });

        const course = await Course.findByPk(poll.courseId);
        if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
            return res.status(403).json({ message: "본인 과목만 조회 가능" });
        }
        if (user.role === "STUDENT") {
            const enr = await Enrollment.findOne({ where: { courseId: poll.courseId, studentId: user.id } });
            if (!enr) return res.status(403).json({ message: "수강생만 조회 가능" });
        }

        res.json({ poll });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

// POST /free-time-polls/:id/vote (학생)
router.post(
    "/free-time-polls/:id/vote",
    requireLogin,
    requireRole("STUDENT"),
    async (req, res) => {
        const t = await sequelize.transaction();
        try {
            const user = req.session.user;
            const pollId = Number(req.params.id);
            const { optionId } = req.body;

            const poll = await FreeTimePoll.findByPk(pollId, { transaction: t, lock: t.LOCK.UPDATE });
            if (!poll) {
                await t.rollback();
                return res.status(404).json({ message: "투표 없음" });
            }
            if (poll.status !== "OPEN") {
                await t.rollback();
                return res.status(400).json({ message: "종료된 투표입니다." });
            }
            if (poll.deadlineAt && new Date() > new Date(poll.deadlineAt)) {
                await t.rollback();
                return res.status(400).json({ message: "마감 시간이 지났습니다." });
            }

            // 수강생 확인
            const enr = await Enrollment.findOne({
                where: { courseId: poll.courseId, studentId: user.id },
                transaction: t,
            });
            if (!enr) {
                await t.rollback();
                return res.status(403).json({ message: "수강생만 투표 가능" });
            }

            const opt = await FreeTimePollOption.findByPk(optionId, { transaction: t });
            if (!opt || Number(opt.pollId) !== Number(pollId)) {
                await t.rollback();
                return res.status(400).json({ message: "옵션이 올바르지 않습니다." });
            }

            // 1인 1표: 있으면 업데이트
            const existing = await FreeTimePollVote.findOne({
                where: { pollId, voterId: user.id },
                transaction: t,
                lock: t.LOCK.UPDATE,
            });

            if (existing) {
                existing.optionId = opt.id;
                await existing.save({ transaction: t });
            } else {
                await FreeTimePollVote.create(
                    { pollId, optionId: opt.id, voterId: user.id },
                    { transaction: t }
                );
            }

            await t.commit();
            res.json({ ok: true });
        } catch (e) {
            console.error(e);
            try { await t.rollback(); } catch (_) {}
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

// POST /free-time-polls/:id/close (교원/관리자)
router.post(
    "/free-time-polls/:id/close",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        const t = await sequelize.transaction();
        try {
            const user = req.session.user;
            const poll = await FreeTimePoll.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
            if (!poll) {
                await t.rollback();
                return res.status(404).json({ message: "투표 없음" });
            }

            const course = await Course.findByPk(poll.courseId, { transaction: t });
            if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
                await t.rollback();
                return res.status(403).json({ message: "본인 과목만 종료 가능" });
            }

            poll.status = "CLOSED";
            await poll.save({ transaction: t });

            await t.commit();

            // ✅ 종료 알림(수강생)
            try {
                await notifyCourseStudents(poll.courseId, (sid) => ({
                    userId: sid,
                    type: "POLL_CLOSED",
                    title: "공강 투표가 종료되었습니다",
                    message: `${course.title}: ${poll.title}`,
                    linkUrl: `/free-time-polls/${poll.id}`,
                    isRead: false,
                }));
            } catch (err) {
                console.error("notification create failed (POLL_CLOSED):", err);
            }

            res.json({ ok: true, poll });
        } catch (e) {
            console.error(e);
            try { await t.rollback(); } catch (_) {}
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

// GET /free-time-polls/:id/results (결과)
// - 학생: 카운트만
// - 교원/관리자: 카운트 + 투표자 목록(원하면 확장)
router.get("/free-time-polls/:id/results", requireLogin, async (req, res) => {
    try {
        const user = req.session.user;
        const poll = await FreeTimePoll.findByPk(req.params.id, {
            include: [{ model: FreeTimePollOption, as: "options" }],
        });
        if (!poll) return res.status(404).json({ message: "투표 없음" });

        const course = await Course.findByPk(poll.courseId);
        if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
            return res.status(403).json({ message: "본인 과목만 조회 가능" });
        }
        if (user.role === "STUDENT") {
            const enr = await Enrollment.findOne({ where: { courseId: poll.courseId, studentId: user.id } });
            if (!enr) return res.status(403).json({ message: "수강생만 조회 가능" });
        }

        const votes = await FreeTimePollVote.findAll({ where: { pollId: poll.id } });
        const countMap = new Map();
        for (const o of poll.options) countMap.set(Number(o.id), 0);
        for (const v of votes) countMap.set(Number(v.optionId), (countMap.get(Number(v.optionId)) || 0) + 1);

        const counts = poll.options.map((o) => ({
            optionId: o.id,
            label: o.label,
            count: countMap.get(Number(o.id)) || 0,
        }));

        res.json({ pollId: poll.id, status: poll.status, counts });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

module.exports = router;