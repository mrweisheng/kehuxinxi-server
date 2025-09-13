const User = require('../models/user');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// JWT密钥安全检查
if (!process.env.JWT_SECRET) {
  console.error('❌ 安全警告：未设置JWT_SECRET环境变量！请在.env文件中设置强密钥');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'; // token有效期

// 注册
exports.register = async (req, res) => {
  try {
    const { username, password, nickname, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ code: 400, message: '用户名和密码必填' });
    }
    const exist = await User.findOne({ where: { username } });
    if (exist) {
      return res.status(400).json({ code: 400, message: '用户名已存在' });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hash, nickname, role });
    res.json({ code: 0, message: '注册成功', data: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ code: 500, message: '注册失败', error: err.message });
  }
};

// 登录
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ code: 400, message: '用户名和密码必填' });
    }
    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(400).json({ code: 400, message: '用户不存在' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ code: 400, message: '密码错误' });
    }
    const token = jwt.sign({ id: user.id, username: user.username, nickname: user.nickname, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ code: 0, message: '登录成功', data: { token, user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role } } });
  } catch (err) {
    res.status(500).json({ code: 500, message: '登录失败', error: err.message });
  }
};

// 用户列表（仅管理员可访问）
exports.list = async (req, res) => {
  try {
    // 权限检查：仅管理员可以查看用户列表
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ 
        code: 403, 
        message: '您没有权限查看用户列表，仅管理员可访问' 
      });
    }
    
    const users = await User.findAll({ attributes: { exclude: ['password'] } });
    res.json({ code: 0, data: users.map(user => user.toJSON()) });
  } catch (err) {
    res.status(500).json({ code: 500, message: '查询失败', error: err.message });
  }
};

// 用户详情（仅管理员或本人可访问）
exports.detail = async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id);
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;
    
    // 权限检查：仅管理员或本人可以查看用户详情
    if (currentUserRole !== 'admin' && currentUserId !== targetUserId) {
      return res.status(403).json({ 
        code: 403, 
        message: '您没有权限查看该用户信息' 
      });
    }
    
    const user = await User.findByPk(targetUserId, { attributes: { exclude: ['password'] } });
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
    res.json({ code: 0, data: user.toJSON() });
  } catch (err) {
    res.status(500).json({ code: 500, message: '查询失败', error: err.message });
  }
};

// 修改用户（仅管理员或本人可修改，角色修改仅管理员）
exports.update = async (req, res) => {
  try {
    const { nickname, role, password } = req.body;
    const targetUserId = parseInt(req.params.id);
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;
    
    // 权限检查：仅管理员或本人可以修改用户信息
    if (currentUserRole !== 'admin' && currentUserId !== targetUserId) {
      return res.status(403).json({ 
        code: 403, 
        message: '您没有权限修改该用户信息' 
      });
    }
    
    // 角色修改权限检查：仅管理员可以修改角色
    if (role !== undefined && currentUserRole !== 'admin') {
      return res.status(403).json({ 
        code: 403, 
        message: '只有管理员可以修改用户角色' 
      });
    }
    
    const user = await User.findByPk(targetUserId);
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
    
    if (nickname !== undefined) user.nickname = nickname;
    if (role !== undefined) user.role = role;
    if (password) user.password = await bcrypt.hash(password, 10);
    await user.save();
    res.json({ code: 0, message: '修改成功' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '修改失败', error: err.message });
  }
};

// 删除用户（仅管理员可删除，且不能删除自己）
exports.remove = async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id);
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;
    
    // 权限检查：仅管理员可以删除用户
    if (currentUserRole !== 'admin') {
      return res.status(403).json({ 
        code: 403, 
        message: '只有管理员可以删除用户' 
      });
    }
    
    // 防止管理员删除自己
    if (currentUserId === targetUserId) {
      return res.status(400).json({ 
        code: 400, 
        message: '不能删除自己的账号' 
      });
    }
    
    const user = await User.findByPk(targetUserId);
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
    await user.destroy();
    res.json({ code: 0, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '删除失败', error: err.message });
  }
};

// 获取所有销售用户
exports.listSalesUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { role: 'sales' },
      attributes: { exclude: ['password'] }
    });
    res.json({ code: 0, data: users.map(u => u.toJSON()) });
  } catch (err) {
    res.status(500).json({ code: 500, message: '查询失败', error: err.message });
  }
}; 