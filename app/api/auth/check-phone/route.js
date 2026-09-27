// app/api/auth/check-phone/route.js

import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { sendOtpSms } from '../../../../lib/nimbus-sms';

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
  "School Admin": { table: "sss_student_master", phoneColumn: "admin_phone" }, 
  "Headmaster": { table: "sss_teacher_master", phoneColumn: "phone" }, 
  "Faculty": { table: "sss_teacher_master", phoneColumn: "phone" },
  "Student": { table: "sss_student_master", phoneColumn: "student_phone" },
  "Parent": { table: "sss_parent_master", phoneColumn: "phone" }, 
};

const otpStore = global.otpStore || new Map();
if (process.env.NODE_ENV !== 'production') global.otpStore = otpStore;

export async function POST(request) {
  try {
    const body = await request.json();
    const { phone, role } = body;

    console.log(`\n📱 --- NEW PHONE VALIDATION: ${role} ---`);
    console.log(`📱 Requested Phone: ${phone}`);

    if (!phone || !role) {
      return NextResponse.json(
        { valid: false, message: 'Phone number and role are required' },
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

    const cleanPhone = phone.trim().replace(/[^0-9]/g, '');
    const targetNumber = cleanPhone.slice(-10);
    const { table, phoneColumn } = mapping;

    console.log(`🔍 Querying table: ${table} | Column: ${phoneColumn} | For number: ${targetNumber}`);

    const query = `SELECT * FROM ${table} WHERE ${phoneColumn} = $1 OR ${phoneColumn} LIKE $2 LIMIT 1`;
    const result = await pool.query(query, [cleanPhone, `%${targetNumber}`]);

    if (result.rows.length === 0) {
      console.log(`❌ No ${role} found in ${table} for ${targetNumber}`);
      return NextResponse.json({
        valid: false,
        message: `No ${role} found with phone number: ${phone}. Please contact your administrator.`
      });
    }

    console.log(`✅ User found in DB. Preparing OTP...`);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    otpStore.set(targetNumber, {
      otp,
      role,
      user: result.rows[0],
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    console.log(`🚀 Sending OTP ${otp} to ${targetNumber} via Nimbus...`);
    const smsResponse = await sendOtpSms(targetNumber, otp);

    if (!smsResponse.success) {
      console.error('❌ Failed to send SMS via Nimbus:', smsResponse.error);
      return NextResponse.json(
        { valid: false, message: 'Failed to dispatch OTP SMS. Provider rejected the request.' },
        { status: 500 }
      );
    }

    console.log(`✅ SMS successfully handed off to Nimbus for ${targetNumber}`);
    return NextResponse.json({
      valid: true,
      message: 'OTP sent successfully to registered phone number'
    });

  } catch (error) {
    console.error('❌ Phone check error:', error);
    return NextResponse.json(
      { valid: false, message: 'Unable to process phone number. Please try again.' },
      { status: 500 }
    );
  }
}