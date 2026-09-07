import { IsIn, IsString, MaxLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

// P1-6:证照/LOGO 上传。前端以 base64 dataURL 提交,服务端负责大小/类型白名单
// 与对象存储落盘;返回随机 key,不暴露原始文件名。
export class UploadDto {
  @ApiProperty({ example: "license", enum: ["license", "logo"] })
  @IsIn(["license", "logo"])
  kind: "license" | "logo";

  @ApiProperty({ example: "business-license.jpg" })
  @IsString()
  @MaxLength(200)
  fileName: string;

  @ApiProperty({ example: "image/jpeg" })
  @IsString()
  contentType: string;

  @ApiProperty({ example: "data:image/jpeg;base64,/9j/..." })
  @IsString()
  dataBase64: string;
}
