@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo           简单文件同步工具
echo ========================================

REM 配置信息
set "LOCAL_DIR=%cd%"
set "REMOTE_USER=root"
set "REMOTE_IP=47.113.177.228"
set "REMOTE_DIR=/root/kehuxinxi-server"

echo 本地目录: %LOCAL_DIR%
echo 远程服务器: %REMOTE_USER%@%REMOTE_IP%
echo 远程目录: %REMOTE_DIR%
echo.

REM 检查项目文件
if not exist "app.js" (
    echo [错误] 未找到 app.js
    goto :end
)

if not exist "package.json" (
    echo [错误] 未找到 package.json
    goto :end
)

echo [步骤1] 上传所有文件...
echo 请输入服务器密码，后续传输将自动进行...

REM 使用一个命令上传所有文件
scp -r app.js package.json package-lock.json config controllers models routes middleware services utils api-doc.txt kehuxinxi.sql README-remind.md %REMOTE_USER%@%REMOTE_IP%:%REMOTE_DIR%/

if %errorlevel% neq 0 (
    echo [错误] 文件上传失败
    goto :end
)

echo [步骤2] 服务器端处理...
ssh %REMOTE_USER%@%REMOTE_IP% "cd %REMOTE_DIR% && npm install --production && pm2 restart kehuxinxi-server"

if %errorlevel% neq 0 (
    echo [错误] 服务器端处理失败
    goto :end
)

echo [完成] 同步成功！

:end
echo.
pause
