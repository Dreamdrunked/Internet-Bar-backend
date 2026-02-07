const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

module.exports = (db) => {
  // 获取所有用户 (仅管理员)
  router.get('/', authMiddleware, adminMiddleware, (req, res) => {
    db.query('SELECT id, username, role, created_at FROM users', (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(results);
    });
  });
  
  // 获取单个用户 (仅管理员或本人)
  router.get('/:id', authMiddleware, (req, res) => {
    const { id } = req.params;
    
    // 检查权限 (管理员可以查看任何用户，普通用户只能查看自己)
    if (req.user.role !== 'admin' && req.user.id !== parseInt(id)) {
      return res.status(403).json({ error: '权限不足' });
    }
    
    db.query('SELECT id, username, role, created_at FROM users WHERE id = ?', [id], (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      if (results.length === 0) {
        return res.status(404).json({ error: '用户不存在' });
      }
      
      res.json(results[0]);
    });
  });
  
  // 创建用户 (仅管理员)
  router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
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
            
            res.status(201).json({
              message: '用户创建成功',
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
  
  // 更新用户 (仅管理员或本人)
  router.put('/:id', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const { username, password, role } = req.body;
      
      // 检查权限 (管理员可以更新任何用户，普通用户只能更新自己且不能更改角色)
      if (req.user.role !== 'admin' && (req.user.id !== parseInt(id) || role)) {
        return res.status(403).json({ error: '权限不足' });
      }
      
      // 检查用户是否存在
      db.query('SELECT * FROM users WHERE id = ?', [id], async (err, results) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        if (results.length === 0) {
          return res.status(404).json({ error: '用户不存在' });
        }
        
        const user = results[0];
        
        // 准备更新数据
        const updates = {};
        
        if (username && username !== user.username) {
          // 检查新用户名是否已存在
          const usernameCheck = await new Promise((resolve, reject) => {
            db.query('SELECT id FROM users WHERE username = ? AND id != ?', [username, id], (err, results) => {
              if (err) reject(err);
              resolve(results);
            });
          });
          
          if (usernameCheck.length > 0) {
            return res.status(400).json({ error: '用户名已存在' });
          }
          
          updates.username = username;
        }
        
        if (password) {
          const salt = await bcrypt.genSalt(10);
          updates.password = await bcrypt.hash(password, salt);
        }
        
        if (role && req.user.role === 'admin') {
          updates.role = role === 'admin' ? 'admin' : 'staff';
        }
        
        // 如果没有更新内容
        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ error: '没有提供有效的更新内容' });
        }
        
        // 构建更新SQL
        const updateFields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const updateValues = Object.values(updates);
        updateValues.push(id);
        
        db.query(`UPDATE users SET ${updateFields} WHERE id = ?`, updateValues, (err) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          res.json({
            message: '用户更新成功',
            user: {
              id: parseInt(id),
              ...updates
            }
          });
        });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // 删除用户 (仅管理员)
  router.delete('/:id', authMiddleware, adminMiddleware, (req, res) => {
    const { id } = req.params;
    
    // 防止删除自己
    if (req.user.id === parseInt(id)) {
      return res.status(400).json({ error: '不能删除当前登录的用户' });
    }
    
    db.query('DELETE FROM users WHERE id = ?', [id], (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: '用户不存在' });
      }
      
      res.json({ message: '用户删除成功' });
    });
  });
  
  return router;
};