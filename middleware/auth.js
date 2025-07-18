const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'kehuxinxi_secret';

module.exports = function (req, res, next) {
  // 允许登录和注册接口不鉴权
  if (
    (req.path === '/api/users/login' || req.path === '/api/users/register') && req.method === 'POST'
  ) {
    return next();
  }
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未携带有效token' });
  }
  const token = authHeader.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, message: 'token无效或已过期' });
  }
}; 