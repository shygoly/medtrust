import { Column, ColumnOptions } from "typeorm";
import { createEncryptionTransformer } from "../../shared/transformers/encryption.transformer";

export function EncryptedColumn(
  keyId: string,
  options?: ColumnOptions,
): PropertyDecorator {
  return function (target: any, propertyKey: string | symbol) {
    const columnOptions: ColumnOptions = {
      type: "varchar",
      length: 500,
      transformer: createEncryptionTransformer(keyId),
      ...options,
    };

    Column(columnOptions)(target, propertyKey);
  };
}
