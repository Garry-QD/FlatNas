import jwt from "jsonwebtoken";

export const authenticateToken = (secret) => (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, secret, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

export const checkSingleUser = (req, res, next) => {
  // Logic to allow single-user mode access if configured
  next();
};
