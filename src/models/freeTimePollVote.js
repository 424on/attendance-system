const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    return sequelize.define(
        "FreeTimePollVote",
        {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            pollId: { type: DataTypes.INTEGER, allowNull: false },
            optionId: { type: DataTypes.INTEGER, allowNull: false },
            voterId: { type: DataTypes.INTEGER, allowNull: false },
        },
        {
            tableName: "free_time_poll_votes",
            underscored: true,
            timestamps: true,
            indexes: [
                { unique: true, fields: ["poll_id", "voter_id"] }, // 학생 1명당 1표(재투표=업데이트)
            ],
        }
    );
};