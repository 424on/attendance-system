const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define(
        "ExcuseRequest",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            sessionId: { type: DataTypes.INTEGER, allowNull: false },
            studentId: { type: DataTypes.INTEGER, allowNull: false },

            reasonCode: {
                type: DataTypes.ENUM("SICK", "OFFICIAL", "ETC"),
                allowNull: false,
                defaultValue: "ETC",
            },
            reasonText: { type: DataTypes.TEXT, allowNull: true },

            status: {
                type: DataTypes.ENUM("PENDING", "APPROVED", "REJECTED"),
                allowNull: false,
                defaultValue: "PENDING",
            },

            filePath: { type: DataTypes.STRING(255), allowNull: true }, // 업로드된 파일 경로
            reviewerComment: { type: DataTypes.TEXT, allowNull: true },
        },
        { tableName: "excuse_requests", underscored: true, timestamps: true }
    );
};