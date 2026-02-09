import Link from 'next/link';

export default function Page() {
  return (
    <main>
      <section className="hero">
        <h1>Build ATS-ready resumes in minutes.</h1>
        <p className="small">
          Clean, scannable templates. Skill matching. Smart guidance for students and professionals.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link className="btn" href="/auth/register">Get started</Link>
          <Link className="btn secondary" href="/resume">Open editor</Link>
        </div>
      </section>

      <section className="grid">
        <div className="card col-7">
          <h3>Resume Editor</h3>
          <p className="small">
            Create ATS-safe resumes with structured sections and plain-text friendly formatting.
          </p>
        </div>
        <div className="card col-5">
          <h3>AI Suggestions</h3>
          <p className="small">
            Get targeted improvements for impact, clarity, and keyword alignment.
          </p>
        </div>
        <div className="card col-12">
          <h3>Job Description Matching</h3>
          <p className="small">
            Upload a JD to calculate match %, skill gaps, and tailored guidance.
          </p>
        </div>
      </section>
    </main>
  );
}
