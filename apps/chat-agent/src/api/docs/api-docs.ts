import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

/**
 * 组装 OpenAPI 文档（4.5.3）。
 *
 * 抽出来是因为它**必须**能被测试挂载：只写在 `main.ts` 的 bootstrap 里的话，
 * e2e 用 TestingModule 起的应用没有文档端点，"文档与实现同源"就只剩口号。
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('MedTrust Chat Agent API')
      .setDescription(
        '对话式任务配置服务：自然语言 → Card Message → MDOP 作业。' +
          '本 spec 由代码装饰器生成，与实现同源。',
      )
      .setVersion('0.1.0')
      .addTag('chat', '对话与会话')
      .build(),
  );
}

/** 挂载 `/api/docs`（UI）与 `/api/docs-json`（机器可读）。 */
export function setupApiDocs(app: INestApplication): OpenAPIObject {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, document);
  return document;
}
