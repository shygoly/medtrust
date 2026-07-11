import { SetMetadata } from "@nestjs/common";

export const MASKED_METADATA_KEY = "masked";

export type MaskingType = "phone" | "idCard" | "name" | "email";

export function Masked(type: MaskingType): PropertyDecorator {
  return SetMetadata(MASKED_METADATA_KEY, type);
}
