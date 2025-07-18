const User = require('../models/user');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'kehuxinxi_secret';
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
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ code: 0, message: '登录成功', data: { token, user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role } } });
  } catch (err) {
    res.status(500).json({ code: 500, message: '登录失败', error: err.message });
  }
};

// 用户列表
exports.list = async (req, res) => {
  try {
    const users = await User.findAll({ attributes: { exclude: ['password'] } });
    res.json({ code: 0, data: users.map(user => user.toJSON()) });
  } catch (err) {
    res.status(500).json({ code: 500, message: '查询失败', error: err.message });
  }
};

// 用户详情
exports.detail = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, { attributes: { exclude: ['password'] } });
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
    res.json({ code: 0, data: user.toJSON() });
  } catch (err) {
    res.status(500).json({ code: 500, message: '查询失败', error: err.message });
  }
};

// 修改用户
exports.update = async (req, res) => {
  try {
    const { nickname, role, password } = req.body;
    const user = await User.findByPk(req.params.id);
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

// 删除用户
exports.remove = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
    await user.destroy();
    res.json({ code: 0, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '删除失败', error: err.message });
  }
};

// 获取所有客服用户
exports.listServiceUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { role: 'service' },
      attributes: { exclude: ['password'] }
    });
    res.json({ code: 0, data: users.map(u => u.toJSON()) });
  } catch (err) {
    res.status(500).json({ code: 500, message: '查询失败', error: err.message });
  }
}; 