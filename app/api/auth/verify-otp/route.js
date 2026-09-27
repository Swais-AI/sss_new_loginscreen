// app/api/auth/verify-otp/route.js

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

const DASHBOARD_PATHS = {
  "School Admin": "https://staging.sss.swais.in/admin",
  "Headmaster": "https://staging.sss.swais.in/headmaster",
  "Faculty": "https://staging.sss.swais.in/faculty",
  "Student": "https://staging.sss.swais.in/student",
  "Parent": "https://staging.sss.swais.in/parent/dashboard",
};

const otpStore = global.otpStore || new Map();
if (process.env.NODE_ENV !== 'production') global.otpStore = otpStore;

export async function POST(request) {
  try {
    const body = await request.json();
    const { phone, otp, role } = body;

    if (!phone || !otp) {
      return NextResponse.json(
        { authenticated: false, message: 'Phone number and OTP are required' },
        { status: 400 }
      );
    }

    const cleanPhone = phone.trim().replace(/[^0-9]/g, '').slice(-10);
    const record = otpStore.get(cleanPhone);

    if (!record) {
      return NextResponse.json(
        { authenticated: false, message: 'OTP has expired or was not requested.' },
        { status: 400 }
      );
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(cleanPhone);
      return NextResponse.json(
        { authenticated: false, message: 'OTP has expired. Please request a new one.' },
        { status: 400 }
      );
    }

    if (record.otp !== otp.trim()) {
      return NextResponse.json(
        { authenticated: false, message: 'Invalid OTP. Please check and try again.' },
        { status: 400 }
      );
    }

    const user = record.user;
    const finalRole = role || record.role;
    otpStore.delete(cleanPhone);

    const dashboardPath = DASHBOARD_PATHS[finalRole] || '/';

    const userEmail = user.email || user.student_email || user.admin_email || 'Not available';
    const userPhone = user.phone || user.student_phone || user.admin_phone || cleanPhone;

    return NextResponse.json({
      authenticated: true,
      role: finalRole,
      user: user,
      email: userEmail,
      phone: userPhone,
      dashboardPath: dashboardPath,
      message: 'Login successful'
    });

  } catch (error) {
    console.error('❌ OTP verification error:', error);
    return NextResponse.json(
      { authenticated: false, message: 'Failed to verify OTP. Please try again.' },
      { status: 500 }
    );
  }
}