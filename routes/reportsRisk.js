const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const requireRole = require("../src/middlewares/requireRole");

const { Course, ClassSession, Attendance, Enrollment, User } = require("../src/models");

const router = express.Router();

function toInt(v, def) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}

/**
 * GET /reports/risk?courseId=1
 * optional:
 *  - absentMin=3 (결석 누적 기준)
 *  - lateStreakMin=3 (연속 지각 기준)
 *  - absentStreakMin=2 (연속 결석 기준)
 *  - lateOrAbsentStreakMin=3 (연속 지각/결석(합친) 기준)
 *  - includeUnknown=true|false (unknown을 streak에 포함할지; 기본 false)
 *
 * 응답:
 *  - sessionsMeta: 세션 정렬 기준(week/round/startAt)
 *  - list: 학생별 누적/최대연속/현재연속 + flag 사유
 */
router.get(
    "/reports/risk",
    requireLogin,
    requireRole("INSTRUCTOR", "ADMIN"),
    async (req, res) => {
        try {
            const user = req.session.user;

            const courseId = Number(req.query.courseId);
            if (!courseId) return res.status(400).json({ message: "courseId가 필요합니다." });

            const absentMin = toInt(req.query.absentMin, 3);
            const lateStreakMin = toInt(req.query.lateStreakMin, 3);
            const absentStreakMin = toInt(req.query.absentStreakMin, 2);
            const lateOrAbsentStreakMin = toInt(req.query.lateOrAbsentStreakMin, 3);
            const includeUnknown = String(req.query.includeUnknown || "false").toLowerCase() === "true";

            const course = await Course.findByPk(courseId);
            if (!course) return res.status(404).json({ message: "과목 없음" });

            // 교원은 본인 과목만
            if (user.role === "INSTRUCTOR" && Number(course.instructorId) !== Number(user.id)) {
                return res.status(403).json({ message: "본인 과목만 조회 가능" });
            }

            // 1) 세션 목록(시간순)
            const sessions = await ClassSession.findAll({
                where: { courseId },
                order: [
                    ["week", "ASC"],
                    ["round", "ASC"],
                    // startAt이 잘 채워져 있다면 이걸로 정렬하는 게 더 정확
                    ["startAt", "ASC"],
                ],
            });

            if (sessions.length === 0) {
                return res.json({
                    courseId,
                    courseTitle: course.title,
                    message: "세션이 없어 위험군 산출 불가",
                    sessionsCount: 0,
                    list: [],
                });
            }

            const sessionIds = sessions.map((s) => Number(s.id));

            // 2) 수강생 목록
            const enrollments = await Enrollment.findAll({
                where: { courseId },
                attributes: ["studentId"],
            });

            const studentIds = enrollments.map((e) => Number(e.studentId)).filter(Boolean);
            if (studentIds.length === 0) {
                return res.json({
                    courseId,
                    courseTitle: course.title,
                    sessionsCount: sessions.length,
                    enrolledCount: 0,
                    list: [],
                });
            }

            const students = await User.findAll({
                where: { id: studentIds },
                attributes: ["id", "name", "email", "department", "role"],
            });
            const studentMap = new Map(students.map((u) => [Number(u.id), u.toJSON()]));

            // 3) 출석 데이터(해당 과목의 세션들)
            const attends = await Attendance.findAll({
                where: { sessionId: sessionIds },
                attributes: ["sessionId", "studentId", "status", "checkedAt"],
            });

            // studentId -> (sessionId -> status)
            const statusMap = new Map();
            for (const sid of studentIds) statusMap.set(sid, new Map());
            for (const a of attends) {
                const sid = Number(a.studentId);
                const sesId = Number(a.sessionId);
                if (!statusMap.has(sid)) continue;
                statusMap.get(sid).set(sesId, Number(a.status));
            }

            // streak 계산 헬퍼
            function calcStreaks(statusSeq) {
                // statusSeq: 세션 순서대로 status 값(없으면 0=unknown)
                let maxLate = 0, maxAbsent = 0, maxLA = 0;
                let curLate = 0, curAbsent = 0, curLA = 0;

                for (const st of statusSeq) {
                    const isUnknown = st === 0;
                    const isLate = st === 2;
                    const isAbsent = st === 3;
                    const isLA = (st === 2 || st === 3) || (includeUnknown && isUnknown);

                    // late streak
                    if (isLate) curLate += 1;
                    else curLate = 0;

                    // absent streak
                    if (isAbsent) curAbsent += 1;
                    else curAbsent = 0;

                    // late-or-absent streak(연속 지각/결석)
                    if (isLA) curLA += 1;
                    else curLA = 0;

                    if (curLate > maxLate) maxLate = curLate;
                    if (curAbsent > maxAbsent) maxAbsent = curAbsent;
                    if (curLA > maxLA) maxLA = curLA;
                }

                // "현재 연속"은 마지막에서부터 다시 계산(끝에서 끊길 때까지)
                let tailLate = 0, tailAbsent = 0, tailLA = 0;
                for (let i = statusSeq.length - 1; i >= 0; i--) {
                    const st = statusSeq[i];
                    const isUnknown = st === 0;
                    const isLate = st === 2;
                    const isAbsent = st === 3;
                    const isLA = (st === 2 || st === 3) || (includeUnknown && isUnknown);

                    if (tailLate === 0 && !isLate) { /* no-op */ }
                    if (tailAbsent === 0 && !isAbsent) { /* no-op */ }
                    if (tailLA === 0 && !isLA) { /* no-op */ }

                    if (isLate) tailLate += 1;
                    else break;
                }
                for (let i = statusSeq.length - 1; i >= 0; i--) {
                    const st = statusSeq[i];
                    if (st === 3) tailAbsent += 1;
                    else break;
                }
                for (let i = statusSeq.length - 1; i >= 0; i--) {
                    const st = statusSeq[i];
                    const isUnknown = st === 0;
                    const isLA = (st === 2 || st === 3) || (includeUnknown && isUnknown);
                    if (isLA) tailLA += 1;
                    else break;
                }

                return {
                    maxLateStreak: maxLate,
                    maxAbsentStreak: maxAbsent,
                    maxLateOrAbsentStreak: maxLA,
                    currentLateStreak: tailLate,
                    currentAbsentStreak: tailAbsent,
                    currentLateOrAbsentStreak: tailLA,
                };
            }

            // 4) 학생별 누적/연속 산출
            const list = [];
            for (const sid of studentIds) {
                const per = statusMap.get(sid) || new Map();

                const statusSeq = sessions.map((s) => {
                    const st = per.get(Number(s.id));
                    return st !== undefined && st !== null ? Number(st) : 0; // 없으면 unknown
                });

                // 누적 카운트
                let present = 0, late = 0, absent = 0, excused = 0, unknown = 0;
                for (const st of statusSeq) {
                    if (st === 1) present++;
                    else if (st === 2) late++;
                    else if (st === 3) absent++;
                    else if (st === 4) excused++;
                    else unknown++;
                }

                const streak = calcStreaks(statusSeq);

                // 위험 플래그
                const flags = [];
                if (absent >= absentMin) flags.push(`결석누적>=${absentMin}`);
                if (streak.maxLateStreak >= lateStreakMin) flags.push(`연속지각>=${lateStreakMin}`);
                if (streak.maxAbsentStreak >= absentStreakMin) flags.push(`연속결석>=${absentStreakMin}`);
                if (streak.maxLateOrAbsentStreak >= lateOrAbsentStreakMin) flags.push(`연속(지각/결석)>=${lateOrAbsentStreakMin}`);

                // 간단 위험 점수(정렬용)
                const riskScore = (absent * 10) + (streak.maxLateOrAbsentStreak * 3) + (late * 2);

                const u = studentMap.get(sid) || { id: sid, name: null, email: null, department: null };

                list.push({
                    student: { id: u.id, name: u.name, email: u.email, department: u.department },
                    totals: { present, late, absent, excused, unknown, sessionsCount: sessions.length },
                    streak,
                    flags,
                    riskScore,
                });
            }

            // 5) “위험군만” 추출 + 정렬
            const riskyOnly = list
                .filter((x) => x.flags.length > 0)
                .sort((a, b) => {
                    if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
                    return (b.totals.absent - a.totals.absent);
                });

            return res.json({
                courseId,
                courseTitle: course.title,
                enrolledCount: studentIds.length,
                sessionsCount: sessions.length,
                filter: { absentMin, lateStreakMin, absentStreakMin, lateOrAbsentStreakMin, includeUnknown },
                sessionsMeta: sessions.map((s) => ({
                    id: s.id,
                    week: s.week,
                    round: s.round,
                    startAt: s.startAt,
                    endAt: s.endAt,
                })),
                count: riskyOnly.length,
                list: riskyOnly,
            });
        } catch (e) {
            console.error(e);
            return res.status(500).json({ message: "서버 에러" });
        }
    }
);

module.exports = router;