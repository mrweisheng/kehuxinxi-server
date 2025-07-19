const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// 用户注册
router.post('/register', userController.register);
// 用户登录
router.post('/login', userController.login);
// 用户列表
router.get('/', userController.list);
// 获取所有销售用户
router.get('/sales', userController.listSalesUsers);
// 用户详情
router.get('/:id', userController.detail);
// 修改用户
router.put('/:id', userController.update);
// 删除用户
router.delete('/:id', userController.remove);

module.exports = router; 