const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 导入认证中间件
const { authMiddleware, adminMiddleware } = require('./middleware/auth');

// 导入认证路由
const authRoutes = require('./routes/auth')(db);
app.use('/api/auth', authRoutes);

// 导入用户管理路由
const userRoutes = require('./routes/users')(db);
app.use('/api/users', userRoutes);

// 导入上机记录路由
const usageRecordsRoutes = require('./routes/usage-records')(db);
app.use('/api/usage-records', usageRecordsRoutes);

// 导入收入统计路由
const incomeRoutes = require('./routes/income')(db);
app.use('/api/income', incomeRoutes);

// 导入机位管理路由
const machinesRoutes = require('./routes/machines')(db);
app.use('/api/machines', machinesRoutes);

// 会员路由 - 需要认证
app.get('/api/members', authMiddleware, (req, res) => {
  db.query('SELECT * FROM members', (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

// 获取单个会员信息
app.get('/api/members/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  
  db.query('SELECT * FROM members WHERE id = ?', [id], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: '会员不存在' });
    }
    
    res.json(results[0]);
  });
});

app.post('/api/members', authMiddleware, (req, res) => {
  const { name, phone, balance } = req.body;
  db.query('INSERT INTO members (name, phone, balance) VALUES (?, ?, ?)', [name, phone, balance || 0], (err, results) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.status(201).json({ id: results.insertId, name, phone, balance });
    }
  });
});

app.put('/api/members/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { name, phone, balance } = req.body;
  
  // 验证输入
  if (!name && !phone && balance === undefined) {
    return res.status(400).json({ error: '至少需要提供一个要更新的字段' });
  }
  
  // 首先检查会员是否存在
  db.query('SELECT * FROM members WHERE id = ?', [id], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: '会员不存在' });
    }
    
    const member = results[0];
    
    // 准备更新数据
    const updatedName = name !== undefined ? name : member.name;
    const updatedPhone = phone !== undefined ? phone : member.phone;
    const updatedBalance = balance !== undefined ? balance : member.balance;
    
    // 验证电话号码格式
    if (phone && !/^\d{11}$/.test(phone)) {
      return res.status(400).json({ error: '电话号码格式不正确，应为11位数字' });
    }
    
    // 验证余额是否为有效数字
    if (balance !== undefined && (isNaN(parseFloat(balance)) || parseFloat(balance) < 0)) {
      return res.status(400).json({ error: '余额必须是大于等于0的数字' });
    }
    
    // 更新会员信息
    db.query(
      'UPDATE members SET name=?, phone=?, balance=? WHERE id=?', 
      [updatedName, updatedPhone, updatedBalance, id], 
      (err, result) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        if (result.affectedRows === 0) {
          return res.status(404).json({ error: '会员更新失败' });
        }
        
        res.json({ 
          message: '会员信息更新成功',
          member: {
            id: parseInt(id),
            name: updatedName,
            phone: updatedPhone,
            balance: updatedBalance
          }
        });
      }
    );
  });
});

// 会员充值接口
app.post('/api/members/:id/recharge', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;
  
  // 验证充值金额
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: '充值金额必须是大于0的数字' });
  }
  
  const rechargeAmount = parseFloat(amount);
  
  // 开启事务
  db.getConnection((err, connection) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    connection.beginTransaction(err => {
      if (err) {
        connection.release();
        return res.status(500).json({ error: err.message });
      }

      // 1. 查询会员当前余额
      connection.query('SELECT balance FROM members WHERE id = ?', [id], (err, results) => {
        if (err) {
          return connection.rollback(() => {
            connection.release();
            res.status(500).json({ error: err.message });
          });
        }

        if (results.length === 0) {
          return connection.rollback(() => {
            connection.release();
            res.status(404).json({ error: '会员不存在' });
          });
        }

        const currentBalance = parseFloat(results[0].balance) || 0;
        const newBalance = currentBalance + rechargeAmount;

        // 2. 更新会员余额
        connection.query('UPDATE members SET balance = ? WHERE id = ?', [newBalance, id], (err) => {
          if (err) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: err.message });
            });
          }

          // 提交事务
          connection.commit(err => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).json({ error: err.message });
              });
            }

            connection.release();
            // 返回充值成功信息和新余额
          res.json({
            message: '充值成功',
            memberId: id,
            rechargeAmount,
            previousBalance: currentBalance,
            newBalance
          });
        });
      });
    });
  });
});
});

app.delete('/api/members/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  // 开启事务处理
  db.getConnection((err, connection) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    connection.beginTransaction(err => {
      if (err) {
        connection.release();
        return res.status(500).json({ error: err.message });
      }

      // 1. 检查会员是否存在
      connection.query('SELECT id FROM members WHERE id = ?', [id], (err, results) => {
        if (err) {
          return connection.rollback(() => {
            connection.release();
            res.status(500).json({ error: err.message });
          });
        }

        if (results.length === 0) {
          return connection.rollback(() => {
            connection.release();
            res.status(404).json({ error: '会员不存在' });
          });
        }

        // 2. 检查该会员是否正在使用机位
        connection.query('SELECT id FROM machines WHERE member_id = ? AND status = "使用中"', [id], (err, results) => {
          if (err) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: err.message });
            });
          }

          // 如果会员正在使用机位，则不允许删除
          if (results.length > 0) {
            return connection.rollback(() => {
              connection.release();
              res.status(400).json({ error: '该会员正在使用机位，无法删除' });
            });
          }

          // 3. 解除所有机位关联
          connection.query('UPDATE machines SET member_id = NULL, status = "空闲" WHERE member_id = ?', [id], (err) => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).json({ error: err.message });
              });
            }

            // 4. 删除使用记录
            connection.query('DELETE FROM usage_records WHERE member_id = ?', [id], (err) => {
              if (err) {
                return connection.rollback(() => {
                  connection.release();
                  res.status(500).json({ error: err.message });
                });
              }

              // 5. 删除会员
              connection.query('DELETE FROM members WHERE id = ?', [id], (err) => {
                if (err) {
                  return connection.rollback(() => {
                    connection.release();
                    res.status(500).json({ error: err.message });
                  });
                }

                // 提交事务
                connection.commit(err => {
                  if (err) {
                    return connection.rollback(() => {
                      connection.release();
                      res.status(500).json({ error: err.message });
                    });
                  }

                  connection.release();
                  res.json({ message: '会员删除成功' });
                });
            });
          });
        });
      });
    });
  });
})
});

// 机位路由 - 需要认证
app.get('/api/machines', authMiddleware, (req, res) => {
  // 获取机位信息，包括会员姓名（如果有）和机位单价
  const query = `
    SELECT m.id, m.machine_number, m.status, m.member_id, m.start_time, m.hourly_rate, mem.name as member_name
    FROM machines m
    LEFT JOIN members mem ON m.member_id = mem.id
  `;
  db.query(query, (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

app.put('/api/machines/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const { status, member_id, hourly_rate } = req.body;
  let start_time = null;
  if (status === '使用中') {
    start_time = new Date();
  }
  
  // 开启事务
  db.getConnection((err, connection) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    connection.beginTransaction(err => {
      if (err) {
        connection.release();
        return res.status(500).json({ error: err.message });
      }

      // 首先检查机位当前状态
      connection.query('SELECT * FROM machines WHERE id = ?', [id], (err, results) => {
        if (err) {
          return connection.rollback(() => {
            connection.release();
            res.status(500).json({ error: err.message });
          });
        }

        if (results.length === 0) {
          return connection.rollback(() => {
            connection.release();
            res.status(404).json({ error: '机位不存在' });
          });
        }

        const machine = results[0];

        // 如果机位当前有人使用，且要修改状态，则需要先让用户下机
        if (machine.status === '使用中' && machine.member_id && status && status !== '使用中') {
          // 查找未结束的上机记录
          connection.query(
            'SELECT id FROM usage_records WHERE machine_id = ? AND end_time IS NULL',
            [id],
            (err, recordResults) => {
              if (err) {
                return connection.rollback(() => {
                  connection.release();
                  res.status(500).json({ error: err.message });
                });
              }

              if (recordResults.length > 0) {
                return connection.rollback(() => {
                  connection.release();
                  res.status(400).json({
                    error: '该机位有人正在使用，请先让用户下机后再修改状态',
                    machine_id: id,
                    current_status: machine.status
                  });
                });
              }

              // 如果没有未结束的上机记录，但状态是"使用中"，这是一种异常情况
              // 可以继续更新机位状态
              proceedWithUpdate();
            }
          );
        } else {
          // 如果机位空闲或者不需要修改状态，直接更新
          proceedWithUpdate();
        }
      
      function proceedWithUpdate() {
        // 构建更新查询
        let query = 'UPDATE machines SET';
        const params = [];
        
        // 添加状态更新
        if (status !== undefined) {
          query += ' status=?';
          params.push(status);
        }
        
        // 添加会员ID更新
        if (member_id !== undefined) {
          query += params.length > 0 ? ', member_id=?' : ' member_id=?';
          params.push(member_id);
        }
        
        // 添加开始时间更新
        if (status === '使用中' || status === undefined) {
          query += params.length > 0 ? ', start_time=?' : ' start_time=?';
          params.push(start_time);
        }
        
        // 添加单价更新
        if (hourly_rate !== undefined) {
          query += params.length > 0 ? ', hourly_rate=?' : ' hourly_rate=?';
          params.push(hourly_rate);
        }
        
        // 添加WHERE条件
        query += ' WHERE id=?';
        params.push(id);

        connection.query(query, params, (err) => {
          if (err) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: err.message });
            });
          }

          // 提交事务
          connection.commit(err => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).json({ error: err.message });
              });
            }

            connection.release();
            res.json({ message: '机位更新成功' });
          });
        });
      }
    });
  });
});
});

// 专门用于修改单个机位单价的接口
app.patch('/api/machines/:id/hourly-rate', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  const { hourly_rate } = req.body;
  
  // 验证单价参数
  if (hourly_rate === undefined || hourly_rate === null) {
    return res.status(400).json({ error: '单价参数不能为空' });
  }
  
  // 验证单价是否为有效数字
  const rate = parseFloat(hourly_rate);
  if (isNaN(rate) || rate < 0) {
    return res.status(400).json({ error: '单价必须是有效的正数' });
  }
  
  // 更新机位单价
  db.query('UPDATE machines SET hourly_rate = ? WHERE id = ?', [rate, id], (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '未找到指定机位' });
    }
    
    // 查询更新后的机位信息
    db.query('SELECT id, machine_number, hourly_rate FROM machines WHERE id = ?', [id], (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      res.json({
        message: '机位单价更新成功',
        machine: results[0]
      });
    });
  });
});

// 批量修改机位单价的接口
app.patch('/api/machines/batch/hourly-rate', authMiddleware, adminMiddleware, (req, res) => {
  const { machine_ids, hourly_rate } = req.body;
  
  // 验证参数
  if (!Array.isArray(machine_ids) || machine_ids.length === 0) {
    return res.status(400).json({ error: '机位ID列表不能为空' });
  }
  
  if (hourly_rate === undefined || hourly_rate === null) {
    return res.status(400).json({ error: '单价参数不能为空' });
  }
  
  // 验证单价是否为有效数字
  const rate = parseFloat(hourly_rate);
  if (isNaN(rate) || rate < 0) {
    return res.status(400).json({ error: '单价必须是有效的正数' });
  }
  
  // 构建SQL查询条件
  const placeholders = machine_ids.map(() => '?').join(',');
  
  // 开始事务
  db.getConnection((err, connection) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    connection.beginTransaction(err => {
      if (err) {
        connection.release();
        return res.status(500).json({ error: err.message });
      }

      // 更新机位单价
      connection.query(`UPDATE machines SET hourly_rate = ? WHERE id IN (${placeholders})`, [rate, ...machine_ids], (err, result) => {
        if (err) {
          return connection.rollback(() => {
            connection.release();
            res.status(500).json({ error: err.message });
          });
        }

        if (result.affectedRows === 0) {
          return connection.rollback(() => {
            connection.release();
            res.status(404).json({ error: '未找到指定机位' });
          });
        }

        // 查询更新后的机位信息
        connection.query(`SELECT id, machine_number, hourly_rate FROM machines WHERE id IN (${placeholders})`, machine_ids, (err, results) => {
          if (err) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: err.message });
            });
          }

          // 提交事务
          connection.commit(err => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).json({ error: err.message });
              });
            }

            connection.release();
            res.json({
              message: `成功更新${result.affectedRows}个机位的单价`,
              machines: results
            });
          });
        });
      });
    });
  });
});

// 按机位类型批量修改单价的接口
app.patch('/api/machines/type/hourly-rate', authMiddleware, adminMiddleware, (req, res) => {
  const { type_prefix, hourly_rate } = req.body;
  
  // 验证参数
  if (!type_prefix || typeof type_prefix !== 'string') {
    return res.status(400).json({ error: '机位类型前缀不能为空' });
  }
  
  if (hourly_rate === undefined || hourly_rate === null) {
    return res.status(400).json({ error: '单价参数不能为空' });
  }
  
  // 验证单价是否为有效数字
  const rate = parseFloat(hourly_rate);
  if (isNaN(rate) || rate < 0) {
    return res.status(400).json({ error: '单价必须是有效的正数' });
  }
  
  // 开始事务
  db.getConnection((err, connection) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    connection.beginTransaction(err => {
      if (err) {
        connection.release();
        return res.status(500).json({ error: err.message });
      }

      // 更新机位单价
      connection.query('UPDATE machines SET hourly_rate = ? WHERE machine_number LIKE ?', [rate, `${type_prefix}%`], (err, result) => {
        if (err) {
          return connection.rollback(() => {
            connection.release();
            res.status(500).json({ error: err.message });
          });
        }

        if (result.affectedRows === 0) {
          return connection.rollback(() => {
            connection.release();
            res.status(404).json({ error: `未找到前缀为 ${type_prefix} 的机位` });
          });
        }

        // 查询更新后的机位信息
        connection.query('SELECT id, machine_number, hourly_rate FROM machines WHERE machine_number LIKE ?', [`${type_prefix}%`], (err, results) => {
          if (err) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: err.message });
            });
          }

          // 提交事务
          connection.commit(err => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).json({ error: err.message });
              });
            }

            connection.release();

            res.json({
              message: `成功更新${result.affectedRows}个机位的单价`,
              machines: results
            });
          });
        });
      });
    });
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});