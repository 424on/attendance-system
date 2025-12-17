module.exports = function requireRole(...roles) {
    return (req, res, next) => {
        const user = req.session?.user;
        if (!user || !roles.includes(user.role)) {
            return res.status(403).json({ message: "권한이 없습니다." });
        }
        next();
    };
};