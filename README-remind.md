# 客户跟进超期提醒功能说明

## 功能概述

系统已实现完整的客户跟进超期提醒功能，能够根据用户配置的不同意向等级的天数来自动发送邮件提醒。

## 功能特性

### 1. 自动定时检查
- **执行时间**: 每天上午9点自动执行
- **检查内容**: 根据配置的天数检查所有线索的跟进情况
- **提醒方式**: 自动发送邮件给配置的收件人列表

### 2. 意向等级配置
- **高意向**: 默认1天未跟进即提醒
- **中意向**: 默认3天未跟进即提醒  
- **低意向**: 默认5天未跟进即提醒
- **可自定义**: 每个等级的天数都可以单独配置

### 3. 邮件提醒功能
- **收件人管理**: 支持配置多个收件人邮箱
- **邮件内容**: 按意向等级分组显示超期线索
- **详细信息**: 包含客户昵称、跟进人、最后跟进时间、超期天数等

## 配置步骤

### 1. 配置邮件服务
在 `.env` 文件中配置邮件服务信息：
```
EMAIL_HOST=smtp.163.com
EMAIL_PORT=465
EMAIL_USER=your-email@163.com
EMAIL_PASS=your-password
EMAIL_FROM=your-email@163.com
```

### 2. 配置收件人邮箱
使用API接口添加收件人邮箱：
```bash
POST /api/remind-email-list
{
  "email": "recipient@example.com"
}
```

### 3. 配置提醒天数
使用API接口配置各意向等级的提醒天数：
```bash
# 配置高意向提醒天数
PUT /api/followup-remind-config/高
{
  "interval_days": 1
}

# 配置中意向提醒天数
PUT /api/followup-remind-config/中
{
  "interval_days": 3
}

# 配置低意向提醒天数
PUT /api/followup-remind-config/低
{
  "interval_days": 5
}
```

## API接口

### 1. 获取提醒配置
```bash
GET /api/followup-remind-config
```

### 2. 更新提醒配置
```bash
PUT /api/followup-remind-config/:level
{
  "interval_days": 3
}
```

### 3. 手动触发检查
```bash
POST /api/followup-remind-config/trigger-check
```

### 4. 收件人邮箱管理
```bash
# 获取收件人列表
GET /api/remind-email-list

# 添加收件人
POST /api/remind-email-list
{
  "email": "new@example.com"
}

# 删除收件人
DELETE /api/remind-email-list/:id
```

## 测试功能

### 1. 运行测试脚本
```bash
node test-remind.js
```

### 2. 手动触发检查
```bash
curl -X POST http://localhost:3000/api/followup-remind-config/trigger-check
```

## 邮件内容示例

系统发送的邮件包含以下信息：
- 按意向等级分组的超期线索
- 每个线索的详细信息（客户昵称、跟进人、最后跟进时间、超期天数）
- 清晰的表格格式展示
- 支持HTML和纯文本格式

## 注意事项

1. **收件人配置**: 必须至少配置一个收件人邮箱才能发送邮件
2. **邮件服务**: 确保邮件服务配置正确，建议使用163邮箱或QQ邮箱
3. **定时执行**: 系统启动后会自动设置定时任务，每天上午9点执行
4. **手动触发**: 可以通过API接口手动触发检查，用于测试或紧急情况
5. **日志记录**: 所有检查结果和邮件发送状态都会记录在控制台日志中

## 故障排除

### 1. 邮件发送失败
- 检查邮件服务配置是否正确
- 确认邮箱密码是否为授权码（不是登录密码）
- 检查网络连接是否正常

### 2. 没有收到提醒邮件
- 确认是否配置了收件人邮箱
- 检查是否有超期线索
- 查看控制台日志确认检查是否正常执行

### 3. 定时任务不执行
- 确认服务器时间是否正确
- 检查应用是否正常运行
- 查看启动日志确认定时任务是否已启动 