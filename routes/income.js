const express = require('express');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

module.exports = (db) => {
  // 获取总收入统计
  router.post('/statistics', authMiddleware, (req, res) => {
    const { start_date, end_date, group_by } = req.body;
    
    let query = `
      SELECT 
        SUM(fee) as total_income
      FROM usage_records
      WHERE end_time IS NOT NULL`;
    
    const queryParams = [];
    
    if (start_date) {
      query += ' AND DATE(start_time) >= ? AND DATE(end_time) >= ?';
      queryParams.push(start_date, start_date);
    }
    
    if (end_date) {
      query += ' AND DATE(start_time) <= ? AND DATE(end_time) <= ?';
      queryParams.push(end_date, end_date);
    }
    
    db.query(query, queryParams, (err, results) => {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
      
      res.json({
        success: true,
        data: {
          total_income: results[0].total_income || 0
        }
      });
    });
  });
  
  // 按日期分组获取收入统计
  router.post('/statistics/daily', authMiddleware, (req, res) => {
    const { start_date, end_date } = req.body;
    
    let query = `
      SELECT 
        DATE(start_time) as date,
        SUM(fee) as daily_income,
        COUNT(*) as record_count
      FROM usage_records
      WHERE end_time IS NOT NULL`;
    
    const queryParams = [];
    
    if (start_date) {
      query += ' AND DATE(start_time) >= ? AND DATE(end_time) >= ?';
      queryParams.push(start_date, start_date);
    }
    
    if (end_date) {
      query += ' AND DATE(start_time) <= ? AND DATE(end_time) <= ?';
      queryParams.push(end_date, end_date);
    }
    
    query += ' GROUP BY DATE(start_time) ORDER BY date DESC';
    
    db.query(query, queryParams, (err, results) => {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
      
      res.json({
        success: true,
        data: results
      });
    });
  });
  
  // 按月份分组获取收入统计
  router.post('/statistics/monthly', authMiddleware, (req, res) => {
    const { start_date, end_date } = req.body;
    
    let query = `
      SELECT 
        DATE_FORMAT(start_time, '%Y-%m') as month,
        SUM(fee) as monthly_income,
        COUNT(*) as record_count
      FROM usage_records
      WHERE end_time IS NOT NULL`;
    
    const queryParams = [];
    
    if (start_date) {
      query += ' AND DATE(start_time) >= ? AND DATE(end_time) >= ?';
      queryParams.push(start_date, start_date);
    }
    
    if (end_date) {
      query += ' AND DATE(start_time) <= ? AND DATE(end_time) <= ?';
      queryParams.push(end_date, end_date);
    }
    
    query += ' GROUP BY DATE_FORMAT(start_time, "%Y-%m") ORDER BY month DESC';
    
    db.query(query, queryParams, (err, results) => {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
      
      res.json({
        success: true,
        data: results
      });
    });
  });
  
  // 按机位类型分组获取收入统计
  router.post('/statistics/machine-type', authMiddleware, (req, res) => {
    const { start_date, end_date } = req.body;
    
    let query = `
      SELECT 
        SUBSTRING(m.machine_number, 1, 1) as machine_type,
        SUM(ur.fee) as type_income,
        COUNT(*) as record_count
      FROM usage_records ur
      JOIN machines m ON ur.machine_id = m.id
      WHERE ur.end_time IS NOT NULL`;
    
    const queryParams = [];
    
    if (start_date) {
      query += ' AND DATE(ur.start_time) >= ?';
      queryParams.push(start_date);
    }
    
    if (end_date) {
      query += ' AND DATE(ur.start_time) <= ?';
      queryParams.push(end_date);
    }
    
    query += ' GROUP BY SUBSTRING(m.machine_number, 1, 1) ORDER BY type_income DESC';
    
    db.query(query, queryParams, (err, results) => {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
      
      res.json({
        success: true,
        data: results
      });
    });
  });
  
  return router;
};