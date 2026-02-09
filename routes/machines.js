const express = require('express');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

module.exports = (db) => {
  // 获取所有机位
  router.get('/', authMiddleware, (req, res) => {
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

  // 添加机位
  router.post('/add', authMiddleware, adminMiddleware, (req, res) => {
    const { machine_number, hourly_rate } = req.body;

    // 验证输入
    if (!machine_number) {
      return res.status(400).json({ error: '机位编号不能为空' });
    }

    if (hourly_rate === undefined || hourly_rate === null) {
      return res.status(400).json({ error: '单价参数不能为空' });
    }

    // 验证单价是否为有效数字
    const rate = parseFloat(hourly_rate);
    if (isNaN(rate) || rate < 0) {
      return res.status(400).json({ error: '单价必须是有效的正数' });
    }

    // 检查机位编号是否已存在
    db.query('SELECT id FROM machines WHERE machine_number = ?', [machine_number], (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (results.length > 0) {
        return res.status(400).json({ error: '机位编号已存在' });
      }

      // 创建新机位
      db.query(
        'INSERT INTO machines (machine_number, hourly_rate, status) VALUES (?, ?, ?)',
        [machine_number, rate, '空闲'],
        (err, result) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          res.status(201).json({
            message: '机位创建成功',
            machine: {
              id: result.insertId,
              machine_number,
              hourly_rate: rate,
              status: '空闲'
            }
          });
        }
      );
    });
  });

  // 更新机位信息
  router.put('/:id', authMiddleware, (req, res) => {
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
  router.patch('/:id/hourly-rate', authMiddleware, adminMiddleware, (req, res) => {
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
  router.patch('/batch/hourly-rate', authMiddleware, adminMiddleware, (req, res) => {
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
  router.patch('/type/hourly-rate', authMiddleware, adminMiddleware, (req, res) => {
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

  // 删除机位
  router.delete('/:id', authMiddleware, adminMiddleware, (req, res) => {
    const { id } = req.params;

    // 检查机位是否正在使用
    db.query('SELECT * FROM machines WHERE id = ?', [id], (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: '机位不存在' });
      }

      const machine = results[0];

      if (machine.status === '使用中') {
        return res.status(400).json({ error: '该机位正在使用中，无法删除' });
      }

      // 删除机位
      db.query('DELETE FROM machines WHERE id = ?', [id], (err, result) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (result.affectedRows === 0) {
          return res.status(404).json({ error: '机位删除失败' });
        }

        res.json({ message: '机位删除成功' });
      });
    });
  });

  return router;
};
