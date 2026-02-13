# Data Masking Guide

## Overview

MedTrust automatically masks sensitive data in API responses based on user roles, ensuring privacy compliance and data protection.

## Quick Start

### 1. Using Masked Decorator

Apply the `@Masked` decorator to DTO properties:

```typescript
import { Masked } from '../security/decorators';

export class PatientDTO {
  id: number;

  @Masked('name')
  name: string;

  @Masked('phone')
  phoneNumber: string;

  @Masked('idCard')
  idCard: string;

  @Masked('email')
  email: string;

  // Non-sensitive fields are not masked
  age: number;
  gender: string;
}
```

### 2. Masking Types

| Type | Example Input | Masked Output | Use Case |
|------|--------------|---------------|----------|
| `phone` | `13812345678` | `138****5678` | Phone numbers |
| `idCard` | `110101199001011234` | `110101********1234` | ID cards |
| `name` | `张三` | `张*` | Personal names |
| `email` | `zhangsan@example.com` | `zh****an@example.com` | Email addresses |

## How It Works

1. **Interceptor**: `MaskingInterceptor` runs on all HTTP responses
2. **Metadata**: Reads `@Masked` decorator metadata from DTOs
3. **Role Check**: Determines if masking should be applied based on user role
4. **Transformation**: Applies masking functions to sensitive fields

## Role-Based Masking

### Admin Users (No Masking)

```typescript
// User with role 'admin' or 'ADMIN'
{
  "role": "admin",
  "id": 1
}

// Response: Full data visible
{
  "name": "张三",
  "phoneNumber": "13812345678",
  "idCard": "110101199001011234"
}
```

### Regular Users (Masked)

```typescript
// User with role 'user' or 'doctor'
{
  "role": "user",
  "id": 2
}

// Response: Sensitive data masked
{
  "name": "张*",
  "phoneNumber": "138****5678",
  "idCard": "110101********1234"
}
```

### Data Owner Bypass

Users accessing their own data see unmasked values:

```typescript
// User ID 5 accessing their own profile
GET /users/5

// Response: Unmasked (accessing own data)
{
  "id": 5,
  "name": "李四",
  "phoneNumber": "13987654321"
}
```

## Masking Patterns

### Phone Number Masking

```typescript
maskPhone('13812345678')     // '138****5678'
maskPhone('138-1234-5678')   // '138****5678' (strips formatting)
maskPhone('+86 138 1234 5678') // '138****5678'
```

**Pattern**: Shows first 3 and last 4 digits for 11-digit numbers.

### ID Card Masking

```typescript
maskIdCard('110101199001011234')  // '110101********1234' (18-digit)
maskIdCard('110101900101123')     // '110101*****0123' (15-digit)
```

**Pattern**: Shows first 6 and last 4 digits.

### Name Masking

```typescript
// Chinese names
maskName('张三')      // '张*'
maskName('张三丰')    // '张**'

// English names
maskName('John Smith')  // 'J*** S.'
maskName('John')        // 'J**n'
```

**Pattern**:
- Chinese: Shows first character only
- English: Shows first letter of each word

### Email Masking

```typescript
maskEmail('zhangsan@example.com')  // 'zh****an@example.com'
maskEmail('ab@example.com')        // 'a*@example.com'
```

**Pattern**: Shows first 2 and last 2 characters of local part.

## Configuration

### Disable Masking Globally

```typescript
// In SecurityModule
@Module({
  providers: [
    // Comment out to disable masking
    // {
    //   provide: APP_INTERCEPTOR,
    //   useClass: MaskingInterceptor,
    // },
  ],
})
export class SecurityModule {}
```

### Custom Masking Logic

Extend the interceptor for custom rules:

```typescript
@Injectable()
export class CustomMaskingInterceptor extends MaskingInterceptor {
  protected shouldSkipMasking(user: any, data: any): boolean {
    // Custom logic
    if (user.department === 'medical') {
      return true; // Medical staff see unmasked data
    }
    return super.shouldSkipMasking(user, data);
  }
}
```

## Usage Examples

### Controller with Masked Response

```typescript
@Controller('patients')
export class PatientController {
  @Get(':id')
  async getPatient(@Param('id') id: number): Promise<PatientDTO> {
    const patient = await this.patientService.findOne(id);
    return plainToClass(PatientDTO, patient);
  }
}
```

### Array Responses

Masking works automatically with arrays:

```typescript
@Get()
async listPatients(): Promise<PatientDTO[]> {
  const patients = await this.patientService.findAll();
  return patients.map(p => plainToClass(PatientDTO, p));
}

// Response: All items masked
[
  { "name": "张*", "phoneNumber": "138****5678" },
  { "name": "李*", "phoneNumber": "139****1234" }
]
```

### Nested Objects

```typescript
export class MedicalRecordDTO {
  id: number;

  @Masked('name')
  patientName: string;

  diagnosis: string;

  doctor: {
    @Masked('name')
    name: string;
  };
}
```

## Audit Logging

All unmasked access is logged for compliance:

```typescript
{
  "action": "UNMASKED_ACCESS",
  "userId": 1,
  "userRole": "admin",
  "status": "skipped",
  "timestamp": "2026-02-11T10:30:00.000Z"
}
```

### Enable/Disable Audit Logs

```bash
# .env
AUDIT_LOG_UNMASKED_ACCESS=true
```

## Testing

### Unit Tests

```typescript
describe('Masking', () => {
  it('should mask phone number', () => {
    expect(maskPhone('13812345678')).toBe('138****5678');
  });
});
```

### Integration Tests

```typescript
describe('PatientController', () => {
  it('should mask data for regular users', async () => {
    const response = await request(app.getHttpServer())
      .get('/patients/1')
      .set('Authorization', `Bearer ${regularUserToken}`)
      .expect(200);

    expect(response.body.phoneNumber).toContain('****');
  });

  it('should not mask data for admin users', async () => {
    const response = await request(app.getHttpServer())
      .get('/patients/1')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.phoneNumber).not.toContain('****');
  });
});
```

## Best Practices

1. **Apply to DTOs, Not Entities**: Use `@Masked` on DTOs, not database entities
2. **Consistent Patterns**: Use standard masking types for consistency
3. **Document Behavior**: Clearly document which fields are masked in API docs
4. **Test Both Roles**: Test with both admin and regular user roles
5. **Audit Compliance**: Regularly review audit logs for compliance

## Troubleshooting

### Masking Not Applied

**Cause**: Interceptor not registered or DTO not used.

**Solution**:
- Ensure `SecurityModule` is imported
- Return DTO instances, not plain objects
- Use `plainToClass()` to convert entities to DTOs

### All Data Masked (Including Admin)

**Cause**: User role not properly set in request context.

**Solution**: Verify JWT payload includes `role` field:

```typescript
{
  "sub": 1,
  "username": "admin",
  "role": "admin"  // Must be present
}
```

### Custom Masking Not Working

**Cause**: Metadata not properly attached.

**Solution**: Ensure decorator is applied to DTO class properties, not entity properties.

## API Reference

### Masking Functions

```typescript
function maskPhone(phone: string | null): string | null;
function maskIdCard(idCard: string | null): string | null;
function maskName(name: string | null): string | null;
function maskEmail(email: string | null): string | null;
```

### Decorator

```typescript
function Masked(type: 'phone' | 'idCard' | 'name' | 'email'): PropertyDecorator;
```

## Further Reading

- [GDPR Data Minimization](https://gdpr.eu/data-minimization/)
- [Chinese Personal Information Protection Law](https://www.china-briefing.com/news/china-personal-information-protection-law-pipl-overview/)
- [NestJS Interceptors](https://docs.nestjs.com/interceptors)
