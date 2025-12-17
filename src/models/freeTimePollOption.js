const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define(
        "FreeTimePollOption",
        {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            pollId: { type: DataTypes.INTEGER, allowNull: false },
            label: { type: DataTypes.STRING(100), allowNull: false }, // 예: "12/20(금) 14:00-15:00"
            startAt: { type: DataTypes.DATE, allowNull: true },
            endAt: { type: DataTypes.DATE, allowNull: true },
        },
        {
            tableName: "free_time_poll_options",
            underscored: true,
            timestamps: true,
            indexes: [{ fields: ["poll_id"] }],
        }
    );
};