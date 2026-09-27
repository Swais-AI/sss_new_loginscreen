"use client";

import { useEffect, useRef, useState } from "react";

// ============================================
// ICONS
// ============================================

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none">
      <path d="M4 6h16v12H4z" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.6 1.9Z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
      <path d="M16 3.1a4 4 0 0 1 0 7.8" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <path d="M12 15v2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="chevron" viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SchoolLogo() {
  const [useFallback, setUseFallback] = useState(false);

  return (
    <img
      className="school-logo"
      src={useFallback ? "/assets/sss-logo.jpeg" : "/assets/sss-logo.jpeg"}
      alt="SSS logo"
      onError={() => setUseFallback(true)}
    />
  );
}

function encodeGoogleState(data) {
  return btoa(JSON.stringify(data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeGoogleState(state) {
  try {
    const base64 = state.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function Home() {
  const [method, setMethod] = useState("email");
  const [selectedRole, setSelectedRole] = useState("Select your role");
  const [isRoleOpen, setIsRoleOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [phoneStep, setPhoneStep] = useState("phone");
  const [googleToken, setGoogleToken] = useState("");
  const [isGoogleVerified, setIsGoogleVerified] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [otpMessage, setOtpMessage] = useState("");
  
  const roleDropdownRef = useRef(null);
  const pendingGoogleLoginRef = useRef(null);
  const isRestoringGoogleLoginRef = useRef(false);
  
  const roles = ["School Admin", "Headmaster", "Faculty", "Student", "Parent"];
  
  const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
  const googleRedirectUri = process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI || "";

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
    if (isRestoringGoogleLoginRef.current) {
      isRestoringGoogleLoginRef.current = false;
      return;
    }

    if (isGoogleVerified) {
      return;
    }

    const verifiedLogin = JSON.parse(sessionStorage.getItem("sssVerifiedGoogleLogin") || "null");
    if (verifiedLogin?.email === email && verifiedLogin?.role === selectedRole && verifiedLogin?.googleToken) {
      return;
    }

    sessionStorage.removeItem("sssVerifiedGoogleLogin");
    setIsEmailVerified(false);
    pendingGoogleLoginRef.current = null;
    setGoogleToken("");
    setIsGoogleVerified(false);
    setMessage("");
  }, [email, selectedRole, isGoogleVerified]);

  // Reset OTP state when phone number is edited
  useEffect(() => {
    setPhoneStep("phone");
    setOtp("");
    setGoogleToken("");
    setIsGoogleVerified(false);
    pendingGoogleLoginRef.current = null;
    setMessage("");
    setOtpMessage("");
  }, [phone]);

  useEffect(() => {
    const verifiedLogin = JSON.parse(sessionStorage.getItem("sssVerifiedGoogleLogin") || "null");
    if (verifiedLogin?.email && verifiedLogin?.role && verifiedLogin?.googleToken) {
      isRestoringGoogleLoginRef.current = true;
      setEmail(verifiedLogin.email);
      setSelectedRole(verifiedLogin.role);
      setIsEmailVerified(true);
      setGoogleToken(verifiedLogin.googleToken);
      setIsGoogleVerified(true);
      completeGoogleLogin({
        email: verifiedLogin.email,
        role: verifiedLogin.role,
        googleToken: verifiedLogin.googleToken
      });
      setIsLoading(false);
      return;
    }

    if (!window.location.hash.includes("id_token")) {
      return;
    }

    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("id_token");
    const state = params.get("state");
    const pendingLogin = JSON.parse(sessionStorage.getItem("sssPendingGoogleLogin") || "null");
    const stateLogin = state ? decodeGoogleState(state) : null;
    const loginContext = pendingLogin?.state === state ? pendingLogin : stateLogin;

    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    if (!token || !loginContext?.email || !loginContext?.role) {
      sessionStorage.removeItem("sssPendingGoogleLogin");
      setIsLoading(false);
      setMessage("Google authentication failed. Please try again.");
      return;
    }

    sessionStorage.removeItem("sssPendingGoogleLogin");
    sessionStorage.setItem("sssVerifiedGoogleLogin", JSON.stringify({
      email: loginContext.email,
      role: loginContext.role,
      googleToken: token
    }));
    
    isRestoringGoogleLoginRef.current = true;
    setEmail(loginContext.email);
    setSelectedRole(loginContext.role);
    setIsEmailVerified(true);
    setGoogleToken(token);
    setIsGoogleVerified(true);
    pendingGoogleLoginRef.current = null;
    
    completeGoogleLogin({
      email: loginContext.email,
      role: loginContext.role,
      googleToken: token
    });
  }, []);

  function dashboardPath(role) {
    const paths = {
      "School Admin": "https://staging.sss.swais.in/admin",
      "Headmaster": "https://staging.sss.swais.in/headmaster",
      "Faculty": "https://staging.sss.swais.in/faculty",
      "Student": "https://staging.sss.swais.in/student",
      "Parent": "https://staging.sss.swais.in/parent/dashboard"
    };
    return paths[role] || "/";
  }

  function submitButtonText() {
    if (isLoading) return "Please wait...";
    if (method === "phone") {
      return phoneStep === "otp" ? "Verify OTP & Login" : "Send OTP";
    }
    return "Continue";
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
      if (response.status === 404) {
        throw new Error("Not authorised to login");
      }
      const detail = typeof data.detail === "string" ? data.detail : "";
      if (detail.toLowerCase().includes("does not exist") || detail.toLowerCase().includes("not found")) {
        throw new Error("Not authorised to login");
      }
      throw new Error(detail || data.message || "Something went wrong. Please try again.");
    }
    return data;
  }

  async function startGoogleVerification(loginContext) {
    if (!googleClientId) {
      setMessage("Google Client ID is not configured.");
      setIsLoading(false);
      return;
    }

    const state = encodeGoogleState({
      email: loginContext.email,
      role: loginContext.role,
      nonce: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`
    });
    const nonce = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const redirectUri = googleRedirectUri || `${window.location.origin}${window.location.pathname}`;
    const nextLoginContext = { ...loginContext, state };

    sessionStorage.removeItem("sssVerifiedGoogleLogin");
    sessionStorage.setItem("sssPendingGoogleLogin", JSON.stringify(nextLoginContext));
    pendingGoogleLoginRef.current = nextLoginContext;

    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: redirectUri,
      response_type: "id_token",
      scope: "openid email profile",
      nonce,
      state,
      prompt: "select_account"
    });

    window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  }

  async function completeGoogleLogin(loginContext) {
    setIsLoading(true);
    setMessage("");

    try {
      const loginResponse = await postJson("/api/auth/login", {
        email: loginContext.email,
        role: loginContext.role,
        googleToken: loginContext.googleToken
      });

      if (!loginResponse.authenticated) {
        setMessage("Authentication could not be completed.");
        return;
      }

      sessionStorage.removeItem("sssVerifiedGoogleLogin");
      completeLogin(loginResponse);
    } catch (error) {
      setMessage(error.message || "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  function completeLogin(data) {
    const session = {
      email: data.email,
      phone: data.phone,
      role: data.role || selectedRole,
      user: data.user
    };

    sessionStorage.setItem("sssUserSession", JSON.stringify(session));
    localStorage.setItem("sssUserSession", JSON.stringify(session));

    if (data.role === "Faculty" && data.access_token) {
       localStorage.setItem("swais_faculty_token", data.access_token);
    }

    const target = data.dashboardPath || dashboardPath(data.role || selectedRole);
    const url = (data.role === "Faculty" && data.access_token)
      ? `${target}${target.includes("?") ? "&" : "?"}token=${encodeURIComponent(data.access_token)}`
      : target;
      
    window.location.assign(url);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setOtpMessage("");

    if (selectedRole === "Select your role" || !selectedRole) {
      setMessage("Please select your role.");
      return;
    }

    if (method === "phone") {
      const normalizedPhone = phone.trim();

      if (!normalizedPhone) {
        setMessage("Please enter your phone number.");
        return;
      }

      setIsLoading(true);
      try {
        if (phoneStep === "phone") {
          await postJson("/api/auth/check-phone", {
            phone: normalizedPhone,
            role: selectedRole
          });
          setPhoneStep("otp");
          // DLT template time matching the backend
          setOtpMessage("OTP sent. It is valid for 10 minutes.");
          return;
        }

        if (!otp.trim()) {
          setMessage("Please enter the OTP.");
          return;
        }

        const loginResponse = await postJson("/api/auth/verify-otp", {
          phone: normalizedPhone,
          role: selectedRole,
          otp: otp.trim()
        });
        
        completeLogin(loginResponse);
        return;
      } catch (error) {
        setMessage(error.message || "Something went wrong. Please try again.");
        return;
      } finally {
        setIsLoading(false);
      }
    }

    if (!email.trim()) {
      setMessage("Please enter your email address.");
      return;
    }

    setIsLoading(true);

    try {
      await postJson("/api/auth/check-email", {
        email: email.trim(),
        role: selectedRole
      });

      if (googleClientId) {
        await startGoogleVerification({
          email: email.trim(),
          role: selectedRole
        });
        return;
      }

      const loginResponse = await postJson("/api/auth/login", {
        email: email.trim(),
        role: selectedRole
      });

      if (!loginResponse.authenticated) {
        setMessage("Authentication could not be completed.");
        return;
      }

      completeLogin(loginResponse);
    } catch (error) {
      console.error('❌ Login error:', error);
      setMessage(error.message || "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="brand-panel" aria-label="SSS Portal">
        <div className="sky-shape top-shape" />
        <div className="dot-grid" aria-hidden="true" />

        <div className="brand-content">
          <SchoolLogo />
          <h1>SSS PORTAL</h1>
          <div className="gold-divider" aria-hidden="true" />
          <p className="tagline">Smart. Global. Secure.</p>
        </div>

        <img className="campus-art" src="/assets/campus-hero.png" alt="Students walking toward a bright school campus" />
        <div className="sky-shape bottom-shape" />
      </section>

      <section className="form-panel" aria-label="Sign in form">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="form-inner">
            <p className="section-title" style={{ marginBottom: '1rem', fontWeight: 'bold' }}>Sign in with</p>

            <div className="tabs" role="tablist" aria-label="Sign in method" style={{ display: 'flex', marginBottom: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
              <button
                className={`tab ${method === "email" ? "active" : ""}`}
                type="button"
                role="tab"
                aria-selected={method === "email"}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', background: method === "email" ? '#f8f4ff' : 'white', border: 'none', cursor: 'pointer', fontWeight: method === "email" ? '600' : '400', color: method === "email" ? '#4f46e5' : '#64748b' }}
                onClick={() => {
                  setMethod("email");
                  setMessage("");
                  setOtpMessage("");
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
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', background: method === "phone" ? '#f8f4ff' : 'white', border: 'none', borderLeft: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: method === "phone" ? '600' : '400', color: method === "phone" ? '#4f46e5' : '#64748b' }}
                onClick={() => {
                  setMethod("phone");
                  setIsEmailVerified(false);
                  setMessage("");
                  setOtpMessage("");
                }}
              >
                <PhoneIcon />
                <span>Phone Number</span>
              </button>
            </div>

            {method === "email" ? (
              <label className="field-group" style={{ display: 'flex', flexDirection: 'column', marginBottom: '1rem' }}>
                <span style={{ fontWeight: '600', marginBottom: '8px', fontSize: '14px' }}>Email Address</span>
                <span className="input-wrap" style={{ display: 'flex', alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px', gap: '10px' }}>
                  <MailIcon />
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="Enter your email address"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={isLoading}
                    style={{ border: 'none', outline: 'none', flex: 1, fontSize: '14px' }}
                  />
                </span>
              </label>
            ) : (
              <label className="field-group" style={{ display: 'flex', flexDirection: 'column', marginBottom: '1rem' }}>
                <span style={{ fontWeight: '600', marginBottom: '8px', fontSize: '14px' }}>Phone Number</span>
                <span className="input-wrap" style={{ display: 'flex', alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px', gap: '10px' }}>
                  <PhoneIcon />
                  <input
                    type="tel"
                    autoComplete="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="Enter your 10-digit phone number"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))}
                    disabled={isLoading}
                    style={{ border: 'none', outline: 'none', flex: 1, fontSize: '14px' }}
                  />
                </span>
              </label>
            )}

            <div className="field-group role-dropdown" ref={roleDropdownRef} style={{ display: 'flex', flexDirection: 'column', marginBottom: '1rem' }}>
              <span style={{ fontWeight: '600', marginBottom: '8px', fontSize: '14px' }}>Select Role</span>
              <button
                className={`select-box ${isRoleOpen ? "open" : ""}`}
                type="button"
                aria-expanded={isRoleOpen}
                disabled={isLoading}
                onClick={() => setIsRoleOpen((current) => !current)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px', background: 'white', cursor: 'pointer' }}
              >
                <span className="select-label" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: selectedRole === "Select your role" ? '#94a3b8' : '#0f172a' }}>
                  <UsersIcon />
                  <span id="selectedRole">{selectedRole}</span>
                </span>
                <ChevronIcon />
              </button>
              
              {isRoleOpen ? (
                <div className="role-menu" role="listbox" aria-label="Role options" style={{ border: '1px solid #e2e8f0', borderRadius: '8px', marginTop: '4px', background: 'white', position: 'absolute', width: '100%', zIndex: 10 }}>
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
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: selectedRole === role ? '#f8f4ff' : 'white', cursor: 'pointer', fontSize: '14px' }}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* OTP Input Field - Only visible when phoneStep is 'otp' */}
            {method === "phone" && phoneStep === "otp" && (
              <label className="field-group" style={{ display: 'flex', flexDirection: 'column', marginBottom: '1.5rem', animation: 'fadeIn 0.3s ease-in' }}>
                <span style={{ fontWeight: '600', marginBottom: '8px', fontSize: '14px' }}>OTP</span>
                <span className="input-wrap" style={{ display: 'flex', alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px', gap: '10px' }}>
                  <LockIcon />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="Enter OTP"
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    disabled={isLoading}
                    style={{ border: 'none', outline: 'none', flex: 1, fontSize: '14px', letterSpacing: otp ? '4px' : 'normal' }}
                    required
                  />
                </span>
                {otpMessage && (
                  <span style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px', fontWeight: '500' }}>
                    {otpMessage}
                  </span>
                )}
              </label>
            )}

            {method === "email" && (
              <div className="form-links-row" style={{ marginBottom: '1.5rem' }}>
                <label className="remember" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#64748b' }}>
                  <input type="checkbox" />
                  <span>Remember me</span>
                </label>
              </div>
            )}

            {message && !otpMessage ? (
              <p className="form-message" role="alert" style={{ color: '#ef4444', fontSize: '14px', marginBottom: '1rem' }}>
                {message}
              </p>
            ) : null}

            <button 
              className="sign-in" 
              type="submit" 
              style={{ width: '100%', padding: '12px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '600', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '1.5rem' }}
              disabled={isLoading || (method === "phone" && phoneStep === "otp" && otp.length !== 6) || (method === "phone" && phoneStep === "phone" && phone.length < 10)}
            >
              {isLoading ? <span className="loader" aria-hidden="true" /> : <LockIcon />}
              <span>{submitButtonText()}</span>
            </button>

            <div className="or-row" style={{ textAlign: 'center', position: 'relative', marginBottom: '1.5rem' }}>
              <span style={{ background: 'white', padding: '0 10px', color: '#94a3b8', fontSize: '12px', position: 'relative', zIndex: 1 }}>or</span>
              <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', background: '#e2e8f0', zIndex: 0 }} />
            </div>
            
            <p className="administrator" style={{ textAlign: 'center', fontSize: '14px', color: '#64748b' }}>
              Don't have an account? <strong style={{ color: '#0f172a' }}>Contact your administrator</strong>
            </p>
          </div>
        </form>

        <footer className="footer" style={{ marginTop: '2rem', textAlign: 'center', fontSize: '12px', color: '#94a3b8', display: 'flex', justifyContent: 'center', gap: '15px' }}>
          <span>&copy; 2026 SSS Portal. All rights reserved.</span>
          <span className="footer-link" style={{ cursor: 'pointer' }}>Privacy Policy</span>
          <span className="footer-link" style={{ cursor: 'pointer' }}>Terms of Use</span>
        </footer>
      </section>
    </main>
  );
}