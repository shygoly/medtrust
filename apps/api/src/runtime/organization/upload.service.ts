import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface UploadedFile {
  key: string;
  url?: string;
}

const MAX_BYTES: Record<"license" | "logo", number> = {
  license: 5 * 1024 * 1024, // 营业执照 ≤5M
  logo: 2 * 1024 * 1024, // LOGO ≤2M
};
const ALLOWED_TYPES = ["image/jpeg", "image/png"];
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

// P1-6:证照/LOGO 上传。优先使用 S3 兼容对象存储(复用 DEPLOY.md 已登记
// BUCKET_NAME/AWS_* env);未配置时开发环境落本地 data/uploads,生产 fail-closed。
@Injectable()
export class UploadService {
  private readonly s3Configured = Boolean(
    process.env.BUCKET_NAME &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY,
  );

  async save(
    userId: number,
    input: {
      kind: "license" | "logo";
      fileName: string;
      contentType: string;
      dataBase64: string;
    },
  ): Promise<UploadedFile> {
    const maxBytes = MAX_BYTES[input.kind];
    if (!ALLOWED_TYPES.includes(input.contentType)) {
      throw new BadRequestException("仅支持 JPG/PNG 图片");
    }
    const ext = EXT[input.contentType] || "jpg";
    const safeName = input.fileName
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 80);
    const key = `certifications/${userId}/${input.kind}/${randomUUID()}.${ext}`;

    // 剥离 dataURL 前缀,得到纯 base64。
    const base64 = input.dataBase64.replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(base64, "base64");
    if (buf.byteLength === 0) throw new BadRequestException("文件内容为空");
    if (buf.byteLength > maxBytes) {
      const mb = Math.round(maxBytes / 1024 / 1024);
      throw new BadRequestException(`文件大小不能超过 ${mb}M`);
    }

    if (this.s3Configured) {
      await this.putS3(key, buf, input.contentType, safeName);
      return { key, url: this.objectUrl(key) };
    }
    if (process.env.NODE_ENV === "production") {
      throw new ServiceUnavailableException("对象存储未配置");
    }
    // 开发模式:落本地 data/uploads,便于联调。
    const localDir = join(
      process.cwd(),
      "data",
      "uploads",
      String(userId),
      input.kind,
    );
    mkdirSync(localDir, { recursive: true });
    const file = join(localDir, `${key.split("/").pop()}`);
    writeFileSync(file, buf);
    return { key: `local:${file}`, url: `local://${file}` };
  }

  // P1-6:读取已上传文件(S3 或本地)。仅允许访问本用户前缀下的 key。
  async getFile(
    userId: number,
    key: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const allowedPrefix = `certifications/${userId}/`;
    if (
      !key.startsWith(allowedPrefix) &&
      !key.startsWith(`local:${process.cwd()}`)
    ) {
      throw new BadRequestException("无权访问该文件");
    }

    if (key.startsWith("local:")) {
      const path = key.slice("local:".length);
      if (!existsSync(path)) throw new NotFoundException("文件不存在");
      const body = readFileSync(path);
      const ext = path.split(".").pop()?.toLowerCase();
      return {
        body,
        contentType: ext === "png" ? "image/png" : "image/jpeg",
      };
    }

    if (!this.s3Configured) throw new NotFoundException("文件不存在");
    const client = new S3Client({
      region: process.env.AWS_REGION || "auto",
      endpoint: process.env.AWS_ENDPOINT_URL_S3 || "https://t3.storage.dev",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    const resp = await client.send(
      new GetObjectCommand({ Bucket: process.env.BUCKET_NAME!, Key: key }),
    );
    const body = Buffer.from(await resp.Body!.transformToByteArray());
    return { body, contentType: resp.ContentType ?? "image/jpeg" };
  }

  private async putS3(
    key: string,
    body: Buffer,
    contentType: string,
    safeName: string,
  ): Promise<void> {
    const client = new S3Client({
      region: process.env.AWS_REGION || "auto",
      endpoint: process.env.AWS_ENDPOINT_URL_S3 || "https://t3.storage.dev",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.BUCKET_NAME!,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: { originalName: safeName },
      }),
    );
  }

  private objectUrl(key: string): string {
    const bucket = process.env.BUCKET_NAME!;
    const endpoint =
      process.env.AWS_ENDPOINT_URL_S3 || "https://t3.storage.dev";
    return `${endpoint}/${bucket}/${key}`;
  }
}
