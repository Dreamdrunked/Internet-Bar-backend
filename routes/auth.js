const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

// JWT密钥，在实际应用中应该存储在环境变量中
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

module.exports = (db) => {
  // 用户注册
  router.post('/register', async (req, res) => {
    try {
      const { username, password, role } = req.body;
      
      // 验证输入
      if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
      }
      
      // 检查用户名是否已存在
      db.query('SELECT id FROM users WHERE username = ?', [username], async (err, results) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        if (results.length > 0) {
          return res.status(400).json({ error: '用户名已存在' });
        }
        
        // 哈希密码
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        // 创建新用户
        const userRole = role === 'admin' ? 'admin' : 'staff';
        
        db.query(
          'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
          [username, hashedPassword, userRole],
          (err, result) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            
            // 生成JWT
            const token = jwt.sign(
              { id: result.insertId, username, role: userRole },
              JWT_SECRET,
              { expiresIn: '24h' }
            );

  // 修改密码
  router.post('/change-password', async (req, res) => {
    try {
      const { username, oldPassword, newPassword } = req.body;

      // 验证输入
      if (!username || !oldPassword || !newPassword) {
        return res.status(400).json({ error: '用户名、旧密码和新密码不能为空' });
      }

      // 查找用户
      db.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (results.length === 0) {
          return res.status(401).json({ error: '用户名或密码错误' });
        }

        const user = results[0];

        // 验证旧密码
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) {
          return res.status(401).json({ error: '用户名或密码错误' });
        }

        // 哈希新密码
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // 更新密码
        db.query(
          'UPDATE users SET password = ? WHERE username = ?',
          [hashedPassword, username],
          (err, result) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            res.status(200).json({ message: '密码修改成功' });
          }
        );
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
            
            res.status(201).json({
              message: '用户注册成功',
              token,
              user: {
                id: result.insertId,
                username,
                role: userRole
              }
            });
          }
        );
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // 用户登录
  router.post('/login', (req, res) => {
    try {
      // 打印请求头和请求体内容
      console.log('请求头:', req.headers);
      console.log('请求体内容:', req.body);
      
      // 检查请求体是否为空
      if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({ error: '请求体不能为空' });
      }
      
      const { username, password } = req.body;
      
      // 验证输入
      if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
      }
      
      // 查找用户
      db.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        if (results.length === 0) {
          return res.status(401).json({ error: '用户名或密码错误' });
        }
        
        const user = results[0];
        
        // 验证密码
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (!isMatch) {
          return res.status(401).json({ error: '用户名或密码错误' });
        }
        
        // 生成JWT
        const token = jwt.sign(
          { id: user.id, username: user.username, role: user.role },
          JWT_SECRET,
          { expiresIn: '24h' }
        );
        
        res.json({
          message: '登录成功',
          token,
          user: {
            id: user.id,
            username: user.username,
            role: user.role
          }
        });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  return router;
};