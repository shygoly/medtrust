export interface FhirObservation {
  resourceType: "Observation";
  id?: string;
  status:
    | "registered"
    | "preliminary"
    | "final"
    | "amended"
    | "corrected"
    | "cancelled";
  category?: Array<{
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
  }>;
  code: {
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
    text?: string;
  };
  subject?: {
    reference?: string;
    display?: string;
  };
  effectiveDateTime?: string;
  valueQuantity?: {
    value?: number;
    unit?: string;
    system?: string;
    code?: string;
  };
  valueString?: string;
  interpretation?: Array<{
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
  }>;
}

export interface DomainObservation {
  id: number;
  patientId: number;
  observationType: string;
  value: string | number;
  unit?: string;
  status: string;
  observedAt: Date;
  fhirResource?: FhirObservation;
}

export class ObservationTransform {
  static toFHIR(observation: DomainObservation): FhirObservation {
    if (observation.fhirResource) {
      return observation.fhirResource;
    }

    const isNumeric = typeof observation.value === "number";

    return {
      resourceType: "Observation",
      id: observation.id.toString(),
      status: this.mapStatus(observation.status),
      category: [
        {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "vital-signs",
              display: "Vital Signs",
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: "http://loinc.org",
            code: this.mapObservationTypeToLOINC(observation.observationType),
            display: observation.observationType,
          },
        ],
        text: observation.observationType,
      },
      subject: {
        reference: `Patient/${observation.patientId}`,
      },
      effectiveDateTime: observation.observedAt.toISOString(),
      ...(isNumeric
        ? {
            valueQuantity: {
              value: observation.value as number,
              unit: observation.unit,
              system: "http://unitsofmeasure.org",
              code: observation.unit,
            },
          }
        : {
            valueString: observation.value.toString(),
          }),
    };
  }

  static fromFHIR(
    fhirObservation: FhirObservation,
  ): Partial<DomainObservation> {
    const patientRef = fhirObservation.subject?.reference;
    const patientId = patientRef ? parseInt(patientRef.split("/")[1], 10) : 0;

    const observationType =
      fhirObservation.code.coding?.[0]?.display ||
      fhirObservation.code.text ||
      "Unknown";

    let value: string | number;
    let unit: string | undefined;

    if (fhirObservation.valueQuantity) {
      value = fhirObservation.valueQuantity.value || 0;
      unit = fhirObservation.valueQuantity.unit;
    } else {
      value = fhirObservation.valueString || "";
    }

    return {
      patientId,
      observationType,
      value,
      unit,
      status: fhirObservation.status,
      observedAt: fhirObservation.effectiveDateTime
        ? new Date(fhirObservation.effectiveDateTime)
        : new Date(),
      fhirResource: fhirObservation,
    };
  }

  private static mapStatus(status: string): FhirObservation["status"] {
    const statusMap: Record<string, FhirObservation["status"]> = {
      registered: "registered",
      preliminary: "preliminary",
      final: "final",
      amended: "amended",
      corrected: "corrected",
      cancelled: "cancelled",
    };
    return statusMap[status.toLowerCase()] || "final";
  }

  private static mapObservationTypeToLOINC(type: string): string {
    // Simplified mapping - actual implementation would have comprehensive LOINC codes
    const loincMap: Record<string, string> = {
      "Blood Pressure": "85354-9",
      "Heart Rate": "8867-4",
      "Body Temperature": "8310-5",
      "Respiratory Rate": "9279-1",
      "Blood Glucose": "2339-0",
      "Body Weight": "29463-7",
      "Body Height": "8302-2",
    };
    return loincMap[type] || "8310-5"; // Default to body temperature
  }
}
