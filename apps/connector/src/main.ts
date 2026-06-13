import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Connector runs on the participant's local side. It does NOT expose data
// endpoints; it pulls authorized tasks from the control plane outbound.
// Port 5022 per the repo's 5020–5029 convention (see CLAUDE.md).
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.CONNECTOR_PORT || 5022;
  await app.listen(port);
  console.log(`MedTrust connector running on port ${port} (outbound task pull; no data endpoints)`);
}
bootstrap();
