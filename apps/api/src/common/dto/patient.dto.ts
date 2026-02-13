import { Masked } from '../../security/decorators';

export class PatientDTO {
  id: number;

  @Masked('name')
  name: string;

  @Masked('phone')
  phoneNumber: string;

  @Masked('idCard')
  idCard: string;

  @Masked('email')
  email?: string;

  age: number;

  gender: string;

  address?: string;

  createdAt: Date;

  updatedAt: Date;
}
