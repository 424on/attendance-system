const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define(
        "AuditLog",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            targetType: { type: DataTypes.STRING(30), allowNull: false }, // ATTENDANCE, EXCUSE 등
            targetId: { type: DataTypes.INTEGER, allowNull: false },
            action: { type: DataTypes.STRING(30), allowNull: false }, // UPDATE, APPROVE, REJECT
            actorId: { type: DataTypes.INTEGER, allowNull: false }, // 누가 했는지

            beforeValue: { type: DataTypes.JSON, allowNull: true },
            afterValue: { type: DataTypes.JSON, allowNull: true },
        },
        { tableName: "audit_logs", underscored: true, timestamps: true }
    );
};