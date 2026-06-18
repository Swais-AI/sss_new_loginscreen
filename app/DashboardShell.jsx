"use client";

import { useEffect, useMemo, useState } from "react";

const roleLabels = {
  Student: "Student Dashboard",
  Faculty: "Faculty Dashboard",
  Headmaster: "Headmaster Dashboard",
  Parent: "Parent Dashboard",
  Admin: "Admin Dashboard"
};

export default function DashboardShell({ role }) {
  const [session, setSession] = useState(null);

  useEffect(() => {
    const storedSession = sessionStorage.getItem("sssUserSession") || localStorage.getItem("sssUserSession");

    if (!storedSession) {
      window.location.replace("/");
      return;
    }

    try {
      setSession(JSON.parse(storedSession));
    } catch {
      sessionStorage.removeItem("sssUserSession");
      localStorage.removeItem("sssUserSession");
      window.location.replace("/");
    }
  }, []);

  const displayName = useMemo(() => {
    if (!session?.user) {
      return session?.email || "User";
    }

    return (
      session.user.name ||
      session.user.full_name ||
      session.user.student_name ||
      session.user.teacher_name ||
      session.user.parent_name ||
      session.email ||
      "User"
    );
  }, [session]);

  function handleLogout() {
    sessionStorage.removeItem("sssUserSession");
    localStorage.removeItem("sssUserSession");
    window.location.replace("/");
  }

  if (!session) {
    return (
      <main className="dashboard-page">
        <p className="dashboard-loading">Loading...</p>
      </main>
    );
  }

  return (
    <main className="dashboard-page">
      <section className="dashboard-panel">
        <div>
          <p className="dashboard-kicker">SSS Portal</p>
          <h1>{roleLabels[role]}</h1>
          <p className="dashboard-copy">Welcome, {displayName}. Your login was completed successfully.</p>
        </div>

        <dl className="dashboard-details">
          <div>
            <dt>Email</dt>
            <dd>{session.email || "Not available"}</dd>
          </div>
          {session.phone ? (
            <div>
              <dt>Phone</dt>
              <dd>{session.phone}</dd>
            </div>
          ) : null}
          <div>
            <dt>Role</dt>
            <dd>{session.role}</dd>
          </div>
        </dl>

        <button className="dashboard-logout" type="button" onClick={handleLogout}>
          Sign Out
        </button>
      </section>
    </main>
  );
}
