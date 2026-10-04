// ==========================================
// MediKiosk - FHIR Mock Service
// ==========================================

export function createFHIRPatient(patient) {
  return {
    resourceType: 'Patient',

    id: `medikiosk-patient-${Date.now()}`,

    identifier: [
      {
        system: 'https://medikiosk.example/patient-id',
        value: `AAR-${Date.now()}`
      }
    ],

    name: [
      {
        use: 'official',
        text: patient?.name || 'Unknown Patient'
      }
    ],

    gender:
      patient?.gender?.toLowerCase() === 'male'
        ? 'male'
        : patient?.gender?.toLowerCase() === 'female'
        ? 'female'
        : 'unknown',

    birthDate: patient?.age
      ? calculateBirthDate(patient.age)
      : undefined,

    telecom: patient?.mobile
      ? [
          {
            system: 'phone',
            value: patient.mobile,
            use: 'mobile'
          }
        ]
      : []
  }
}


function calculateBirthDate(age) {
  const today = new Date()

  const birthYear =
    today.getFullYear() - Number(age)

  return `${birthYear}-01-01`
}


export function createFHIRCase(patient, caseSummary, redFlag) {

  const patientResource =
    createFHIRPatient(patient)

  const caseId =
    `medikiosk-case-${Date.now()}`

  return {
    resourceType: 'Bundle',

    id: caseId,

    type: 'collection',

    timestamp: new Date().toISOString(),

    entry: [
      {
        fullUrl: `urn:uuid:${patientResource.id}`,

        resource: patientResource
      },

      {
        fullUrl: `urn:uuid:${caseId}-condition`,

        resource: {
          resourceType: 'Condition',

          id: `${caseId}-condition`,

          subject: {
            reference:
              `Patient/${patientResource.id}`
          },

          code: {
            text:
              caseSummary?.complaint ||
              'Clinical complaint not provided'
          },

          clinicalStatus: {
            coding: [
              {
                system:
                  'http://terminology.hl7.org/CodeSystem/condition-clinical',

                code: 'active',

                display: 'Active'
              }
            ]
          }
        }
      },

      {
        fullUrl: `urn:uuid:${caseId}-observation`,

        resource: {
          resourceType: 'Observation',

          id: `${caseId}-observation`,

          status: 'final',

          code: {
            text: 'MediKiosk Patient Case Summary'
          },

          subject: {
            reference:
              `Patient/${patientResource.id}`
          },

          valueString: JSON.stringify(
            caseSummary || {}
          )
        }
      },

      {
        fullUrl: `urn:uuid:${caseId}-risk`,

        resource: {
          resourceType: 'Observation',

          id: `${caseId}-risk`,

          status: 'final',

          code: {
            text: 'Clinical Red Flag Status'
          },

          subject: {
            reference:
              `Patient/${patientResource.id}`
          },

          valueString:
            redFlag
              ? 'Red Flag Detected'
              : 'No Red Flag Detected'
        }
      }
    ]
  }
}
