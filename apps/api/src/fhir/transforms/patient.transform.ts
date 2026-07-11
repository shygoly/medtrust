export interface FhirPatient {
  resourceType: "Patient";
  id?: string;
  identifier?: Array<{
    system?: string;
    value: string;
  }>;
  name?: Array<{
    use?: string;
    family?: string;
    given?: string[];
  }>;
  telecom?: Array<{
    system?: string;
    value?: string;
    use?: string;
  }>;
  gender?: "male" | "female" | "other" | "unknown";
  birthDate?: string;
  address?: Array<{
    use?: string;
    line?: string[];
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }>;
  active?: boolean;
}

export interface DomainPatient {
  id: number;
  name: string;
  idCard: string;
  phoneNumber: string;
  age: number;
  gender: string;
  address?: string;
  email?: string;
  isActive: boolean;
  fhirResource?: FhirPatient;
}

export class PatientTransform {
  static toFHIR(patient: DomainPatient): FhirPatient {
    // If FHIR resource already exists, return it
    if (patient.fhirResource) {
      return patient.fhirResource;
    }

    // Calculate birth date from age (approximate)
    const currentYear = new Date().getFullYear();
    const birthYear = currentYear - patient.age;
    const birthDate = `${birthYear}-01-01`;

    return {
      resourceType: "Patient",
      id: patient.id.toString(),
      identifier: [
        {
          system: "http://medtrust.example.com/patient-id",
          value: patient.id.toString(),
        },
      ],
      name: [
        {
          use: "official",
          family: patient.name.split(" ")[0],
          given: patient.name.split(" ").slice(1),
        },
      ],
      telecom: [
        {
          system: "phone",
          value: patient.phoneNumber,
          use: "mobile",
        },
        ...(patient.email
          ? [
              {
                system: "email",
                value: patient.email,
                use: "home",
              },
            ]
          : []),
      ],
      gender: this.mapGender(patient.gender),
      birthDate,
      address: patient.address
        ? [
            {
              use: "home",
              line: [patient.address],
            },
          ]
        : undefined,
      active: patient.isActive,
    };
  }

  static fromFHIR(fhirPatient: FhirPatient): Partial<DomainPatient> {
    const name = fhirPatient.name?.[0];
    const fullName = name
      ? `${name.family || ""} ${name.given?.join(" ") || ""}`.trim()
      : "";

    const phone = fhirPatient.telecom?.find((t) => t.system === "phone");
    const email = fhirPatient.telecom?.find((t) => t.system === "email");

    // Calculate age from birthDate
    let age = 0;
    if (fhirPatient.birthDate) {
      const birthYear = new Date(fhirPatient.birthDate).getFullYear();
      const currentYear = new Date().getFullYear();
      age = currentYear - birthYear;
    }

    return {
      name: fullName,
      phoneNumber: phone?.value || "",
      email: email?.value,
      age,
      gender: this.mapGenderFromFHIR(fhirPatient.gender),
      address: fhirPatient.address?.[0]?.line?.join(", "),
      isActive: fhirPatient.active !== false,
      fhirResource: fhirPatient,
    };
  }

  private static mapGender(gender: string): FhirPatient["gender"] {
    const genderMap: Record<string, FhirPatient["gender"]> = {
      男: "male",
      女: "female",
      male: "male",
      female: "female",
      other: "other",
    };
    return genderMap[gender.toLowerCase()] || "unknown";
  }

  private static mapGenderFromFHIR(gender?: FhirPatient["gender"]): string {
    const genderMap: Record<string, string> = {
      male: "男",
      female: "女",
      other: "other",
      unknown: "unknown",
    };
    return genderMap[gender || "unknown"] || "unknown";
  }
}
