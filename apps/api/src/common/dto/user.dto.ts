import { Masked } from '../../security/decorators';

export class UserDTO {
  id: number;

  username: string;

  @Masked('email')
  email: string;

  @Masked('name')
  fullName: string;

  @Masked('phone')
  phoneNumber?: string;

  role: string;

  tenantId: number;

  isActive: boolean;

  createdAt: Date;

  lastLoginAt?: Date;
}
