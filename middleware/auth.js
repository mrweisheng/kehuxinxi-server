const jwt = require('jsonwebtoken');

// JWT密钥安全检查
if (!process.env.JWT_SECRET) {
  console.error('❌ 安全警告：未设置JWT_SECRET环境变量！请在.env文件中设置强密钥');
  console.error('建议使用：node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))" 生成随机密钥');
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;

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