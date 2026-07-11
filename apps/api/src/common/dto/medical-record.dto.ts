import { Masked } from "../../security/decorators";

export class MedicalRecordDTO {
  id: number;

  patientId: number;

  @Masked("name")
  patientName: string;

  diagnosis: string;

  treatment: string;

  doctorId: number;

  @Masked("name")
  doctorName: string;

  recordDate: Date;

  notes?: string;

  createdAt: Date;
}
