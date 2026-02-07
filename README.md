# 网吧管理系统后端

这是一个基于 Express 和 JWT 认证的网吧管理系统后端。

## 功能特性

- JWT 认证和授权
- 用户管理（管理员/员工）
- 会员管理
- 机位管理
- 权限控制

## 技术栈

- Node.js
- Express
- MySQL
- JWT (JSON Web Token)
- bcryptjs (密码加密)

## 安装和运行

### 前提条件

- Node.js (v14+)
- MySQL 数据库

### 安装步骤

1. 克隆仓库或下载代码

2. 安装依赖
```
npm install
```

3. 配置环境变量
创建 `.env` 文件，并设置以下变量：
```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=internet_cafe
PORT=5000
JWT_SECRET=your_secret_key
```

4. 初始化数据库
```
node init-db.js
```

5. 启动服务器
```
npm start
```

开发模式（使用 nodemon 自动重启）：
```
npm run dev
```

## API 接口

### 认证接口

- `POST /api/auth/register` - 注册新用户
- `POST /api/auth/login` - 用户登录

### 用户管理接口

- `GET /api/users` - 获取所有用户（仅管理员）
- `GET /api/users/:id` - 获取单个用户
- `POST /api/users` - 创建新用户（仅管理员）
- `PUT /api/users/:id` - 更新用户信息
- `DELETE /api/users/:id` - 删除用户（仅管理员）

### 会员管理接口

- `GET /api/members` - 获取所有会员
- `POST /api/members` - 添加新会员
- `PUT /api/members/:id` - 更新会员信息
- `DELETE /api/members/:id` - 删除会员（仅管理员）

### 机位管理接口

- `GET /api/machines` - 获取所有机位
- `PUT /api/machines/:id` - 更新机位状态

## 默认账户

系统初始化后会创建一个默认管理员账户：

- 用户名：admin
- 密码：admin123

## 前端页面

系统提供了简单的前端页面用于测试：

- `/` - 首页
- `/login.html` - 登录页面
- `/register.html` - 注册页面
- `/dashboard.html` - 仪表盘（需要登录）