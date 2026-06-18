import os
import hashlib
import hmac
import logging
import random
import re
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr


def load_local_env() -> None:
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return

    for line in env_path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_local_env()

DATABASE_URL = os.getenv("DATABASE_URL")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "").strip()
OTP_EXPIRY_MINUTES = int(os.getenv("OTP_EXPIRY_MINUTES", "5"))
OTP_DELIVERY_MODE = os.getenv("OTP_DELIVERY_MODE", "sms").strip().lower()
OTP_MAX_ATTEMPTS = 5
AUTH_NOT_AUTHORISED_MESSAGE = "Not authorised to login"

logger = logging.getLogger("uvicorn.error")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI(title="SSS Portal Auth API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


class EmailCheckRequest(BaseModel):
    email: EmailStr
    role: str


class LoginRequest(EmailCheckRequest):
    googleToken: str | None = None


class PhoneCheckRequest(BaseModel):
    phone: str
    role: str


class OtpVerifyRequest(PhoneCheckRequest):
    otp: str


def env_column(name: str, default: str) -> str:
    value = os.getenv(name, default).strip()
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
        raise RuntimeError(f"Invalid database column configured for {name}")
    return value


ROLE_TABLES = {
    "Student": {
        "table": "sss_student_master",
        "email": env_column("SSS_STUDENT_EMAIL_COLUMN", "email"),
        "phone": env_column("SSS_STUDENT_PHONE_COLUMN", "phone"),
        "password": env_column("SSS_STUDENT_PASSWORD_COLUMN", "password"),
    },
    "Faculty": {
        "table": "sss_teacher_master",
        "email": env_column("SSS_TEACHER_EMAIL_COLUMN", "email"),
        "phone": env_column("SSS_TEACHER_PHONE_COLUMN", "phone"),
        "password": env_column("SSS_TEACHER_PASSWORD_COLUMN", "password"),
        "role": env_column("SSS_TEACHER_ROLE_COLUMN", "role"),
    },
    "Headmaster": {
        "table": "sss_teacher_master",
        "email": env_column("SSS_TEACHER_EMAIL_COLUMN", "email"),
        "phone": env_column("SSS_TEACHER_PHONE_COLUMN", "phone"),
        "password": env_column("SSS_TEACHER_PASSWORD_COLUMN", "password"),
        "role": env_column("SSS_TEACHER_ROLE_COLUMN", "role"),
        "required_role": "Headmaster",
    },
    "Parent": {
        "table": "sss_parent_master",
        "email": env_column("SSS_PARENT_EMAIL_COLUMN", "email"),
        "phone": env_column("SSS_PARENT_PHONE_COLUMN", "phone"),
        "password": env_column("SSS_PARENT_PASSWORD_COLUMN", "password"),
    },
    "Admin": {
        "table": "sss_student_master",
        "email": env_column("SSS_ADMIN_EMAIL_COLUMN", "admin_email"),
        "phone": env_column("SSS_ADMIN_PHONE_COLUMN", "admin_phone"),
        "password": env_column("SSS_ADMIN_PASSWORD_COLUMN", "admin_password"),
    },
}


@contextmanager
def db_connection():
    if not DATABASE_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="DATABASE_URL is not configured.",
        )

    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        yield conn


def get_role_config(role: str) -> dict[str, str]:
    config = ROLE_TABLES.get(role)
    if not config:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role selected.")
    return config


def fetch_user(email: str, role: str) -> dict[str, Any] | None:
    config = get_role_config(role)
    query = (
        f'SELECT * FROM "{config["table"]}" '
        f'WHERE LOWER("{config["email"]}") = LOWER(%s) LIMIT 1'
    )

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (email,))
            return cur.fetchone()


def normalize_phone(phone: str) -> str:
    value = phone.strip().replace(" ", "").replace("-", "")
    if not value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please enter your phone number.")

    if value.startswith("+"):
        digits = value[1:]
    else:
        digits = value

    if not digits.isdigit() or len(digits) < 10 or len(digits) > 15:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please enter a valid phone number.")

    if value.startswith("+"):
        return f"+{digits}"

    if len(digits) == 10:
        return f"+91{digits}"

    return f"+{digits}"


def phone_lookup_values(phone: str) -> list[str]:
    normalized = normalize_phone(phone)
    without_plus = normalized[1:]
    values = [normalized, without_plus]

    if without_plus.startswith("91") and len(without_plus) == 12:
        values.append(without_plus[2:])

    return list(dict.fromkeys(values))


def fetch_user_by_phone(phone: str, role: str) -> dict[str, Any] | None:
    config = get_role_config(role)
    values = phone_lookup_values(phone)
    placeholders = ", ".join(["%s"] * len(values))
    query = (
        f'SELECT * FROM "{config["table"]}" '
        f'WHERE REGEXP_REPLACE(COALESCE("{config["phone"]}"::text, \'\'), \'[^0-9+]\', \'\', \'g\') '
        f"IN ({placeholders}) LIMIT 1"
    )

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, values)
            return cur.fetchone()


def assert_role_matches(user: dict[str, Any], role: str) -> None:
    config = get_role_config(role)
    required_role = config.get("required_role")
    if not required_role:
        return

    user_role = str(user.get(config["role"], "")).strip()
    if user_role.lower() != required_role.lower():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Selected role does not match user role.",
        )


def verify_password(plain_password: str, stored_password: str | None) -> bool:
    if not stored_password:
        return False

    if stored_password.startswith(("$2a$", "$2b$", "$2y$")):
        return pwd_context.verify(plain_password, stored_password)

    return plain_password == stored_password


def public_user(user: dict[str, Any], role: str) -> dict[str, Any]:
    config = get_role_config(role)
    blocked = {config["password"], "password_hash", "hashed_password"}
    return {key: value for key, value in user.items() if key not in blocked}


def user_email(user: dict[str, Any], role: str) -> str:
    config = get_role_config(role)
    return str(user.get(config["email"], "") or "")


def create_otp() -> str:
    return f"{random.SystemRandom().randint(100000, 999999)}"


def otp_digest(otp: str) -> str:
    secret = TWILIO_AUTH_TOKEN or GOOGLE_CLIENT_ID or "sss-local-otp-secret"
    return hmac.new(secret.encode("utf-8"), otp.encode("utf-8"), hashlib.sha256).hexdigest()


def store_otp(phone: str, role: str, otp: str) -> None:
    expires_at = datetime.utcnow() + timedelta(minutes=OTP_EXPIRY_MINUTES)
    otp_hash = otp_digest(otp)

    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE public.sss_login_otp_tokens
                SET is_used = TRUE
                WHERE role = %s AND phone = %s AND is_used = FALSE
                """,
                (role, phone),
            )
            cur.execute(
                """
                INSERT INTO public.sss_login_otp_tokens (role, phone, otp_hash, expires_at)
                VALUES (%s, %s, %s, %s)
                """,
                (role, phone, otp_hash, expires_at),
            )
        conn.commit()


def send_otp_sms(phone: str, otp: str) -> None:
    if OTP_DELIVERY_MODE == "console":
        return

    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN or not TWILIO_PHONE_NUMBER:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Twilio SMS is not configured.",
        )

    try:
        from twilio.rest import Client

        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        client.messages.create(
            body=f"Your SSS Portal OTP is {otp}. It is valid for {OTP_EXPIRY_MINUTES} minutes.",
            from_=TWILIO_PHONE_NUMBER,
            to=phone,
        )
    except Exception as exc:
        logger.exception("Twilio failed to send OTP SMS to %s", phone)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OTP SMS could not be sent: {exc}",
        )


def verify_stored_otp(phone: str, role: str, otp: str) -> None:
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT otp_id, otp_hash, attempts, expires_at
                FROM public.sss_login_otp_tokens
                WHERE role = %s AND phone = %s AND is_used = FALSE
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (role, phone),
            )
            otp_row = cur.fetchone()

            if not otp_row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OTP does not exist.")

            if otp_row["expires_at"] < datetime.utcnow():
                cur.execute(
                    "UPDATE public.sss_login_otp_tokens SET is_used = TRUE WHERE otp_id = %s",
                    (otp_row["otp_id"],),
                )
                conn.commit()
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OTP has expired.")

            if otp_row["attempts"] >= OTP_MAX_ATTEMPTS:
                raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many OTP attempts.")

            if not hmac.compare_digest(otp_digest(otp), otp_row["otp_hash"]):
                cur.execute(
                    "UPDATE public.sss_login_otp_tokens SET attempts = attempts + 1 WHERE otp_id = %s",
                    (otp_row["otp_id"],),
                )
                conn.commit()
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid OTP.")

            cur.execute(
                """
                UPDATE public.sss_login_otp_tokens
                SET is_used = TRUE, verified_at = CURRENT_TIMESTAMP
                WHERE otp_id = %s
                """,
                (otp_row["otp_id"],),
            )
        conn.commit()


def verify_google_token(google_token: str, email: str) -> None:
    if not GOOGLE_CLIENT_ID:
        return

    try:
        payload = id_token.verify_oauth2_token(
            google_token,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google authentication failed.",
        )

    google_email = str(payload.get("email", "")).lower()
    if google_email != email.lower():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account does not match the login email.",
        )


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/auth/check-email")
def check_email(payload: EmailCheckRequest):
    user = fetch_user(payload.email, payload.role)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=AUTH_NOT_AUTHORISED_MESSAGE)

    assert_role_matches(user, payload.role)
    return {"exists": True, "role": payload.role, "email": payload.email}


@app.post("/api/auth/check-phone")
def check_phone(payload: PhoneCheckRequest):
    phone = normalize_phone(payload.phone)
    user = fetch_user_by_phone(phone, payload.role)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=AUTH_NOT_AUTHORISED_MESSAGE)

    assert_role_matches(user, payload.role)
    otp = create_otp()
    store_otp(phone, payload.role, otp)
    send_otp_sms(phone, otp)
    response = {
        "otpSent": True,
        "role": payload.role,
        "phone": phone,
        "expiresInMinutes": OTP_EXPIRY_MINUTES,
    }
    if OTP_DELIVERY_MODE == "console":
        response["devOtp"] = otp

    return response


@app.post("/api/auth/verify-otp")
def verify_otp(payload: OtpVerifyRequest):
    phone = normalize_phone(payload.phone)
    user = fetch_user_by_phone(phone, payload.role)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=AUTH_NOT_AUTHORISED_MESSAGE)

    assert_role_matches(user, payload.role)
    verify_stored_otp(phone, payload.role, payload.otp.strip())
    return {
        "authenticated": True,
        "otpVerified": True,
        "email": user_email(user, payload.role),
        "phone": phone,
        "role": payload.role,
        "user": public_user(user, payload.role),
    }


@app.post("/api/auth/login")
def login(payload: LoginRequest):
    user = fetch_user(payload.email, payload.role)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=AUTH_NOT_AUTHORISED_MESSAGE)

    assert_role_matches(user, payload.role)

    if GOOGLE_CLIENT_ID and not payload.googleToken:
        return {"authenticated": False, "requiresGoogleAuth": True}

    if payload.googleToken:
        verify_google_token(payload.googleToken, payload.email)

    return {
        "authenticated": True,
        "email": payload.email,
        "role": payload.role,
        "user": public_user(user, payload.role),
    }

