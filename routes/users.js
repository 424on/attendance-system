const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  return sequelize.define(
      "User",
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        email: { type: DataTypes.STRING(100), allowNull: false, unique: true },
        name: { type: DataTypes.STRING(50), allowNull: false },

        role: {
          type: DataTypes.ENUM("ADMIN", "INSTRUCTOR", "STUDENT"),
          allowNull: false,
        },

        department: { type: DataTypes.STRING(50), allowNull: true },

        // ✅ 속성명은 passwordHash로 통일(코드에서 쓰기 편함)
        passwordHash: {
          type: DataTypes.STRING(255),
          allowNull: false,
          field: "password_hash",
        },
      },
      {
        tableName: "users",
        underscored: true,
        timestamps: true,
      }
  );
};