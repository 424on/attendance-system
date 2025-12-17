const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define(
        "ClassSession",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            courseId: { type: DataTypes.INTEGER, allowNull: false },
            week: { type: DataTypes.INTEGER, allowNull: false },
            round: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
            startAt: { type: DataTypes.DATE, allowNull: true },
            endAt: { type: DataTypes.DATE, allowNull: true },
            room: { type: DataTypes.STRING(50), allowNull: true },
            attendanceMethod: {
                type: DataTypes.ENUM("ELECTRONIC", "CODE"),
                allowNull: false,
                defaultValue: "ELECTRONIC",
            },
            status: {
                type: DataTypes.ENUM("OPEN", "CLOSED"),
                allowNull: false,
                defaultValue: "CLOSED",
            },
            code: { type: DataTypes.STRING(10), allowNull: true }, // CODE 방식일 때만
        },
        { tableName: "class_sessions", underscored: true, timestamps: true }
    );
};