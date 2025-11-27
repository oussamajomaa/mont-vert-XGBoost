import dotenv from 'dotenv'
dotenv.config()

// import mysql from 'mysql2/promise';
// import dotenv from 'dotenv';
// import path from 'node:path';
// import { fileURLToPath } from 'node:url';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname  = path.dirname(__filename);

// // .env situé dans server/.env (un niveau au-dessus de src)
// dotenv.config({ path: path.resolve(__dirname, '../.env') });
import mysql from 'mysql2/promise'

export const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    timezone: 'Z',
    charset: 'utf8mb4'
})