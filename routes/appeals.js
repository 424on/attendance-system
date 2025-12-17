const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const requireRole = require("../src/middlewares/requireRole");

const {
    sequelize,
    Appeal,
    Attendance,
    ClassSession,
    Course,
    Enrollment,
    AuditLog,
    Notification,
} = require("../src/models");

const router = express.Router();

function isValidRequestedStatus(x) {
    const n = Number(x);
    return [1, 2, 3, 4].includes(n);
}

// ===== 알림 유틸 =====
async function notifyUser({ userId, type, title, message, linkUrl = null }, t) {
    if (!Notification) return;
    await Notification.create(
        { userId, type, title, message, linkUrl, isRead: false },
        t ? { transaction: t } : undefined
    );
}

// =========================
// 학생: 이의신청 생성
// POST /attendance/:attendanceId/appeals
// body: { message, requestedStatus? }
// =========================
router.post(
    "/attendance/:attendanceId/appeals",
    requireLogin,
    requireRole("STUDENT"),
    async (req, res) => {
        try {
            const user = req.session.user;
            const attendanceId = Number(req.params.attendanceId);
            const { message, requestedStatus } = req.body;

            if (!message || String(message).trim().length < 2) {
                return res.status(400).json({ message: "message는 2글자 이상 필요합니다." });
            }
            if (requestedStatus !== undefined && !isValidRequestedStatus(requestedStatus)) {
                return res.status(400).json({ message: "requestedStatus는 1~4 중 하나여야 합니다." });
            }

            const attendance = await Attendance.findByPk(attendanceId);
            if (!attendance) return res.status(404).json({ message: "attendance 없음" });

            // 본인 출석에 대해서만 신청
            if (Number(attendance.studentId) !== Number(user.id)) {
                return res.status(403).json({ message: "본인 출석에 대해서만 이의신청 가능" });
            }

            // 이미 PENDING 이의신청이 있으면 막기(중복 방지)
            const exists = await Appeal.findOne({
                where: { attendanceId, studentId: user.id, status: "PENDING" },
            });
            if (exists) return res.status(409).json({ message: "이미 처리 대기중인 이의신청이 있습니다." });

            const appeal = await Appeal.create({
                attendanceId,
                studentId: user.id,
                message: String(message).trim(),
                requestedStatus: requestedStatus !== undefined ? Number(requestedStatus) : null,
                status: "PENDING",
            });

            // ✅ (선택) 담당교원에게 이의신청 생성 알림
            try {
                const att = await Attendance.findByPk(attendanceId, {
                    include: [
                        {
                            model: ClassSession,
                            as: "session",
                            required: true,
                            include: [{ model: Course, as: "course", required: true }],
                        },
                    ],
                });

                const course = att?.session?.course;
                const session = att?.session;

                if (course?.instructorId) {
                    const title = "이의신청이 도착했습니다";
                    const msg = `${course.title} ${session.week}주차 ${session.round}회차 출석 이의신청이 등록되었습니다. (studentId=${user.id})`;
                    await notifyUser(
                        {
                            userId: course.instructorId,
                            type: "APPEAL_REQUESTED",
                            title,
                            message: msg,
                            linkUrl: `/appeals/${appeal.id}`,
                        },
                        null
                    );
                }
            } catch (err) {
                console.error("notification create failed (APPEAL_REQUESTED):", err);
            }

            return res.status(201).json({ appeal });
        } catch (e) {
            console.error(e);
            return res.status(500).json({ message: "서버 에러" });
        }
    }
);

// =========================
// 학생: 내 이의신청 목록
// GET /me/appeals
// =========================
router.get("/me/appeals", requireLogin, requireRole("STUDENT"), async (req, res) => {
    try {
        const user = req.session.user;

        const list = await Appeal.findAll({
            where: { studentId: user.id },
            order: [["createdAt", "DESC"]],
        });

        res.json({ count: list.length, list });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

// =========================
// 교원/관리자: 이의신청 목록
// GET /appeals?status=PENDING&courseId=1
// - INSTRUCTOR는 본인 과목 것만
// =========================
router.get(
    "/appeals",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        try {
            const user = req.session.user;
            const status = req.query.status ? String(req.query.status).toUpperCase() : null;
            const courseId = req.query.courseId ? Number(req.query.courseId) : null;

            if (status && !["PENDING", "ACCEPTED", "REJECTED"].includes(status)) {
                return res.status(400).json({ message: "status는 PENDING|ACCEPTED|REJECTED" });
            }

            const whereAppeal = {};
            if (status) whereAppeal.status = status;

            const whereCourse = {};
            if (courseId) whereCourse.id = courseId;
            if (user.role === "INSTRUCTOR") whereCourse.instructorId = user.id;

            const list = await Appeal.findAll({
                where: whereAppeal,
                include: [
                    {
                        model: Attendance,
                        as: "attendance",
                        required: true,
                        include: [
                            {
                                model: ClassSession,
                                as: "session",
                                required: true,
                                include: [
                                    { model: Course, as: "course", required: true, where: whereCourse },
                                ],
                            },
                        ],
                    },
                ],
                order: [["createdAt", "DESC"]],
            });

            res.json({ count: list.length, list });
        } catch (e) {
            console.error(e);
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

// =========================
// 상세 조회
// GET /appeals/:id
// =========================
router.get("/appeals/:id", requireLogin, async (req, res) => {
    try {
        const user = req.session.user;

        const appeal = await Appeal.findByPk(req.params.id, {
            include: [
                {
                    model: Attendance,
                    as: "attendance",
                    required: true,
                    include: [
                        {
                            model: ClassSession,
                            as: "session",
                            required: true,
                            include: [{ model: Course, as: "course", required: true }],
                        },
                    ],
                },
            ],
        });

        if (!appeal) return res.status(404).json({ message: "appeal 없음" });

        const course = appeal.attendance.session.course;

        if (user.role === "STUDENT") {
            if (Number(appeal.studentId) !== Number(user.id)) {
                return res.status(403).json({ message: "본인 이의신청만 조회 가능" });
            }
        } else if (user.role === "INSTRUCTOR") {
            if (Number(course.instructorId) !== Number(user.id)) {
                return res.status(403).json({ message: "본인 과목 이의신청만 조회 가능" });
            }
        } else if (user.role !== "ADMIN") {
            return res.status(403).json({ message: "권한 없음" });
        }

        res.json({ appeal });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "서버 에러" });
    }
});

// =========================
// 교원/관리자: 이의신청 처리
// PATCH /appeals/:id
// body: { status: "ACCEPTED"|"REJECTED", replyText?, applyAttendanceStatus? }
// - 처리 결과 학생 알림 + AuditLog + (ACCEPTED면 Attendance 변경)
// =========================
router.patch(
    "/appeals/:id",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        const t = await sequelize.transaction();
        try {
            const user = req.session.user;
            const { status, replyText, applyAttendanceStatus } = req.body;

            const nextStatus = status ? String(status).toUpperCase() : null;
            if (!["ACCEPTED", "REJECTED"].includes(nextStatus)) {
                await t.rollback();
                return res.status(400).json({ message: "status는 ACCEPTED 또는 REJECTED" });
            }

            const appeal = await Appeal.findByPk(req.params.id, {
                transaction: t,
                lock: t.LOCK.UPDATE,
                include: [
                    {
                        model: Attendance,
                        as: "attendance",
                        required: true,
                        include: [
                            {
                                model: ClassSession,
                                as: "session",
                                required: true,
                                include: [{ model: Course, as: "course", required: true }],
                            },
                        ],
                    },
                ],
            });

            if (!appeal) {
                await t.rollback();
                return res.status(404).json({ message: "appeal 없음" });
            }

            if (appeal.status !== "PENDING") {
                await t.rollback();
                return res.status(400).json({ message: "이미 처리된 이의신청입니다." });
            }

            const course = appeal.attendance.session.course;
            const session = appeal.attendance.session;

            if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
                await t.rollback();
                return res.status(403).json({ message: "본인 과목 이의신청만 처리 가능" });
            }

            const beforeAppeal = appeal.toJSON();
            const attendance = appeal.attendance;
            const beforeAttendance = attendance.toJSON();

            let changedAttendance = false;
            let newAttendanceStatus = null;

            if (nextStatus === "ACCEPTED") {
                if (applyAttendanceStatus !== undefined && applyAttendanceStatus !== null) {
                    const n = Number(applyAttendanceStatus);
                    if (![1, 2, 3, 4].includes(n)) {
                        await t.rollback();
                        return res.status(400).json({ message: "applyAttendanceStatus는 1~4" });
                    }
                    newAttendanceStatus = n;
                } else if (appeal.requestedStatus !== null && appeal.requestedStatus !== undefined) {
                    newAttendanceStatus = Number(appeal.requestedStatus);
                }

                if (newAttendanceStatus !== null && [1, 2, 3, 4].includes(newAttendanceStatus)) {
                    if (Number(attendance.status) !== Number(newAttendanceStatus)) {
                        attendance.status = newAttendanceStatus;
                        attendance.checkedAt = attendance.checkedAt || new Date();
                        if ("updatedBy" in attendance) attendance.updatedBy = user.id;
                        await attendance.save({ transaction: t });
                        changedAttendance = true;
                    }
                }
            }

            appeal.status = nextStatus;
            appeal.reviewedBy = user.id;
            appeal.reviewedAt = new Date();
            if (replyText !== undefined) appeal.replyText = String(replyText);

            await appeal.save({ transaction: t });

            const afterAppeal = appeal.toJSON();
            const afterAttendance = attendance.toJSON();

            const auditRows = [];

            auditRows.push({
                targetType: "APPEAL",
                targetId: appeal.id,
                action: nextStatus === "ACCEPTED" ? "ACCEPT" : "REJECT",
                actorId: user.id,
                beforeValue: JSON.stringify({ status: beforeAppeal.status, replyText: beforeAppeal.replyText }),
                afterValue: JSON.stringify({ status: afterAppeal.status, replyText: afterAppeal.replyText }),
            });

            if (nextStatus === "ACCEPTED" && changedAttendance) {
                auditRows.push({
                    targetType: "ATTENDANCE",
                    targetId: attendance.id,
                    action: "UPDATE",
                    actorId: user.id,
                    beforeValue: JSON.stringify({ status: beforeAttendance.status }),
                    afterValue: JSON.stringify({ status: afterAttendance.status }),
                });
            }

            if (AuditLog && auditRows.length) {
                await AuditLog.bulkCreate(auditRows, { transaction: t });
            }

            // ✅ 이의 처리 결과 알림(학생에게) - 트랜잭션 안에서 같이 저장
            try {
                const title = nextStatus === "ACCEPTED" ? "이의신청이 승인되었습니다" : "이의신청이 반려되었습니다";
                let msg = `${course.title} ${session.week}주차 ${session.round}회차 이의신청이 ${
                    nextStatus === "ACCEPTED" ? "승인" : "반려"
                }되었습니다.`;
                if (replyText) msg += `\n처리자 답변: ${String(replyText)}`;

                await notifyUser(
                    {
                        userId: appeal.studentId,
                        type: nextStatus === "ACCEPTED" ? "APPEAL_ACCEPTED" : "APPEAL_REJECTED",
                        title,
                        message: msg,
                        linkUrl: `/appeals/${appeal.id}`,
                    },
                    t
                );
            } catch (err) {
                console.error("notification create failed (APPEAL_RESULT):", err);
            }

            await t.commit();

            return res.json({
                ok: true,
                appeal,
                attendanceChanged: changedAttendance,
                newAttendanceStatus: changedAttendance ? newAttendanceStatus : null,
            });
        } catch (e) {
            console.error(e);
            try { await t.rollback(); } catch (_) {}
            return res.status(500).json({ message: "서버 에러" });
        }
    }
);

module.exports = router;