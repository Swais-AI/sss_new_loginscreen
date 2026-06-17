"use client";

import { useEffect, useRef, useState } from "react";

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16v12H4z" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.6 1.9Z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
      <path d="M16 3.1a4 4 0 0 1 0 7.8" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <path d="M12 15v2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="chevron" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SchoolLogo() {
  const [useFallback, setUseFallback] = useState(false);

  return (
    <img
      className="school-logo"
      src={useFallback ? "/assets/sgs-school-logo.svg" : "/assets/sgs-school-logo.jpeg"}
      alt="SGS Senior Secondary School logo"
      onError={() => setUseFallback(true)}
    />
  );
}

export default function Home() {
  const [method, setMethod] = useState("email");
  const [selectedRole, setSelectedRole] = useState("Select your role");
  const [isRoleOpen, setIsRoleOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [phoneStep, setPhoneStep] = useState("phone");
  const [pendingGoogleLogin, setPendingGoogleLogin] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const roleDropdownRef = useRef(null);
  const googleButtonRef = useRef(null);
  const roles = ["Student", "Faculty", "Headmaster", "Parent", "Admin"];
  const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

  useEffect(() => {
    function handleOutsideClick(event) {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(event.target)) {
        setIsRoleOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    setIsEmailVerified(false);
    setPendingGoogleLogin(null);
    setPassword("");
    setMessage("");
  }, [email, selectedRole]);

  useEffect(() => {
    setPhoneStep("phone");
    setOtp("");
    setPassword("");
    setMessage("");
  }, [phone, selectedRole]);

  useEffect(() => {
    if (!pendingGoogleLogin || !googleClientId || !googleButtonRef.current) {
      return;
    }

    let isCancelled = false;

    loadGoogleScript()
      .then(() => {
        if (isCancelled || !googleButtonRef.current) {
          return;
        }

        googleButtonRef.current.innerHTML = "";
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          auto_select: false,
          cancel_on_tap_outside: false,
          callback: (response) => {
            if (response?.credential) {
              completeGoogleLogin(response.credential);
              return;
            }

            setMessage("Google authentication failed.");
          }
        });
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          width: 320,
          text: "signin_with",
          shape: "rectangular"
        });
      })
      .catch(() => setMessage("Google sign-in could not load. Please check your browser or network."));

    return () => {
      isCancelled = true;
    };
  }, [pendingGoogleLogin, googleClientId]);

  function dashboardPath(role) {
    const paths = {
      Student: "/student-dashboard",
      Faculty: "/faculty-dashboard",
      Headmaster: "/headmaster-dashboard",
      Parent: "/parent-dashboard",
      Admin: "/admin-dashboard"
    };

    return paths[role] || "/";
  }

  function selectedRoleIsValid() {
    return roles.includes(selectedRole);
  }

  function submitButtonText() {
    if (isLoading) {
      return "Please wait...";
    }

    if (method === "phone") {
      if (phoneStep === "otp") {
        return "Verify OTP";
      }

      if (phoneStep === "password") {
        return "Sign In";
      }

      return "Send OTP";
    }

    return isEmailVerified ? "Sign In" : "Continue";
  }

  async function postJson(path, body) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.detail || "Something went wrong. Please try again.");
    }

    return data;
  }

  function loadGoogleScript() {
    if (window.google?.accounts?.id) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const existingScript = document.querySelector("script[data-google-identity]");
      if (existingScript) {
        existingScript.addEventListener("load", resolve, { once: true });
        existingScript.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = "true";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function completeGoogleLogin(googleToken) {
    if (!pendingGoogleLogin) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const verifiedResponse = await postJson("/api/auth/login", {
        ...pendingGoogleLogin,
        googleToken
      });

      completeLogin(verifiedResponse);
    } catch (error) {
      setMessage(error.message || "Google authentication failed.");
    } finally {
      setIsLoading(false);
    }
  }

  function completeLogin(data) {
    const session = {
      email: data.email,
      phone: data.phone,
      role: data.role,
      user: data.user
    };

    sessionStorage.setItem("sgsUserSession", JSON.stringify(session));
    localStorage.setItem("sgsUserSession", JSON.stringify(session));
    window.location.assign(dashboardPath(data.role));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    if (!selectedRoleIsValid()) {
      setMessage("Please select your role.");
      return;
    }

    setIsLoading(true);

    try {
      if (method === "phone") {
        const normalizedPhone = phone.trim();

        if (!normalizedPhone) {
          setMessage("Please enter your phone number.");
          return;
        }

        if (phoneStep === "phone") {
          const response = await postJson("/api/auth/check-phone", {
            phone: normalizedPhone,
            role: selectedRole
          });
          setPhoneStep("otp");
          setMessage(`OTP sent. It is valid for ${response.expiresInMinutes} minutes.`);
          return;
        }

        if (phoneStep === "otp") {
          if (!otp.trim()) {
            setMessage("Please enter the OTP.");
            return;
          }

          await postJson("/api/auth/verify-otp", {
            phone: normalizedPhone,
            role: selectedRole,
            otp: otp.trim()
          });
          setPhoneStep("password");
          setMessage("");
          return;
        }

        if (!password) {
          setMessage("Please enter your password.");
          return;
        }

        const loginResponse = await postJson("/api/auth/login-phone", {
          phone: normalizedPhone,
          role: selectedRole,
          password
        });
        completeLogin(loginResponse);
        return;
      }

      if (!email.trim()) {
        setMessage("Please enter your email address.");
        return;
      }

      if (!isEmailVerified) {
        await postJson("/api/auth/check-email", {
          email: email.trim(),
          role: selectedRole
        });
        setIsEmailVerified(true);
        setMessage("");
        return;
      }

      if (!password) {
        setMessage("Please enter your password.");
        return;
      }

      const loginResponse = await postJson("/api/auth/login", {
        email: email.trim(),
        role: selectedRole,
        password
      });

      if (loginResponse.requiresGoogleAuth) {
        if (!googleClientId) {
          setMessage("Google Client ID is not configured.");
          return;
        }

        setPendingGoogleLogin({
          email: email.trim(),
          role: selectedRole,
          password
        });
        setMessage("Please continue with Google using the button below.");
        return;
      }

      if (!loginResponse.authenticated) {
        setMessage("Authentication could not be completed.");
        return;
      }

      completeLogin(loginResponse);
    } catch (error) {
      setMessage(error.message || "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="brand-panel" aria-label="SGS Portal">
        <div className="sky-shape top-shape" />
        <div className="dot-grid" aria-hidden="true" />

        <div className="brand-content">
          <SchoolLogo />
          <h1>SGS PORTAL</h1>
          <div className="gold-divider" aria-hidden="true" />
          <p className="tagline">Smart. Global. Secure.</p>

          <div className="portal-copy">
            <h2>SGS Learning Portal</h2>
            <p>One platform for students, teachers, parents and administrators to connect, learn and grow together.</p>
          </div>
        </div>

        <img className="campus-art" src="/assets/campus-hero.png" alt="Students walking toward a bright school campus" />
        <div className="sky-shape bottom-shape" />
      </section>

      <section className="form-panel" aria-label="Sign in form">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="form-inner">
            <p className="section-title">Sign in with</p>

            <div className="tabs" role="tablist" aria-label="Sign in method">
              <button
                className={`tab ${method === "email" ? "active" : ""}`}
                type="button"
                role="tab"
                aria-selected={method === "email"}
                onClick={() => {
                  setMethod("email");
                  setMessage("");
                }}
              >
                <MailIcon />
                <span>Email</span>
              </button>
              <button
                className={`tab ${method === "phone" ? "active" : ""}`}
                type="button"
                role="tab"
                aria-selected={method === "phone"}
                onClick={() => {
                  setMethod("phone");
                  setIsEmailVerified(false);
                  setMessage("");
                }}
              >
                <PhoneIcon />
                <span>Phone Number</span>
              </button>
            </div>

            {method === "email" ? (
              <label className="field-group">
                <span>Email Address</span>
                <span className="input-wrap">
                  <MailIcon />
                  <input
                    type="email"
                    placeholder="Enter your email address"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={isLoading}
                  />
                </span>
              </label>
            ) : (
              <label className="field-group">
                <span>Phone Number</span>
                <span className="input-wrap">
                  <PhoneIcon />
                  <input
                    type="tel"
                    placeholder="Enter your phone number"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    disabled={isLoading || phoneStep !== "phone"}
                  />
                </span>
              </label>
            )}

            <div className="field-group role-dropdown" ref={roleDropdownRef}>
              <span>Select Role</span>
              <button
                className={`select-box ${isRoleOpen ? "open" : ""}`}
                type="button"
                aria-expanded={isRoleOpen}
                disabled={isLoading}
                onClick={() => setIsRoleOpen((current) => !current)}
              >
                <span className="select-label">
                  <UsersIcon />
                  <span id="selectedRole">{selectedRole}</span>
                </span>
                <ChevronIcon />
              </button>
              {isRoleOpen ? (
                <div className="role-menu" role="listbox" aria-label="Role options">
                  {roles.map((role) => (
                    <button
                      className={`role-menu-option ${selectedRole === role ? "selected" : ""}`}
                      key={role}
                      type="button"
                      role="option"
                      aria-selected={selectedRole === role}
                      onClick={() => {
                        setSelectedRole(role);
                        setIsRoleOpen(false);
                      }}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {method === "phone" && phoneStep === "otp" ? (
              <label className="field-group">
                <span>OTP</span>
                <span className="input-wrap">
                  <LockIcon />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Enter OTP"
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    disabled={isLoading}
                  />
                </span>
              </label>
            ) : null}

            {(method === "email" && isEmailVerified) || (method === "phone" && phoneStep === "password") ? (
              <label className="field-group">
                <span>Password</span>
                <span className="input-wrap">
                  <LockIcon />
                  <input
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={isLoading}
                  />
                </span>
              </label>
            ) : null}

            {message ? <p className="form-message" role="alert">{message}</p> : null}

            {pendingGoogleLogin ? (
              <div className="google-auth-panel">
                <div ref={googleButtonRef} />
              </div>
            ) : null}

            <div className="form-links-row">
              <label className="remember">
                <input type="checkbox" />
                <span>Remember me</span>
              </label>
              <a className="forgot-link" href="#">
                Forgot Password?
              </a>
            </div>

            <button className="sign-in" type="submit" disabled={isLoading}>
              {isLoading ? <span className="loader" aria-hidden="true" /> : <LockIcon />}
              <span>{submitButtonText()}</span>
            </button>

            <div className="or-row">
              <span>or</span>
            </div>
            <p className="administrator">
              Don't have an account? <strong>Contact your administrator</strong>
            </p>
          </div>
        </form>

        <footer className="footer">
          <span>&copy; 2024 SGS Portal. All rights reserved.</span>
          <span className="footer-link">Privacy Policy</span>
          <span className="footer-link">Terms of Use</span>
        </footer>
      </section>
    </main>
  );
}
