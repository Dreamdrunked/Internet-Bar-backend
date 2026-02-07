const jwt = require('jsonwebtoken');

// JWT密钥，在实际应用中应该存储在环境变量中
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

// 验证JWT令牌的中间件
const authMiddleware = (req, res, next) => {
  // 从请求头获取令牌
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  // 如果没有令牌，拒绝访问
  if (!token) {
    return res.status(401).json({ error: '无访问权限，请先登录' });
  }
  
  try {
    // 验证令牌
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // 将用户信息添加到请求对象
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: '令牌无效或已过期，请重新登录' });
  }
};

// 验证管理员权限的中间件
const adminMiddleware = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: '权限不足，需要管理员权限' });
  }
};

module.exports = {
  authMiddleware,
  adminMiddleware
};