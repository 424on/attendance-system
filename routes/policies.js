const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const requireRole = require("../src/middlewares/requireRole");
const { sequelize, Course, Enrollment, ClassSession, Attendance, AttendancePolicy, User } = require("../src/models");

const router = express.Router();

function ensureCourseOwner(user, course) {
    if (user.role === "ADMIN") return true;
    if (user.role === "INSTRUCTOR" && Number(course.instructorId) === Number(user.id)) return true;
    return false;
}

// 기본 정책(정책 테이블이 없을 때 fallback)
function defaultPolicy(courseId) {
    return {
        courseId,
        lateToAbsent: 3,
        wPresent: 1.0,
        wLate: 0.5,
        wAbsent: 0.0,
        wExcused: 1.0,
        maxScore: 20,
        missingAsAbsent: true,
    };
}

// 1) 정책 조회
// GET /courses/:courseId/policy  (INSTRUCTOR/ADMIN)
router.get(
    "/courses/:courseId/policy",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        try {
            const user = req.session.user;
            const courseId = Number(req.params.courseId);

            const course = await Course.findByPk(courseId);
            if (!course) return res.status(404).json({ message: "과목 없음" });
            if (!ensureCourseOwner(user, course)) return res.status(403).json({ message: "권한 없음" });

            const policy = await AttendancePolicy.findOne({ where: { courseId } });
            res.json({ courseId, policy: policy ? policy : defaultPolicy(courseId) });
        } catch (e) {
            console.error(e);
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

// 2) 정책 생성/수정(업서트)
// PUT /courses/:courseId/policy (INSTRUCTOR/ADMIN)
router.put(
    "/courses/:courseId/policy",
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
            if (!ensureCourseOwner(user, course)) {
                await t.rollback();
                return res.status(403).json({ message: "권한 없음" });
            }

            const {
                lateToAbsent,
                wPresent,
                wLate,
                wAbsent,
                wExcused,
                maxScore,
                missingAsAbsent,
            } = req.body;

            // 간단 검증
            if (lateToAbsent !== undefined && Number(lateToAbsent) < 1) {
                await t.rollback();
                return res.status(400).json({ message: "lateToAbsent는 1 이상" });
            }
            if (maxScore !== undefined && Number(maxScore) < 1) {
                await t.rollback();
                return res.status(400).json({ message: "maxScore는 1 이상" });
            }

            const [policy, created] = await AttendancePolicy.findOrCreate({
                where: { courseId },
                defaults: { ...defaultPolicy(courseId) },
                transaction: t,
            });

            const patch = {};
            if (lateToAbsent !== undefined) patch.lateToAbsent = Number(lateToAbsent);
            if (wPresent !== undefined) patch.wPresent = Number(wPresent);
            if (wLate !== undefined) patch.wLate = Number(wLate);
            if (wAbsent !== undefined) patch.wAbsent = Number(wAbsent);
            if (wExcused !== undefined) patch.wExcused = Number(wExcused);
            if (maxScore !== undefined) patch.maxScore = Number(maxScore);
            if (missingAsAbsent !== undefined) patch.missingAsAbsent = Boolean(missingAsAbsent);

            await policy.update(patch, { transaction: t });
            await t.commit();

            res.json({ ok: true, created, policy });
        } catch (e) {
            console.error(e);
            try { await t.rollback(); } catch (_) {}
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

// 3) 출석 점수/통계 계산 (과목 전체)
// GET /courses/:courseId/score/attendance (INSTRUCTOR/ADMIN)
router.get(
    "/courses/:courseId/score/attendance",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        try {
            const user = req.session.user;
            const courseId = Number(req.params.courseId);

            const course = await Course.findByPk(courseId);
            if (!course) return res.status(404).json({ message: "과목 없음" });
            if (!ensureCourseOwner(user, course)) return res.status(403).json({ message: "권한 없음" });

            const policyRow = await AttendancePolicy.findOne({ where: { courseId } });
            const policy = policyRow ? policyRow.toJSON() : defaultPolicy(courseId);

            // 세션 목록
            const sessions = await ClassSession.findAll({
                where: { courseId },
                attributes: ["id"],
            });
            const sessionIds = sessions.map(s => Number(s.id));
            const totalSessions = sessionIds.length;

            // 수강생
            const enrollments = await Enrollment.findAll({
                where: { courseId },
                attributes: ["studentId"],
            });
            const studentIds = enrollments.map(e => Number(e.studentId));

            // 학생 기본정보(있으면 같이)
            let userMap = new Map();
            try {
                const users = await User.findAll({
                    where: { id: studentIds },
                    attributes: ["id", "name", "email", "department"],
                });
                userMap = new Map(users.map(u => [Number(u.id), u.toJSON()]));
            } catch (_) {
                // User export/모델이 없으면 studentId만 내보냄
            }

            // Attendance 전부 로드
            const attendances = sessionIds.length
                ? await Attendance.findAll({
                    where: { sessionId: sessionIds },
                    attributes: ["sessionId", "studentId", "status"],
                })
                : [];

            // studentId -> {status counts}
            const byStudent = new Map();
            for (const sid of studentIds) {
                byStudent.set(sid, { present: 0, late: 0, absent: 0, excused: 0, unknown: 0 });
            }

            // (studentId, sessionId) 단위로 상태 맵
            const statusMap = new Map(); // key `${sid}:${sessId}` -> status
            for (const a of attendances) {
                const sid = Number(a.studentId);
                const sessId = Number(a.sessionId);
                if (!byStudent.has(sid)) continue;
                statusMap.set(`${sid}:${sessId}`, Number(a.status || 0));
            }

            // 누락/미정 처리 포함 카운팅
            for (const sid of studentIds) {
                const cnt = byStudent.get(sid);
                for (const sessId of sessionIds) {
                    const st = statusMap.get(`${sid}:${sessId}`) ?? null;

                    if (st === 1) cnt.present++;
                    else if (st === 2) cnt.late++;
                    else if (st === 3) cnt.absent++;
                    else if (st === 4) cnt.excused++;
                    else {
                        // st가 0이거나 레코드가 없음
                        if (policy.missingAsAbsent) cnt.absent++;
                        else cnt.unknown++;
                    }
                }
            }

            // 점수 계산(+ 지각->결석 변환)
            const rows = [];
            for (const sid of studentIds) {
                const cnt = byStudent.get(sid);

                // 변환
                const lateToAbsent = Number(policy.lateToAbsent || 1);
                const convertedAbs = Math.floor(cnt.late / lateToAbsent);
                const lateRemain = cnt.late % lateToAbsent;

                const absentFinal = cnt.absent + convertedAbs;

                // raw 점수(세션당 점수 합)
                const raw =
                    cnt.present * Number(policy.wPresent) +
                    lateRemain * Number(policy.wLate) +
                    absentFinal * Number(policy.wAbsent) +
                    cnt.excused * Number(policy.wExcused);

                // 정규화(총 세션 수로 나눠 만점 환산)
                const score =
                    totalSessions > 0
                        ? (raw / totalSessions) * Number(policy.maxScore)
                        : 0;

                const u = userMap.get(sid);

                rows.push({
                    studentId: sid,
                    name: u?.name || null,
                    email: u?.email || null,
                    department: u?.department || null,

                    totalSessions,
                    present: cnt.present,
                    lateOriginal: cnt.late,
                    lateRemain,
                    absentOriginal: cnt.absent,
                    absentConvertedFromLate: convertedAbs,
                    absentFinal,
                    excused: cnt.excused,
                    unknown: cnt.unknown,

                    raw,
                    score: Number(score.toFixed(2)),
                });
            }

            // 점수 순 정렬(선택)
            rows.sort((a, b) => b.score - a.score);

            res.json({
                courseId,
                policy,
                totalSessions,
                count: rows.length,
                rows,
            });
        } catch (e) {
            console.error(e);
            res.status(500).json({ message: "서버 에러" });
        }
    }
);

module.exports = router;