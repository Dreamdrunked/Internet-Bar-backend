const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

module.exports = (db) => {
  // 获取所有上机记录
  router.get('/', authMiddleware, (req, res) => {
    // 可以添加查询参数，如按会员ID筛选、按日期范围筛选等
    const { member_id, start_date, end_date, status } = req.query;

    let query = `SELECT ur.id, ur.member_id, ur.machine_id, ur.start_time, ur.end_time, ur.fee,
                       m.name as member_name, mc.machine_number
                FROM usage_records ur
                LEFT JOIN members m ON ur.member_id = m.id
                LEFT JOIN machines mc ON ur.machine_id = mc.id`;
    
    const queryParams = [];
    const conditions = [];
    
    if (member_id) {
      conditions.push('ur.member_id = ?');
      queryParams.push(member_id);
    }
    
    if (start_date) {
      conditions.push('DATE(ur.start_time) >= ?');
      queryParams.push(start_date);
    }
    
    if (end_date) {
      conditions.push('DATE(ur.start_time) <= ?');
      queryParams.push(end_date);
    }
    
    // 添加状态过滤：进行中或已结束
    if (status === 'active') {
      conditions.push('ur.end_time IS NULL');
    } else if (status === 'completed') {
      conditions.push('ur.end_time IS NOT NULL');
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY ur.start_time DESC';
    
    db.query(query, queryParams, (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message, member_id: req.body.member_id });
      }
      res.json(results);
    });
  });
  
  // 开始上机
  router.post('/start', authMiddleware, (req, res) => {
    const { member_id, machine_id } = req.body;
    
    if (!member_id || !machine_id) {
      return res.status(400).json({ error: '会员ID和机位ID不能为空' });
    }
    
    // 开启事务
    db.getConnection((err, connection) => {
      if (err) {
        return res.status(500).json({ error: err.message, member_id: req.body.member_id });
      }

      connection.beginTransaction(err => {
        if (err) {
          connection.release();
          return res.status(500).json({ error: err.message, member_id: req.body.member_id });
        }

        // 1. 检查会员是否存在且没有未结束的上机记录
        connection.query('SELECT * FROM members WHERE id = ?', [member_id], (err, memberResults) => {
          if (err) {
            return connection.rollback(() => {
              connection.release();
              res.status(500).json({ error: err.message, member_id: req.body.member_id });
            });
          }

          if (memberResults.length === 0) {
            return connection.rollback(() => {
              connection.release();
              res.status(404).json({ error: '会员不存在' });
            });
          }

          const member = memberResults[0];

          // 检查会员是否有未结束的上机记录
          connection.query('SELECT * FROM usage_records WHERE member_id = ? AND end_time IS NULL', [member_id], (err, activeRecords) => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).json({ error: err.message, member_id: req.body.member_id });
              });
            }

            if (activeRecords.length > 0) {
              return connection.rollback(() => {
                connection.release();
                res.status(400).json({ error: '该会员已有未结束的上机记录，不能同时使用多个机位' });
              });
            }

            // 2. 检查机位是否存在且空闲
            connection.query('SELECT * FROM machines WHERE id = ?', [machine_id], (err, machineResults) => {
              if (err) {
                return connection.rollback(() => {
                  connection.release();
                  res.status(500).json({ error: err.message, member_id: req.body.member_id });
                });
              }

              if (machineResults.length === 0) {
                return connection.rollback(() => {
                  connection.release();
                  res.status(404).json({ error: '机位不存在' });
                });
              }

              const machine = machineResults[0];

              if (machine.status !== '空闲') {
                return connection.rollback(() => {
                  connection.release();
                  res.status(400).json({ error: '该机位不可用，当前状态: ' + machine.status });
                });
              }

              // 3. 创建上机记录
              const startTime = new Date();

              connection.query(
                'INSERT INTO usage_records (member_id, machine_id, start_time) VALUES (?, ?, ?)',
                [member_id, machine_id, startTime],
                (err, result) => {
                  if (err) {
                    return connection.rollback(() => {
                      connection.release();
                      res.status(500).json({ error: err.message, member_id: req.body.member_id });
                    });
                  }

                  const recordId = result.insertId;

                  // 4. 更新机位状态
                  connection.query(
                    'UPDATE machines SET status = ?, member_id = ?, start_time = ? WHERE id = ?',
                    ['使用中', member_id, startTime, machine_id],
                    (err) => {
                      if (err) {
                        return connection.rollback(() => {
                          connection.release();
                          res.status(500).json({ error: err.message, member_id: req.body.member_id });
                        });
                      }

                      // 提交事务
                      connection.commit(err => {
                        if (err) {
                          return connection.rollback(() => {
                            connection.release();
                            res.status(500).json({ error: err.message, member_id: req.body.member_id });
                          });
                        }

                        connection.release();
                        res.status(201).json({
                          message: '上机成功',
                          record: {
                            id: recordId,
                        member_id,
                        machine_id,
                        start_time: startTime
                      }
                    });
                  });
                }
              );
            }
          );
        });
      });
    });
  })
  });
});
  
  // 结束上机
  router.post('/end', authMiddleware, (req, res) => {
    const { machine_id } = req.body;
    
    if (!machine_id) {
      return res.status(400).json({ error: '机器ID不能为空' });
    }
    
    // 开启事务
    db.getConnection((err, connection) => {
      if (err) {
        return res.status(500).json({ error: err.message, member_id: req.body.member_id });
      }

      connection.beginTransaction(err => {
        if (err) {
          connection.release();
          return res.status(500).json({ error: err.message, member_id: req.body.member_id });
        }

        // 1. 查询未下机的记录及关联的会员ID
        connection.query(
          'SELECT ur.id, ur.member_id, ur.machine_id, ur.start_time FROM usage_records ur WHERE ur.machine_id = ? AND ur.end_time IS NULL',
          [machine_id],
          (err, results) => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).json({ error: err.message });
              });
            }

            if (results.length === 0) {
              return connection.rollback(() => {
                connection.release();
                res.status(400).json({ error: '未找到未下机的记录' });
              });
            }

            const id = results[0].id;
            const member_id = results[0].member_id;
            const record_machine_id = results[0].machine_id;
            const start_time = results[0].start_time;

            if (!member_id) {
              return connection.rollback(() => {
                connection.release();
                res.status(400).json({ error: '未获取到有效的会员ID' });
              });
            }

            const record = { id, member_id, machine_id: record_machine_id, start_time };
            const endTime = new Date();

            // 2. 获取机位单价并计算费用
            if (!record.start_time) {
              return connection.rollback(() => {
                connection.release();
                res.status(400).json({
                  error: '上机开始时间不能为空',
                  details: `记录ID: ${record.id} 未设置开始时间，请检查数据完整性`
                });
              });
            }
            const startTime = new Date(record.start_time);
            if (isNaN(startTime.getTime())) {
              return connection.rollback(() => {
                connection.release();
                res.status(400).json({ error: '无效的上机开始时间格式' });
              });
            }

            // 查询机位单价
            connection.query('SELECT hourly_rate FROM machines WHERE id = ?', [record.machine_id], (err, machineResults) => {
              if (err) {
                return connection.rollback(() => {
                  connection.release();
                  res.status(500).json({ error: err.message });
                });
              }

              if (!machineResults || machineResults.length === 0) {
                return connection.rollback(() => {
                  connection.release();
                  res.status(400).json({ error: '未找到机位信息' });
                });
              }

              const hourlyRate = machineResults[0].hourly_rate || 10; // 默认为10元/小时
              const durationMinutes = Math.ceil((endTime - startTime) / (1000 * 60));
              const fee = (durationMinutes / 60) * hourlyRate;

              if (isNaN(fee)) {
                return connection.rollback(() => {
                  connection.release();
                  res.status(400).json({ error: '费用计算失败' });
                });
              }

              // 3. 检查会员余额
              connection.query('SELECT * FROM members WHERE id = ?', [record.member_id], (err, memberResults) => {
                if (err) {
                  return connection.rollback(() => {
                    connection.release();
                    res.status(500).json({ error: err.message });
                  });
                }

                if (!memberResults || memberResults.length === 0) {
                  return connection.rollback(() => {
                    connection.release();
                    res.status(400).json({ error: '未找到会员信息' });
                  });
                }

                const member = memberResults[0];

                if (member.balance < fee) {
                  return connection.rollback(() => {
                    connection.release();
                    res.status(400).json({ error: '会员余额不足，请先充值' });
                  });
                }

                // 4. 更新上机记录
                connection.query(
                  'UPDATE usage_records SET end_time = ?, fee = ? WHERE id = ?',
                  [endTime, fee, id],
                  (err) => {
                    if (err) {
                      return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ error: err.message });
                      });
                    }

                    // 5. 扣除会员余额
                    connection.query(
                      'UPDATE members SET balance = balance - ? WHERE id = ?',
                      [fee, record.member_id],
                      (err) => {
                        if (err) {
                          return connection.rollback(() => {
                            connection.release();
                            res.status(500).json({ error: err.message, member_id: req.body.member_id });
                          });
                        }

                        // 6. 更新机位状态（清空 member_id 和 start_time）
                        connection.query(
                          'UPDATE machines SET status = ?, member_id = NULL, start_time = NULL WHERE id = ?',
                          ['空闲', record.machine_id],
                          (err) => {
                            if (err) {
                              return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ error: err.message, member_id: req.body.member_id });
                              });
                            }

                            // 提交事务
                            connection.commit(err => {
                              if (err) {
                                return connection.rollback(() => {
                                  connection.release();
                                  res.status(500).json({ error: err.message, member_id: req.body.member_id });
                                });
                              }

                              connection.release();
                              res.json({
                                message: '下机成功',
                            record: {
                              id: id,
                              member_id: record.member_id,
                              machine_id: record.machine_id,
                              start_time: startTime,
                              end_time: endTime,
                              duration_minutes: durationMinutes,
                              hourly_rate: hourlyRate,
                              fee: fee
                            }
                          });
                        });
                      }
                    );
                  }
                );
              }
            );
          });
        }
      );
    });
  })
})
  });
  
  // 获取特定会员的上机记录
  router.get('/member/:id', authMiddleware, (req, res) => {
    const { id } = req.params;
    
    db.query(
      `SELECT ur.id, ur.machine_id, ur.start_time, ur.end_time, ur.fee,
              mc.machine_number
       FROM usage_records ur
       LEFT JOIN machines mc ON ur.machine_id = mc.id
       WHERE ur.member_id = ?
       ORDER BY ur.start_time DESC`,
      [id],
      (err, results) => {
        if (err) {
          return res.status(500).json({ error: err.message, member_id: req.body.member_id });
        }
        res.json(results);
      }
    );
  });
  
  // 获取单个上机记录详情
  router.get('/:id', authMiddleware, (req, res) => {
    const { id } = req.params;
    
    db.query(
      `SELECT ur.id, ur.member_id, ur.machine_id, ur.start_time, ur.end_time, ur.fee,
              m.name as member_name, m.phone as member_phone,
              mc.machine_number, mc.status as machine_status, mc.hourly_rate,
              TIMESTAMPDIFF(MINUTE, ur.start_time, IFNULL(ur.end_time, NOW())) as duration_minutes
       FROM usage_records ur
       LEFT JOIN members m ON ur.member_id = m.id
       LEFT JOIN machines mc ON ur.machine_id = mc.id
       WHERE ur.id = ?`,
      [id],
      (err, results) => {
        if (err) {
          return res.status(500).json({ error: err.message, member_id: req.body.member_id });
        }
        
        if (results.length === 0) {
          return res.status(404).json({ error: '上机记录不存在' });
        }
        
        res.json(results[0]);
      }
    );
  });
  
  // 统计上机记录
  router.get('/stats/summary', authMiddleware, (req, res) => {
    const { start_date, end_date } = req.query;
    
    let query = `
      SELECT 
        DATE(start_time) as date,
        COUNT(*) as total_records,
        SUM(fee) as total_revenue,
        AVG(TIMESTAMPDIFF(MINUTE, start_time, end_time)) as avg_duration_minutes
      FROM usage_records
      WHERE end_time IS NOT NULL`;
    
    const queryParams = [];
    
    if (start_date) {
      query += ' AND DATE(start_time) >= ?';
      queryParams.push(start_date);
    }
    
    if (end_date) {
      query += ' AND DATE(start_time) <= ?';
      queryParams.push(end_date);
    }
    
    query += ' GROUP BY DATE(start_time) ORDER BY date DESC';
    
    db.query(query, queryParams, (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message, member_id: req.body.member_id });
      }
      res.json(results);
    });
  });
  
  // 批量删除上机记录
  router.delete('/batch', authMiddleware, (req, res) => {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '记录ID列表不能为空' });
    }
    
    // 开启事务
    db.getConnection((err, connection) => {
      if (err) {
        return res.status(500).json({ error: err.message, member_id: req.body.member_id });
      }

      connection.beginTransaction(err => {
        if (err) {
          connection.release();
          return res.status(500).json({ error: err.message, member_id: req.body.member_id });
        }

        // 检查是否有正在进行中的记录
        const placeholders = ids.map(() => '?').join(',');
        connection.query(
          `SELECT id FROM usage_records WHERE id IN (${placeholders}) AND end_time IS NULL`,
          ids,
          (err, activeRecords) => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).json({ error: err.message, member_id: req.body.member_id });
              });
            }

            if (activeRecords.length > 0) {
              return connection.rollback(() => {
                connection.release();
                res.status(400).json({
                  error: '无法删除正在进行中的上机记录',
                  active_records: activeRecords.map(r => r.id)
                });
              });
            }

            // 执行删除操作
            connection.query(
              `DELETE FROM usage_records WHERE id IN (${placeholders})`,
              ids,
              (err, result) => {
                if (err) {
                  return connection.rollback(() => {
                    connection.release();
                    res.status(500).json({ error: err.message, member_id: req.body.member_id });
                  });
                }

                // 提交事务
                connection.commit(err => {
                  if (err) {
                    return connection.rollback(() => {
                      connection.release();
                      res.status(500).json({ error: err.message, member_id: req.body.member_id });
                    });
                  }

                    connection.release();
                  res.json({
                    message: '删除成功',
                    deleted_count: result.affectedRows
                  });
                });
              }
            );
          }
        );
      });
    });
  });

  // 按机位统计使用情况
  router.get('/stats/machines', authMiddleware, (req, res) => {
    const { start_date, end_date } = req.query;
    
    let query = `
      SELECT 
        m.id as machine_id,
        m.machine_number,
        COUNT(ur.id) as usage_count,
        SUM(ur.fee) as total_revenue,
        SUM(TIMESTAMPDIFF(MINUTE, ur.start_time, IFNULL(ur.end_time, NOW()))) as total_minutes,
        AVG(TIMESTAMPDIFF(MINUTE, ur.start_time, IFNULL(ur.end_time, NOW()))) as avg_duration_minutes
      FROM machines m
      LEFT JOIN usage_records ur ON m.id = ur.machine_id`;
    
    const queryParams = [];
    const conditions = [];
    
    if (start_date) {
      conditions.push('DATE(ur.start_time) >= ?');
      queryParams.push(start_date);
    }
    
    if (end_date) {
      conditions.push('DATE(ur.start_time) <= ?');
      queryParams.push(end_date);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' GROUP BY m.id, m.machine_number ORDER BY usage_count DESC';
    
    db.query(query, queryParams, (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message, member_id: req.body.member_id });
      }
      res.json(results);
    });
  });
  
  // 按会员统计使用情况
  router.get('/stats/members', authMiddleware, (req, res) => {
    const { start_date, end_date } = req.query;
    
    let query = `
      SELECT 
        m.id as member_id,
        m.name as member_name,
        m.phone as member_phone,
        COUNT(ur.id) as usage_count,
        SUM(ur.fee) as total_spent,
        SUM(TIMESTAMPDIFF(MINUTE, ur.start_time, IFNULL(ur.end_time, NOW()))) as total_minutes,
        AVG(TIMESTAMPDIFF(MINUTE, ur.start_time, IFNULL(ur.end_time, NOW()))) as avg_duration_minutes
      FROM members m
      LEFT JOIN usage_records ur ON m.id = ur.member_id`;
    
    const queryParams = [];
    const conditions = [];
    
    if (start_date) {
      conditions.push('DATE(ur.start_time) >= ?');
      queryParams.push(start_date);
    }
    
    if (end_date) {
      conditions.push('DATE(ur.start_time) <= ?');
      queryParams.push(end_date);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' GROUP BY m.id, m.name, m.phone ORDER BY usage_count DESC';
    
    db.query(query, queryParams, (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message, member_id: req.body.member_id });
      }
      res.json(results);
    });
  });
  
  return router;
};
