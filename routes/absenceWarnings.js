const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const requireRole = require("../src/middlewares/requireRole");

const {
    sequelize,
    Course,
    Enrollment,
    Attendance,
    ClassSession,
    Notification,
    AttendancePolicy, // 없으면 undefined일 수 있음
} = require("../src/models");

const router = express.Router();

// ===== 기본 임계값(정책 없을 때) =====
const DEFAULT_THRESHOLDS = {
    warnAbsences: 2,
    dangerAbsences: 4,
    failAbsences: 6,
    lateToAbsent: 3, // 지각 3번 = 결석 1회로 환산
};

function pickPolicy(policyRow) {
    if (!policyRow) return { ...DEFAULT_THRESHOLDS };

    const p = policyRow.toJSON ? policyRow.toJSON() : policyRow;

    return {
        warnAbsences: Number(p.warnAbsences ?? DEFAULT_THRESHOLDS.warnAbsences),
        dangerAbsences: Number(p.dangerAbsences ?? DEFAULT_THRESHOLDS.dangerAbsences),
        failAbsences: Number(p.failAbsences ?? DEFAULT_THRESHOLDS.failAbsences),
        lateToAbsent: Number(p.lateToAbsent ?? DEFAULT_THRESHOLDS.lateToAbsent),
    };
}

function decideLevel(absEq, thresholds) {
    if (absEq >= thresholds.failAbsences) return "FAIL";
    if (absEq >= thresholds.dangerAbsences) return "DANGER";
    if (absEq >= thresholds.warnAbsences) return "WARN";
    return null;
}

function buildTitle(level) {
    if (level === "WARN") return "결석 누적 경고";
    if (level === "DANGER") return "결석 누적 위험";
    return "결석 누적 한계";
}

function buildType(level) {
    if (level === "WARN") return "ABSENCE_WARN";
    if (level === "DANGER") return "ABSENCE_DANGER";
    return "ABSENCE_FAIL";
}

// 중복 방지: 같은 (userId,type,title,linkUrl) 있으면 생성 X
async function createNotificationIfNotExists(payload, t) {
    const exists = await Notification.findOne({
        where: {
            userId: payload.userId,
            type: payload.type,
            title: payload.title,
            linkUrl: payload.linkUrl || null,
        },
        transaction: t,
    });
    if (exists) return { created: false };

    await Notification.create(
        {
            ...payload,
            isRead: false,
        },
        { transaction: t }
    );

    return { created: true };
}

// =============================
// POST /admin/absence-warnings/run
// body(옵션):
// {
//   semester: "2025-2",
//   department: "소프트웨어",
//   courseId: 1,
//   dryRun: false
// }
// =============================
router.post(
    "/admin/absence-warnings/run",
    requireLogin,
    requireRole("ADMIN", "INSTRUCTOR"),
    async (req, res) => {
        const t = await sequelize.transaction();
        try {
            const user = req.session.user;
            const {
                semester = "2025-2",
                department = "소프트웨어",
                courseId,
                dryRun = false,
            } = req.body || {};

            // 1) 대상 과목 가져오기
            const whereCourse = {};
            if (courseId) whereCourse.id = Number(courseId);
            else {
                whereCourse.semester = semester;
                whereCourse.department = department;
            }

            if (user.role === "INSTRUCTOR") {
                whereCourse.instructorId = user.id; // 본인 과목만
            }

            const courses = await Course.findAll({ where: whereCourse, transaction: t });
            if (courses.length === 0) {
                await t.rollback();
                return res.json({ ok: true, message: "대상 과목 없음", created: 0, checkedCourses: 0 });
            }

            let createdCount = 0;
            let skippedCount = 0;
            let checkedStudents = 0;

            const perCourseSummary = [];

            for (const course of courses) {
                // 2) 정책(있으면) 로딩
                let thresholds = { ...DEFAULT_THRESHOLDS };
                try {
                    if (AttendancePolicy) {
                        const policy = await AttendancePolicy.findOne({
                            where: { courseId: course.id },
                            transaction: t,
                        });
                        thresholds = pickPolicy(policy);
                    }
                } catch (e) {
                    // 정책 테이블/컬럼이 완벽하지 않아도 경고 알림 기능 자체는 돌아가게
                    thresholds = { ...DEFAULT_THRESHOLDS };
                }

                // 3) 수강생 목록
                const enrollments = await Enrollment.findAll({
                    where: { courseId: course.id },
                    attributes: ["studentId"],
                    transaction: t,
                });
                const studentIds = enrollments.map((e) => Number(e.studentId)).filter(Boolean);
                if (studentIds.length === 0) {
                    perCourseSummary.push({ courseId: course.id, created: 0, skipped: 0, students: 0 });
                    continue;
                }

                // 4) 출석 데이터(해당 과목 세션에 대한 Attendance만)
                const rows = await Attendance.findAll({
                    where: { studentId: studentIds },
                    include: [
                        {
                            model: ClassSession,
                            as: "session",
                            required: true,
                            attributes: ["id", "courseId"],
                            where: { courseId: course.id },
                        },
                    ],
                    transaction: t,
                });

                // 5) 학생별 집계
                const map = new Map(); // studentId -> {abs, late}
                for (const sid of studentIds) map.set(sid, { abs: 0, late: 0 });

                for (const a of rows) {
                    const sid = Number(a.studentId);
                    if (!map.has(sid)) continue;

                    if (Number(a.status) === 3) map.get(sid).abs += 1; // 결석
                    else if (Number(a.status) === 2) map.get(sid).late += 1; // 지각
                }

                let courseCreated = 0;
                let courseSkipped = 0;

                for (const [sid, stat] of map.entries()) {
                    checkedStudents++;

                    const lateToAbsent = Math.max(1, Number(thresholds.lateToAbsent || 3));
                    const absEq = stat.abs + Math.floor(stat.late / lateToAbsent);

                    const level = decideLevel(absEq, thresholds);
                    if (!level) continue;

                    const title = buildTitle(level);
                    const type = buildType(level);

                    const msg =
                        `${course.title} (${course.semester}, ${course.department})\n` +
                        `현재 결석(환산) ${absEq}회 (결석 ${stat.abs} / 지각 ${stat.late}, 지각 ${lateToAbsent}회=결석 1회)\n` +
                        `상태: ${level}\n` +
                        `담당교원/조교에게 문의하세요.`;

                    const payload = {
                        userId: sid,
                        type,
                        title,
                        message: msg,
                        linkUrl: `/courses/${course.id}`,
                    };

                    if (dryRun) {
                        courseSkipped++;
                        continue;
                    }

                    const r = await createNotificationIfNotExists(payload, t);
                    if (r.created) {
                        createdCount++;
                        courseCreated++;
                    } else {
                        skippedCount++;
                        courseSkipped++;
                    }
                }

                perCourseSummary.push({
                    courseId: course.id,
                    courseTitle: course.title,
                    students: studentIds.length,
                    created: courseCreated,
                    skipped: courseSkipped,
                    thresholds,
                });
            }

            if (dryRun) {
                await t.rollback();
                return res.json({
                    ok: true,
                    dryRun: true,
                    checkedCourses: courses.length,
                    checkedStudents,
                    created: 0,
                    skipped: skippedCount,
                    perCourseSummary,
                });
            }

            await t.commit();
            return res.json({
                ok: true,
                checkedCourses: courses.length,
                checkedStudents,
                created: createdCount,
                skipped: skippedCount,
                perCourseSummary,
            });
        } catch (e) {
            console.error(e);
            try { await t.rollback(); } catch (_) {}
            return res.status(500).json({ message: "서버 에러" });
        }
    }
);

module.exports = router;