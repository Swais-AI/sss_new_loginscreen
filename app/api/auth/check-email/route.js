// app/api/auth/check-email/route.js

import { NextResponse } from 'next/server';
import { Pool } from 'pg';

if (!global.pgPool) {
  global.pgPool = new Pool({
    host: process.env.PGHOST || process.env.DB_HOST,
    user: process.env.PGUSER || process.env.DB_USER,
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
    database: process.env.PGDATABASE || process.env.DB_NAME || 'sss_prod',
    port: parseInt(process.env.PGPORT || process.env.DB_PORT || '5432'),
    ssl: { rejectUnauthorized: false }, // FIX: AWS RDS strictly requires encrypted connections
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}
const pool = global.pgPool;

const ROLE_MAPPING = {
  "School Admin": { table: "sss_users_master", emailColumn: "email", nameColumn: "username" },
  "Headmaster": { table: "sss_users_master", emailColumn: "email", nameColumn: "username" },
  "Faculty": { table: "sss_teacher_master", emailColumn: "email", nameColumn: "full_name" },
  "Student": { table: "sss_student_master", emailColumn: "student_email", nameColumn: "full_name" },
  "Parent": { table: "sss_student_master", emailColumn: "student_email", nameColumn: "full_name" },
};

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, role } = body;

    console.log('📧 Validation request:', { email, role });

    if (!email || !role) {
      return NextResponse.json(
        { valid: false, message: 'Email and role are required' },
        { status: 400 }
      );
    }

    const mapping = ROLE_MAPPING[role];
    if (!mapping) {
      return NextResponse.json(
        { valid: false, message: 'Invalid role selected' },
        { status: 400 }
      );
    }

    const { table, emailColumn } = mapping;
    const emailLower = email.trim().toLowerCase();

    const query = `SELECT * FROM ${table} WHERE ${emailColumn} = $1`;
    console.log('🔍 Query:', query, 'Email:', emailLower);

    const result = await pool.query(query, [emailLower]);
    console.log('📊 Result rows:', result.rows.length);

    if (result.rows.length === 0) {
      return NextResponse.json({
        valid: false,
        message: `No ${role} found with email: ${email}. Please contact your administrator.`
      });
    }

    return NextResponse.json({
      valid: true,
      message: 'User validated successfully',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Email validation error:', error);
    return NextResponse.json(
      { valid: false, message: 'Unable to validate email. Please try again.' },
      { status: 500 }
    );
  }
}