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

  const port = process.env.CONNECTOR_PORT || 5022;
  await app.listen(port);
  console.log(`MedTrust connector running on port ${port}`);

  const worker = app.get(ConnectorWorkerService);
  worker.start();
}
bootstrap();
