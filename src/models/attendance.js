const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define(
        "Attendance",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            sessionId: { type: DataTypes.INTEGER, allowNull: false },
            studentId: { type: DataTypes.INTEGER, allowNull: false },
            status: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, // 0~4
            checkedAt: { type: DataTypes.DATE, allowNull: true },
            updatedBy: { type: DataTypes.INTEGER, allowNull: true },
        },
        {
            tableName: "attendances",
            underscored: true,
            timestamps: true,
            indexes: [{ unique: true, fields: ["session_id", "student_id"] }],
        }
    );
};