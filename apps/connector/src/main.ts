import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConnectorWorkerService } from './domain/connector-worker.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.enableShutdownHooks();

  // Fly / ops health probe (no auth — worker is outbound-pull only).
  app.getHttpAdapter().get('/health', (_req, res) => {
    res.json({ ok: true, service: 'medtrust-connector' });
  });

  const port = process.env.CONNECTOR_PORT || 5022;
  // 显式绑 IPv4 通配：默认 `listen(port)` 走 `::`，在本部署（Docker 网络纯 IPv4）里
  // 会被宿主/跨容器的 IPv4 连接视作不可达（实测：本机 127.0.0.1 通、同网段其他容器 timeout）。
  await app.listen(port, '0.0.0.0');
  console.log(`MedTrust connector running on port ${port}`);

  const worker = app.get(ConnectorWorkerService);
  worker.start();
}
bootstrap();
