const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define(
        "Course",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            title: { type: DataTypes.STRING(100), allowNull: false },
            section: { type: DataTypes.STRING(20), allowNull: true },
            semester: { type: DataTypes.STRING(20), allowNull: false }, // 예: 2025-2
            department: { type: DataTypes.STRING(100), allowNull: true },
            instructorId: { type: DataTypes.INTEGER, allowNull: false },
        },
        { tableName: "courses", underscored: true, timestamps: true }
    );
};