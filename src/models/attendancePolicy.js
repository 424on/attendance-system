module.exports = (sequelize, DataTypes) => {
    const AttendancePolicy = sequelize.define(
        "AttendancePolicy",
        {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

            courseId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                unique: true,
            },

            lateToAbsent: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 3, // 지각 3회 -> 결석 1회
            },

            wPresent: {
                type: DataTypes.DECIMAL(5, 2),
                allowNull: false,
                defaultValue: 1.0,
            },
            wLate: {
                type: DataTypes.DECIMAL(5, 2),
                allowNull: false,
                defaultValue: 0.5,
            },
            wAbsent: {
                type: DataTypes.DECIMAL(5, 2),
                allowNull: false,
                defaultValue: 0.0,
            },
            wExcused: {
                type: DataTypes.DECIMAL(5, 2),
                allowNull: false,
                defaultValue: 1.0,
            },

            maxScore: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 20,
            },

            // Attendance 레코드가 없는 경우(미체크)를 결석으로 볼지
            missingAsAbsent: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
            },
        },
        {
            tableName: "attendance_policies",
            underscored: true,
            timestamps: true,
        }
    );

    return AttendancePolicy;
};