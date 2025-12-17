const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const requireRole = require("../src/middlewares/requireRole");

const {
    sequelize,
    ExcuseRequest,
    ClassSession,
    Course,
    Enrollment,
    Attendance,
    AuditLog,
    Notification,
    User,
} = require("../src/models");

const router = express.Router();

// ===== 알림 유틸 =====
async function notifyUser({ userId, type, title, message, linkUrl = null }, t) {
    if (!Notification) return;
    await Notification.create(
        {
            userId,
            type,
            title,
            message,
            linkUrl,
            isRead: false,
        },
        t ? { transaction: t } : undefined
    );
}

// =========================
// (A) 학생: 공결 신청
// POST /sessions/:id/excuses
// body: { reasonCode?, reasonText?, filePath? }
// =========================
router.post(
    "/sessions/:id/excuses",
    requireLogin,
    requireRole("STUDENT"),
    async (req, res) => {
        try {
            const user = req.session.user;
            const sessionId = Number(req.params.id);

            const { reasonCode = "ETC", reasonText = "", filePath = null } = req.body;

            const session = await ClassSession.findByPk(sessionId);
            if (!session) return res.status(404).json({ message: "세션 없음" });

            // 수강생 확인
            const enr = await Enrollment.findOne({
                where: { courseId: session.courseId, studentId: user.id },
            });
            if (!enr) return res.status(403).json({ message: "수강생만 공결 신청 가능" });

            // 중복 PENDING 방지
            const exists = await ExcuseRequest.findOne({
                where: { sessionId, studentId: user.id, status: "PENDING" },
            });
            if (exists) return res.status(409).json({ message: "이미 처리 대기중인 공결 신청이 있습니다." });

            const excuse = await ExcuseRequest.create({
                sessionId,
                studentId: user.id,
                reasonCode,
                reasonText,
                filePath,
                status: "PENDING",
            });

            // ✅ (선택) 담당교원에게 공결 신청 알림
            try {
                const course = await Course.findByPk(session.courseId);
                if (course?.instructorId) {
                    const title = "공결 신청이 도착했습니다";
                    const msg = `세션(${session.week}주차 ${session.round}회차)에 공결 신청이 등록되었습니다. (studentId=${user.id})`;
                    await notifyUser(
                        {
                            userId: course.instructorId,
                            type: "EXCUSE_REQUESTED",
                            title,
                            message: msg,
                            linkUrl: `/excuses/${excuse.id}`,
                        },
                        null
                    );
                }
            } catch (err) {
                console.error("notification create failed (EXCUSE_REQUESTED):", err);
            }

            return res.status(201).json({ excuse });
        } catch (e) {
            console.error(e);
            return res.status(500).json({ message: "서버 에러" });
        }
    }
);

// =========================
// (B) 교원/관리자: 공결 신청 처리
// PATCH /excuses/:id
// body: { status: "APPROVED"|"REJECTED", replyText? }
// - 승인 시 Attendance를 status=4(공결)로 자동 변경
// - AuditLog 남김
// - ✅ 처리 결과를 학생에게 Notification으로 알림
// =========================
router.patch(
    "/excuses/:id",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        const t = await sequelize.transaction();
        try {
            const user = req.session.user;
            const excuseId = Number(req.params.id);
            const { status, replyText } = req.body;

            const nextStatus = status ? String(status).toUpperCase() : null;
            if (!["APPROVED", "REJECTED"].includes(nextStatus)) {
                await t.rollback();
                return res.status(400).json({ message: "status는 APPROVED 또는 REJECTED" });
            }

            const excuse = await ExcuseRequest.findByPk(excuseId, {
                transaction: t,
                lock: t.LOCK.UPDATE,
            });
            if (!excuse) {
                await t.rollback();
                return res.status(404).json({ message: "공결 신청 없음" });
            }

            if (excuse.status !== "PENDING") {
                await t.rollback();
                return res.status(400).json({ message: "이미 처리된 공결 신청입니다." });
            }

            const session = await ClassSession.findByPk(excuse.sessionId, { transaction: t });
            if (!session) {
                await t.rollback();
                return res.status(404).json({ message: "세션 없음" });
            }

            const course = await Course.findByPk(session.courseId, { transaction: t });
            if (!course) {
                await t.rollback();
                return res.status(404).json({ message: "과목 없음" });
            }

            // 교원은 본인 과목만 처리 가능
            if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
                await t.rollback();
                return res.status(403).json({ message: "본인 과목 공결만 처리 가능" });
            }

            // BEFORE 스냅샷
            const beforeExcuse = excuse.toJSON();

            // 공결 처리 저장
            excuse.status = nextStatus;
            excuse.reviewedBy = user.id;
            excuse.reviewedAt = new Date();
            if (replyText !== undefined) excuse.replyText = String(replyText);

            await excuse.save({ transaction: t });

            // 승인 시 Attendance 자동 변경(공결=4)
            let attendanceChanged = false;
            let attendanceRow = null;
            let beforeAttendance = null;
            let afterAttendance = null;

            if (nextStatus === "APPROVED") {
                const [attendance, created] = await Attendance.findOrCreate({
                    where: { sessionId: session.id, studentId: excuse.studentId },
                    defaults: {
                        status: 4,
                        checkedAt: new Date(),
                        updatedBy: user.id,
                    },
                    transaction: t,
                });

                attendanceRow = attendance;
                beforeAttendance = attendance.toJSON();

                if (!created) {
                    if (Number(attendance.status) !== 4) {
                        attendance.status = 4;
                        attendance.checkedAt = attendance.checkedAt || new Date();
                        if ("updatedBy" in attendance) attendance.updatedBy = user.id;
                        await attendance.save({ transaction: t });
                        attendanceChanged = true;
                    }
                } else {
                    attendanceChanged = true;
                }

                afterAttendance = attendance.toJSON();
            }

            // AuditLog
            const auditRows = [];

            auditRows.push({
                targetType: "EXCUSE",
                targetId: excuse.id,
                action: nextStatus === "APPROVED" ? "APPROVE" : "REJECT",
                actorId: user.id,
                beforeValue: JSON.stringify({ status: beforeExcuse.status, replyText: beforeExcuse.replyText }),
                afterValue: JSON.stringify({ status: excuse.status, replyText: excuse.replyText }),
            });

            if (nextStatus === "APPROVED" && attendanceChanged && attendanceRow) {
                auditRows.push({
                    targetType: "ATTENDANCE",
                    targetId: attendanceRow.id,
                    action: "UPDATE",
                    actorId: user.id,
                    beforeValue: JSON.stringify({ status: beforeAttendance?.status }),
                    afterValue: JSON.stringify({ status: afterAttendance?.status }),
                });
            }

            if (AuditLog && auditRows.length) {
                await AuditLog.bulkCreate(auditRows, { transaction: t });
            }

            // ✅ 공결 처리 결과 알림(학생에게) - 트랜잭션 안에서 같이 저장
            try {
                const title = nextStatus === "APPROVED" ? "공결이 승인되었습니다" : "공결이 반려되었습니다";
                let msg = `${course.title} ${session.week}주차 ${session.round}회차 공결 신청이 ${
                    nextStatus === "APPROVED" ? "승인" : "반려"
                }되었습니다.`;
                if (replyText) msg += `\n처리자 답변: ${String(replyText)}`;

                await notifyUser(
                    {
                        userId: excuse.studentId,
                        type: nextStatus === "APPROVED" ? "EXCUSE_APPROVED" : "EXCUSE_REJECTED",
                        title,
                        message: msg,
                        linkUrl: `/excuses/${excuse.id}`,
                    },
                    t
                );
            } catch (err) {
                console.error("notification create failed (EXCUSE_RESULT):", err);
            }

            await t.commit();

            return res.json({
                ok: true,
                excuse,
                attendanceChanged,
            });
        } catch (e) {
            console.error(e);
            try { await t.rollback(); } catch (_) {}
            return res.status(500).json({ message: "서버 에러" });
        }
    }
);

module.exports = router;