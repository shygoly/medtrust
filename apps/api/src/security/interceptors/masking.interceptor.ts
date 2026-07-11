import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { Reflector } from "@nestjs/core";
import {
  MASKED_METADATA_KEY,
  MaskingType,
} from "../decorators/masked.decorator";
import {
  maskPhone,
  maskIdCard,
  maskName,
  maskEmail,
} from "../utils/masking.utils";

@Injectable()
export class MaskingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MaskingInterceptor.name);

  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (this.shouldSkipMasking(user, data)) {
          this.auditLog("UNMASKED_ACCESS", user, "skipped");
          return data;
        }

        return this.applyMasking(data, user);
      }),
    );
  }

  private shouldSkipMasking(user: any, data: any): boolean {
    if (!user) {
      return false;
    }

    if (user.role === "admin" || user.role === "ADMIN") {
      return true;
    }

    return false;
  }

  private applyMasking(data: any, user: any): any {
    if (!data) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.maskObject(item, user));
    }

    if (typeof data === "object") {
      return this.maskObject(data, user);
    }

    return data;
  }

  private maskObject(obj: any, user: any): any {
    if (!obj || typeof obj !== "object") {
      return obj;
    }

    const constructor = obj.constructor;
    if (!constructor || constructor === Object || Array.isArray(obj)) {
      const result = Array.isArray(obj) ? [] : {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          result[key] = this.applyMasking(obj[key], user);
        }
      }
      return result;
    }

    const maskedObj = { ...obj };

    for (const propertyKey of Object.keys(maskedObj)) {
      const maskingType = this.reflector.get<MaskingType>(
        MASKED_METADATA_KEY,
        constructor,
      );

      if (maskingType) {
        maskedObj[propertyKey] = this.maskValue(
          maskedObj[propertyKey],
          maskingType,
        );
      }
    }

    return maskedObj;
  }

  private maskValue(value: any, type: MaskingType): any {
    if (value === null || value === undefined) {
      return value;
    }

    switch (type) {
      case "phone":
        return maskPhone(value);
      case "idCard":
        return maskIdCard(value);
      case "name":
        return maskName(value);
      case "email":
        return maskEmail(value);
      default:
        return value;
    }
  }

  private auditLog(action: string, user: any, status: string): void {
    this.logger.log({
      action,
      userId: user?.id,
      userRole: user?.role,
      status,
      timestamp: new Date().toISOString(),
    });
  }
}
