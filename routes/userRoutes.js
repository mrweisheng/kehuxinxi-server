const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/auth');

// 用户注册
router.post('/register', userController.register);
// 用户登录
router.post('/login', userController.login);
// 用户列表 - 需要管理员权限
router.get('/', authMiddleware, userController.list);
// 获取所有销售用户 - 需要登录
router.get('/sales', authMiddleware, userController.listSalesUsers);
// 用户详情 - 需要登录
router.get('/:id', authMiddleware, userController.detail);
// 修改用户 - 需要登录
router.put('/:id', authMiddleware, userController.update);
// 删除用户 - 需要登录
router.delete('/:id', authMiddleware, userController.remove);

module.exports = router; 