const express = require("express");
const requireLogin = require("../src/middlewares/requireLogin");
const requireRole = require("../src/middlewares/requireRole");
const { User } = require("../src/models");

const router = express.Router();

router.get("/users", requireLogin, requireRole("ADMIN"), async (req, res) => {
    const users = await User.findAll({ attributes: ["id", "role", "email", "name"] });
    res.json({ users });
});

module.exports = router;