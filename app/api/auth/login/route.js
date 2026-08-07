// app/api/auth/login/route.js

import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'sss_prod',
  port: parseInt(process.env.PGPORT || '5432'),
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const ROLE_MAPPING = {
  "School Admin": { table: "sss_users_master", emailColumn: "email", nameColumn: "username" },
  "Headmaster": { table: "sss_users_master", emailColumn: "email", nameColumn: "username" },
  "Faculty": { table: "sss_teacher_master", emailColumn: "email", nameColumn: "full_name" },
  "Student": { table: "sss_student_master", emailColumn: "student_email", nameColumn: "full_name" },
  "Parent": { table: "sss_student_master", emailColumn: "student_email", nameColumn: "full_name" },
};

const DASHBOARD_PATHS = {
  "School Admin": "/admin-dashboard",
  "Headmaster": "/headmaster-dashboard",
  "Faculty": "/faculty-dashboard",
  "Student": "/student-dashboard",
  "Parent": "/parent-dashboard",
};

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, role, googleToken } = body;

    console.log('📧 Login request:', { email, role, googleToken: googleToken ? 'present' : 'missing' });

    if (!email || !role) {
      return NextResponse.json(
        { authenticated: false, message: 'Email and role are required' },
        { status: 400 }
      );
    }

    const mapping = ROLE_MAPPING[role];
    if (!mapping) {
      return NextResponse.json(
        { authenticated: false, message: 'Invalid role selected' },
        { status: 400 }
      );
    }

    const { table, emailColumn } = mapping;
    const emailLower = email.trim().toLowerCase();

    const query = `SELECT * FROM ${table} WHERE ${emailColumn} = $1`;
    const result = await pool.query(query, [emailLower]);

    if (result.rows.length === 0) {
      return NextResponse.json({
        authenticated: false,
        message: `No ${role} found with this email.`
      });
    }

    const user = result.rows[0];
    const dashboardPath = DASHBOARD_PATHS[role] || '/';

    return NextResponse.json({
      authenticated: true,
      email: user[emailColumn] || user.email,
      role: role,
      user: user,
      dashboardPath: dashboardPath
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    return NextResponse.json(
      { authenticated: false, message: 'Unable to login. Please try again.' },
      { status: 500 }
    );
  }
}
