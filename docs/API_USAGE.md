# MedTrust API Documentation

## Privacy Computing APIs

### Federated Learning

#### Submit FL Job
```http
POST /api/privacy/fl/jobs
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Cross-hospital diabetes prediction",
  "fl_type": "horizontal",
  "algorithm": "logistic_regression",
  "participants": [
    {
      "party_id": 1,
      "role": "guest",
      "endpoint": "https://hospital1.example.com"
    },
    {
      "party_id": 2,
      "role": "host",
      "endpoint": "https://hospital2.example.com"
    }
  ],
  "training_params": {
    "epochs": 10,
    "batch_size": 32,
    "learning_rate": 0.01
  }
}
```

#### Query Job Status
```http
GET /api/privacy/fl/jobs/:id
Authorization: Bearer <token>
```

#### Download Model
```http
GET /api/privacy/fl/jobs/:id/model
Authorization: Bearer <token>
```

### Multi-Party Computation

#### Create MPC Session
```http
POST /api/privacy/mpc/sessions
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Cross-hospital patient count",
  "computation_type": "secure_sum",
  "participants": [
    {
      "party_id": 0,
      "tenant_id": 1,
      "endpoint": "https://hospital1.example.com"
    },
    {
      "party_id": 1,
      "tenant_id": 2,
      "endpoint": "https://hospital2.example.com"
    }
  ],
  "timeout_seconds": 300
}
```

#### Submit Share
```http
POST /api/privacy/mpc/sessions/:id/shares
Authorization: Bearer <token>
Content-Type: application/json

{
  "party_id": 0,
  "value": 150
}
```

#### Query Result
```http
GET /api/privacy/mpc/sessions/:id/result
Authorization: Bearer <token>
```

### Trusted Execution Environment

#### Create TEE Computation
```http
POST /api/privacy/tee/computations
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Gene analysis for patient cohort",
  "computation_type": "gene_analysis",
  "computation_params": {
    "algorithm": "gwas",
    "threshold": 0.05
  },
  "user_public_key": "base64-encoded-public-key"
}
```

#### Get Attestation
```http
GET /api/privacy/tee/computations/:id/attestation
Authorization: Bearer <token>
```

#### Submit Computation Data
```http
POST /api/privacy/tee/computations/:id/submit
Authorization: Bearer <token>
Content-Type: multipart/form-data

data: <encrypted-file>
```

## Blockchain APIs

### Submit Attestation
```http
POST /api/blockchain/attest
Authorization: Bearer <token>
Content-Type: application/json

{
  "attestation_type": "prescription",
  "data_id": "prescription-12345",
  "data": "prescription data to be hashed",
  "metadata": {
    "patient_id": "P001",
    "doctor_id": "D001",
    "drug_name": "Metformin"
  }
}
```

### Verify Attestation
```http
POST /api/blockchain/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "data": "prescription data to verify",
  "attestation_id": 123
}
```

### Query Attestations
```http
GET /api/blockchain/attestations?attestation_type=prescription&from_date=2026-01-01
Authorization: Bearer <token>
```

## FHIR APIs

### Create Patient
```http
POST /api/fhir/Patient
Authorization: Bearer <token>
Content-Type: application/json

{
  "resourceType": "Patient",
  "name": [{
    "family": "Zhang",
    "given": ["Wei"]
  }],
  "gender": "male",
  "birthDate": "1980-01-01"
}
```

### Search Patients
```http
GET /api/fhir/Patient?name=Zhang
Authorization: Bearer <token>
```

### Create Observation
```http
POST /api/fhir/Observation
Authorization: Bearer <token>
Content-Type: application/json

{
  "resourceType": "Observation",
  "status": "final",
  "code": {
    "coding": [{
      "system": "http://loinc.org",
      "code": "8867-4",
      "display": "Heart Rate"
    }]
  },
  "subject": {
    "reference": "Patient/1"
  },
  "valueQuantity": {
    "value": 72,
    "unit": "beats/minute"
  }
}
```

## Health Check

```http
GET /health
```

Returns overall system health including all external services.
