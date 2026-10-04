import React, { useState } from 'react'
import { createFHIRCase } from './fhirService'
import { classifyInvestigationValue } from './clinicalSummaryService'

function SummaryList({ items, emptyLabel = 'Not reported.' }) {
  return items?.length ? <ul className="ai-clinical-list">{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="ai-clinical-empty">{emptyLabel}</p>
}

function InvestigationBar({ investigation }) {
  const { value, referenceLow, referenceHigh } = investigation
  const hasLow = Number.isFinite(referenceLow)
  const hasHigh = Number.isFinite(referenceHigh)
  const status = classifyInvestigationValue(investigation)
  const boundaries = [value, ...(hasLow ? [referenceLow] : []), ...(hasHigh ? [referenceHigh] : [])]
  const minimumBoundary = Math.min(...boundaries, 0)
  const maximumBoundary = Math.max(...boundaries)
  const padding = Math.max((maximumBoundary - minimumBoundary) * 0.12, Math.abs(maximumBoundary || 1) * 0.06, 1)
  const scaleMinimum = Math.min(0, minimumBoundary - (minimumBoundary < 0 ? padding : 0))
  const scaleMaximum = maximumBoundary + padding
  const scaleRange = scaleMaximum - scaleMinimum || 1
  const percent = (number) => Math.max(0, Math.min(100, ((number - scaleMinimum) / scaleRange) * 100))
  const patientWidth = `${Math.max(2, percent(value))}%`
  const referenceStart = hasLow ? percent(referenceLow) : 0
  const referenceEnd = hasHigh ? percent(referenceHigh) : 100
  const referenceWidth = `${Math.max(2, referenceEnd - referenceStart)}%`

  return (
    <article className="investigation-bar-card">
      <div className="investigation-card-header">
        <strong>{investigation.testName}</strong>
        <span className={`investigation-status ${status.toLowerCase()}`}>{status.replaceAll('_', ' ')}</span>
      </div>
      <div className="investigation-value-row">
        <span>Patient value</span>
        <strong>{value} {investigation.unit}</strong>
      </div>
      <div className={`investigation-comparison-track patient ${status.toLowerCase()}`} aria-label={`${investigation.testName} patient value: ${value} ${investigation.unit}`}>
        <span style={{ width: patientWidth }} />
      </div>
      <div className="investigation-value-row reference">
        <span>Reference range</span>
        <strong>{investigation.referenceText}</strong>
      </div>
      <div className="investigation-comparison-track reference" aria-label={`${investigation.testName} reference range: ${investigation.referenceText}`}>
        <span style={{ left: `${referenceStart}%`, width: referenceWidth }} />
      </div>
      <p className="investigation-scale-note">Both bars use the same scale for this test.</p>
    </article>
  )
}

function DoctorDashboard({
  patient,
  caseSummary,
  caseRedFlag,
  redFlagAssessment,
  clinicalSummary,
  clinicalSummaryStatus,
  onBack,
  onLogout
}) {

  const [selectedPatient, setSelectedPatient] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filter, setFilter] = useState('all')
  const [showShareModal, setShowShareModal] = useState(false)
  const [showFHIRModal, setShowFHIRModal] = useState(false)

    const patients = [
    {
      id: 1,
      name: patient?.name || 'Current Patient',
      age: patient?.age || '-',
      gender: patient?.gender || '-',
      complaint: caseSummary?.complaint || 'Case history available',
      mode: caseSummary?.mode || 'General',
      redFlag: caseRedFlag,
      redFlagAssessment,
      current: true
    },
    {
      id: 2,
      name: 'Aniket Raj',
      age: 24,
      gender: 'Male',
      complaint: 'Abdominal Pain',
      mode: 'General',
      redFlag: false,
      current: false
    },
    {
      id: 3,
      name: 'Priya Singh',
      age: 31,
      gender: 'Female',
      complaint: 'High Fever',
      mode: 'General',
      redFlag: true,
      current: false
    },
    {
      id: 4,
      name: 'Pankaj Kumar',
      age: 45,
      gender: 'Male',
      complaint: 'Digestive Issues',
      mode: 'AYUSH',
      redFlag: false,
      current: false
    }
  ]

  const filteredPatients = patients.filter((item) => {

    const matchesSearch =
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.complaint.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesFilter =
      filter === 'all' ||
      (filter === 'red-flag' && item.redFlag) ||
      (filter === 'normal' && !item.redFlag)

    return matchesSearch && matchesFilter
  })

  const patientName = patient?.name || 'Patient'
  const patientAge = patient?.age || '-'
  const patientGender = patient?.gender || '-'
  const patientMobile = patient?.mobile || '-'

  if (selectedPatient) {
  const p = selectedPatient
  const isCurrent = p.current

  const detailSummary = isCurrent ? caseSummary : null
  const detailRedFlagAssessment = isCurrent ? redFlagAssessment : null

  const fhirRecord = createFHIRCase(
  isCurrent ? patient : {
    name: p.name,
    age: p.age,
    gender: p.gender,
    mobile: ''
  },
  detailSummary,
  p.redFlag
)

  const shareText = `
MediKiosk - Patient Case Summary

Patient Name: ${p.name}
Age: ${p.age}
Gender: ${p.gender}
Case Mode: ${p.mode}
Chief Complaint: ${p.complaint}
Risk Status: ${p.redFlag ? 'Red Flag Detected' : 'No Red Flag'}

${
  detailSummary
    ? Object.entries(detailSummary)
        .filter(([key]) => key !== 'mode')
        .map(
          ([key, value]) =>
            `${key
              .replace(/([A-Z])/g, ' $1')
              .replace(/^./, (str) => str.toUpperCase())}: ${value || 'Not provided'}`
        )
        .join('\n')
    : ''
}

Note: This is an AI-assisted case draft. Doctor verification is required before clinical decision-making.
`

  return (
    <div className="doctor-dashboard-page">
      <div className="doctor-dashboard-container">

        {/* Header */}
        <div className="doctor-dashboard-header">
          <div>
            <span className="dashboard-eyebrow">
              PATIENT CASE
            </span>

            <h1>Patient Detailed Case View</h1>

            <p>
              Complete clinical information for doctor review
            </p>
          </div>

          <button
            className="dashboard-back-btn"
            onClick={() => setSelectedPatient(null)}
          >
            ← Back to Patients
          </button>
        </div>

        {/* Patient Basic Information */}
        <div className="case-detail-card">

          <div className="case-detail-title">
            <span>👤</span>
            <div>
              <h2>{p.name}</h2>
              <p>Patient Information</p>
            </div>

            <span
              className={
                p.redFlag
                  ? 'case-status red'
                  : 'case-status normal'
              }
            >
              {p.redFlag ? '⚠ Red Flag' : '✓ Normal'}
            </span>
          </div>

          <div className="patient-info-grid">
            <div>
              <span>Age</span>
              <strong>{p.age}</strong>
            </div>

            <div>
              <span>Gender</span>
              <strong>{p.gender}</strong>
            </div>

            <div>
              <span>Case Mode</span>
              <strong>{p.mode}</strong>
            </div>

            <div>
              <span>Chief Complaint</span>
              <strong>{p.complaint}</strong>
            </div>
          </div>
        </div>

        {/* Clinical Summary */}
        {detailSummary && (
          <div className="case-detail-card">

            <div className="case-section-heading">
              <span>🩺</span>
              <div>
                <h2>Clinical Summary</h2>
                <p>AI-generated draft for doctor verification</p>
              </div>
            </div>

            <div className="clinical-summary-grid">

              {Object.entries(detailSummary).map(([key, value]) => (
                key !== 'mode' && (
                  <div
                    className="clinical-summary-item"
                    key={key}
                  >
                    <span>
                      {key
                        .replace(/([A-Z])/g, ' $1')
                        .replace(/^./, (str) => str.toUpperCase())}
                    </span>

                    <strong>
                      {value || 'Not provided'}
                    </strong>
                  </div>
                )
              ))}

            </div>
          </div>
        )}

        {/* Red Flag Alert */}
        {p.redFlag && (
          <div className="case-red-flag-alert">
            <div className="red-flag-icon">⚠</div>

            <div>
              <h3>Red Flag Detected</h3>
              {detailRedFlagAssessment?.priority && (
                <p><strong>Priority: {detailRedFlagAssessment.priority}</strong></p>
              )}
              <p>
                This case contains symptoms that may require
                immediate clinical attention. Please review the
                patient's responses carefully.
              </p>
              {detailRedFlagAssessment?.reasons?.length > 0 && (
                <div className="doctor-red-flag-reasons">
                  <strong>Why it was flagged</strong>
                  <ul>{detailRedFlagAssessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                  {detailRedFlagAssessment.sources?.length > 0 && <small>Detection source: {detailRedFlagAssessment.sources.join(' + ')}</small>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Case Sheet Actions */}
<div className="case-sheet-actions">
  <div>
    <span className="dashboard-eyebrow">CASE DOCUMENT</span>
    <h3>Doctor Case Sheet</h3>
    <p>
      Generate or share this patient's case summary.
    </p>
  </div>

  <div className="case-action-buttons">
    <button
      className="print-case-btn"
      onClick={() => window.print()}
    >
      🖨️ Print Case
    </button>

    <button
      className="share-case-btn"
      onClick={() => setShowShareModal(true)}
    >
      📤 Share Case
    </button>
  </div>
</div>

{/* ABDM / FHIR Integration */}
<div className="case-detail-card fhir-card">

  <div className="case-section-heading">
    <span>🔗</span>

    <div>
      <h2>ABDM / FHIR Record</h2>
      <p>
        Structured healthcare record prepared for interoperability.
      </p>
    </div>

    <span className="fhir-status">
      ✓ FHIR Ready
    </span>
  </div>

  <div className="fhir-info-grid">

    <div>
      <span>Resource Type</span>
      <strong>{fhirRecord.resourceType}</strong>
    </div>

    <div>
      <span>Bundle Type</span>
      <strong>{fhirRecord.type}</strong>
    </div>

    <div>
      <span>FHIR Entries</span>
      <strong>{fhirRecord.entry?.length || 0}</strong>
    </div>

    <div>
      <span>Integration</span>
      <strong>ABDM Compatible</strong>
    </div>

  </div>

  <div className="fhir-actions">
  <button
    className="view-fhir-btn"
    onClick={() => setShowFHIRModal(true)}
  >
    🔍 View FHIR JSON
  </button>
</div>

  <div className="fhir-note">
    <span>ℹ️</span>

    <p>
      This is a prototype FHIR record generated from the patient's
      case information. In a production system, the record can be
      securely exchanged with authorized healthcare systems through
      ABDM-compatible infrastructure.
    </p>
  </div>

</div>

        {/* Doctor Review */}
        <div className="case-detail-card doctor-review-card">

          <div className="case-section-heading">
            <span>👨‍⚕️</span>
            <div>
              <h2>Doctor Review</h2>
              <p>Clinical decision remains with the treating doctor.</p>
            </div>
          </div>

          <div className="doctor-review-note">
            <span>ℹ️</span>

            <p>
              This information is an AI-assisted patient case draft.
              The doctor should verify all details with the patient
              before making any clinical decision.
            </p>
          </div>

        </div>

        {showShareModal && (
  <div
    className="share-modal-overlay"
    onClick={() => setShowShareModal(false)}
  >
    <div
      className="share-modal"
      onClick={(e) => e.stopPropagation()}
    >

      <div className="share-modal-header">
        <div>
          <span className="dashboard-eyebrow">
            CASE SHARING
          </span>

          <h2>Share Patient Case</h2>

          <p>
            Choose how you want to share this case summary.
          </p>
        </div>

        <button
          className="share-modal-close"
          onClick={() => setShowShareModal(false)}
        >
          ×
        </button>
      </div>

      <div className="share-patient-preview">
        <div className="share-patient-avatar">
          {p.name.charAt(0).toUpperCase()}
        </div>

        <div>
          <strong>{p.name}</strong>
          <span>
            {p.age} yrs • {p.gender} • {p.mode} Case
          </span>
        </div>

        <span
          className={
            p.redFlag
              ? 'case-status red'
              : 'case-status normal'
          }
        >
          {p.redFlag ? '⚠ Red Flag' : '✓ Normal'}
        </span>
      </div>

      <div className="share-options">

        <button
          className="share-option"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(shareText)
              alert('Case summary copied successfully!')
            } catch {
              alert('Unable to copy the case summary.')
            }
          }}
        >
          <span className="share-option-icon">📋</span>
          <div>
            <strong>Copy Summary</strong>
            <small>Copy case details to clipboard</small>
          </div>
          <span>→</span>
        </button>

        <button
          className="share-option"
          onClick={() => {
            const whatsappUrl =
              `https://wa.me/?text=${encodeURIComponent(shareText)}`

            window.open(whatsappUrl, '_blank')
          }}
        >
          <span className="share-option-icon">💬</span>
          <div>
            <strong>WhatsApp</strong>
            <small>Share case summary via WhatsApp</small>
          </div>
          <span>→</span>
        </button>

        <button
          className="share-option"
          onClick={() => {
            const subject =
              `MediKiosk Patient Case - ${p.name}`

            const mailto =
              `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(shareText)}`

            window.location.href = mailto
          }}
        >
          <span className="share-option-icon">📧</span>
          <div>
            <strong>Email</strong>
            <small>Send case summary by email</small>
          </div>
          <span>→</span>
        </button>

        <button
          className="share-option"
          onClick={() => {
            setShowShareModal(false)
            window.print()
          }}
        >
          <span className="share-option-icon">🖨️</span>
          <div>
            <strong>Print Case Sheet</strong>
            <small>Print the complete clinical case</small>
          </div>
          <span>→</span>
        </button>

      </div>

      <div className="share-modal-footer">
        🔒 Patient information should only be shared with authorized
        healthcare personnel.
      </div>

    </div>
  </div>
)}

{showFHIRModal && (
  <div
    className="fhir-modal-overlay"
    onClick={() => setShowFHIRModal(false)}
  >
    <div
      className="fhir-modal"
      onClick={(e) => e.stopPropagation()}
    >

      <div className="fhir-modal-header">
        <div>
          <span className="dashboard-eyebrow">
            INTEROPERABILITY
          </span>

          <h2>FHIR JSON Record</h2>

          <p>
            Structured healthcare data generated by MediKiosk.
          </p>
        </div>

        <button
          className="fhir-modal-close"
          onClick={() => setShowFHIRModal(false)}
        >
          ×
        </button>
      </div>

      <div className="fhir-json-container">
        <pre>
          {JSON.stringify(fhirRecord, null, 2)}
        </pre>
      </div>

      <div className="fhir-modal-actions">

        <button
          className="fhir-copy-btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                JSON.stringify(fhirRecord, null, 2)
              )

              alert('FHIR JSON copied successfully!')
            } catch {
              alert('Unable to copy FHIR JSON.')
            }
          }}
        >
          📋 Copy JSON
        </button>

        <button
          className="fhir-close-btn"
          onClick={() => setShowFHIRModal(false)}
        >
          Close
        </button>

      </div>

    </div>
  </div>
)}

      </div>
    </div>
  )
}

  return (
    <div className="doctor-page">

      {/* Header */}
      <div className="doctor-header">

        <div className="patient-logo">
          <div className="logo-icon">✚</div>
          <span>MediKiosk</span>
        </div>

        <div className="doctor-header-title">
          <span>CLINICAL WORKSPACE</span>
          <h2>Doctor Dashboard</h2>
        </div>

        <div className="doctor-header-actions">
  <button
    className="dashboard-back-btn"
    onClick={onBack}
  >
    ← Back
  </button>

  <button
    className="doctor-logout-button"
    onClick={onLogout}
  >
    ↪ Logout
  </button>
</div>

      </div>

      {/* Main */}
      <div className="doctor-dashboard">

        {/* Welcome */}
        <div className="doctor-welcome">
          <div>
            <span className="eyebrow">PATIENT CASE REVIEW</span>
            <h1>Clinical Overview</h1>
            <p>
              Review the patient's case history, AI-assisted summary
              and reported information before consultation.
            </p>
          </div>

          <div className="doctor-status">
            <span className="status-dot"></span>
            Ready for Review
          </div>
        </div>

        {/* Patient Card */}
        <div className="doctor-patient-card">

          <div className="patient-avatar">
            {patientName.charAt(0).toUpperCase()}
          </div>

          <div className="doctor-patient-info">
            <span className="card-label">PATIENT</span>
            <h2>{patientName}</h2>

            <div className="patient-meta">
              <span>Age: {patientAge}</span>
              <span>Gender: {patientGender}</span>
              <span>Mobile: {patientMobile}</span>
            </div>
          </div>

          <div className="case-mode-badge">
            {caseSummary?.mode || 'General'} Case
          </div>

        </div>

        {/* Stats */}
        <div className="doctor-stats">

          <div className="doctor-stat-card">
            <span className="stat-icon">🩺</span>
            <div>
              <span>Case Status</span>
              <strong>Completed</strong>
            </div>
          </div>

          <div className="doctor-stat-card">
            <span className="stat-icon">📋</span>
            <div>
              <span>History</span>
              <strong>Available</strong>
            </div>
          </div>

          <div className="doctor-stat-card">
            <span className="stat-icon">📄</span>
            <div>
              <span>Medical Report</span>
              <strong>
                {patient?.report ? 'Uploaded' : 'Not Uploaded'}
              </strong>
            </div>
          </div>

          <div className={`doctor-stat-card ${caseRedFlag ? 'danger-stat' : ''}`}>
            <span className="stat-icon">
              {caseRedFlag ? '⚠️' : '✓'}
            </span>
            <div>
              <span>Risk Status</span>
              <strong>
                {caseRedFlag ? 'Red Flag' : 'No Red Flag'}
              </strong>
            </div>
          </div>

        </div>

        {/* Red Flag */}
        {caseRedFlag && (
          <div className="doctor-alert">

            <div className="alert-icon">⚠</div>

            <div>
              <strong>Red Flag Detected</strong>
              {redFlagAssessment?.priority && <span className="doctor-alert-priority">Priority: {redFlagAssessment.priority}</span>}
              <p>
                The patient's responses contain information that
                may require prompt clinical attention.
                Please verify the information before consultation.
              </p>
              {redFlagAssessment?.reasons?.length > 0 && (
                <div className="doctor-red-flag-reasons">
                  <strong>Why it was flagged</strong>
                  <ul>{redFlagAssessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                  {redFlagAssessment.sources?.length > 0 && <small>Detection source: {redFlagAssessment.sources.join(' + ')}</small>}
                </div>
              )}
            </div>

          </div>
        )}

                {/* Patient List */}
        <div className="doctor-section patient-list-section">

          <div className="section-heading">
            <div>
              <span className="eyebrow">PATIENTS</span>
              <h2>Patient List</h2>
            </div>

            <span className="patient-count">
              {filteredPatients.length} Patients
            </span>
          </div>

          {/* Search + Filter */}
          <div className="patient-list-controls">

            <div className="patient-search">
              <span>🔍</span>

              <input
                type="text"
                placeholder="Search patient or complaint..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="patient-filters">

              <button
                className={filter === 'all' ? 'active' : ''}
                onClick={() => setFilter('all')}
              >
                All
              </button>

              <button
                className={filter === 'red-flag' ? 'active red' : ''}
                onClick={() => setFilter('red-flag')}
              >
                ⚠️ Red Flag
              </button>

              <button
                className={filter === 'normal' ? 'active' : ''}
                onClick={() => setFilter('normal')}
              >
                ✓ Normal
              </button>

            </div>

          </div>

          {/* Patients */}
          <div className="patient-list">

            {filteredPatients.length > 0 ? (

              filteredPatients.map((item) => (

                <div
  className={`patient-list-item ${
    item.current ? 'current-patient' : ''
  }`}
  key={item.id}
  onClick={() => setSelectedPatient(item)}
>

                  <div className="patient-list-avatar">
                    {item.name.charAt(0).toUpperCase()}
                  </div>

                  <div className="patient-list-info">

                    <div className="patient-list-name">
                      <strong>{item.name}</strong>

                      {item.current && (
                        <span className="current-badge">
                          Current Case
                        </span>
                      )}
                    </div>

                    <div className="patient-list-meta">
                      <span>
                        {item.age} yrs
                      </span>

                      <span>
                        {item.gender}
                      </span>

                      <span>
                        {item.complaint}
                      </span>
                    </div>

                  </div>

                  <div className="patient-list-right">

                    <span className="mode-small">
                      {item.mode}
                    </span>

                    {item.redFlag ? (
                      <span className="risk-badge danger">
                        ⚠ Red Flag
                      </span>
                    ) : (
                      <span className="risk-badge normal">
                        ✓ Normal
                      </span>
                    )}

                  </div>

                </div>

              ))

            ) : (

              <div className="patient-empty">
                <span>🔍</span>
                <p>No patients found.</p>
              </div>

            )}

          </div>

        </div>

        {/* AI clinical summary — separate from the original structured case. */}
        <div className="doctor-section ai-clinical-summary-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">AI-ASSISTED</span>
              <h2>Clinical Summary</h2>
            </div>
            <span className="draft-badge">AI Draft • Physician Review Required</span>
          </div>

          {clinicalSummaryStatus === 'LOADING' && <div className="empty-summary">Preparing an AI-assisted clinical summary…</div>}
          {clinicalSummaryStatus === 'UNAVAILABLE' && <div className="empty-summary">AI clinical summary unavailable. Existing structured case information is shown below.</div>}
          {clinicalSummaryStatus !== 'LOADING' && clinicalSummary && (
            <>
              <p className="ai-assistance-notice">AI-assisted clinical summary for physician review. It does not diagnose or replace clinical judgement.</p>
              <div className="ai-clinical-grid">
                <article className="ai-clinical-card"><h3>Patient Information</h3><p>Age: {patientAge} · Gender: {patientGender}</p></article>
                <article className="ai-clinical-card"><h3>Chief Complaint</h3><p>{clinicalSummary.chiefComplaint}</p></article>
                <article className="ai-clinical-card full-width"><h3>History of Present Illness</h3><p>{clinicalSummary.historyOfPresentIllness}</p></article>
                <article className="ai-clinical-card"><h3>Symptoms</h3><SummaryList items={clinicalSummary.symptoms} /></article>
                <article className="ai-clinical-card"><h3>Duration / Severity</h3><p>Duration: {clinicalSummary.duration}</p><p>Severity: {clinicalSummary.severity}</p></article>
                <article className="ai-clinical-card"><h3>Relevant Negative Findings</h3><SummaryList items={clinicalSummary.relevantNegativeFindings} /></article>
                <article className="ai-clinical-card"><h3>Medical History</h3><SummaryList items={clinicalSummary.medicalHistory} /></article>
                <article className="ai-clinical-card"><h3>Medications</h3><SummaryList items={clinicalSummary.medications} /></article>
                <article className="ai-clinical-card"><h3>Allergies</h3><SummaryList items={clinicalSummary.allergies} /></article>
                <article className="ai-clinical-card"><h3>Investigations</h3><SummaryList items={clinicalSummary.investigations} /></article>
                <article className="ai-clinical-card full-width"><h3>Medical Report Findings</h3><SummaryList items={clinicalSummary.reportFindings} emptyLabel="No report findings available." /></article>
                {clinicalSummary.caseMode === 'AYUSH' && <article className="ai-clinical-card full-width"><h3>AYUSH Context</h3><SummaryList items={clinicalSummary.ayushContext} /></article>}
                <article className="ai-clinical-card"><h3>Important Points for Doctor</h3><SummaryList items={clinicalSummary.importantPointsForDoctor} /></article>
                <article className="ai-clinical-card"><h3>Missing Information</h3><SummaryList items={clinicalSummary.missingInformation} /></article>
              </div>

              <div className="ai-red-flag-summary">
                <h3>Red Flag Assessment</h3>
                <p><strong>{redFlagAssessment?.detected ? 'Priority alert' : 'No Red Flag detected'}</strong> · Priority: {redFlagAssessment?.priority || 'NORMAL'}</p>
                <SummaryList items={redFlagAssessment?.reasons} emptyLabel="No Red Flag reasons recorded." />
              </div>

              <div className="clinical-trends-section investigation-overview-section">
                <h3>Investigation Overview</h3>
                <p className="ai-assistance-notice">Patient values compared with reference ranges provided in the uploaded report.</p>
                {clinicalSummary.investigationData?.length ? (
                  <div className="investigation-bar-grid">
                    {clinicalSummary.investigationData.map((investigation) => <InvestigationBar key={`${investigation.testName}-${investigation.value}-${investigation.referenceText}`} investigation={investigation} />)}
                  </div>
                ) : patient?.report ? (
                  <p className="ai-clinical-empty">No sufficient reference-range data available for investigation comparison.</p>
                ) : (
                  <p className="ai-clinical-empty">No investigation report data available for comparison.</p>
                )}
              </div>
            </>
          )}
          {clinicalSummaryStatus === 'IDLE' && <div className="empty-summary">AI clinical summary will be available after case information is submitted.</div>}
        </div>

        {/* Existing structured summary remains available as a safe fallback. */}
        <div className="doctor-section">

          <div className="section-heading">
            <div>
              <span className="eyebrow">AI-ASSISTED</span>
              <h2>Structured Case Information</h2>
            </div>

            <span className="draft-badge">
              AI Draft • Doctor Verification Required
            </span>
          </div>

          {caseSummary ? (

            <div className="clinical-summary-grid">

              <div className="clinical-item">
                <span>Chief Complaint</span>
                <strong>
                  {caseSummary.complaint || 'Not provided'}
                </strong>
              </div>

              <div className="clinical-item">
                <span>Duration</span>
                <strong>
                  {caseSummary.duration || 'Not provided'}
                </strong>
              </div>

              {caseSummary.mode !== 'AYUSH' && (
                <>
                  <div className="clinical-item">
                    <span>Location</span>
                    <strong>
                      {caseSummary.location || 'Not provided'}
                    </strong>
                  </div>

                  <div className="clinical-item">
                    <span>Severity</span>
                    <strong>
                      {caseSummary.severity || 'Not provided'}
                    </strong>
                  </div>

                  <div className="clinical-item full-width">
                    <span>Associated Symptoms</span>
                    <strong>
                      {caseSummary.associated || 'None reported'}
                    </strong>
                  </div>
                </>
              )}

              {caseSummary.mode === 'AYUSH' && (
                <>
                  <div className="clinical-item">
                    <span>Agni / Appetite & Digestion</span>
                    <strong>{caseSummary.agni}</strong>
                  </div>

                  <div className="clinical-item">
                    <span>Digestion</span>
                    <strong>{caseSummary.digestion}</strong>
                  </div>

                  <div className="clinical-item">
                    <span>Sleep</span>
                    <strong>{caseSummary.sleep}</strong>
                  </div>

                  <div className="clinical-item">
                    <span>Diet</span>
                    <strong>{caseSummary.diet}</strong>
                  </div>

                  <div className="clinical-item">
                    <span>Bowel Habit</span>
                    <strong>{caseSummary.bowel}</strong>
                  </div>

                  <div className="clinical-item">
                    <span>Urination</span>
                    <strong>{caseSummary.urination}</strong>
                  </div>

                  <div className="clinical-item">
                    <span>Lifestyle</span>
                    <strong>{caseSummary.lifestyle}</strong>
                  </div>

                  <div className="clinical-item">
                    <span>Stress / Mental State</span>
                    <strong>{caseSummary.stress}</strong>
                  </div>

                  <div className="clinical-item full-width">
                    <span>Current Treatment</span>
                    <strong>{caseSummary.treatment}</strong>
                  </div>
                </>
              )}

            </div>

          ) : (

            <div className="empty-summary">
              No clinical summary available.
            </div>

          )}

        </div>

        {/* Medical Report */}
        <div className="doctor-section">

          <div className="section-heading">
            <div>
              <span className="eyebrow">DOCUMENTS</span>
              <h2>Medical Reports</h2>
            </div>
          </div>

          {patient?.report ? (

            <div className="report-preview-card">

              <div className="report-file-icon">
                📄
              </div>

              <div className="report-file-info">
                <strong>{patient.report.fileName}</strong>
                <span>
                  OCR text extracted for clinical review
                </span>
              </div>

              <span className="report-status">
                Uploaded
              </span>

            </div>

          ) : (

            <div className="empty-report">
              <span>📂</span>
              <p>No medical report uploaded by the patient.</p>
            </div>

          )}

        </div>

        {/* Doctor Action */}
        <div className="doctor-action-bar">

          <div>
            <strong>Ready for consultation</strong>
            <p>
              Verify the AI-generated summary before using it
              for clinical decision-making.
            </p>
          </div>

          <div className="doctor-review-ready">
  ✓ Case Ready for Doctor Review
</div>

        </div>

      </div>

    </div>
  )
}

export default DoctorDashboard
