import os
import hashlib
import hmac
import logging
import random
import re
import math
import asyncio
import urllib.parse
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
from psycopg_pool import ConnectionPool
import requests
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

FRONTEND_ORIGIN = os.getenv(
    "FRONTEND_ORIGIN",
    "http://localhost:3000"
)

GOOGLE_CLIENT_ID = os.getenv(
    "GOOGLE_CLIENT_ID",
    ""
).strip()

# NIMBUS SMS CREDENTIALS
NIMBUS_USER_ID = os.getenv("NIMBUS_USER_ID", "").strip()
NIMBUS_PASSWORD = os.getenv("NIMBUS_PASSWORD", "").strip()
NIMBUS_SENDER_ID = os.getenv("NIMBUS_SENDER_ID", "").strip()
NIMBUS_ENTITY_ID = os.getenv("NIMBUS_ENTITY_ID", "").strip()
NIMBUS_TEMPLATE_ID = os.getenv("NIMBUS_TEMPLATE_ID", "").strip()

OTP_EXPIRY_MINUTES = int(
    os.getenv("OTP_EXPIRY_MINUTES", "5")
)

OTP_DELIVERY_MODE = os.getenv(
    "OTP_DELIVERY_MODE",
    "sms"
).strip().lower()

OTP_MAX_ATTEMPTS = 5

AUTH_NOT_AUTHORISED_MESSAGE = "Not authorised to login"

FACULTY_SSO_URL = os.getenv(
    "FACULTY_SSO_URL",
    ""
).strip()

SSO_SECRET = os.getenv(
    "SSO_SECRET",
    ""
).strip()


logger = logging.getLogger("uvicorn.error")

pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto"
)


# ============================================================
# DATABASE CONNECTION POOL
# ============================================================

pool: ConnectionPool | None = None

DEFAULT_SLOTS = 12
DEFAULT_RESERVE = 0.2
FALLBACK_MAX_CONNECTIONS = int(os.getenv("DB_MAX_CONNECTIONS_FALLBACK", "80"))

def _get_max_connections(url: str) -> int:
    """Ask the server its own limit. Never fatal - a service must still boot."""
    try:
        with psycopg.connect(url, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute("SHOW max_connections")
                return int(cur.fetchone()[0])
    except Exception as exc:
        logger.warning(
            "Could not read max_connections (%s); assuming %d",
            exc, FALLBACK_MAX_CONNECTIONS,
        )
        return FALLBACK_MAX_CONNECTIONS

@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool

    if DATABASE_URL:
        db_url = DATABASE_URL
        if "sslmode" not in db_url:
            db_url += "?sslmode=require" if "?" not in db_url else "&sslmode=require"

        server_max = _get_max_connections(db_url)
        share = max(2, math.floor(server_max * (1 - DEFAULT_RESERVE) / DEFAULT_SLOTS))

        logger.warning("DB pool for sss-login-backend: idle 1, burst to %d (slots=%d)", share, DEFAULT_SLOTS)

        pool = ConnectionPool(
            conninfo=db_url,
            kwargs={
                "row_factory": dict_row,
                "application_name": "sss-login-backend",
                "prepare_threshold": None,
                "keepalives": 1,
                "keepalives_idle": 60,
                "keepalives_interval": 10,
                "keepalives_count": 5
            },
            min_size=1,  # Set floor to 1 to allow overflow to handle bursts
            max_size=share,
            timeout=30.0,
            max_idle=300,
            open=False
        )
        
        # Offload the synchronous connection creation to a thread 
        # so it doesn't block FastAPI's async event loop.
        await asyncio.to_thread(pool.open)

        logger.info("Database connection pool initialized.")

    yield

    if pool:
        logger.info("Closing database connection pool.")
        pool.close()
        pool = None

app = FastAPI(
    title="SSS Portal Auth API",
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_ORIGIN,
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=[
        "POST",
        "GET",
        "OPTIONS",
    ],
    allow_headers=["*"],
)


# ============================================================
# REQUEST MODELS
# ============================================================

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


# ============================================================
# DATABASE COLUMN CONFIG
# ============================================================

def env_column(name: str, default: str) -> str:
    value = os.getenv(name, default).strip()

    if not re.fullmatch(
        r"[A-Za-z_][A-Za-z0-9_]*",
        value
    ):
        raise RuntimeError(
            f"Invalid database column configured for {name}"
        )

    return value


ROLE_TABLES = {
    "Student": {
        "table": "sss_student_master",
        "email": env_column(
            "SSS_STUDENT_EMAIL_COLUMN",
            "email"
        ),
        "phone": env_column(
            "SSS_STUDENT_PHONE_COLUMN",
            "phone"
        ),
        "password": env_column(
            "SSS_STUDENT_PASSWORD_COLUMN",
            "password"
        ),
    },

    "Faculty": {
        "table": "sss_teacher_master",
        "email": env_column(
            "SSS_TEACHER_EMAIL_COLUMN",
            "email"
        ),
        "phone": env_column(
            "SSS_TEACHER_PHONE_COLUMN",
            "phone"
        ),
        "password": env_column(
            "SSS_TEACHER_PASSWORD_COLUMN",
            "password"
        ),
    },

    "Headmaster": {
        "table": "sss_teacher_master",
        "email": env_column(
            "SSS_TEACHER_EMAIL_COLUMN",
            "email"
        ),
        "phone": env_column(
            "SSS_TEACHER_PHONE_COLUMN",
            "phone"
        ),
        "password": env_column(
            "SSS_TEACHER_PASSWORD_COLUMN",
            "password"
        ),
        "role": env_column(
            "SSS_TEACHER_ROLE_COLUMN",
            "employee_role"
        ),
        "required_role": "Headmaster",
    },

    "Parent": {
        "table": "sss_parent_master",
        "email": env_column(
            "SSS_PARENT_EMAIL_COLUMN",
            "email"
        ),
        "phone": env_column(
            "SSS_PARENT_PHONE_COLUMN",
            "phone"
        ),
        "password": env_column(
            "SSS_PARENT_PASSWORD_COLUMN",
            "password"
        ),
    },

    "Admin": {
        "table": "sss_student_master",
        "email": env_column(
            "SSS_ADMIN_EMAIL_COLUMN",
            "admin_email"
        ),
        "phone": env_column(
            "SSS_ADMIN_PHONE_COLUMN",
            "admin_phone"
        ),
        "password": env_column(
            "SSS_ADMIN_PASSWORD_COLUMN",
            "admin_password"
        ),
    },
}


# ============================================================
# DATABASE CONNECTION
# ============================================================

@contextmanager
def db_connection():
    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database pool is not initialized.",
        )

    try:
        with pool.connection() as conn:
            yield conn

    except Exception:
        logger.exception(
            "Database operation failed."
        )
        raise


# ============================================================
# ROLE HELPERS
# ============================================================

ROLE_ALIASES = {
    "School Admin": "Admin"
}


def get_role_config(role: str) -> dict[str, str]:
    config = ROLE_TABLES.get(
        ROLE_ALIASES.get(role, role)
    )

    if not config:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid role selected.",
        )

    return config


# ============================================================
# EMAIL USER LOOKUP
# ============================================================

def fetch_user(
    email: str,
    role: str
) -> dict[str, Any] | None:

    config = get_role_config(role)

    params = [email]

    query = (
        f'SELECT * FROM "{config["table"]}" '
        f'WHERE LOWER("{config["email"]}") = LOWER(%s)'
    )

    if config.get("required_role"):
        query += (
            f' AND LOWER("{config["role"]}") = LOWER(%s)'
        )

        params.append(
            config["required_role"]
        )

    query += " LIMIT 1"

    with db_connection() as conn:
        with conn.cursor() as cur:

            cur.execute(
                query,
                params
            )

            return cur.fetchone()


# ============================================================
# PHONE HELPERS
# ============================================================

def normalize_phone(phone: str) -> str:

    value = (
        phone
        .strip()
        .replace(" ", "")
        .replace("-", "")
    )

    if not value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please enter your phone number.",
        )

    if value.startswith("+"):
        digits = value[1:]
    else:
        digits = value

    if (
        not digits.isdigit()
        or len(digits) < 10
        or len(digits) > 15
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please enter a valid phone number.",
        )

    if value.startswith("+"):
        return f"+{digits}"

    if len(digits) == 10:
        return f"+91{digits}"

    return f"+{digits}"


def phone_lookup_values(
    phone: str
) -> list[str]:

    normalized = normalize_phone(phone)

    without_plus = normalized[1:]

    values = [
        normalized,
        without_plus,
    ]

    if (
        without_plus.startswith("91")
        and len(without_plus) == 12
    ):
        values.append(
            without_plus[2:]
        )

    return list(
        dict.fromkeys(values)
    )

# ============================================================
# PHONE USER LOOKUP
# ============================================================

def fetch_user_by_phone(
    phone: str,
    role: str
) -> dict[str, Any] | None:

    config = get_role_config(role)

    values = phone_lookup_values(phone)

    placeholders = ", ".join(
        ["%s"] * len(values)
    )

    params = list(values)

    query = (
        f'SELECT * FROM "{config["table"]}" '
        f'WHERE REGEXP_REPLACE('
        f'COALESCE("{config["phone"]}"::text, \'\'), '
        f'\'[^0-9+]\', \'\', \'g\') '
        f"IN ({placeholders})"
    )

    if config.get("required_role"):

        query += (
            f' AND LOWER("{config["role"]}") '
            f'= LOWER(%s)'
        )

        params.append(
            config["required_role"]
        )

    query += " LIMIT 1"

    with db_connection() as conn:
        with conn.cursor() as cur:

            cur.execute(
                query,
                params
            )

            return cur.fetchone()


# ============================================================
# ROLE VALIDATION
# ============================================================

def assert_role_matches(
    user: dict[str, Any],
    role: str
) -> None:

    config = get_role_config(role)

    required_role = config.get(
        "required_role"
    )

    if not required_role:
        return

    user_role = str(
        user.get(
            config["role"],
            ""
        )
    ).strip()

    if user_role.lower() != required_role.lower():

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Selected role does not match user role.",
        )


# ============================================================
# PASSWORD
# ============================================================

def verify_password(
    plain_password: str,
    stored_password: str | None
) -> bool:

    if not stored_password:
        return False

    if stored_password.startswith(
        ("$2a$", "$2b$", "$2y$")
    ):
        return pwd_context.verify(
            plain_password,
            stored_password
        )

    return plain_password == stored_password


# ============================================================
# PUBLIC USER
# ============================================================

def public_user(
    user: dict[str, Any],
    role: str
) -> dict[str, Any]:

    config = get_role_config(role)

    blocked = {
        config["password"],
        "password_hash",
        "hashed_password",
    }

    return {
        key: value
        for key, value in user.items()
        if key not in blocked
    }


def user_email(
    user: dict[str, Any],
    role: str
) -> str:

    config = get_role_config(role)

    return str(
        user.get(
            config["email"],
            ""
        ) or ""
    )


# ============================================================
# FACULTY SSO
# ============================================================

def fetch_faculty_sso_token(
    email: str
) -> str | None:

    if (
        not FACULTY_SSO_URL
        or not SSO_SECRET
        or not email
    ):
        return None

    try:

        resp = requests.post(
            FACULTY_SSO_URL,
            json={
                "email": email
            },
            headers={
                "X-SSO-Secret": SSO_SECRET
            },
            timeout=8,
        )

        if resp.status_code == 200:

            return resp.json().get(
                "access_token"
            )

        logger.warning(
            "Faculty SSO token request failed: %s %s",
            resp.status_code,
            resp.text[:200]
        )

    except requests.RequestException as exc:

        logger.warning(
            "Faculty SSO token request error: %s",
            exc
        )

    return None


def maybe_attach_faculty_token(
    response: dict[str, Any],
    user: dict[str, Any],
    role: str
) -> dict[str, Any]:

    if (
        ROLE_ALIASES.get(role, role)
        == "Faculty"
    ):

        token = fetch_faculty_sso_token(
            user_email(user, role)
        )

        if token:

            response["access_token"] = token
            response["token_type"] = "bearer"

    return response


# ============================================================
# OTP
# ============================================================

def create_otp() -> str:

    return f"{random.SystemRandom().randint(100000, 999999)}"


def otp_digest(otp: str) -> str:
    secret = (
        NIMBUS_PASSWORD
        or GOOGLE_CLIENT_ID
        or "sss-local-otp-secret"
    )

    return hmac.new(
        secret.encode("utf-8"),
        otp.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()


# ============================================================
# STORE OTP
# ============================================================

def store_otp(
    phone: str,
    role: str,
    otp: str
) -> None:

    expires_at = (
        datetime.utcnow()
        + timedelta(
            minutes=OTP_EXPIRY_MINUTES
        )
    )

    otp_hash = otp_digest(otp)

    with db_connection() as conn:

        with conn.cursor() as cur:

            cur.execute(
                """
                UPDATE public.sss_login_otp_tokens
                SET is_used = TRUE
                WHERE role = %s
                  AND phone = %s
                  AND is_used = FALSE
                """,
                (
                    role,
                    phone
                ),
            )

            cur.execute(
                """
                INSERT INTO public.sss_login_otp_tokens
                (
                    role,
                    phone,
                    otp_hash,
                    expires_at
                )
                VALUES (%s, %s, %s, %s)
                """,
                (
                    role,
                    phone,
                    otp_hash,
                    expires_at
                ),
            )

        conn.commit()


# ============================================================
# SEND OTP SMS (NIMBUS INTEGRATION)
# ============================================================

def send_otp_sms(
    phone: str,
    otp: str
) -> None:

    if OTP_DELIVERY_MODE == "console":
        print(f"OTP for {phone}: {otp}")
        return

    if (
        not NIMBUS_USER_ID 
        or not NIMBUS_PASSWORD
    ):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Nimbus SMS is not configured.",
        )

    try:
        clean_phone = phone.replace("+", "")
        # CRITICAL FIX: Ensure exactly one space before the period to match approved DLT template
        message = f"Your mobile verification OTP is {otp} for SSS School . It is valid for {OTP_EXPIRY_MINUTES} minutes. Do not share this OTP with anyone.\n- SARAF WORLDSPHERE AI SERVICES"
        
        # CRITICAL FIX: urllib.parse.quote ensures spaces become "%20" instead of "+"
        encoded_message = urllib.parse.quote(message, safe="")
        encoded_password = urllib.parse.quote(NIMBUS_PASSWORD, safe="")

        # Manually construct the URL to bypass requests' default url encoding 
        url = f"http://nimbusit.biz/api/SmsApi/SendSingleApi?UserID={NIMBUS_USER_ID}&Password={encoded_password}&SenderID={NIMBUS_SENDER_ID}&Phno={clean_phone}&Msg={encoded_message}&EntityID={NIMBUS_ENTITY_ID}&TemplateID={NIMBUS_TEMPLATE_ID}"

        resp = requests.get(url, timeout=10, headers={"Cache-Control": "no-cache"})
        data = resp.text
        
        logger.info(f"📡 Nimbus API Response: {data}")
        
        # Catch silent errors hidden in the response body
        if "err" in data.lower():
            logger.warning("Nimbus SMS API returned an error: %s", data)
            raise Exception(f"Provider rejected request: {data}")

        if resp.status_code != 200:
            logger.warning("Nimbus SMS API returned status %s: %s", resp.status_code, data)
            raise Exception(f"API returned status {resp.status_code}")
            
    except Exception as exc:
        logger.exception("Nimbus failed to send OTP SMS to %s", phone)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OTP SMS could not be sent: {exc}",
        )


# ============================================================
# VERIFY STORED OTP
# ============================================================

def verify_stored_otp(
    phone: str,
    role: str,
    otp: str
) -> None:

    with db_connection() as conn:

        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT
                    otp_id,
                    otp_hash,
                    attempts,
                    expires_at
                FROM public.sss_login_otp_tokens
                WHERE role = %s
                  AND phone = %s
                  AND is_used = FALSE
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (
                    role,
                    phone
                ),
            )

            otp_row = cur.fetchone()

            if not otp_row:

                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="OTP does not exist.",
                )

            if (
                otp_row["expires_at"]
                < datetime.utcnow()
            ):

                cur.execute(
                    """
                    UPDATE public.sss_login_otp_tokens
                    SET is_used = TRUE
                    WHERE otp_id = %s
                    """,
                    (
                        otp_row["otp_id"],
                    ),
                )

                conn.commit()

                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="OTP has expired.",
                )

            if (
                otp_row["attempts"]
                >= OTP_MAX_ATTEMPTS
            ):

                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many OTP attempts.",
                )

            if not hmac.compare_digest(
                otp_digest(otp),
                otp_row["otp_hash"]
            ):

                cur.execute(
                    """
                    UPDATE public.sss_login_otp_tokens
                    SET attempts = attempts + 1
                    WHERE otp_id = %s
                    """,
                    (
                        otp_row["otp_id"],
                    ),
                )

                conn.commit()

                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid OTP.",
                )

            cur.execute(
                """
                UPDATE public.sss_login_otp_tokens
                SET
                    is_used = TRUE,
                    verified_at = CURRENT_TIMESTAMP
                WHERE otp_id = %s
                """,
                (
                    otp_row["otp_id"],
                ),
            )

        conn.commit()


# ============================================================
# GOOGLE TOKEN
# ============================================================

def verify_google_token(
    google_token: str,
    email: str
) -> None:

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

    google_email = str(
        payload.get(
            "email",
            ""
        )
    ).lower()

    if google_email != email.lower():

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account does not match the login email.",
        )


# ============================================================
# HEALTH
# ============================================================

@app.get("/api/health")
def health():

    return {
        "status": "ok"
    }


# ============================================================
# CHECK EMAIL
# ============================================================

@app.post("/api/auth/check-email")
def check_email(
    payload: EmailCheckRequest
):

    user = fetch_user(
        payload.email,
        payload.role
    )

    if not user:

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=AUTH_NOT_AUTHORISED_MESSAGE,
        )

    assert_role_matches(
        user,
        payload.role
    )

    return {
        "exists": True,
        "role": payload.role,
        "email": payload.email,
    }


# ============================================================
# CHECK PHONE
# ============================================================

@app.post("/api/auth/check-phone")
def check_phone(
    payload: PhoneCheckRequest
):

    phone = normalize_phone(
        payload.phone
    )

    user = fetch_user_by_phone(
        phone,
        payload.role
    )

    if not user:

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=AUTH_NOT_AUTHORISED_MESSAGE,
        )

    assert_role_matches(
        user,
        payload.role
    )

    otp = create_otp()

    store_otp(
        phone,
        payload.role,
        otp
    )

    send_otp_sms(
        phone,
        otp
    )

    response = {
        "otpSent": True,
        "role": payload.role,
        "phone": phone,
        "expiresInMinutes": OTP_EXPIRY_MINUTES,
    }

    if OTP_DELIVERY_MODE == "console":

        response["devOtp"] = otp

    return response


# ============================================================
# VERIFY OTP
# ============================================================

@app.post("/api/auth/verify-otp")
def verify_otp(
    payload: OtpVerifyRequest
):

    phone = normalize_phone(
        payload.phone
    )

    user = fetch_user_by_phone(
        phone,
        payload.role
    )

    if not user:

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=AUTH_NOT_AUTHORISED_MESSAGE,
        )

    assert_role_matches(
        user,
        payload.role
    )

    verify_stored_otp(
        phone,
        payload.role,
        payload.otp.strip()
    )

    return maybe_attach_faculty_token(
        {
            "authenticated": True,
            "otpVerified": True,
            "email": user_email(
                user,
                payload.role
            ),
            "phone": phone,
            "role": payload.role,
            "user": public_user(
                user,
                payload.role
            ),
        },
        user,
        payload.role
    )


# ============================================================
# LOGIN
# ============================================================

@app.post("/api/auth/login")
def login(
    payload: LoginRequest
):

    user = fetch_user(
        payload.email,
        payload.role
    )

    if not user:

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=AUTH_NOT_AUTHORISED_MESSAGE,
        )

    assert_role_matches(
        user,
        payload.role
    )

    if (
        GOOGLE_CLIENT_ID
        and not payload.googleToken
    ):

        return {
            "authenticated": False,
            "requiresGoogleAuth": True,
        }

    if payload.googleToken:

        verify_google_token(
            payload.googleToken,
            payload.email
        )

    return maybe_attach_faculty_token(
        {
            "authenticated": True,
            "email": payload.email,
            "role": payload.role,
            "user": public_user(
                user,
                payload.role
            ),
        },
        user,
        payload.role
    )