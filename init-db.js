const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// 创建数据库连接
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

// 创建数据库
connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`, (err) => {
  if (err) {
    console.error('创建数据库失败:', err);
    process.exit(1);
  }
  
  console.log(`数据库 ${process.env.DB_NAME} 创建成功或已存在`);
  
  // 切换到新创建的数据库
  connection.changeUser({ database: process.env.DB_NAME }, (err) => {
    if (err) {
      console.error('切换数据库失败:', err);
      process.exit(1);
    }
    
    // 读取并执行SQL文件
    const sqlFiles = [
      path.join(__dirname, 'db', 'users.sql'),
      // 添加其他SQL文件路径
    ];
    
    let completedFiles = 0;
    
    sqlFiles.forEach(filePath => {
      fs.readFile(filePath, 'utf8', (err, sql) => {
        if (err) {
          console.error(`读取SQL文件 ${filePath} 失败:`, err);
          return;
        }
        
        // 执行SQL语句
        connection.query(sql, (err) => {
          if (err) {
            console.error(`执行SQL文件 ${filePath} 失败:`, err);
          } else {
            console.log(`SQL文件 ${path.basename(filePath)} 执行成功`);
          }
          
          completedFiles++;
          
          // 所有文件处理完毕后关闭连接
          if (completedFiles === sqlFiles.length) {
            connection.end();
            console.log('数据库初始化完成');
          }
        });
      });
    });
  });
});